# Phase 3 · PR #2 — Retire the Clubhouse directory

**Status: In progress (started 2026-06-06).**

Parent plan: [`30-remove-clubhouse.md`](30-remove-clubhouse.md). Follows
[`31-local-people-directory.md`](31-local-people-directory.md) (PR #1, merged as #16),
which stood up the local `PERSON`/`POSITION`/`TEAM` model, the `person_id` re-key,
and the `directory.IUserStore` seam with **two** backends (clubhouse + local). With
`local` directory mode now fully functional, this PR removes the external Clubhouse
dependency entirely so the local IMS-DB people tables are the *only* directory.

---

## Goal

Delete the Clubhouse backend and all its plumbing, leaving a single local directory.
After this PR there is no `directory/clubhousedb`, no Clubhouse config/env, and no
Clubhouse container in any compose file. Login and authorization run only against the
local `PERSON` table.

## What stays — the abstraction is deliberately kept

PR #1 introduced two interfaces with different jobs. Only one loses its reason to
exist:

| Interface | Role | Fate |
|---|---|---|
| `personSource` | **backend seam** — where person data is fetched from (was clubhouse vs local) | **Kept** — now one impl (`localSource`), but it remains the extension point for a future alternate source (LDAP, an importer, etc.); a new source plugs in here and inherits `UserStore`'s caching for free. |
| `IUserStore` | **consumer seam** — what the API handlers depend on | **Kept and adopted** — the ~50 handler fields + `authz.EventPermissions` migrate from concrete `*directory.UserStore` to the interface, so handlers can be unit-tested with an in-memory fake instead of a real MariaDB. |

We are **not** collapsing these. The interface that abstracted over *real backends*
(`clubhouseSource`/`localSource`) keeps its second purpose (future sources); the
interface that abstracts the store *for tests* (`IUserStore`) finally earns its keep
once consumers depend on it. (Decision 2026-06-06.)

## Scope

### In scope

1. **Delete the Clubhouse backend & plumbing**
   - `directory.clubhouseSource` (in `directory.go`), `directory.NewUserStore`
     (clubhouse constructor), `directory/clubhousedb.go` (`DBQ`, `NewDBQ`, `MariaDB`,
     `CurrentSchema`), `directory/clubhousedb_test.go`.
   - Generated/sql sources: `directory/clubhousedb/` (gitignored gen),
     `directory/queries.sql`, `directory/schema/`, `directory/fakeclubhousedb/`.
   - Remove the `clubhousedb` block from `sqlc.yaml`.
2. **Migrate consumers to `directory.IUserStore`** — the handler `userStore` fields
   across `api/`, the `api/mux.go` `AddToMux` parameter, and the
   `authz.EventPermissions` parameter flip from `*directory.UserStore` to the
   interface. `personIDByHandle` already takes it.
3. **Config / env / wiring**
   - `conf`: drop `DirectoryTypeClubhouseDB`, the `ClubhouseDB` struct, and
     `Directory.ClubhouseDB`; default directory → `local`; simplify `Validate`.
     Keep the `DirectoryType` selector (`local` default, `noop` retained) as the
     future-source wiring point.
   - `cmd/serveconfig.go`: drop the `IMS_DMS_*` env mappings.
   - `cmd/serve.go`: build the local store from `imsDBQ` (no clubhouse branch).
4. **`api/integration` → local mode** — drop the Clubhouse container/goroutine; seed
   the IMS `PERSON`/`POSITION`/`TEAM`/membership tables (with the same argon2id
   hashes, `Nooperator` position, `Brown Dot` team) so login + authz run locally;
   `userStore = NewLocalUserStore(imsDBQ)`. Delete `clubhousedb_test_seed.sql`. This
   removes the cross-mode FK-seeding wart called out in PR #1.
5. **`DirectoryID()` → `PersonID()`** — retire `IMSClaims.DirectoryID() int64`; fold
   the subject-parse into the existing bounds-checked `PersonID() int32`. The two
   int64 call sites (`api/auth.go` refresh comparison, `api/mux.go` action-log user
   id) use `int64(PersonID())`. Rename the `clubhouseID` token params to `personID`.
6. **Docs/compose** — remove the `clubhouse-db` service + `IMS_DMS_*` from
   `docker-compose.dev.yml` and `docker-compose.cicd.yml`; update `.env.example`,
   `README.md`, `CLAUDE.md`, `docs/README.md`, and the `add-demo-user` skill to
   point at the local seed (`store/fakeimsdb/seed.sql`) instead of Clubhouse.

### Out of scope (later Phase 3 PR)

- UI / JSON / URL vocabulary rename (`rangers`→`people`, `/people/`,
  `role`→`involvement`) and the `RangerHandle()`/`Ranger*` claim method names — the
  wire contract and those identifiers stay this PR.
- `PERSON.is_admin` (admins stay env-`IMS_ADMINS`), local `onduty:` modeling.
- Terminology renames of `lib/argon2id.ClubhouseParams` and related comments — these
  are param values, harmless, deferred to the holistic terminology pass.

## Build order

1. Delete the Clubhouse backend + `sqlc.yaml` block; `go run bin/build/build.go
   -generate-only` to confirm codegen still works without the directory schema.
2. Remove Clubhouse config/env; fix `conf` + `serveconfig` tests.
3. Migrate consumers + `EventPermissions` to `IUserStore`; simplify `cmd/serve.go`.
4. Retire `DirectoryID()`; fix the two int64 sites.
5. Convert `api/integration` to local mode; delete the clubhouse seed.
6. Compose/docs cleanup.
7. Green: build, `go test ./...`, `store/integration`, `api/integration`,
   golangci-lint, end-to-end docker local login.

## Risks / call-outs

- **Auth + permissions integration tests are the safety net** — converting them to
  local mode is the riskiest change; the assertions (admin login, `position:`/
  `team:` grants) must still pass against locally-seeded rows.
- `onduty:` was exercised only by seeded data, never asserted — it stays inert
  locally (no timesheet), so no test behavior changes.
- Single-impl `personSource` is intentional speculative generality (future sources),
  documented in code where the comment previously named clubhouse.

## Exit criteria

- [ ] No `directory/clubhousedb`, `directory/queries.sql`, `directory/schema/`,
      `directory/fakeclubhousedb/`, or Clubhouse config/env/container remains.
- [ ] `IUserStore` is the consumer-facing type; `personSource`/`localSource` kept.
- [ ] `api/integration` runs in local mode (one DB container); FK-seeding wart gone.
- [ ] `DirectoryID()` retired in favor of `PersonID()`.
- [ ] Build + `go test ./...` + `store/integration` + `api/integration` +
      golangci-lint + Docker green.
