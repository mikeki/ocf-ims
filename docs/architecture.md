# Architecture

The layers, the data model, configuration, auth and the audit log of the OCF IMS
Go service. This is the reference half of what used to live in `CLAUDE.md`;
`CLAUDE.md` keeps the commands and the rules a change must honour and points
here for the why. The Expo client's own layout is in
`packages/interface/README.md` and its design rules in
`packages/interface/DESIGN.md`; the platform plan is `docs/plans/09-proto-connect-platform.md`.

## Layers

### High-Level Structure

The codebase follows a layered architecture:

- **`main.go`** - Entry point that delegates to `cmd` package
- **`cmd/`** - Cobra CLI commands (`serve`, `healthcheck`, `hashpassword`)
- **`api/`** - HTTP API handlers and middleware for the REST/JSON API
- **`web/`** - Web UI handlers, templates (templ), TypeScript, and static assets
- **`store/`** - Database layer for the IMS database (incidents, field reports, etc.)
- **`directory/`** - User directory layer (local IMS-DB-backed people store behind the `IUserStore` seam)
- **`lib/`** - Reusable utilities (auth, logging, caching, formatting, etc.)
- **`json/`** - JSON serialization types for the API
- **`packages/interface/`** - Expo mobile and web client (React Native, Expo Router, TypeScript)

### Database Architecture

The system uses a **single IMS database** (`store/` package) for both incident data
and the people directory. The `directory/` package no longer owns its own database;
it reads the local `PERSON`/`POSITION`/`TEAM` tables that live in the IMS schema (see
`docs/plans/32-retire-clubhouse.md` — the external Clubhouse directory was retired).

The IMS database uses **sqlc** for type-safe SQL code generation:
- SQL schema: the `store/schema/migrations/` directory (the goose migrations are
  the single schema source — sqlc reads them, see `sqlc.yaml`)
- SQL queries: `store/queries.sql` (incidents, field reports, **and** the local
  people-directory queries)
- Generated Go code: `store/imsdb/`

### Database Migrations

