# Phase 3 · PR #1 — Local people directory + identity re-key to `person_id`

**Status: Planned (approved 2026-06-06) — implementation not started.**

Parent plan: [`30-remove-clubhouse.md`](30-remove-clubhouse.md). This is the detailed
implementation plan for the **first and largest** Phase 3 PR. It merges what the
parent doc originally sketched as sub-PRs 1, 2, and 3 into one slice — see
[Why one PR](#why-one-pr).

---

## Goal

Stand up a **local people model in the IMS database** and make identity local and
stable:

- A local `PERSON` table (with credentials) replaces Clubhouse as the source of who
  can log in.
- Local `POSITION`/`TEAM` (+ membership) back the existing authz expression engine.
- `directory.UserStore` becomes an interface (`IUserStore`) with two
  backends — Clubhouse (existing) and local (new, IMS-DB-backed) — selected by
  config. All ~50 API consumers keep working through the seam.
- Attached-people and report-entry author **re-key from handle strings to
  `person_id` FKs**, resolving the long-standing `current.sql` FIXME.

After this PR, login + authorization run entirely against the local DB in `local`
directory mode. Clubhouse code remains in the tree (retired in a later PR) but is no
longer on the default path.

## Why one PR

The original parent-doc slicing split "PERSON + login" (1), "positions/teams" (2),
and "attached-people FK re-key" (3). Investigation showed those splits fight the
code, so we merged them:

- **The `UserStore` seam loads persons + positions + teams as one unit.**
  `directory.go`'s `refreshUserCache` fetches persons, positions, teams,
  person-positions, person-teams, and on-duty together into one `User`, which login
  bakes wholesale into the JWT. A "persons-only" PR would ship a backend returning
  *empty* positions/teams, silently breaking every `position:`/`team:`/`onduty:`
  `EVENT_ACCESS` rule until the next PR — and the empty stub is throwaway code.
- **Clean slate ⇒ no reason to defer the FK re-key.** The IMS DB is empty for the
  beta, so there is no data migration risk. Leaving attachments keyed on handle
  strings while identity is local `person_id` creates an awkward dual-keying middle
  state (every attach would resolve handle→person at runtime). Keying attachments on
  `person_id` *now* is the coherent cut.
- **The migration test is schema-only and the fixtures are empty.**
  `store/integration/06.sql` seeds only `INCIDENT_TYPE` + `SCHEMA_INFO` — no
  attached-people / report-entry rows — and `TestMigrateSameAsCurrentSchema` compares
  `SHOW CREATE TABLE` structure, not data. So converting `RANGER_HANDLE varchar` →
  `PERSON_ID` FK cannot orphan rows; the only requirement is byte-identical FK
  **names** between the migration chain and `current.sql`.

## Scope boundary

**In scope:** local schema, the FK re-key, the `IUserStore` seam + local backend,
config selector, local login, demo seed.

**Deliberately deferred (later Phase 3 PRs):**

- Retire `directory/` Clubhouse backend + config (PR after this).
- UI / JSON / URL vocabulary rename (`rangers`→`people`, `/people/`,
  `role`→`involvement`, templ/TypeScript). **The JSON wire contract stays
  handle-based this PR** (see [Wire contract](#c-keep-the-wire-contract-handle-based)).
- `PERSON.is_admin` flag — admins stay env-`IMS_ADMINS` (matched on nickname).
- `onduty:` expressions — no local timesheet yet, so the local backend's on-duty
  lookup returns empty and `onduty:` rules are inert (called out in code + here).
- Self-service password reset / invites.

---

## A. Schema — `34-from-33.sql` → v34 (mirror in `current.sql`)

### New tables (additive)

- **`PERSON`** — `ID` PK auto-increment, `NICKNAME` varchar(64) unique (the former
  callsign/handle; human-facing, changeable), `EMAIL` varchar unique-ish nullable,
  `STATUS` (mirror the statuses the directory filters on), `ON_SITE` bool,
  `PASSWORD` varchar(255) nullable (argon2id hash), `CREATED` double.
- **`POSITION`** — `ID` PK, `NAME`.
- **`TEAM`** — `ID` PK, `NAME`.
- **`PERSON__POSITION`** — (`PERSON`, `POSITION`) FKs, PK both.
- **`PERSON__TEAM`** — (`PERSON`, `TEAM`) FKs, PK both.

### Re-key (clean slate — breaking, no data to migrate)

- `INCIDENT__RANGER` → **`INCIDENT__PERSON`**; `RANGER_HANDLE varchar` →
  `PERSON_ID int` with explicit FK **`IPE_TO_PERSON`** → `PERSON(ID)`. Keep `ROLE`
  column as-is (rename to `INVOLVEMENT` happens in the UI-rename PR).
- `VISIT__RANGER` → **`VISIT__PERSON`**; same `RANGER_HANDLE` → `PERSON_ID`, explicit
  FK **`VPE_TO_PERSON`**.
- `REPORT_ENTRY.AUTHOR varchar` → **`AUTHOR_PERSON_ID int`**, explicit FK
  **`RE_TO_AUTHOR`** → `PERSON(ID)`. Safe: author is *always* the acting logged-in
  user, including `GENERATED` entries (`api/*.go` set `author := claims.RangerHandle()`).

### Migration mechanics

- Implicit `EVENT` / incident FKs on the renamed tables auto-rename with the table
  (InnoDB `<table>_ibfk_N` rule — proven by the `INCIDENT_REPORT→FIELD_REPORT`
  rename). Only the **new explicit FKs** above need naming, in *both* the migration
  and `current.sql`.
- Bump `SCHEMA_INFO.VERSION` to 34 in the migration and in `current.sql`.
- `go test ./store/integration` must stay green (byte-identical chain).

## B. `IUserStore` interface + local backend

- Define **`directory.IUserStore`** = the consumer seam: `GetAllUsers`,
  `GetRangers`, `GetPositionsAndTeams` (the three methods the API actually calls).
- Keep **one cached implementation** (today's `UserStore` with its
  `userCache`/`positionCache`/`teamCache`) satisfying `IUserStore`, fed by a
  pluggable data source with two backends:
  - **clubhouse** — today's `DBQ` over `chqueries` (behavior unchanged).
  - **local** — new sqlc queries over the IMS-DB people tables (step A).
- The ~50 handler struct fields move `*directory.UserStore` → `directory.IUserStore`
  (mechanical). This also makes the store mockable in `api/` tests.
- sqlc: add `Persons`, `Positions`, `Teams`, `PersonPositions`, `PersonTeams`,
  `PersonsOnDuty` (returns empty for now) for the local tables to `store/queries.sql`;
  regenerate `store/imsdb`.

## C. Keep the wire contract handle-based

The TypeScript/UI rename is a later PR, so the JSON stays as-is (`handle`,
`rangers`, `author`) and we translate at the API boundary:

- **Write path:** report-entry author = `claims.DirectoryID()` (the JWT already
  carries the person id — no lookup). Attaching *another* person resolves their
  handle → `person_id` via the local store.
- **Read path:** join `PERSON_ID → NICKNAME` to fill the existing `handle` / `author`
  JSON fields.
- `containsAuthor(...)` compares person ids instead of handle strings.
- Internal store/sqlc identifiers rename to Person (`AttachPersonToIncident`, etc.);
  JSON types (`IncidentRanger`, `VisitRanger`) keep their wire shape this PR.

## D. Config, login, JWT, admins

- `conf/imsconfig.go`: add `DirectoryType` value `local` (+ `Validate`); default
  dev/demo → `local`. Clubhouse stays valid (retired later). `cmd/serve.go`: build the
  local `userStore` from `imsDBQ` when `Directory == local` (reorder so `imsDBQ`
  exists first); else the Clubhouse path.
- Login flow (`api/auth.go`) **unchanged in shape**: match nickname/email →
  `authn.Verify` (argon2id) → bake `ID` + `handle(=nickname)` + positions + teams.
  JWT `Subject` is now the local `PERSON.id`; the `handle` claim = nickname (keeps the
  `lib/authz/jwt.go` non-empty-handle guard satisfied).
- Admins: keep env `IMS_ADMINS` matched on nickname (`is_admin` deferred).

## E. Seed, tests, docs

- **Demo/dev seed:** copy the fake-Clubhouse people + positions/teams (and their
  argon2id hashes) from `directory/fakeclubhousedb/seed.sql` into an IMS-DB seed used
  by `local` mode.
- **Fair:** clean DB, no seed; admins seeded as `PERSON` rows (passwords via the
  existing `hashpassword` cmd) and listed in `IMS_ADMINS`.
- **Tests:** `api/integration/auth_test.go` + `permissions_test.go` against the local
  store; `store/integration` covers the migration; add a local-backend unit test
  mirroring `directory/clubhousedb_test.go`. Then `go test ./...` + Docker +
  Playwright.

---

## Build order (each step compiles/tests before the next where possible)

1. Migration `34-from-33.sql` + `current.sql` (schema only) → `go test ./store/integration`.
2. sqlc queries for the local people tables → regenerate `store/imsdb`.
3. `IUserStore` interface + local backend + cached impl; swap `cmd/serve.go` wiring
   and config selector.
4. Move the ~50 API consumer fields to `directory.IUserStore`.
5. Re-key write/read paths to `person_id` (attach/detach, author, `containsAuthor`),
   keeping JSON wire names.
6. Demo seed + credentials path.
7. Tests green: `go test ./...`, `store/integration`, `api/integration`, Docker,
   Playwright.
8. Amend [`30-remove-clubhouse.md`](30-remove-clubhouse.md) slicing to point here.

## Risks / call-outs

- **Highest-risk surface is auth** — land behind the existing auth + permissions
  integration tests; verify a locally-seeded admin can log in, grant `*`/`person:`
  access, and operate an event end-to-end.
- **Token break** on deploy is acceptable (fresh beta, web-UI-only, no live
  sessions) — but stated so no one expects existing sessions to survive.
- **`onduty:` goes inert** until a later slice models on-duty locally.
- Large diff: the re-key touches store queries, the JSON join layer, and the
  attach/detach handlers. Mitigated by keeping the wire contract stable (no
  TypeScript changes) and by step-by-step build order above.

## Exit criteria

- [ ] `local` directory mode: login + authorization fully local; Clubhouse off the
      default path.
- [ ] `PERSON`/`POSITION`/`TEAM`/membership tables live; `INCIDENT__PERSON` /
      `VISIT__PERSON` / `REPORT_ENTRY` author keyed on `person_id` FKs; FIXME resolved.
- [ ] `directory.IUserStore` seam in place with clubhouse + local backends.
- [ ] JSON wire contract unchanged (`handle`/`rangers`/`author`); no TypeScript churn.
- [ ] Demo seeded from former fake-Clubhouse data; Fair path = clean DB + seeded admins.
- [ ] `go test ./...` + `store/integration` + `api/integration` + Docker + Playwright green.
