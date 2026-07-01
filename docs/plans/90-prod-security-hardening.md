# Plan 90 — Pre-production security & access-control hardening

Source: the 2026-07-01 pre-launch security audit (14 confirmed findings, 1 refuted).
Each item below is an **independent PR straight to master** (no stacking), sized to
be reviewed and merged on its own. Severities are the post-verification adjusted
values. Fix order is by risk, but any item can be picked up alone.

Standing constraints (see CLAUDE.md / memory): branch off master, target master,
merge manually after CI is green; `git add -A ':!.idea'`; generated code
(`web/static/*.js`, `web/template/*_templ.go`, `store/imsdb/`) is **not** committed —
regenerate with `go run bin/build/build.go`; run golangci `--fix` locally before
pushing (CI Linters fails on any modification); every new mutating endpoint registers
`LogRequest(true, …)`.

Global verification for any code PR: `go run bin/build/build.go` (codegen + compile),
`go test ./...`, golangci-lint `--fix`, and the relevant integration suite
(`go test ./api/integration ./store/integration`, Docker).

---

## PR 1 — HIGH: login rate-limiting + lockout  *(launch blocker)*

**Findings:** H1 (`api/auth.go:72`, no throttle/lockout) and M4 (`lib/authn/password.go:32`,
global argon2 mutex → auth DoS under login flood). One PR fixes both, plus mitigates
I1 (`/readyz` flood).

**Problem.** `POST /ims/api/auth` has only RecoverFromPanic / LogRequest /
LimitRequestBytes. No failed-attempt counter, backoff, or lockout. Handles/emails are
guessable → unbounded online credential-stuffing; a cracked admin = full access. And
every verify serialises on a process-wide mutex, so concurrent login spam starves
legitimate new logins.

**Approach (decide during implementation — see Open questions):**
- Add a **rate-limiting adapter** in the `api/` Adapter chain applied to `POST /ims/api/auth`
  (and `POST /ims/api/auth/refresh`). Track failures **per-IP and per-identification**
  with exponential backoff + a temporary lockout after ~5–10 failures. Shed load with
  `429` (with `Retry-After`) rather than queueing, so a flood can't starve the mutex.
- Client IP must come from the trusted proxy (Caddy) — honour `X-Forwarded-For` **only**
  from the known proxy hop; do not trust it blindly (spoofable = bypasses per-IP limits).
- Storage: in-memory (single-instance deploy, per `lib/cache`) is acceptable for launch;
  note it resets on restart. A DB-backed counter is the durable version — see Open questions.
- Consider a small concurrency cap / semaphore around the argon2 verify so a burst can't
  monopolise the mutex even within the rate limit.
- Optional belt-and-braces: a `rate_limit` directive at the Caddy layer
  (`deploy/Caddyfile.example`) for the auth path.

**Files:** new adapter in `api/` (near the other middleware), wired at `api/mux.go:88`
(auth) and the refresh route; possibly `lib/authn/password.go` for the concurrency cap;
`deploy/Caddyfile.example` if we also gate at the proxy.

**Tests:** unit test the limiter (N failures → 429/lockout; window resets; per-IP vs
per-account isolation; success resets the counter). An `api/integration` case that hammers
`/auth` and asserts lockout kicks in without affecting an already-authenticated session or
`/auth/refresh`.

**Action log:** `/auth` already `LogRequest(true, …)`; nothing new. Consider logging
lockout events at WARN (aligns with the round-8 severity-logging work).

**Open questions for the user:**
- Lockout thresholds/windows (e.g. 8 failures → 15-min lockout)?
- In-memory (resets on restart, fine for single instance) vs DB-backed counters?
- App-layer limiter, Caddy-layer, or both?

---

## PR 2 — MEDIUM: report journal-entry strike needs an ownership check

**Finding:** M1 (`api/journalentry.go:54`). The report strike endpoint gates only on
`EventWriteAllReports|EventWriteOwnReports`, so a `reporter`-tier user can strike/unstrike
journal entries on reports they don't own (report#/entry-id are enumerable), injecting a
"Struck journalEntry N" line under their name — audit-trail tampering.

