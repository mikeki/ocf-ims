# Phase 3 — Remove Clubhouse & Establish Local People

> **Status:** design (2026-06-06). No code yet. This phase was carved out of the
> original Phase 2 slice **2b (Ranger → Person/People)** once exploration showed
> that the rename and the Clubhouse removal are the *same* change and cannot be
> shipped separately without doing the rename twice. See
> [`20-terminology.md`](20-terminology.md) (the locked Person/People decisions) and
> [`00-master-plan.md`](00-master-plan.md).

## Why this is its own phase

Slice 2b was specified as *"local `Person` table (replaces Clubhouse dependency);
`RANGER_HANDLE` → `person_id` FK."* Tracing the code showed the two halves are
inseparable:

- The attached-people data (`INCIDENT__RANGER`, `VISIT__RANGER`) and
  `REPORT_ENTRY.AUTHOR` only store a **handle string** today — renamable on its own.
- But you can't turn those into a real `person_id` FK **without a local Person
  table that has rows**, and those rows come *only* from Clubhouse today. Login,
  credentials, and authorization all read Clubhouse too.

So a "shallow" 2b (rename the column but keep a handle string) would ship a schema
we already know is wrong (the `current.sql:90` `FIXME` untouched) and force a
second rename later. Instead we do it **once**, as a unit: remove Clubhouse, stand
up a local `Person` entity, and complete the Ranger→Person rename keyed on
`person_id`.

This phase is the **foundation Phase 4 (roles & permissions) stands on** — Phase 4
cannot model crews/titles/roles until People are local. It is deliberately scoped
to a **minimum-viable local identity**; the rich org model is Phase 4.

## What Clubhouse provides today (the three things we must replace)

The external Clubhouse directory (`directory/` package, sqlc-generated
`directory/clubhousedb/`, fake data in `directory/fakeclubhousedb/seed.sql`) is the
sole source of:

1. **Roster / identity** — the list of people. `directory.User`
   (`directory/directory.go:36-50`): `ID`, `Handle` (Clubhouse `callsign`),
   `Email`, `Status`, `Onsite`, `Password` (hash), `PositionIDs/Names`,
   `TeamIDs/Names`, `OnDutyPositionID/Name`. The roster is filtered to the statuses
   eligible for IMS (`active`, `inactive`, `inactive extension`, `auditor`,
   `prospective`, `alpha` — `directory/queries.sql`).
2. **Credentials** — Argon2id password hashes live in the Clubhouse `person` table;
   login validates against them (`api/auth.go:82,120`, `lib/authn/password.go`).
   The IMS DB has **no** credential table today.
3. **Org structure for authorization** — `position`, `team`, and on-duty
   (`timesheet`) data. These back the `EVENT_ACCESS.EXPRESSION` engine
   (`lib/authz/permission.go:196-235`): `*`, `person:<handle>`, `position:<name>`,
   `team:<name>`, `onduty:<name>`.

Identity is currently keyed on the **handle string** end-to-end: the JWT carries it
(`lib/authz/claim.go:28-36`, `IMSClaims.Handle`), validation hard-requires it
non-empty (`lib/authz/jwt.go:55-56`), `IMS_ADMINS` matches on it
(`lib/authz/permission.go:181`, `cmd/serveconfig.go:96`), and `person:<handle>`
access rules reference it.

## Goal

Replace Clubhouse with a first-class local **`Person`** entity owned by OCF IMS,
identified by a stable immutable **`person_id`** and a unique, human-facing,
**changeable `nickname`** (the artist-formerly-known-as "handle"/callsign). Complete
the **Ranger → Person/People** and **`ROLE` → `involvement`** rename keyed on
`person_id`. Login and authorization become fully local. No external directory
dependency remains.

## Scope

### In scope
- Local `PERSON` table (roster + credentials + `is_admin`).
- Local org tables sufficient to keep the **existing** authz expression engine
  working: positions, teams, and person↔position / person↔team membership.
- `INCIDENT__RANGER` → `INCIDENT__PERSON`, `VISIT__RANGER` → `VISIT__PERSON`;
  `RANGER_HANDLE` → `PERSON_ID` (real FK), `ROLE` → `INVOLVEMENT`.
- `REPORT_ENTRY.AUTHOR` (handle string) → `AUTHOR_PERSON_ID` (FK).
- JWT re-keyed on `person_id` (subject); a display `nickname` claim for UI/audit.
- `EVENT_ACCESS.EXPRESSION` `person:<handle>` → `person:<id>`; `position:`/`team:`/
  `onduty:` reference local ids.
- Login validates against local credentials; `IMS_ADMINS`/admin bootstrap reworked.
- Retire the `directory/` Clubhouse dependency (`clubhousedb`, `fakeclubhousedb`,
  the `Directory` config type) — after it has served as the one-time demo seed.
