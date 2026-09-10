# 09m — The staging instance (Phase 3, between 3a.2 and 3a.3)

> **Status:** Merged (#244). Bring-up on the host done 2026-09-09 up to the proxy
> (§ *Build notes*); the vhost + DNS are pending, then step 2 (§ *Step 2*).
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3; the 3a gate) under
> [09-proto-connect-platform.md](09-proto-connect-platform.md)
> **Follows:** [09l](09l-client-foundations.md) (3a.2, merged as #242) and the SPDX header
> chore (#243). Master is the base, no stacking (09i E16).
> **Owner:** Architect tier (the compose and docs are mechanic-sized, but the cookie / CORS
> / token-lifetime analysis is the part that matters, so it was done directly). The host
> bring-up runs as its own agent session **on the server**, from the brief below.
> **Last updated:** 2026-09-09

## Objective

Miguel's decision of 2026-09-09: the laptop cannot run the docker dev stack (the `air`
first build is OOM-killed, the bind-mounted MariaDB data is corrupt), so **every
Phase-3 hand check, and the 3a.3 Playwright tracer, runs against a deployed testing
instance**. This slice defines that instance — **staging** — and puts everything the
host needs in the repo:

- the **production image** (`ghcr.io/mikeki/ocf-ims`, built and pushed by CI on every
  master merge that passes the tests) **following master automatically**, so the
  server side of each merged slice is on staging within minutes;
- **seeded with the demo data** (`IMS_SEED=demo`), so testers and the tracer sign in
  as the seed users with no account admin;
- at **its own hostname behind the same Caddy** the production runbook already
  describes, beside production on Miguel's home server, isolated by compose project,
  checkout directory, `.env` and volumes.

Step 2 (its own PR, § *Step 2*) puts the **Expo web export at `/`** on that hostname —
the 09i E9 topology. The cookie analysis below shows this is required for the web
hand checks, not a nicety.

## Decisions (S1–S7)

| # | Decision | Why |
|---|---|---|
| S1 | **A second image-based stack beside production**: `docker-compose.staging.yml` = `docker-compose.prod.yml` with the test knobs; compose project `ocf-ims-staging`; its own checkout (`/opt/ocf-ims-staging`) and `.env`; its own volumes; container names `ocf-ims-staging` / `ocf-ims-staging-db`; joins the proxy's external network (`web`, overridable via `PROXY_NETWORK` for a host that names it differently). | Everything the runbook already established for production is reused: the host never compiles, Caddy is the only thing publishing ports, containers are reached by name. A distinct project name is what keeps `--remove-orphans` on one stack from touching the other. |
| S2 | **Follows master by pulling**: `IMAGE_TAG=latest` + `pull_policy: always`, and `deploy/staging-pull.sh` from cron every 10 min (prints a line only when the image changed). No CI-side push to the host. | `latest` is only ever moved by `docker-publish`, which runs after lint, the Go suite and the image test — so staging can only receive a tested build. A pull model needs no deploy key, no inbound access and no secret in GitHub. Pin `IMAGE_TAG=<sha>` in `.env` to freeze it for a test session. |
| S3 | **Demo seed, never real data.** `IMS_SEED=demo` loads `store/fakeimsdb/seed.sql` into an empty DB (idempotent). Seed logins are public (`miguel@example.com` / `Miguel`, `shadowdancer@example.com` / `ShadowDancer`, `teammember@example.com` / `TeamMember`; password = handle). Reset = `down -v` + `up -d`. The Caddy block adds `X-Robots-Tag: noindex`. | The tracer and a tester need known logins; the demo host has run these publicly for months. The consequence is a rule, not a mitigation: nothing real ever goes on staging. |
| S4 | **The client-work knobs are `.env` passthroughs** with safe empty defaults: `IMS_CORS_ALLOWED_ORIGINS` (default `http://localhost:8081,http://localhost:8082` — Metro web and the Playwright `expo serve` port), `IMS_ACCESS_TOKEN_LIFETIME` (seconds, default 900; 90 to watch the proactive refresh), `IMS_DEFAULT_PASSWORD` (empty = off; set to exercise the forced password change). `IMS_DEPLOYMENT=staging` (a value `conf.DeploymentType` already accepts), `DEBUG` logs. | Verified against `cmd/serveconfig.go`: an empty `IMS_CORS_ALLOWED_ORIGINS` is "off", an empty `IMS_DEFAULT_PASSWORD` skips the 8–256 length check, `IMS_ACCESS_TOKEN_LIFETIME` is parsed as whole seconds; a non-dev deployment refuses to boot without a ≥ 32-char `IMS_JWT_SECRET` (the compose hard-fails on an unset one). |
| S5 | **Web checks need the web build hosted on staging (step 2).** The refresh cookie is `HttpOnly; Secure; SameSite=Strict` (`internal/auth/connect.go`). A browser on `http://localhost:8081` is *cross-site* to `https://ims-staging.…`, and Chrome neither sends nor even stores a `Strict` cookie from a cross-site response — so Metro-on-the-laptop against staging can sign in and read for one access-token lifetime, but never refreshes and never resumes a reload. (The local docker stack only worked because `localhost:8081` → `localhost:8090` is *same-site*: ports do not count.) Native is unaffected (body-carried refresh token, no cookie). | This is the finding of the slice (plan 09 §7). It fixes what step 2 is for: same origin. It also means the CORS allow-list is a convenience for reads, not the web session path. |
| S6 | **Step 2 = E9 on staging**: CI builds `ghcr.io/mikeki/ocf-ims-web` from the `Interface` job's `expo export` (a `caddy` file server with the SPA fallback), the staging compose gains a `web` service, and the Caddy block routes `/ims/*` and `/ocf.ims.service.v1.ImsService/*` to the Go container and everything else to the web container. `EXPO_PUBLIC_API_URL` stays unset in that build (web = same origin, 09l F13). | Same origin ⇒ the cookie flows, CORS is not involved, and a phone browser can open the app with no laptop. The Go image stays JS-free (the 0a finding); the web build gets its own deploy cadence. |
| S7 | **The 3a.3 tracer targets staging by environment**: the spec reads `E2E_BASE_URL` (the hosted web build) plus `E2E_EMAIL` / `E2E_PASSWORD`, and skips when unset; the CI `Interface` job keeps the export smoke and does not reach staging. | CI must not depend on a home server being up; the tracer is a hand-triggered check from a dev machine until a self-hosted runner exists (not planned). |

## What the slice leaves behind

```
docker-compose.staging.yml          # S1–S4; the prod compose with the test knobs
deploy/.env.staging.example         # the .env template (secrets, IMAGE_TAG, seed, client knobs, PROXY_NETWORK)
deploy/staging-pull.sh              # cron: pull latest, up -d, log only on change (S2)
deploy/Caddyfile.example            # + the ims-staging block (noindex; step-2 note)
docs/deployment.md                  # + "Staging instance" section (bring-up, follow, reset, knobs, the cookie limit)
packages/interface/README.md        # + "against the staging instance" (EXPO_PUBLIC_API_URL; what web-from-Metro proves)
CLAUDE.md                           # Expo section: hand checks run against staging
docs/plans/09i-expo-client.md       # staging row in the 3a table; the 3a gate names staging + step 2
docs/plans/09l-client-foundations.md# status → Merged (#242)
docs/plans/README.md                # 09l row → Merged; 09m row
docs/plans/09-proto-connect-platform.md  # §7 finding: a Strict cookie needs a same-site client
```

Nothing in `go/` or `packages/interface/src` changes.

## Bring-up brief — for the agent session on the server

This section is the whole prompt for a Claude Code session running **on Miguel's home
server** (the Docker host that runs, or will run, production per `docs/deployment.md`).
Clone the repo there first (it holds the compose files; nothing is built on the host),
then follow this in order. Report back what § *Report* asks for.

**Ground rules.** Do not touch the production stack (`ocf-ims` project, `/opt/ocf-ims`)
or its volumes. Do not run `docker-compose.dev.yml` (air) anywhere. Never commit or
paste the filled-in `.env`. Put no real data on staging. Ask before anything
destructive outside the `ocf-ims-staging` project.

1. **Discover the host.** Record: Docker and Compose v2 versions (`docker version`,
   `docker compose version`); whether the shared proxy network exists (`docker network
   ls` — the runbook's name is `web`; the demo host used `maybloom-proxy`); the Caddy
   container's name and where its Caddyfile lives (Miguel keeps host specifics in a
   private ops repo, `ocf-reverse-proxy`, not in this repo); whether production is
   running (`docker compose -p ocf-ims ps`); free RAM and disk (`free -h`, `df -h` —
   staging needs ~1 GiB RAM and a few GB). Which hostname staging gets and where its
   DNS record is made is Miguel's call — ask.
2. **Checkout and env.**
   ```bash
   sudo git clone --depth 1 https://github.com/mikeki/ocf-ims /opt/ocf-ims-staging
   cd /opt/ocf-ims-staging
   cp deploy/.env.staging.example .env
   ```
   Fill in `IMS_JWT_SECRET=$(openssl rand -hex 32)` and `IMS_DB_PASSWORD=$(openssl rand
   -hex 24)`. Set `PROXY_NETWORK=` if the proxy network is not called `web`. Leave
   `IMAGE_TAG=latest`, `IMS_SEED=demo` and the CORS default. `chmod 600 .env`.
3. **Bring it up.**
   ```bash
   docker compose -f docker-compose.staging.yml pull
   docker compose -f docker-compose.staging.yml up -d
   docker compose -f docker-compose.staging.yml logs -f ims-go   # migrations, the seed, then serving
   docker compose -f docker-compose.staging.yml ps                # both healthy
   docker exec ocf-ims-staging /opt/ims/bin/ims healthcheck --server_url http://localhost:80   # "OK"
   ```
   The GHCR package is public; no registry login is needed.
4. **Caddy.** Add the `ims-staging.` block from `deploy/Caddyfile.example` to the
   host's Caddyfile with the real hostname (keep `X-Robots-Tag`, keep
   `reverse_proxy ocf-ims-staging:80`), make sure the Caddy container is on the same
   proxy network, reload Caddy (`docker exec <caddy> caddy reload --config
   /etc/caddy/Caddyfile`, or however that host does it). Create the DNS record. Caddy
   provisions the certificate on first request.
