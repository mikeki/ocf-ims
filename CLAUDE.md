# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OCF IMS is an Incident Management System for the Oregon Country Fair, used to track incidents at the Fair. It is a Go codebase forked from the Black Rock Rangers' Ranger IMS (itself a Go implementation that replaced an earlier Python version).

## Development Commands

> **The Go module lives under `go/`** (relocated in plan 09f). **Run every Go
> command from `go/`** — `go build`, `go test`, `go run bin/…`, `make`,
> `go tool …`, `golangci-lint`. The commands below assume that working directory.
> The proto contract (`proto/`), the buf configs, and the pnpm/TypeScript tier
> stay at the **repo root**; buf runs from `go/` pointed at `../proto`. Playwright
> and `docker compose` also run from the **repo root**. See
> `docs/plans/09f-server-restructure.md` (diverging roots).

### Initial Setup

First-time setup to fetch external build dependencies (from `go/`):
```bash
cd go && go run bin/fetchbuilddeps/fetchbuilddeps.go
```

### Building

Build the server (runs sqlc, templ, tsgo, and buf code generation, then compiles) — from `go/`:
```bash
go run bin/build/build.go
# or
make build
```

The build outputs an `ocf-ims` binary in `go/` (the module root).

### Running the Server

Run with MariaDB (requires `.env` file configuration) — from `go/`:
```bash
./ocf-ims serve
```

Run with live reloading using air (from `go/`):
```bash
make run/live
# or
go tool air
```

Run with Docker Compose (includes auto-seeded databases) — from the **repo root**:
```bash
docker compose -f docker-compose.dev.yml up
```

### Testing

Run all Go tests (from `go/`):
```bash
go test ./...
# or
make test
```

Run tests with coverage report (from `go/`):
```bash
go test -coverprofile=coverage.out --coverpkg ./... ./... && go tool cover -html=coverage.out
# or
make cover
```

Run integration tests (requires Docker) — from `go/`:
```bash
go test ./store/integration
go test ./api/integration
```

Run Playwright browser tests (requires Playwright installed) — from the **repo root**:
```bash
cd playwright
npx playwright test
```

### Expo client (`packages/interface`)

The replacement client (plan 09i; scaffold 09k): Expo SDK 57 + Expo Router,
TypeScript strict, a package in the repo-root pnpm workspace. **Run its commands
from the repo root**, and **generate first** — it imports the proto TypeScript from
`@ocf-ims/protocol-buffers`, which is git-ignored `buf` output:

```bash
pnpm install --frozen-lockfile
pnpm generate                          # buf web template → packages/protocol-buffers/src (needs Go)
pnpm -F @ocf-ims/interface typecheck   # tsc --noEmit
pnpm lint                              # biome, whole workspace (client included)
pnpm -F @ocf-ims/interface test        # jest-expo
pnpm -F @ocf-ims/interface export:web  # expo export -p web → packages/interface/dist
pnpm -F @ocf-ims/interface e2e         # Playwright (Chromium) against the export
pnpm -F @ocf-ims/interface start       # Metro dev server on :8081
```

The `Interface` CI job runs the same list, which includes only the environment-free
Playwright smoke; the tracer (`e2e/tracer.spec.ts`) walks the full sign-in → events →
incidents → incident → sign-out flow against the staging instance and runs only when
`E2E_EMAIL`/`E2E_PASSWORD` (and, for the hosted build, `E2E_BASE_URL`) are set by hand.
Against the docker stack the dev server
is cross-origin: set `IMS_CORS_ALLOWED_ORIGINS=http://localhost:8081` (see
Configuration). **Hand checks run against the staging instance**
(`docs/deployment.md`, "Staging instance"; `EXPO_PUBLIC_API_URL=https://<staging
host>`), not a local stack — and web refresh only works on the hosted web build
there, since the refresh cookie is `SameSite=Strict`. After changing an
`EXPO_PUBLIC_*` value pass `--clear` to `start` / `export:web`: Metro caches the
inlined value. Staging follows master about ten minutes behind CI. Every `.ts`/`.tsx` file
starts with the one-line SPDX license header (see Linting). Imports: `@/x` is `src/x`; generated protos
are deep-imported (`@ocf-ims/protocol-buffers/ocf/ims/…/x_pb`); **no barrel
files**. `ios/`, `android/`, `.expo/`, `dist/` and `expo-env.d.ts` are generated
and never committed. See `packages/interface/README.md`.