- The Ranger→Person/People **UI + JSON + URL** rename ("People Involved",
  `/people/`, `rangers`→`people`, `role`→`involvement`).
- Migration + cutover (demo seed import; clean-DB path for the Fair).

### Out of scope → Phase 4 (roles & permissions)
- Nestable **crews**, **titles**, the **role tiers** (Basic Reporter / Coordinator /
  Management), **crew leaders**, **invites**, permission inheritance. The four open
  Phase-4 design questions in [`20-terminology.md`](20-terminology.md) (§"Fair org
  structure") stay there. This phase keeps today's flat expression model, just
  sourced locally — Phase 4 redesigns the grant model on top of the local
  foundation.

### Out of scope → Phase 5 (domain model) / later
- **Involvement history** (effective-dated who-was-involved-when). This phase keeps
  `involvement` as a single mutable value (just renamed), per the Phase 2 decision.

## Locked decisions

- **Roster sourcing (decided 2026-06-06).**
  - **Demo / dev:** seed the local `PERSON` (and positions/teams/memberships) by
    **copying the existing `directory/fakeclubhousedb/seed.sql` data** — so demo
    mode keeps working with the same handful of people.
  - **Fair / production:** launch on a **clean database**, seeded with **the user +
    a few others as admins**, and build the structure (people, crews, etc.) from
    there. No bulk import from any external system.
- **Interim authorization (decided 2026-06-06).** Keep the existing
  `person:`/`position:`/`team:`/`onduty:` expression engine; only change its
  *source* (local tables, `person_id`-based) — defer the crew/title/role redesign to
  Phase 4. Smallest change that preserves current behavior.
- **Identity key.** `person_id` (immutable) is the FK / JWT subject everywhere;
  `nickname` (was handle/callsign) is unique, human-facing, and changeable —
  changing it must not break references or sessions. Resolves `current.sql:90`.
- **`ROLE` → `involvement`**, single mutable value (history is Phase 5).
- **Admins.** Bootstrap admins via a local `PERSON.is_admin` flag, seeded for the
  Fair. (See open sub-decision on whether `IMS_ADMINS` env stays as an override.)

## Target data model (sketch — refine during impl)

New local tables (names/columns to firm up against sqlc + the migration test):

- **`PERSON`** — `ID` (pk, auto-inc), `NICKNAME` (unique), `EMAIL`, `STATUS`,
  `ON_SITE`, `PASSWORD` (Argon2id hash, nullable), `IS_ADMIN`, timestamps.
- **`POSITION`** — `ID`, `NAME`. **`TEAM`** — `ID`, `NAME`. *(Local mirrors of the
  Clubhouse concepts, only what the authz expressions need.)*
- **`PERSON__POSITION`**, **`PERSON__TEAM`** — membership join tables (`PERSON_ID` +
  `POSITION_ID`/`TEAM_ID`).
- **On-duty:** Clubhouse derived this from `timesheet` (last 60 days, open shift).
  There is no timesheet locally → see open sub-decision (likely a simple
  manual/flag model for the beta, or drop `onduty:` until Phase 4).

Renamed / re-keyed existing tables (migration `34-from-33.sql`, schema → v34):

- `INCIDENT__RANGER` → `INCIDENT__PERSON`: `RANGER_HANDLE` → `PERSON_ID` (FK →
  `PERSON.ID`), `ROLE` → `INVOLVEMENT`. Mirror the 2a FK-rename discipline
  (explicit FK names; InnoDB auto-renames implicit `ibfk` on `RENAME TABLE`; the
  `store/integration` test requires the migration chain to be byte-identical to
  `current.sql`, FK names included — use the `RRE_TO_*` / `VRE_TO_*` precedent).
- `VISIT__RANGER` → `VISIT__PERSON`: same treatment.
- `REPORT_ENTRY.AUTHOR` (varchar) → `AUTHOR_PERSON_ID` (FK → `PERSON.ID`).
- `EVENT_ACCESS.EXPRESSION`: rewrite `person:<handle>` → `person:<id>` during
  backfill.

## Auth changes

- **Login** (`api/auth.go`): look up `PERSON` by `nickname`/email locally; verify
  against local `PERSON.PASSWORD`.
- **JWT** (`lib/authz/claim.go`, `accesstoken.go`, `refreshtoken.go`, `jwt.go`):
  subject = `person_id`; carry `nickname` as a display claim; positions/teams from
  local membership. Replace the "handle required" guard with "person_id required."
  Tokens are not backward-compatible — fine, the OCF beta is a fresh deployment with
  no live sessions (per the Phase 2 web-UI-only / no-external-clients decision).
- **Authz** (`lib/authz/permission.go`): expression matching unchanged in shape;
  `person:` compares `person_id`; `position:`/`team:` resolve against local ids;
  admin check reads `PERSON.is_admin`.
- **Audit log** (`store/actionlog/`, `api/mux.go`): record `person_id` + `nickname`.

## Migration / cutover plan

1. **Schema migration `34-from-33.sql`** (→ v34): create `PERSON` + org tables; add
   `PERSON_ID`/`AUTHOR_PERSON_ID` columns; backfill from existing handle strings by
   matching `nickname`; switch FKs; drop old `RANGER_HANDLE`/`ROLE`/`AUTHOR`
   columns; rename the join tables. Mirror in `current.sql` (version + every table).
2. **Demo seed:** translate `directory/fakeclubhousedb/seed.sql` into local
   `PERSON`/`POSITION`/`TEAM`/membership inserts (callsign → `nickname`, copy
   password hashes, positions/teams). Lives in `store/fakeimsdb/seed.sql` (the IMS
   seed) so demo mode is self-contained.
3. **Backfill demo data:** existing `INCIDENT__RANGER`/`VISIT__RANGER` handle values
   and `REPORT_ENTRY.AUTHOR` → `person_id` (match on nickname); existing
   `person:<handle>` access rules → `person:<id>`.
4. **Fair path:** fresh DB at v34; seed a few admin `PERSON` rows (`is_admin=1`);
   no import.
5. **Retire Clubhouse:** once the seed is captured locally, remove the `directory/`
   Clubhouse path, `clubhousedb`/`fakeclubhousedb`, and the `Directory` config knob
   (or keep `directory/` only as a throwaway import tool — open sub-decision).

## Suggested sub-PR breakdown

This is large; slice it so each PR lands green (same discipline as 2a). Actual
order (revised 2026-06-06 after the seam investigation):

1. **Local people directory + identity re-key** — local `PERSON`/`POSITION`/`TEAM`/
   membership tables + credentials + local login; the `IUserStore` seam with
   clubhouse + local backends; and the attached-people/author **`person_id` FK
   re-key** (`INCIDENT__PERSON`/`VISIT__PERSON`, `AUTHOR_PERSON_ID`). This **merges
   the originally-separate slices 1, 2, and 3** — they fight the code if split (the
   `UserStore` cache loads persons + positions/teams as one unit, and the clean-slate
   DB removes any reason to defer the FK re-key). Detailed plan:
   [`31-local-people-directory.md`](31-local-people-directory.md). JSON wire contract
   stays handle-based; admins stay env-`IMS_ADMINS`; `onduty:` inert for now.
2. **Retire `directory/` Clubhouse** — delete the dependency and config.
3. **UI / JSON / URL vocabulary rename** — "People Involved", `/people/`,
   `rangers`→`people`, `role`→`involvement`, function/element renames (the 2b UI
   surface inventoried in the exploration); plus deferred bits — `PERSON.is_admin`
   and local `onduty:` modeling.

## Open sub-decisions (resolve during implementation)

- **`onduty:`** without a timesheet — manual on-duty flag per person, or drop
  `onduty:` expressions for the beta until Phase 4 models shifts?
- **Admins** — `PERSON.is_admin` only, or keep `IMS_ADMINS` env (now nickname-based)
  as an override for break-glass access?
- **`directory/` package** — delete outright, or keep as a one-shot import tool for
  the demo seed and remove later?
- **`nickname`** — case-insensitive uniqueness? email-based login still supported?
- **Password reset / set-password UX** — Clubhouse owned this; for the beta, admin
  sets a temp password (full self-service reset can be Phase 4 with invites).

## Risks

- **Auth is the highest-risk surface.** Land behind the existing
  `api/integration/auth_test.go` and `permissions_test.go`; add coverage for local
  login and `person_id` expressions before cutover.
- **Migration of existing demo data** (handle → person_id) must be exercised by the
  `store/integration` migration test (byte-identical chain).
- **Token break** is acceptable (fresh beta) but must be called out so no one
  expects existing sessions to survive.

## Exit criteria

- [ ] No runtime dependency on Clubhouse; `directory/clubhousedb` retired.
- [ ] Login + authorization fully local (`PERSON` credentials, local
      positions/teams, `is_admin`).
- [ ] `person_id` FKs replace handle strings in `INCIDENT__PERSON`/`VISIT__PERSON`
      and `REPORT_ENTRY` author; `current.sql:90` FIXME resolved.
- [ ] Ranger→Person/People + `role`→`involvement` rename complete across DB, Go,
      JSON, URLs, UI.
- [ ] Demo mode seeded from the former fake-Clubhouse data; Fair path = clean DB +
      seeded admins.
- [ ] Build + `go test ./...` + `store/integration` + `api/integration` + Docker +
      Playwright green.
- [ ] Phase 4 (roles & permissions) can build on the local `PERSON` foundation.
