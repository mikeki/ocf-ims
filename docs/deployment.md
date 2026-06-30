# Production deployment runbook

How to run OCF IMS for the Fair on a single Docker host, behind Caddy, with
monitoring. This is the *production* path — do **not** run `docker-compose.dev.yml`
(air live-reload) in production: air keeps a container showing "Up" after the Go
process has crashed and never self-heals, which is how the 2026-06-28 demo outage
went unnoticed. Production uses the real `Dockerfile` (a plain static binary) with
a healthcheck and `restart: unless-stopped`, so a crash is visible and recovers.

**The host never compiles the app.** The image is built and pushed to GHCR by CI
(`.github/workflows/publish-image.yml`) on every merge to master; the deploy box
just pulls it. This matters on a small box — building the Go binary needs far more
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
# hash a password
docker exec -it ocf-ims /opt/ims/bin/ims hash_password
# insert the admin (HANDLE + EMAIL are required to log in; see the login note).
# Pass the DB password via MYSQL_PWD so it never lands in the process list.
MYSQL_PWD="$IMS_DB_PASSWORD" docker exec -e MYSQL_PWD -i ocf-ims-db mariadb -uims ims <<'SQL'
INSERT INTO PERSON (HANDLE, EMAIL, NAME, PASSWORD, IS_ADMIN)
VALUES ('YourHandle', 'you@ocf.example.org', 'Your Name', '<argon2id-hash>', true);
SQL
```

Log in matches HANDLE or EMAIL (never Name), so the admin row needs at least one
of those plus the password.

## How the image is built

`.github/workflows/publish-image.yml` builds the production `Dockerfile` and
pushes it to `ghcr.io/mikeki/ocf-ims` on every merge to master:

- `:<commit-sha>` — every master build (immutable; use for pinned rollouts/rollback).
- `:latest` — moved to the newest master build.

You can also trigger it manually from the Actions tab (`workflow_dispatch`); a
dispatch from a non-master branch pushes only its `:<sha>` tag, never `:latest`.

## Deploying an update

Merge to master → wait for the **Publish image** workflow to go green → on the host:

```bash
cd /opt/ocf-ims
git pull                                                # refresh compose/deploy files
docker compose -f docker-compose.prod.yml pull          # fetch the new image
docker compose -f docker-compose.prod.yml up -d         # rolling restart onto it
docker compose -f docker-compose.prod.yml logs -f ims-go # watch boot/migrations
```

To pin or roll back, set `IMAGE_TAG=<commit-sha>` in `.env` and re-run `pull` +
`up -d`. Migrations are append-only and run automatically on boot — take a DB
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

The DB lives in the `ims-db-data` volume — **a volume is not a backup.** Take
logical dumps and copy them off-host:

```bash
deploy/backup-db.sh                       # writes ./backups/ims-<ts>.sql.gz
# cron (daily 03:30):
30 3 * * * cd /opt/ocf-ims && BACKUP_DIR=/mnt/backups ./deploy/backup-db.sh >> /var/log/ims-backup.log 2>&1
```

Attachments (if used) live in the `ims-attachments` volume — back it up separately:
```bash
docker run --rm -v ocf-ims_ims-attachments:/data -v "$PWD/backups":/out alpine \
  tar czf /out/attachments-$(date +%Y%m%d).tar.gz -C /data .
```

## Operational notes

- **Stable `IMS_JWT_SECRET`.** Changing it (or leaving it unset → random per boot)
  logs everyone out on restart. Set it once in `.env`.
- **Reboots.** `restart: unless-stopped` brings everything back after a reboot. If
  the host has unattended auto-reboots (the demo host rebooted nightly at 02:00),
  consider disabling them for the event window so nothing restarts mid-Fair.
- **Recreate after compose changes.** A long-lived container can outlive its
  compose definition (a deleted bind-mount once exited a container 127 on the next
  reboot). After editing a compose file, `up -d` to recreate the affected service
  rather than leaving the old container running.
- **HTTPS is required** for web-push/service-workers — Caddy provides it.