5. **Verify from outside the host.**
   ```bash
   curl -fsS https://<staging host>/ims/api/ping        # "ack"
   curl -sI https://<staging host>/ | grep -i x-robots   # noindex
   ```
   Then in a browser: open `https://<staging host>/ims/app`, sign in as
   `miguel@example.com` / `Miguel`, see the seeded events and incidents.
6. **Follow master.** Install the cron line:
   ```
   */10 * * * * /opt/ocf-ims-staging/deploy/staging-pull.sh >> /var/log/ims-staging-deploy.log 2>&1
   ```
   Run the script once by hand and confirm it is a no-op (no output) right after a
   fresh pull.
7. **Report.** The staging hostname; the proxy network name used; the image digest /
   SHA running (`docker compose -f docker-compose.staging.yml images`); the outputs of
   step 5; anything in the runbook or this brief that was wrong on this host (that
   goes into § *Build notes* here, via a PR or a note to Miguel). Do not include the
   contents of `.env`.

## Using it from a dev machine

- **Native (iOS simulator / Android emulator):** `EXPO_PUBLIC_API_URL=https://<staging
  host> pnpm -F @ocf-ims/interface start`, then `i` / `a`. The whole session works
  (body-carried refresh token): sign in, kill, relaunch → still signed in; set
  `IMS_ACCESS_TOKEN_LIFETIME=90` on staging to watch the proactive refresh; sign out
  wipes SecureStore.
