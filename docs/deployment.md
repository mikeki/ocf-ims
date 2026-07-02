# Production deployment runbook

How to run OCF IMS for the Fair on a single Docker host, behind Caddy, with
monitoring. This is the *production* path — do **not** run `docker-compose.dev.yml`
(air live-reload) in production: air keeps a container showing "Up" after the Go
process has crashed and never self-heals, which is how the 2026-06-28 demo outage
went unnoticed. Production uses the real `Dockerfile` (a plain static binary) with
a healthcheck and `restart: unless-stopped`, so a crash is visible and recovers.

**The host never compiles the app.** The image is built and pushed to GHCR by CI
(the `docker-publish` job in `.github/workflows/cicd.yml`, gated on the tests) on
every merge to master; the deploy box just pulls it. This matters on a small box — building the Go binary needs far more
RAM than running it — and makes redeploys fast. You still keep a lightweight
checkout of this repo on the host, but only for the compose files and `deploy/`
scripts, not to build.

## Topology

```
                        ┌────────────────────── Docker host (VM) ──────────────────────┐
  Internet ── 443 ──►  Caddy  ──(web network)──►  ocf-ims:80 ──(default net)──► ocf-ims-db
                        │                              │  └ volume: ims-attachments
                        ├─► uptime-kuma (alerts)       └ volume: ims-db-data
                        ├─► dozzle (logs)
                        └─► beszel-hub (+ agent)        all on the `web` network
```

- **`docker-compose.prod.yml`** — the app (`ocf-ims`) + MariaDB (`ocf-ims-db`).
- **`docker-compose.monitoring.yml`** — Uptime Kuma, Dozzle, Beszel.
- **Caddy** — your existing reverse proxy; terminates HTTPS, routes by hostname.
- A shared external Docker network named **`web`** connects Caddy to everything
  it proxies. Nothing publishes host ports.

## One-time host setup

1. Install Docker + Compose (done) and clone the repo (for the compose files and
   `deploy/` scripts — nothing is built here):
   ```bash
   sudo git clone --depth 1 https://github.com/mikeki/ocf-ims /opt/ocf-ims
   cd /opt/ocf-ims
   ```
   The app image is pulled from GHCR. If the `ocf-ims` package is public, no
   registry login is needed. If it's private, authenticate once with a PAT that
   has `read:packages`:
   ```bash
   echo "$GHCR_PAT" | docker login ghcr.io -u <github-user> --password-stdin
   ```
2. Create the shared proxy network and attach your Caddy container to it:
   ```bash
   docker network create web
   ```
   (Add `networks: [web]` to your Caddy service, or `docker network connect web <caddy>`.)
3. Create the production env file and fill in the secrets:
   ```bash
   cp deploy/.env.prod.example .env
   # IMS_JWT_SECRET=$(openssl rand -hex 32)   <- stable! never change mid-event
   # IMS_DB_PASSWORD=$(openssl rand -hex 24)
   $EDITOR .env
   ```
   `.env` is gitignored — it stays on the host, never in git.
4. Point Caddy at the app. Merge `deploy/Caddyfile.example` into your Caddyfile
   (replace the hello-world site), set real domains, and protect the monitoring
   subdomains with `basic_auth` (`caddy hash-password`).

## Bring it up

```bash
cd /opt/ocf-ims
docker compose -f docker-compose.prod.yml pull        # fetch the GHCR image
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.monitoring.yml up -d
```

No compile happens on the host — the app image is pulled from GHCR. On first boot
the app runs goose migrations against the empty DB (`start_period: 40s` keeps the
healthcheck from failing meanwhile).

Verify:
```bash
docker compose -f docker-compose.prod.yml ps        # both healthy
docker exec ocf-ims /opt/ims/bin/ims healthcheck --server_url http://localhost:80   # "OK"
curl -fsS https://ims.ocf.example.org/ims/api/ping   # "ack"
```

## Seed the first admin

A fresh prod DB is schema-only (`IMS_SEED=none`) — no users. Create the first
admin by hand, then manage everyone else in-app (Admin → People & Passwords):

```bash
# hash a password — `--password` is required (the command is non-interactive).
# Heads up: the plaintext lands in your shell history and the process list, so
# this is a deliberately one-off local bootstrap — clear it afterward (run it
# with a leading space, or `history -d`).
docker exec ocf-ims /opt/ims/bin/ims hash_password --password 'choose-a-strong-one'
# insert the admin (HANDLE + EMAIL are required to log in; see the login note).
# CREATED is NOT NULL with no default, so it must be set. The DB password lives
# only in .env (compose reads it) — load it into this shell first, then pass it
# via MYSQL_PWD so it never lands in the process list.
set -a; source .env; set +a
MYSQL_PWD="$IMS_DB_PASSWORD" docker exec -e MYSQL_PWD -i ocf-ims-db mariadb -uims ims <<'SQL'
INSERT INTO PERSON (HANDLE, EMAIL, NAME, PASSWORD, IS_ADMIN, CREATED)
VALUES ('YourHandle', 'you@ocf.example.org', 'Your Name', '<argon2id-hash>', true, UNIX_TIMESTAMP());
SQL
```

