# Phase 5 — Roles & Permissions

> **Status:** Plan / for review; 5a + 5a.1 shipped. **Owner:** TBD · **Last updated:** 2026-06-11
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

> **Update (2026-06-23):** the beta is taking a leaner path than the 5b–5d
> crews/role-tiers/crew-leaders model sketched here. See
> [`52-roles-and-access-model.md`](52-roles-and-access-model.md): a single
> per-event role ladder derived from `PERSON__EVENT`, `EVENT_ACCESS` retired,
> `STATUS`/`ON_SITE` removed. 5b–5d below are deferred; 5a stays as shipped.

The chosen beta scope is **"plumbing + crews model"**: slices **5a–5d** below.

**In scope for the beta:**
- **5a** — `PERSON.IS_ADMIN` flag (in-app admin management; retire env-only admin).
- **5b** — Role tiers (Basic Reporter / Coordinator / Management) as a documented,
  labeled mapping over the existing permission primitives.
- **5c** — Local crews/titles model made first-class: **nestable crews** (parent
  edge on `TEAM`) and **crew-leader edges** (`is_leader` on `PERSON__TEAM`).
- **5d** — Admin UI to manage crews, titles, membership, and leader edges.
- **5e** — **Unified people registry** (added 2026-06-11 from beta feedback):
  `PERSON` becomes the registry of *all* people the IMS touches, not just logins —
  see [`51-people-registry.md`](51-people-registry.md).

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
- **Authz**: admin status is **solely** the local `IS_ADMIN` flag (carried in the
  JWT claim `Admin`). `ManyEventPermissions` OR-s in the `Administrator` global
  perms when the claim is set. The `IMS_ADMINS` env list is **removed** (see D2) —
  there is no parallel env mechanism. Plumb `is_admin` into the JWT claims (mirror
  `PersonOnSite`/`PersonPositions`) so the permission calc needs no extra DB read.
- **API/UI**: extend the existing People admin page (`/ims/app/admin/people`) with
  an admin toggle → `POST /ims/api/personnel/{handle}/admin`. **Gate: the caller
  must themselves be an admin** (`claims.PersonAdmin()`), *not* merely hold the
  delegatable `GlobalAdministratePersonnel`. Only admins create admins — otherwise,
  once 5b/D-decisions let a crew leader hold `GlobalAdministratePersonnel` (for
  password resets), that leader could self-promote to full admin (a confused-deputy
  escalation). Last-admin guard: refuse to clear the last remaining admin (avoid
  lockout); surface as 409.
- **Bootstrap**: OCF launches on a fresh DB, so the first admin is seeded by
  inserting a `PERSON` row with `IS_ADMIN = true` (password hashed via the
  `hash_password` CLI) — the same operator step that already creates the initial
  people. The dev seed marks the demo admin (`fakeimsdb/seed.sql`).
- **Tests**: `is_admin`-grants-Administrator unit test in
  `lib/authz/permission_test.go`; an integration test that a flagged person gets
  admin and a cleared one loses it; last-admin guard test.

> **Decision (D2, settled 2026-06-07): remove `IMS_ADMINS` entirely.** Post-Clubhouse
> all people are local DB rows, and the operator who seeds the initial people can set
> `IS_ADMIN = true` on the bootstrap insert — so the env list adds no bootstrap power
> that DB access doesn't already give. Recovery from a zero-admin state is a direct DB
> write, and the last-admin guard prevents reaching zero through the UI. Removing it
> deletes the parallel admin mechanism and its plumbing.

### 5a.1 — In-app people create/edit + areas-page UX (pulled forward)

A small follow-on to 5a, pulled forward because there was no in-app way to add or
edit people at all (only password/admin toggles on already-seeded rows). This is
the minimal create/edit surface; bulk invites / emailed onboarding stay deferred
(post-fair).

- **API**: `POST /ims/api/personnel` (`CreatePerson`: handle required, email +
  password optional, on-site flag; status defaults to `active`) and
  `POST /ims/api/personnel/{handle}` (`EditPerson`: status + on-site; handle is
  immutable). Both gated on `GlobalAdministratePersonnel` (personnel management,
  *not* admin-minting — that stays on `PersonAdmin()` per 5a). Duplicate handle/email
  → 409; unknown handle on edit → 404; unknown status → 400. A password, if given,
  is bounded like the reset endpoint and argon2id-hashed.
- **Listing**: `GET /ims/api/personnel?all=true` returns people of *any* status
  (admin People page); the default active-only listing still feeds the
  attach-person autocompletes.