**Fix.** Mirror `EditReport` (`api/report.go:276-297`): compute
`limitedAccess := eventPermissions&authz.EventWriteAllReports == 0`; when `limitedAccess`,
fetch the target report's journal entries and require
`containsAuthor(journalEntries, jwtCtx.Claims.PersonHandle())` (or reuse `isPreviousAuthor`)
before calling `SetReportJournalEntryStricken`; else `herr.Forbidden`.

**Files:** `api/journalentry.go` (the `EditReportJournalEntry.editJournalEntry` path only —
leave the incident strike path alone; incidents don't have the own-vs-all split the same way,
confirm during impl).

**Tests:** `api/integration` — a reporter-tier user striking their own report's entry
succeeds; striking another author's report's entry returns 403. An all-reports writer still
succeeds on any.

**Scope note:** self-contained authz fix, no schema/JSON/template change.

---

## PR 3 — MEDIUM: validate `IMS_JWT_SECRET` strength at boot

**Finding:** M2 (`cmd/serveconfig.go:100`, `conf/imsconfig.go` `Validate()`). Operator secret
is accepted verbatim; HS256 means a weak secret is offline-brute-forceable from one token →
forge `adm:true` → full bypass.

**Fix.** In `IMSConfig.Validate()`, when the deployment is **not** dev/test, reject a
`Core.JWTSecret` shorter than ~32 bytes (fail closed at boot with a clear message). Keep the
strong `rand.Text()` default for dev. Update `.env.example` guidance to show a 32-byte value
and how to generate it. Fix `cmd/serveconfig_test.go` (`"shhh"`) to use a valid-length secret
or a dev-deployment fixture.

**Files:** `conf/imsconfig.go` (Validate), `.env.example`, `cmd/serveconfig_test.go`,
possibly `docker-compose.prod.yml` comment.

**Tests:** unit — Validate rejects a short secret for prod deployment, accepts a long one,
still accepts the dev default.

**Watch:** don't break the per-boot dev rotation or existing tests that rely on the default.

---

## PR 4 — MEDIUM: authenticate the SSE `/eventsource` stream

**Finding:** M3 (`api/mux.go:599`). The stream omits `RequireAuthN` (every other data route
has it) and broadcasts `{event_id, incident/report/visit number}` for all events to any
anonymous client.

**Fix.** Wrap the route with `RequireAuthN(jwter)` like the sibling data routes.
**Caveat:** the browser `EventSource` client can't set an `Authorization` header, so confirm
how the SPA authenticates the stream today (`web/typescript/urls.ts:59`,
`requestEventSourceLock`) — auth may need to ride a cookie or a short-lived query token.
Investigate before choosing the mechanism. Stretch (optional, larger): filter the stream
per-subscriber to only events the user can read.

**Files:** `api/mux.go` (route), possibly `api/eventsource.go` + the TS client if the SPA
needs a token-passing tweak.

**Tests:** `api/integration` — unauthenticated GET `/ims/api/eventsource` → 401; authenticated
→ 200 stream. Verify the live SPA still receives updates (Playwright, once dev stack is up).

**Risk:** highest-touch of the mediums because of the client auth mechanism — scope the client
side first.

---

## PR 5 — LOW: security response headers

**Finding:** L2 (+ header half of L4). No HSTS / CSP / X-Frame-Options / Referrer-Policy /
`X-Content-Type-Options` anywhere; example Caddyfile is a bare `reverse_proxy`. (Clickjacking
of admin actions was **refuted** — Bearer-header auth from a SameSite=Strict cookie — so this
is defense-in-depth.)