Schema changes are managed with [**goose**](https://github.com/pressly/goose).
There is a **single schema source of truth**: the `store/schema/migrations/`
directory. goose applies it on boot (`store.MigrateDB`, called from
`cmd/serve.go`), and sqlc reads the same directory for codegen — so there is no
separate `current.sql` to keep in sync. See `docs/plans/08-db-migration-tooling.md`.

To modify the schema:

1. Scaffold a new migration with goose — this gets the sequential numbering and
   the `Up`/`Down` annotations right, and needs no database:
   ```bash
   go run github.com/pressly/goose/v3/cmd/goose@v3.27.1 \
       -dir store/schema/migrations -s create <description> sql
   ```
   (Run from `go/` — goose is a `go run`, so it needs the module context, and
   `-dir store/schema/migrations` then resolves under `go/`. Pin the goose version to the one in `go.mod`. The
   ad-hoc `@version` form is used deliberately — it keeps goose's heavy
   multi-driver CLI deps out of our `go.mod`. This writes
   `store/schema/migrations/NNNNN_<description>.sql`.)
2. Fill in the generated `-- +goose Up` / `-- +goose Down` sections with your DDL
   (one logical change — see conventions below).
3. Regenerate sqlc code: `go tool sqlc generate` — it builds its schema model
   from the migrations' `Up` sections, so this also fails on SQL that doesn't
   parse.
4. Update `store/queries.sql` if you changed tables/columns it touches; fix any
   broken Go.
5. `go test ./...` — `go test ./store/integration` **applies the new migration to
   a real MariaDB**, the authoritative check that it migrates cleanly and that a
   fresh DB and an adopted one still converge.

Optional quick static check of the migration files (no DB):
```bash
go run github.com/pressly/goose/v3/cmd/goose@v3.27.1 -dir store/schema/migrations validate
```

Conventions:
- **No manual version bookkeeping.** goose tracks applied migrations in its own
  `goose_db_version` table — there is no `SCHEMA_INFO` and nothing to hand-bump.
- **Append-only.** Past migrations are immutable history; never edit or delete an
  applied one. Add a new migration instead.
- **One logical DDL change per migration**, kept small: MariaDB DDL is **not
  transactional**, so a multi-statement migration that fails partway can't be
  cleanly rolled back.
- **Schema-only** — migrations don't seed or transform domain data. Reference
  data shipped to *every* environment (e.g. the `INCIDENT_TYPE` taxonomy) lives
  in the baseline migration. Environment-specific seed data is loaded separately
  (see `IMS_SEED` under Configuration; `store.Seed`).
- **`Down` migrations** are written best-effort for dev convenience; production
  rolls forward, never `goose down`.

**Migration test.** `store/integration/migrate_test.go` brings up MariaDB via
testcontainers and checks that goose migrates a fresh DB to head, that
`MigrateDB` is idempotent, and that the baseline's tables exist.

### Configuration

Configuration uses environment variables loaded from a `.env` file (copy from `.env.example`).

Key configuration concepts:
- **User directory**: always the local IMS-DB `PERSON` table (dev users seeded from `store/fakeimsdb/seed.sql`); there is no directory-type selector
- **DB store types**: `MariaDB` (persistent storage) or `noop` (no-op for testing only)
- **Seed profile** (`IMS_SEED`): `none` (default — schema-only, used in prod) or
  `demo` (loads `store/fakeimsdb/seed.sql` into an empty DB on boot, idempotent;
  set in `docker-compose.dev.yml`). New profiles (e.g. a future secret-free
  `prod` bootstrap) plug into `conf.SeedProfile` + `store.Seed`.
- **Attachments stores**: `local` (filesystem) or `s3` (AWS S3)
- **Dev CORS** (`IMS_CORS_ALLOWED_ORIGINS`): comma-separated exact origins (e.g.
  `http://localhost:8081`, the Expo dev server) allowed to call the Connect RPCs and
  the attachment/profile-picture routes cross-origin with credentials. Unset = off
  (no `Access-Control-*` header is emitted); production is same-origin and leaves it
  unset. A malformed entry (path, trailing slash, wildcard) fails boot.

Demo/test users live in the IMS-DB `PERSON` table, seeded from
`store/fakeimsdb/seed.sql` (loaded into the `ims-db` container **only on first
init**). To add one: hash the password with `./ocf-ims hash_password
--password='…'` (argon2id), append a `PERSON` row with `STATUS = 'active'` to
`seed.sql`, and — if the dev stack is already running — also `insert` the row into
the live container (`docker exec -i ranger-ims-db mariadb -uims -pims ims`). New
users become loginable after the in-memory directory cache TTL (default 5 min, see
`conf.InMemoryCacheTTL`) or an immediate `docker restart ocf-ims`.

### API Structure

The API (`api/` package) uses a custom middleware adapter pattern:
- `AddToMux()` in `api/mux.go` registers all routes
- Handlers implement a specific interface and are wrapped with middleware adapters
- Middleware includes: authentication, logging, panic recovery, request size limits

### Web UI

The web UI uses:
- **templ** - Type-safe Go templates (`.templ` files generate `.go` files)
- **TypeScript** - Compiled to JavaScript via tsgo (in `web/typescript/`, output to `web/static/`)
- Custom mux pattern similar to the API

### Testing Strategy

- **Unit tests**: Throughout the codebase using `testify` assertions
- **Integration tests**: `store/integration/` and `api/integration/` use testcontainers to spin up real MariaDB
- **Playwright tests**: Browser automation tests in `playwright/tests/`

### Code Generation Tools

The project uses several code generators (all invoked by the build script):

1. **sqlc** - Generates type-safe Go code from SQL
2. **templ** - Compiles `.templ` templates to Go code
3. **tsgo** - TypeScript compiler wrapper that transpiles to JavaScript

## Development Patterns

### Directory/User Store Pattern

The `directory.UserStore` provides user lookups with caching behind the
`directory.IUserStore` consumer interface. Its data comes from a pluggable
`personSource`; today the only backend is `localSource` (the IMS-DB
`PERSON`/`POSITION`/`TEAM` tables), but the seam is kept so a future alternate source
can plug in and inherit the caching.

### Store Pattern

The `store.DBQ` wraps a `*sql.DB` and sqlc-generated `Querier` interface, providing database access throughout the application.

### Authentication

JWT-based authentication with separate access and refresh tokens:
- Access tokens: Short-lived (default 15 min)
- Refresh tokens: Long-lived (default 7 days)
- Tokens signed with `IMS_JWT_SECRET`
- The refresh token has two homes (plan 09i E4 / 09j): the web client keeps it in the
  HttpOnly `refresh_token` cookie; the native Expo client asks `Login` for it in the body
  (`return_refresh_token`, then **no** cookie is set) and sends it back in
  `RefreshTokenRequest.refresh_token` — body wins, cookie is the fallback. `Logout`
  clears the cookie and is audited; there is no server-side revocation.

Passwords are stored locally (argon2id hash in `PERSON.PASSWORD`); there is no
external credential provider (Clubhouse was retired). There is no self-service /
emailed password reset yet — a locked-out user asks a crew leader or an admin to
reset it. A privileged user resets a password from **Admin → People & Passwords**
(`/ims/app/admin/people`), which calls `POST /ims/api/personnel/{handle}/password`.
For seeding/scripts, the `hash_password` CLI prints an argon2id hash to write into
`PERSON.PASSWORD` directly.

### Authorization

Event-based access control defined in `lib/authz/`:
- Users have specific access modes per event (read, write, report)
- Admins have unrestricted access. A user is an admin solely if their local
  `PERSON.IS_ADMIN` flag is set — there is no admin env list. The flag is managed
  in-app from **Admin → People & Passwords** via
  `POST /ims/api/personnel/{handle}/admin`, and rides in the JWT, so a change takes
  effect on the next access-token refresh. The endpoint refuses to clear the last
  remaining admin (409). **Only admins may change admin status**: the toggle is
  gated on the caller actually being an admin (`claims.PersonAdmin()`), *not* on the
  delegatable `GlobalAdministratePersonnel` — so delegating personnel management
  (e.g. password resets) to a future crew-leader role never implies the power to
  mint admins. **Bootstrap:** OCF launches on a fresh DB, so the first admin is
  seeded by inserting a `PERSON` row with `IS_ADMIN = true` (password hashed via the
  `hash_password` CLI); the dev seed marks Miguel as an admin.
- Global permissions (e.g. `GlobalAdministratePersonnel`, which gates password
  resets) are granted via roles in `RolesToGlobalPerms`. Today only the
  `Administrator` role holds the admin-level globals; a future roles model may grant
  individual globals to non-admins (e.g. crew leaders) without changing the handlers
  that check them.
- **Private incidents** (`INCIDENT.PRIVATE`): an incident marked private is visible
  only to an admin, its creator (`CREATED_BY`), and people granted per-incident access
  (the 52f `INCIDENT__PERSON.GRANTED_ACCESS` grant) — **event-wide read is not
  sufficient**, so writers/crew-leaders can't see it. The shared helper
  `mayViewIncident` in `internal/incident/incident.go` encodes this; an unauthorized single
  read returns **404** (not 403) so the incident's existence stays hidden. Only an admin or
  the creator may toggle the flag (enforced in `updateIncident`; `isJournalOnly`
  excludes `Private` so a granted reporter can't flip it). **When adding any new
  endpoint that surfaces incident content (summary, people, journal entries,
  attachments), it must honor privacy** — see how `GetIncident`/`ListIncidents`/
  `GetIncidentAttachment`/notifications/metrics/linked-incident summaries were gated.
  **Writes honor it too:** `UpdateIncident`, attach/detach a person and strike a journal
  entry all pass through `requireIncidentVisible` (`internal/incident/connect.go`), so a
  private incident the caller may not view answers 404 on the write path as well. The SSE
  "poke" stream (`GET /ims/api/eventsource`) requires the refresh-token cookie and redacts a
  private incident's number at publish time (`EventSourcerer` privacy oracle → a number-less
  `update_all` poke); the accepted residual is that *some* activity in an event is observable
  to an authenticated subscriber. The per-subscriber Connect stream `WatchEvent` (plan 09p,
  built 2026-09-10) filters through `mayViewIncident` per subscriber, so that residual is retired
  for stream subscribers; it remains only for the legacy SSE route until Phase 4 deletes it.
  Non-sensitive attributes (state, priority, type, area) may still feed aggregate
  dashboard counts.

### Action Logging

Mutating API requests are recorded to an action log (`store/actionlog/`) for
audit purposes. Logging is **opt-in per endpoint**: each route registers
`LogRequest(true|false, …)` in `api/mux.go`, and an endpoint wired with `false`
(or one that forgets the adapter) is silently *unlogged*. The log captures
**metadata only** — method, path, user, client address, HTTP status, and
duration — never the request or response body, so password/credential payloads
are never at risk of being logged.

**When adding a new mutating endpoint, register it with `LogRequest(true, …)`.**
Reads are typically `false`; anything that changes state should be `true`. Treat
this as a code-review checklist item — the flag is easy to omit and fails closed
(unlogged) rather than loudly.

## Key Differences from Python Version

- No SQLite support (MariaDB only for persistent storage)
- Uses `.env` file instead of `conf/imsd.conf`
- "File" directory type renamed to "TestUsers" and implemented as compiled Go code
- Heavy use of sqlc code generation instead of ORM