- **Web from Metro** (`w`): sign-in and reads only, for one access-token lifetime (S5).
  Good enough to look at screens, not to prove the session.
- **Web for real:** the hosted build after step 2 — open `https://<staging host>/`.
- **The 3a.3 tracer:** `E2E_BASE_URL=https://<staging host> E2E_EMAIL=… E2E_PASSWORD=…
  pnpm -F @ocf-ims/interface e2e` once 3a.3 lands (S7).

## Step 2 — the Expo web export hosted on staging (next PR)

1. `packages/interface/Dockerfile`: `FROM caddy:2-alpine`, `COPY dist/ /srv`, a
   `Caddyfile` with `root * /srv`, `try_files {path} /index.html` (Expo Router on web
   is a single-page app: `web.output: single`), `file_server`, long cache headers for
   `/_expo/static/*` (content-hashed) and `no-cache` for `index.html`.
2. `cicd.yml`: an `interface-publish` job (`needs: [interface]`, master pushes only,
   `packages: write`) that downloads the export the `Interface` job uploads as an
   artifact (add that upload), builds the image with the Dockerfile above and pushes
   `ghcr.io/mikeki/ocf-ims-web:<sha>` + `:latest`. Egress allow-list gains `ghcr.io`
   and `pkg-containers.githubusercontent.com` (as `docker-publish` has). The export
   in CI is built with `EXPO_PUBLIC_API_URL` **unset** (same origin).
