# Phase 5 — Roles & Permissions

> **Status:** Plan / for review. **Owner:** TBD · **Last updated:** 2026-06-07
>
> Detailed plan for **Phase 5** of the OCF conversion (see
> [`00-master-plan.md`](00-master-plan.md) §"Phase 5"). Builds on **Phase 3**'s
> local `Person` foundation (Clubhouse removed; positions/teams/person-matches are
> now local, editable data — [`30-remove-clubhouse.md`](30-remove-clubhouse.md)).

## 1. Goal

Give OCF a roles-and-permissions model that fits its volunteer org: a small set of
**role tiers** that drive authorization, **crews** that organize people and can
**nest**, **crew leaders** with authority over their crew, and **in-app admin
management** (no env-only admin list). Do it by *extending* the primitives that
already exist rather than inventing a parallel model.

## 2. Scope (decided 2026-06-07)

The chosen beta scope is **"plumbing + crews model"**: slices **5a–5d** below.

**In scope for the beta:**
- **5a** — `PERSON.IS_ADMIN` flag (in-app admin management; retire env-only admin).
- **5b** — Role tiers (Basic Reporter / Coordinator / Management) as a documented,
  labeled mapping over the existing permission primitives.
- **5c** — Local crews/titles model made first-class: **nestable crews** (parent
  edge on `TEAM`) and **crew-leader edges** (`is_leader` on `PERSON__TEAM`).
- **5d** — Admin UI to manage crews, titles, membership, and leader edges.

**Explicitly deferred to post-fair (out of scope here):**
- **Invites** — email self-register *and* admin-create-Person onboarding flows.
- **Emailed self-service password reset** — design preserved in
  [`34-post-clubhouse-login.md`](34-post-clubhouse-login.md) Appendix (needs a
  `lib/notify` mailer seam + `PASSWORD_RESET` table).
- **`onduty` local surfacing** — no local timesheet/shift table exists
  (`directory/local.go:86`); the `onduty:<title>` EVENT_ACCESS expression stays
  inert locally until a shift model lands.

## 3. What exists today (grounding)

The authorization model is already close to what OCF wants — it's just flat and,
until Phase 3, was sourced read-only from Clubhouse.

**Permission primitives** (`lib/authz/permission.go`):
- Two bitmask types: `EventPermissionMask` (per-event) and `GlobalPermissionMask`.
- `Role` constants map to permission sets via `RolesToEventPerms` /
  `RolesToGlobalPerms`. Event roles (`EventReporter`/`EventReader`/`EventWriter`/
  `EventVisitWriter`) correspond 1:1 to `EVENT_ACCESS.MODE`
  (`report`/`read`/`write`/`write_visits`) via `modeToRole`.
- **Admin** is not data-driven: `ManyEventPermissions` OR-s in the `Administrator`
  global perms when `slices.Contains(imsAdmins, handle)` — `imsAdmins` comes from
  the `IMS_ADMINS` env list (`conf.IMSConfig.Admins`).

**Access grants** (`EVENT_ACCESS` table): one row = `(EVENT, EXPRESSION, MODE,
VALIDITY, EXPIRES)`. `EXPRESSION` is matched against a person's attributes by
`PersonMatches`:

| Expression | Matches |
|---|---|
| `person:<handle>` | one specific person |
| `position:<title>` | anyone holding that **position** (= OCF **title**) |
| `team:<title>` | anyone on that **team** (= OCF **crew**) |
| `onduty:<title>` | anyone on-duty in that position (inert locally — no shift table) |

**People/crews/titles tables** (`store/schema/current.sql`, all local since Phase 3):
- `PERSON(ID, HANDLE, EMAIL, STATUS, ON_SITE, PASSWORD, CREATED)`
- `POSITION(ID, NAME)` — **= title**
- `TEAM(ID, NAME)` — **= crew**; currently **flat** (no parent edge)
- `PERSON__POSITION(PERSON_ID, POSITION_ID)` — plain membership
- `PERSON__TEAM(PERSON_ID, TEAM_ID)` — plain membership (**no leader flag**)

**The key insight:** OCF's "crew" and "title" already exist as `TEAM` and
`POSITION`. The only structural gaps vs. the OCF vision are **(a) crews can't
nest** and **(b) there's no crew-leader concept**. 5c closes exactly those two
gaps; it is additive, not a rewrite.

## 4. Vocabulary (decided 2026-06-05, in `20-terminology.md`)

- **Crew** = a group of people; **nestable**. Backed by `TEAM`.
- **Title** = a descriptive label (e.g. "Medical Lead"); **cosmetic**, grants no
  permissions by itself. Backed by `POSITION`.
- **Role** = the permission *tier* (Basic Reporter / Coordinator / Management) —
  the **only** thing that drives authorization.