Log in matches EMAIL only (never the fair name / handle or the legal name), so the
admin row needs an email plus the password.

## How the image is built

The `docker-publish` job in `.github/workflows/cicd.yml` pushes to
`ghcr.io/mikeki/ocf-ims` — but only **after** lint, the Go test suite, and the
Docker-image test pass, and only on master pushes. It republishes the exact image
bytes that were tested (no rebuild). PRs build + test the image but never push.

- `:<commit-sha>` — every master build (immutable; use for pinned rollouts/rollback).
- `:latest` — moved to the newest master build.

## Deploying an update

`pull_policy: missing` means the host never upgrades on its own: a plain `up -d`
keeps running the local image. Upgrading is a deliberate `pull` + `up -d`.

**For the event, pin the version** — set `IMAGE_TAG=<commit-sha>` in `.env` so the
running version is fixed and reproducible, and nothing (not even an accidental
`pull`) moves it. To deploy a new build: merge to master → wait for **CI/CD** to go
green → on the host:

```bash
cd /opt/ocf-ims
git pull                                                # refresh compose/deploy files
# bump IMAGE_TAG=<new-sha> in .env (or leave at latest if you accept rolling),
docker compose -f docker-compose.prod.yml pull          # fetch that image
docker compose -f docker-compose.prod.yml up -d         # rolling restart onto it
docker compose -f docker-compose.prod.yml logs -f ims-go # watch boot/migrations
```

Roll back by setting `IMAGE_TAG` to the previous SHA and re-running `pull` + `up
-d`. Migrations are append-only and run automatically on boot — take a DB
backup (below) before deploying anything that adds a migration.

## Monitoring

- **Uptime Kuma** (`status.` subdomain) — add two monitors and a notification:
  - HTTP `https://ims.ocf.example.org/ims/api/ping`, keyword `ack`.
  - HTTP the public home page.
  - Notification (email / Slack / ntfy / push) that leaves the host, so a full
    host-down still reaches you. Consider one *external* free uptime check too —
    an on-host monitor can't report that the host itself is dead.
- **Dozzle** (`logs.` subdomain) — live logs for every container. Reads through
  the read-only `docker-socket-proxy`, not a mounted root socket.
- **Beszel** (`metrics.` subdomain) — host + per-container CPU/mem/disk. The agent
  is opt-in (it needs an auth KEY first): open the hub, "Add system", copy the KEY
  into `BESZEL_KEY` in `.env`, then start it under the `agent` profile:
  ```bash
  docker compose -f docker-compose.monitoring.yml --profile agent up -d beszel-agent
  ```

## Backups

The DB lives in the `ims-db-data` volume — **a volume is not a backup.** Run
`backup-db.sh` on a schedule for logical dumps:

```bash
deploy/backup-db.sh                       # writes ./backups/ims-<ts>.sql.gz
# cron (daily 03:30):
30 3 * * * cd /opt/ocf-ims && ./deploy/backup-db.sh >> /var/log/ims-backup.log 2>&1
```

These local dumps are the baseline and recover from the most likely mishaps —
a bad migration, an accidental delete, or DB-volume corruption — instantly and
with no extra infra. They do **not** survive losing the whole host, so the
upgrade (do it when convenient) is to copy each dump off the box: set
`BACKUP_DIR=/mnt/some-mount`, or add an `scp`/`rsync`/`aws s3 cp` of the latest
`.sql.gz` to another machine or bucket (reuse the attachments S3 bucket if you
configure one).

Attachments (if used) live in the `ims-attachments` volume — back it up separately:
```bash
docker run --rm -v ocf-ims_ims-attachments:/data -v "$PWD/backups":/out alpine \
  tar czf /out/attachments-$(date +%Y%m%d).tar.gz -C /data .
```

## Operational notes

- **Stable `IMS_JWT_SECRET`.** Changing it (or leaving it unset → random per boot)
  logs everyone out on restart. Set it once in `.env`.
- **Reboots.** `restart: unless-stopped` brings everything back after a reboot,
  but Docker does **not** honor `depends_on`/health ordering across a reboot — it
  just restarts both containers. If `ims-go` comes up before MariaDB is accepting
  connections, it fails its DB ping and exits; Docker restarts it, and it keeps
  cycling until the DB is healthy (typically tens of seconds while MariaDB does its
  InnoDB recovery). So recovery is automatic but **not instant** — expect a brief
  502 window right after a cold reboot, until `ims-go` catches a healthy DB. To
  avoid surprise reboots entirely, disable the host's unattended auto-reboots (the
  demo host rebooted nightly at 02:00) for the event window.
- **Recreate after compose changes.** A long-lived container can outlive its
  compose definition (a deleted bind-mount once exited a container 127 on the next
  reboot). After editing a compose file, `up -d` to recreate the affected service
  rather than leaving the old container running.
- **HTTPS is required** for web-push/service-workers — Caddy provides it.