- **UI**: People admin page gets a green "Add person" button + modal and a per-row
  "Edit" modal. Areas admin page reworked: event **picker** (`<select>`, was a text
  box) that remembers the last-viewed event and auto-loads it, the areas table stays
  hidden until an event is chosen, and a green "New area" button opens a prefill
  modal (replacing the old inline add textbox).
- **Bug fix**: `ims.bsModal` now uses `bootstrap.Modal.getOrCreateInstance` instead
  of `new bootstrap.Modal` — the `new` form created a fresh instance each call whose
  programmatic `.hide()` no-oped, so modals didn't close after a successful submit.
- **Dev**: `docker-compose.dev.yml` sets `IMS_CACHE_CONTROL_SHORT/LONG: "0s"` so
  rebuilt JS/CSS propagate without a hard refresh (the `?v=` cache-buster is a
  constant in dev, so a non-zero TTL served stale assets after every `air` rebuild).
- **Tests**: `api/integration/person_test.go` exercises create/edit (403/400/404/409,
  deactivate→login-fails, reactivate→login-works).

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

### 5e — Unified people registry (added 2026-06-11)

From beta feedback (Stakeholder A + maintainer): `PERSON` becomes the **single registry of
every person the IMS touches** — crews pre-loaded with logins, plus people added
ad-hoc from incident/visit flows (no login, no handle), with per-event
**wristband numbers** and registry-wide **typeahead search**. Visit guests become
linked `PERSON` rows instead of freeform text; admins gain full-profile editing
(including the currently-frozen **email**) and search.

Full design, decisions, and sub-slices (5e.1–5e.4):
[`51-people-registry.md`](51-people-registry.md). Lives in the Phase 5 family
because it reshapes the `PERSON` table that 5c/5d build on, and 5b's tiers apply
only to its login-capable subset.

## 6. Sequencing & risk

Suggested order: **5a → 5b → 5c → 5d** (each independently shippable); **5e**
slots in flexibly (decided 2026-06-11: sequence at implementation time) **except
5e.1 (schema) should precede 5d**, whose people-admin UI would otherwise be built
against the old `PERSON` shape. 5c and 5e both claim "the next" migration
number — whichever lands first takes it.
- **5a** is the highest-value, lowest-risk win (in-app admin; removes an env-only
  footgun) and is self-contained — do it first. *(✅ shipped: 5a PR #27, 5a.1 PR #28.)*
- **5b** is mostly labeling/docs; cheap; can land alongside or right after 5a.
- **5c** is additive schema + sqlc; moderate.
- **5d** is the largest (new admin UI surface); depends on 5c's schema (and 5e.1,
  see above).
- **5e** is moderate-to-large (schema + search + two flow UIs + admin UX), split
  into four sub-slices.

Risk is **Med** overall (per master plan). The sharpest edges are the
name-as-grant-key coupling (D6) and not over-building crew-leader authority before
invites exist (5c keeps it descriptive). Migrations stay append-only and
schema-only; each bumps the version and updates `current.sql` last-column-wise to
keep `TestMigrateSameAsCurrentSchema` green.

## 7. Decisions needed before build (summary)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Rename `TEAM`/`POSITION` → `CREW`/`TITLE` tables? | **No** — UI relabel only, keep DB/API names |
| D2 | Keep `IMS_ADMINS` env as bootstrap? | **No (settled)** — removed; bootstrap by seeding an `IS_ADMIN = true` row |
| D3 | Include a read-only "Reviewer" tier? | Optional; maps to existing `read` mode |
| D4 | Parent-crew leadership cascades to sub-crews? | **Parked** with invites (post-fair) |
| D5 | What can a crew leader *do*? | **Parked** with invites (post-fair) |
| D6 | Crew/title rename vs. `team:`/`position:` grant coupling | **Allow + warn** for beta |
| D-P1–D-P4 | People-registry decisions (inline create gating, legal-name home, handle→ID URLs, min query length) | See [`51-people-registry.md`](51-people-registry.md) §6 |

## 8. Exit criteria

- In-app admin management works; `IMS_ADMINS` is removed (admin = `IS_ADMIN` flag only).
- Role tiers are documented and surfaced in the access-grant UI.
- Crews nest (one level) and carry leader edges; titles manage locally.
- Admin UI covers crew/title CRUD + person assignment, gated and 403-tested.
- The people registry holds crew + participants + public in one table, searchable,
  with visit guests linked (5e exit criteria in [`51-people-registry.md`](51-people-registry.md)).
- `go test ./...`, generators, and build green; migrations replay == `current.sql`.
- Deferred items (invites, emailed reset, onduty) recorded here and in
  [`34-post-clubhouse-login.md`](34-post-clubhouse-login.md) so nothing is lost.