> **Decision needed (D1): do we rename the `TEAM`/`POSITION` tables to
> `CREW`/`TITLE`?** Recommendation: **No for beta — relabel in the UI only, keep
> the DB/API names.** A table rename is a full-stack churn (schema + sqlc + JSON +
> URLs + TS + tests, à la the journal-entry rename) and the `team:`/`position:`
> EVENT_ACCESS expression grammar is load-bearing and externally visible. Keeping
> the names lets 5c stay additive. Revisit post-fair if the mismatch bites.

## 5. Slices

Branch-per-slice, PR-per-slice. Each slice ships independently and keeps
`go test ./...` + the build green.

### 5a — `PERSON.IS_ADMIN` flag

Make "who is an admin" data-driven and manageable in-app, instead of (only) the
`IMS_ADMINS` env list.

- **Schema** (migration `41-from-40.sql`, v41): add
  `PERSON.IS_ADMIN boolean not null default false`. Append the column last in
  `current.sql` to match the replay test's `SHOW CREATE TABLE` ordering.
- **Authz**: a single `authz.IsAdministrator(handle, hasAdminFlag, imsAdmins)`
  helper is the source of truth — a person is an admin when their `IS_ADMIN` is set
  **or** their handle is in `imsAdmins`. The env list stays as a **bootstrap** (so a
  fresh DB with no admins is still recoverable) — it's a union, not a replacement.
  `ManyEventPermissions` OR-s in the `Administrator` global perms via that helper.
  Plumb `is_admin` into the JWT claims (mirror `PersonOnSite`/`PersonPositions`) so
  the permission calc needs no extra DB read.
- **API/UI**: extend the existing People admin page (`/ims/app/admin/people`) with
  an admin toggle → `POST /ims/api/personnel/{handle}/admin`. **Gate: the caller
  must themselves be an admin** (`authz.IsAdministrator`), *not* merely hold the
  delegatable `GlobalAdministratePersonnel`. Only admins create admins — otherwise,
  once 5b/D-decisions let a crew leader hold `GlobalAdministratePersonnel` (for
  password resets), that leader could self-promote to full admin (a confused-deputy
  escalation). Last-admin guard: refuse to clear the last remaining flagged admin
  (avoid lockout); surface as 409.
- **Seed**: mark the dev admin user `IS_ADMIN = true` in `fakeimsdb/seed.sql`.
- **Tests**: `is_admin`-grants-Administrator unit test in
  `lib/authz/permission_test.go`; an integration test that a flagged non-env
  person gets admin and a cleared one loses it; last-admin guard test.

> **Decision needed (D2): keep `IMS_ADMINS` env as a bootstrap, or migrate it
> away entirely?** Recommendation: **keep as bootstrap** (belt-and-suspenders for
> a fresh DB / locked-out instance), documented as such.

### 5b — Role tiers (Basic Reporter / Coordinator / Management)

OCF speaks in three tiers; the system speaks in modes/perms. This slice makes the
mapping **explicit and labeled** without changing the underlying grant mechanics.

- **Mapping** (no new permission bits expected):
  - **Basic Reporter** → `EVENT_ACCESS.MODE = report` (`EventReporter`: own
    reports only).
  - **Coordinator** → `EVENT_ACCESS.MODE = write` (`EventWriter`: full incident +
    report read/write). *(Read-only reviewers → `read`/`EventReader`.)*
  - **Management** → `IS_ADMIN` (5a) — global administration.
- **Code**: introduce the tier names as documented constants/labels and surface
  them in the access-admin UI (`admin_events.ts` access editor) so granting access
  reads as "Coordinator" rather than raw `write`. Likely a thin labeling layer
  over `modeToRole`; **add permission bits only if a tier needs something the
  modes can't express** (none identified yet).
- **Docs**: a short table in this doc + inline comments; update CLAUDE.md
  "Authorization" if the vocabulary surfaces in code.

> **Decision needed (D3): is the tier set exactly {Basic Reporter, Coordinator,
> Management}, or is a read-only "Reviewer" tier also wanted** (it maps cleanly to
> the existing `read` mode)? Affects only labels, not mechanics.

### 5c — Nestable crews + crew-leader edges

Close the two structural gaps. Additive schema only.

- **Schema** (migration `42-from-41.sql`, v42):
  - `TEAM`: add `PARENT_TEAM_ID integer null` + self-FK
    `TEAM_TO_PARENT (PARENT_TEAM_ID) references TEAM(ID)`. **Single-level for beta**
    (enforce one level deep in the handler, like the AREA parent rule in 4c-model),
    though the schema allows deeper.
  - `PERSON__TEAM`: add `IS_LEADER boolean not null default false`.
- **sqlc/Go**: regenerate; extend the team/membership queries to carry
  `PARENT_TEAM_ID` and `IS_LEADER`. New queries: set/clear leader, set parent,
  list sub-crews.
