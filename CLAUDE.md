# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OCF IMS is an Incident Management System for the Oregon Country Fair, used to track incidents at the Fair. It is a Go codebase forked from the Black Rock Rangers' Ranger IMS (itself a Go implementation that replaced an earlier Python version).

## Development Commands

### Initial Setup

First-time setup to fetch external build dependencies:
```bash
go run bin/fetchbuilddeps/fetchbuilddeps.go
```

### Building

Build the server (runs sqlc, templ, and tsgo code generation, then compiles):
```bash
go run bin/build/build.go
# or
make build
```

The build outputs an `ocf-ims` binary in the project root.

### Running the Server

Run with MariaDB (requires `.env` file configuration):
```bash
./ocf-ims serve
```

Run with live reloading using air:
```bash
make run/live
# or
go tool air
```

Run with Docker Compose (includes auto-seeded databases):
```bash
docker compose -f docker-compose.dev.yml up
```

### Testing

Run all Go tests:
```bash
go test ./...
# or
make test
```

Run tests with coverage report:
```bash
go test -coverprofile=coverage.out --coverpkg ./... ./... && go tool cover -html=coverage.out
# or
make cover
```

Run integration tests (requires Docker):
```bash
go test ./store/integration
go test ./api/integration
```

Run Playwright browser tests (requires Playwright installed):
```bash
cd playwright
npx playwright test
```

### Code Generation

The build script runs all code generators, but you can run them individually:

```bash
# Generate sqlc code from SQL schemas and queries
go tool sqlc generate

# Generate templ code (Go HTML templates)
go tool templ generate

# Generate JavaScript from TypeScript
go tool tsgo
```

> **Generated code is NOT committed.** None of the generated output lives in the
> tree — it is all git-ignored and produced at build time:
>
> | Generator | Output |
> |---|---|
> | sqlc | `store/imsdb/` |
> | templ | `web/template/*_templ.go` |
> | tsgo | `web/static/*.js` |
>
> **After a fresh clone, you must generate before anything compiles.** Run
> `go run bin/build/build.go` (full build) or `go run bin/build/build.go
> -generate-only` (generators only, no `go build`) — or the individual `go tool`
> commands above. The same `-generate-only` step runs in the Docker build and in
> CI (both the `build` and `lint` jobs) so generated code exists before compile.
> IDEs/editors will show unresolved imports until the first generate run.

### Linting

JavaScript/TypeScript linting:
```bash
npx eslint
```

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

### Database Architecture

The system uses a **single IMS database** (`store/` package) for both incident data
and the people directory. The `directory/` package no longer owns its own database;
it reads the local `PERSON`/`POSITION`/`TEAM` tables that live in the IMS schema (see
`docs/plans/32-retire-clubhouse.md` — the external Clubhouse directory was retired).

The IMS database uses **sqlc** for type-safe SQL code generation:
- SQL schema: `store/schema/current.sql`
- SQL queries: `store/queries.sql` (incidents, field reports, **and** the local
  people-directory queries)
- Generated Go code: `store/imsdb/`

### Database Migrations

To modify the IMS database schema:

1. Create a new migration file in `store/schema/` following the pattern `XX-from-YY.sql`
2. Update the schema version in the migration:
   ```sql
   update `SCHEMA_INFO` set `VERSION` = XX;
   ```
3. Apply the same changes to `store/schema/current.sql` (update version there too)
4. Run the migration test: `go test ./store/integration`
5. Regenerate sqlc code: `go tool sqlc generate`
6. Update `store/queries.sql` if you modified existing tables/columns
7. Fix any broken Go code and run `go test ./...`

**Migrations are append-only history.** Each `XX-from-YY.sql` file represents
the exact transformation applied to a database at that version, so existing
files are never edited or deleted. Add a new migration rather than touching an
old one. Only `current.sql` describes the present-day schema for fresh installs,
and migrations are **schema-only** — they don't seed or transform domain data
(OCF launches on a fresh DB seeded from `current.sql`, so there's no production
data to migrate; see `docs/plans/40-domain-model.md`).

**Migration test (re-baselined at v36).** `store/integration` verifies that
*future* migrations stay consistent with `current.sql`: `TestMigrateSameAsCurrentSchema`
loads the frozen OCF baseline (`store/integration/36.sql`, a snapshot of the
schema OCF launched on), applies every migration from v37 onward, and checks the
result still matches `current.sql`. The pre-OCF Burning Man upgrade chain is
**not** replayed — OCF starts fresh from `current.sql` and never runs that legacy
path, so the old `06.sql` fixture was retired. The baseline `36.sql` is itself a
frozen fixture: leave it as-is. (When the schema diverges far enough that a fresh
baseline is useful, freeze a new `NN.sql` snapshot and re-point the test.)

### Configuration

Configuration uses environment variables loaded from a `.env` file (copy from `.env.example`).

Key configuration concepts:
- **User directory**: always the local IMS-DB `PERSON` table (dev users seeded from `store/fakeimsdb/seed.sql`); there is no directory-type selector
- **DB store types**: `MariaDB` (persistent storage) or `noop` (no-op for testing only)
- **Attachments stores**: `local` (filesystem) or `s3` (AWS S3)

To add demo/test users to the local directory, use the `add-demo-user` repo skill at `.claude/skills/add-demo-user/SKILL.md` — it covers password hashing, the seed file edit, applying inserts to a live `ims-db` container, and the 5-min user-cache TTL.

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
- Admins have unrestricted access. A user is an admin if their local
  `PERSON.IS_ADMIN` flag is set (managed in-app from **Admin → People & Passwords**
  via `POST /ims/api/personnel/{handle}/admin`) **or** their handle is in the
  `IMS_ADMINS` env list. The two are a union, computed by `authz.IsAdministrator`
  (the single source of truth); the env list is a bootstrap so a fresh DB with no
  flagged admins is still recoverable. The flag rides in the JWT, so a change
  takes effect on the next access-token refresh. The endpoint refuses to clear the
  last remaining flagged admin (409). **Only admins may change admin status**: the
  toggle is gated on the caller actually being an admin, *not* on the delegatable
  `GlobalAdministratePersonnel` — so delegating personnel management (e.g. password
  resets) to a future crew-leader role never implies the power to mint admins.
- Global permissions (e.g. `GlobalAdministratePersonnel`, which gates password
  resets) are granted via roles in `RolesToGlobalPerms`. Today only the
  `Administrator` role holds the admin-level globals; a future roles model may grant
  individual globals to non-admins (e.g. crew leaders) without changing the handlers
  that check them.

### Action Logging

All authenticated API requests are logged to an action log (`store/actionlog/`) for audit purposes.

## Key Differences from Python Version

- No SQLite support (MariaDB only for persistent storage)
- Uses `.env` file instead of `conf/imsd.conf`
- "File" directory type renamed to "TestUsers" and implemented as compiled Go code
- Heavy use of sqlc code generation instead of ORM