**Fix.** Add a security-headers adapter in `web/mux.go` (and/or a header block in
`deploy/Caddyfile.example`): `Strict-Transport-Security`, a `Content-Security-Policy`
(start report-only to avoid breaking the SPA/importmap/inline theme.js — tune before
enforcing), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` /
`frame-ancestors 'none'`, `Referrer-Policy: no-referrer`.

**Files:** `web/mux.go` (new adapter), `deploy/Caddyfile.example`; maybe `api/mux.go`.

**Tests:** extend `web/mux_test.go` `TestTemplEndpoints` to assert the headers.

**Watch:** CSP is the tricky one — the app uses an importmap, deferred vendored scripts, and a
synchronous inline-ish `theme.js`. Ship CSP **report-only first**, or scope it carefully, so
we don't white-screen the SPA. nosniff/XFO/HSTS/Referrer-Policy are safe to add immediately.

---

## PR 6 — LOW: production compose hardening  *(batch)*

**Findings:** L5 (EOL MariaDB 10.5.27), L6 (no container resource limits), L7 (`:latest` on
security-sensitive images incl. `docker-socket-proxy`). One compose-only PR, no app code.

**Fix.**
- **L5:** bump prod DB to a supported LTS (11.4 LTS → 2029, or 10.11 LTS). Re-run
  `go test ./store/integration` (goose migrations + schema) against the chosen version before
  merge; bump `docker-compose.cicd.yml` / dev to match so we test what we ship.
- **L6:** add conservative `deploy.resources.limits` (memory + cpus) to `ims-go`, `ims-db`,
  and the monitoring services, sized to the 8 GiB/4 vCPU host.
- **L7:** pin every image to a fixed version **and digest** (`image@sha256:…`), especially
  `tecnativa/docker-socket-proxy`; make the app default a commit-SHA `IMAGE_TAG` (not
  `:latest`); pin `Dockerfile` base to `alpine:3.x`.

**Files:** `docker-compose.prod.yml`, `docker-compose.monitoring.yml`,
`docker-compose.cicd.yml`, `docker-compose.dev.yml` (DB version parity), `Dockerfile`,
`docs/deployment.md`.

**Tests:** `go test ./store/integration` on the new DB version; a local `docker compose config`
sanity check. Verify the app boots against the new DB locally.

**Watch:** the DB major-version bump is the real work here — validate migrations end-to-end and
confirm the demo host's existing data adopts cleanly (or plan the upgrade path) before touching
prod.

---

## PR 7 — decide/park (design calls, not obvious fixes)

- **L1 — roster/wristband readable by any authenticated user** (`permission.go:93`,
  `personnel.go:206`). `GlobalReadPersonnel` on `AnyAuthenticatedUser` powers @mentions /
  attach-person; the `?q=` typeahead lets any login enumerate names/handles (+ wristband with
  `?event=`). Email/phone/password stay withheld. **This is a documented (R4) design decision.**
  Decision needed: accept for launch (and maybe just drop `wristband` from non-admin results),
  or gate the typeahead behind an access-bearing per-event rung. → **User to decide.**
- **L3 — no server-side session revocation** (`api/password.go:101`). A stolen refresh cookie
  survives an admin password reset + logout for up to the 8h refresh lifetime (needs prior
  cookie theft; cookie is HttpOnly+Secure+SameSite=Strict). Fix = per-person token-generation
  counter in `PERSON`, bumped on reset/logout, checked on refresh — a schema + refresh-path
  change (larger). → **Defer unless we want it for launch.**
- **I1 — unauthenticated `/readyz` DB ping** (`api/mux.go:646`). Marginal; folds into PR 1 /
  restrict `/readyz` to the monitoring network. → **Park.**

---

## Refuted (no work) & confirmed positives
- **Refuted:** attachment upload → stored-XSS → JWT theft. `safeToPreviewContentType`
  (`api/attachment.go:186`) already downgrades HTML→text/plain, SVG→octet-stream. PR 5's nosniff
  header closes the residual; no separate work.
- **Positives (leave as-is):** SQLi-clean (sqlc parameterized), no permissive CORS, refresh
  cookie HttpOnly+Secure+SameSite=Strict + Bearer-header API auth (CSRF-safe), constant-time
  dummy verify defeats user-enumeration timing, `LimitRequestBytes` on every route, prod DB not
  host-exposed + randomized root + scoped user.

---

## Suggested order
1. **PR 1** (H1+M4) — launch blocker.
2. **PR 2, PR 3** — small, high-signal authz/authn fixes.
3. **PR 4** — needs the client-auth investigation first.
4. **PR 5** — headers (CSP report-only first).
5. **PR 6** — compose batch (DB bump is the effort).
6. **PR 7** — user decisions on L1 / L3.