- **Semantics for beta**: the leader edge is **recorded and surfaced**, but its
  *powers* (managing membership, creating sub-crews, inviting) ride with **invites
  — deferred**. So in beta a crew leader is **descriptive + a hook for future
  authority**, not yet a privileged actor. This keeps 5c bounded and avoids
  shipping half an authority model. (See D4/D5 — the authority questions are
  intentionally parked with invites.)
- **EVENT_ACCESS**: unchanged grammar; `team:<crew>` continues to match membership.
  Nesting does **not** auto-cascade access in beta (a `team:Parent` grant does not
  match sub-crew-only members) — call this out explicitly so it isn't assumed.
- **Tests**: parent FK round-trip + single-level 400; leader set/clear; a
  `team:`-expression test confirming nesting does not cascade.

> **Decision needed (D4): does leading a parent crew confer authority over
> sub-crews?** Parked with invites (post-fair) — for beta, leadership is per-crew
> and descriptive. **(D5): what exactly can a crew leader do?** Also parked with
> invites. Recording the edge now means no migration churn when we turn the
> powers on.

### 5d — Crew/title admin UI

`POSITION`/`TEAM` had no admin CRUD before (Clubhouse owned them). Now local, they
need management UI. Model on the existing per-event admin pages
(`adminareas.templ`/`admin_areas.ts`, `admintypes`) and the People page.

- **Crews admin** (`/ims/app/admin/crews`): list/create/rename/delete crews; set a
  crew's parent (single-level); manage membership; toggle a member's `IS_LEADER`.
  New API under `/ims/api/...` mirroring `api/itype.go`'s individual-CRUD shape
  (named entities that are FK/expression targets — **not** the delete-all-recreate
  pattern, since crew names back `team:` expressions and parent FKs).
- **Titles admin** (`/ims/app/admin/titles` or folded into the same page):
  list/create/rename/delete titles; assign to people.
- **Person ↔ crew/title assignment**: extend the People admin page so a person's
  crews (with leader flag) and titles are editable in one place.
- **Gating**: `GlobalAdministratePersonnel` (existing) — or a new
  `GlobalAdministrateCrews` if we want to separate it. Recommendation: reuse
  `GlobalAdministratePersonnel` for beta (fewer moving parts).
- **Tests**: non-admin-403 (mirror `TestAreaMutationRequiresAdmin`); CRUD +
  assignment round-trips; rename-updates-`team:`-matches behavior (renaming a crew
  changes what `team:<name>` matches — document and test this sharp edge, since
  EVENT_ACCESS stores the name string, not an FK).

> **Decision needed (D6): renaming a crew/title silently changes which
> `EVENT_ACCESS` rows match it** (expressions store the name string). Options:
> (a) block rename if referenced, (b) cascade-update matching expressions, or
> (c) allow + warn. Recommendation: **(c) allow + warn for beta**, revisit when
> the grant model is reworked. Lowest effort; matches today's behavior where names
> were authoritative.

## 6. Sequencing & risk

Suggested order: **5a → 5b → 5c → 5d** (each independently shippable).
- **5a** is the highest-value, lowest-risk win (in-app admin; removes an env-only
  footgun) and is self-contained — do it first.
- **5b** is mostly labeling/docs; cheap; can land alongside or right after 5a.
- **5c** is additive schema + sqlc; moderate.
- **5d** is the largest (new admin UI surface); depends on 5c's schema.

Risk is **Med** overall (per master plan). The sharpest edges are the
name-as-grant-key coupling (D6) and not over-building crew-leader authority before
invites exist (5c keeps it descriptive). Migrations stay append-only and
schema-only; each bumps the version and updates `current.sql` last-column-wise to
keep `TestMigrateSameAsCurrentSchema` green.

## 7. Decisions needed before build (summary)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Rename `TEAM`/`POSITION` → `CREW`/`TITLE` tables? | **No** — UI relabel only, keep DB/API names |
| D2 | Keep `IMS_ADMINS` env as bootstrap? | **Yes** — union with `IS_ADMIN`, documented |
| D3 | Include a read-only "Reviewer" tier? | Optional; maps to existing `read` mode |
| D4 | Parent-crew leadership cascades to sub-crews? | **Parked** with invites (post-fair) |
| D5 | What can a crew leader *do*? | **Parked** with invites (post-fair) |
| D6 | Crew/title rename vs. `team:`/`position:` grant coupling | **Allow + warn** for beta |

## 8. Exit criteria

- In-app admin management works; `IMS_ADMINS` is bootstrap-only.
- Role tiers are documented and surfaced in the access-grant UI.
- Crews nest (one level) and carry leader edges; titles manage locally.
- Admin UI covers crew/title CRUD + person assignment, gated and 403-tested.
- `go test ./...`, generators, and build green; migrations replay == `current.sql`.
- Deferred items (invites, emailed reset, onduty) recorded here and in
  [`34-post-clubhouse-login.md`](34-post-clubhouse-login.md) so nothing is lost.