**Design.** `src/design/tokens.ts` is the only file that may hold a colour,
spacing, font-size or duration literal; everything else reads them through
`useTheme()`. The direction those values encode, the state / priority colour
language and the motion budget (press feedback only — a 0.97 press-in scale over
120 ms, nothing enters with an animation on a list, reduced motion honoured) are
in `packages/interface/DESIGN.md`. **Read it before changing a token or adding an
animation.** Note `border` is a decorative rule and is deliberately below 3:1 —
`borderStrong` is the role for a boundary that must be perceivable. The whole
motion budget is `src/design/motion.tsx` (`PressFeedback`, `StateFade`,
`useScreenAnimation`) on `react-native-reanimated` CSS transitions — no shared
values, no worklets, and nothing else in the app animates. Anything pressable
gets press feedback: use the `TextButton` primitive for a pressable word rather
than putting `onPress` on a `Text`. Reanimated needs
`resolver: react-native-worklets/jest/resolver.js` in `jest.config.js` to run
under jest-expo. The brand assets are drawn from the tokens by
`node scripts/brand-assets.mjs`; don't hand-edit the PNGs.

Foundations (plan 09l, slice 3a.2): the server address is `EXPO_PUBLIC_API_URL`
(`packages/interface/.env.example`; unset = same origin on web, the docker stack on
the Metro host for a native dev build). `src/api/transport.ts` adds the Bearer,
refreshes single-flight and **signs out only on an `Unauthenticated` from
`RefreshToken`**; `src/session/` is the state machine (web cookie / native
`expo-secure-store`, refresh token only); screens read `useSession()` and
connect-query hooks, and render errors through `toAppError`. Those files are
architect-tier (09i §7 rule 3). Jest runs the real runtime over
`createRouterTransport` + `createFakeIms()` (`src/test/`); RNTL 14 is async —
`await render(...)` **and** `await fireEvent.*(...)`.

### Code Generation

The build script runs all code generators, but you can run them individually (from `go/`):

```bash
# Generate sqlc code from SQL schemas and queries
go tool sqlc generate

# Generate templ code (Go HTML templates)
go tool templ generate

# Generate JavaScript from TypeScript
go tool tsgo

# Generate Go + OpenAPI from the proto contract (buf runs from go/, points at ../proto)
go tool buf generate --template ../buf.gen.yaml ../proto
```

> **Generated code is NOT committed.** None of the generated output lives in the
> tree — it is all git-ignored and produced at build time. The Go outputs land
> under `go/`; the proto TypeScript target stays with the repo-root pnpm workspace:
>
> | Generator | Output |
> |---|---|
> | sqlc | `go/store/imsdb/` |
> | templ | `go/web/template/*_templ.go` |
> | tsgo | `go/web/static/*.js` |
> | buf (Go + OpenAPI) | `go/gen/` |
> | buf (TypeScript, protoc-gen-es) | `packages/protocol-buffers/src/` (repo root) |
>
> **After a fresh clone, you must generate before anything compiles.** From `go/`,
> run `go run bin/build/build.go` (full build) or `go run bin/build/build.go
> -generate-only` (generators only, no `go build`) — or the individual `go tool`
> commands above. The same `-generate-only` step runs in the Docker build and in
> CI (both the `build` and `lint` jobs) so generated code exists before compile.
> IDEs/editors will show unresolved imports until the first generate run.

### Linting

JavaScript/TypeScript linting:
```bash
npx eslint
```

License header: every hand-written `.go`, `.templ`, `.ts` and `.tsx` file starts
with the single line `// SPDX-License-Identifier: Apache-2.0` — the same line the
`.proto` files carry, so generated code (which copies the proto's leading comment)
looks the same. The `prepend-license` pre-commit hook (`go run
bin/prependlicense/prependlicense.go` from `go/`) stamps it on new files, upgrades
the 16-line Apache block used before 2026-09 in place, and skips generated files
(`// Code generated by`, `// @generated by`). The copyright notice is the
repo-root `COPYRIGHT` file.

### Running a Single Test

```bash
go test ./path/to/package -run TestName
```

### Upgrading Dependencies

Upgrade Go dependencies:
```bash
go get -t -u ./...
go mod tidy
# or
make upgrade-deps
```

## Architecture

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
  to an authenticated subscriber, until a per-subscriber Connect stream replaces it (Phase 3).
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