3. `docker-compose.staging.yml`: a `web` service (`ghcr.io/mikeki/ocf-ims-web:${WEB_IMAGE_TAG:-latest}`,
   `pull_policy: always`, `container_name: ocf-ims-staging-web`, on the proxy network,
   a `wget`-based healthcheck); `staging-pull.sh` pulls both.
4. `deploy/Caddyfile.example`, staging block: `handle /ims/*` and
   `handle /ocf.ims.service.v1.ImsService/*` → `reverse_proxy ocf-ims-staging:80`;
   `handle` (the rest) → `reverse_proxy ocf-ims-staging-web:80`. templ stays reachable at
   `/ims/app`; the Expo app owns `/`.
5. Hand checks then move to the hosted build: sign in on Chrome, reload → still signed
   in (cookie); `IMS_ACCESS_TOKEN_LIFETIME=90` → refresh observed in devtools; sign out
   clears the cookie. Recorded in 09l's checklist.
6. Later, production gets the same `web` service and Caddy split when 3c/3d say so
   (09i E9: "owns `/` on the production host from day one" refers to the day the Expo
   web build is what people use).

## Verification

Local, 2026-09-09 (no Docker daemon on the laptop; the compose file is validated by
`docker compose config`, which needs no daemon):

| Check | Result |
|---|---|
| `docker compose -f docker-compose.staging.yml --env-file <sample .env> config` | renders; the two `:?` secrets hard-fail when unset; `PROXY_NETWORK` override applied |
| `bash -n deploy/staging-pull.sh`; `shellcheck` | clean |
| Docs: every hostname is the `ims-staging.ocf.example.org` placeholder; no secret values anywhere | ok |

On the host: § *Bring-up brief* step 5 and the cron no-op are the acceptance checks.

## Checklist

- [x] Decisions + the cookie analysis written before the files
- [x] `docker-compose.staging.yml`, `deploy/.env.staging.example`, `deploy/staging-pull.sh`, Caddy block
- [x] Runbook section; client README; CLAUDE.md; 09i rows + gate; 09l → Merged; README rows
- [x] Plan 09 §7 finding
- [ ] PR opened; CI green; Miguel merges
- [ ] Bring-up on the home server (the server-side agent session, § *Bring-up brief*); report recorded under *Build notes*
- [ ] 09l hand check (native) done against staging → tick in 09l
- [ ] Step 2 PR: web image in CI, `web` service, Caddy path split; 09l hand check (web) against the hosted build
- [ ] 3a.3 tracer pointed at staging (S7)

## Build notes

The bring-up ran 2026-09-09 (evening, Pacific) on Miguel's home server (`maybloom`,
192.168.10.100; Docker 29.8.0, Compose v5.5.1; 11 GiB RAM with ~4 GiB free, 40 GB
free on `/`). What the host taught, against the brief:

- **No production stack exists on this host yet** — `docker compose -p ocf-ims ps`
  is empty and there is no `/opt/ocf-ims`. "Beside production" is for later; nothing
  had to be protected.
- **No passwordless sudo**, so nothing lives under `/opt` or `/var/log`. The checkout
  is `~/workspace/ocf-ims-staging` (a shallow clone of master over SSH), and the cron
  line is in the **user** crontab writing to `~/logs/ims-staging-deploy.log`:
  ```
  */10 * * * * /home/maybloom/workspace/ocf-ims-staging/deploy/staging-pull.sh >> /home/maybloom/logs/ims-staging-deploy.log 2>&1
  ```
- **The proxy is the maybloom stack's Caddy** (`maybloom-caddy-1`, compose and
  Caddyfile in `MaybloomTech/maybloom` under `infra/`, not an `ocf-reverse-proxy`
  repo), and no `web` / `maybloom-proxy` network existed. `docker network create web`
  was run once, so `PROXY_NETWORK` stays at its default; the Caddy joins it, and gets
  the vhost, through maybloom PR #67. That Caddyfile is a single-file bind mount, so
  the deploy there is `docker compose up -d --no-deps --force-recreate caddy`, not a
  reload.
- **Hostname:** on one of Miguel's domains, recorded with the vhost in that private
  repo, not here — a CNAME to the host's DDNS-tracked A record, which Miguel creates
  at the registrar. The LAN and the tailnet already resolve it to the server through
  the local resolver's wildcard rewrite.
- **The pull script was not quiet.** Compose v5.5.1 prints "Image … Pulled" /
  "Container … Running" on stderr despite `--quiet` / `--quiet-pull`; the cron log
  would have gained eight lines per run. Fixed with the global `--progress quiet`
  (this PR). With it, a run right after a fresh pull prints nothing.
- **First boot**: goose migrated the empty DB to version 28, the demo seed loaded,
  `ims healthcheck` said OK and `/ims/api/ping` answered `ack` from a sibling
  container on `web`, all within ~30 s of `up -d`. Running image:
  `ghcr.io/mikeki/ocf-ims@sha256:706e47d89f8da61eb6530f28c587bdde835e0e5b1bd682b4bada9e412436fa07`
  (the `:latest` of 2026-09-09 ~22:30 PDT, i.e. #244's master). The image carries no
  `org.opencontainers.image.revision` label, so the digest is the only way to say
  which commit is running — worth adding in `docker-publish`.
- The two named volumes sit in Docker's default root on the system disk. Acceptable
  for a re-seedable instance; nothing on staging is worth a ZFS dataset.

Brief steps 1–3 and 6 are done; 4 (vhost) lands with maybloom #67 plus the DNS record,
then 5 (the outside checks) closes the bring-up.

## Findings

Plan 09 §7, *Staging — a Strict cookie needs a same-site client*: the web session's
`SameSite=Strict` refresh cookie makes "dev server on the laptop against a deployed
API" unable to refresh or resume, which the local docker stack had hidden because
same-site ignores ports; the hosted web build (same origin) is the only web setup that
proves the session, and the native client is unaffected. Also: the staging instance
follows master by *pulling* a CI-tested `latest`, so a home server needs no inbound
access and GitHub holds no deploy secret.
