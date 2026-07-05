# 95 — Crews: registry, per-event membership, crew-leader view + report review

## Context

Three related feedback items (round 10, slice 10c):

- **Item 3:** add a **Crew** concept — a per-event **Crews** registry an admin curates,
  and a per-event record of **which crew(s) a person is on that year**.
- **Item 4:** the **Crew Leader** role can **view incidents**, but may **not edit
  anything or add journal entries**.
- **Item 5:** Crew Leaders can **review the reports of their crew**; a crew can have
  **one or more people marked as its leader**.

These form one cohesive feature: a per-event crew registry, per-event membership on
each person, one-or-more leaders per crew, and a `crew_leader` read-only viewer role
that is **derived from leading a crew** (not assigned by hand).

> **Scope (simplified with the user, 2026-07).** The original plan modeled Outcomes-
> style **propose/approve** and a single leader. The user pared it back: **admins alone
> create and modify crews** (no writer-proposal flow), and leadership lives in the
> membership join as a flag (multiple leaders allowed). We are *not* wiring crews to
> roles/positions beyond the derived `crew_leader` view described here.

## Decisions locked with the user

- **Reuse/rename the dormant `TEAM` table into `CREW`**, reshaping it to fit (see the
  TEAM analysis below) rather than adding a brand-new table — and **retire the dead
  teams plumbing** so we don't carry that debt forward.
- **Crews are per-event** (keyed `(EVENT, SLUG)`, mirroring `AREA`) — "which crew a
  person is on *that year*"; membership changes year over year.
- **Admins only create and modify crews.** No writer propose→approve workflow, so
  `CREW` has **no `APPROVED` / `PROPOSED_BY_PERSON_ID`** columns. All crew and
  membership mutations gate on a new admin-only `GlobalAdministrateCrews` permission.
- **Crews live in the event nav, next to People** — a per-event **Crews** page
  (`/ims/app/events/{event}/crews`), since crews are event-scoped. (Not an
  `/ims/app/admin/…` global page like Incident Types.)
- **Membership is a join table, not a scalar field.** `CREW_MEMBERSHIP(EVENT,
  CREW_SLUG, PERSON_ID, IS_LEADER)` — a row is membership; `IS_LEADER = true` marks a
  leader. This supports **multiple crews per person** and **multiple leaders per crew**,
  both in one table. **No `PERSON__EVENT.CREW_ID`/`CREW_SLUG` column** and **no single
  `CREW.LEADER_PERSON_ID`** — those were the earlier single-valued design and are
  replaced by this join.
- **The `crew_leader` role is derived from leadership.** Being a member marked
  `IS_LEADER = true` of any crew that event **grants** the `crew_leader` read-only
  capability — **unless the person already holds a higher role** (writer, or admin via
  bypass), which keeps its greater access. Implemented as an **OR of permission masks**
  in `EventPermissions` (PR 3), so "unless higher" falls out for free (a writer's mask
  already supersets the read-only bits). Because the role is now derived, the manual
  **`crew_leader` option is removed from the People roster's role dropdown** (the
  `crew_leader` enum value stays in the DB — removing it is a needless migration — it is
  just no longer hand-assigned).

## TEAM-table analysis (does it fit? — the user asked)

**What exists** (`store/schema/migrations/00001_baseline.sql:100-126`):
- `TEAM(ID auto_increment PK, NAME varchar(128) unique)` — **global**, no event scope,
  **no leader**, **no approval** columns.
- `PERSON__TEAM(PERSON_ID, TEAM_ID)` — **global many-to-many** membership.
- Queries: only reads — `PeopleTeams` / `PeopleTeamsList` (`store/queries.sql:1066-1076`).
  **No create/update/delete, no admin UI, no propose/approve.**
- Consumers: descriptive plumbing only — `directory.GetPositionsAndTeams`
  (`directory/directory.go:36,127`), `refreshTeamCache` (`:90-92,152-153`),
  `Person.TeamIDs/TeamNames` (`:72-73`), `localPersonSource.teams` +
  `PeopleTeams` fan-out (`directory/local.go:54-82,90+`). **Per plan 52c teams no
  longer drive authorization** — this is dead weight (the action log stamps only
  `POSITION`, not team).

**Fit assessment:** the *table/name* is safe to repurpose (nothing depends on it for
correctness), but its *shape is wrong* on three axes for item 3:

| Need (item 3/5) | TEAM today | Gap |
|---|---|---|
| Per-event ("that year") | global | must scope per-event (mirror `AREA`) |
| Membership (multiple crews per person, ready) | global M:N `PERSON__TEAM` | reshape the join into per-event `CREW_MEMBERSHIP` |
| Multiple designated leaders per crew | none | add `IS_LEADER` to the membership join |
| Admin-only create/modify | none | gate on new `GlobalAdministrateCrews`; **no** approval columns |

**Conclusion:** honor "reuse/rename" by **renaming `TEAM`→`CREW` and reshaping it to
mirror `AREA`** (per-event, `SLUG`/`NAME`, `SORT_ORDER`) — but **without** the AREA-
style approval columns, since crews are admin-only; and **reshape `PERSON__TEAM` into
`CREW_MEMBERSHIP`** — a per-event
`(EVENT, CREW_SLUG, PERSON_ID, IS_LEADER)` join that carries both membership and
(multiple) leadership. Delete the dead teams plumbing in `directory/`. Keeps the
rename lineage and removes the Burning-Man-era debt, exactly as requested.

**As built (PR 1):** because the old TEAM/PERSON__TEAM shapes are so different (global,
integer PK, no event, no leader), the reshape was done as a clean **create + drop**
rather than an in-place rename (TEAM carries no production data OCF relies on):
`00025_create_crew.sql` creates `CREW`, `00026_create_crew_membership.sql` creates
`CREW_MEMBERSHIP`, and `00027_retire_team_tables.sql` drops `PERSON__TEAM` then `TEAM`.

> Because the reshape is substantial, the migration may be cleaner as **rename +
> alter** (`rename table TEAM to CREW`, then add/modify columns and drop
> `PERSON__TEAM`) than as a create+drop. Either is fine; keep each logical DDL step in
> its own append-only migration since MariaDB DDL isn't transactional.

## Current state that this touches (verified, file:line)

- **Participation:** table `PERSON__EVENT(PERSON_ID, EVENT, WRISTBAND,
  PARTICIPATION_TYPE)` (`00001_baseline.sql:137-148`); enum values
  `('writer','crew_leader','reporter','volunteer','public','not_present','ejected')`
  after `00012_rename_participant_to_volunteer.sql:8-11`; `crew_leader` added by
  `00006_add_crew_leader_participation.sql:8`.
- **Authz:** `crew_leader` currently → `RolesToEventPerms[EventReporter] |
  EventInviteReporters` (`lib/authz/permission.go:104-119`,
  `participationToEventPerms`). Event permission bits `permission.go:54-71`
  (`EventReadIncidents`, `EventWriteIncidents`, `EventReadAllReports`,
  `EventReadOwnReports`, `EventWriteAllReports`, `EventWriteOwnReports`, …,
  `EventInviteReporters`). Live per-request lookup from `PERSON__EVENT`
  (`EventPermissions` `:121-165`; admin bypass `ManyEventPermissions` `:169-208`).
- **Journal-entry creation** authorized via incident-edit `POST
  .../incidents/{incidentNumber}` (`api/mux.go:178` → `EditIncident.editIncident`
  `api/incident.go:1040-1071`); gate at `:1060-1071` requires `EventWriteIncidents`,
  else a per-incident grant **and** journal-only payload; low-level insert
  `addIncidentJournalEntry` `:368-397`.
- **Reports "own" scoping** is by journal-entry **authorship**, not `CREATED_BY`:
  `GetReports.getReports` `api/report.go:54-124`; `limitedAccess` when caller has
  `EventReadOwnReports` but not `EventReadAllReports` (`:64`); `containsAuthor`
  `:100-133`. `REPORT.CREATED_BY` FK→PERSON exists (`00017_*`), surfaced as
  `created_by` in `json/report.go:26`. **No REPORT→team/crew join exists today.**
- **Plan 53 (crew-leader invite) is shipped** (PRs #85-87): the invite path scopes to
  `EventInviteReporters` (`api/person.go:283-297,334-347`); `AccessForEvent` surfaces
  `inviteReporters` (`api/auth.go:213-216`). **Redefining `crew_leader` here removes
  the invite grant from that rung** — confirm no other rung/flow depended on
  crew_leader carrying invite (writers still carry `EventInviteReporters`, so
  reporter-invite survives for writers).
- **People UI:** roster `web/template/people.templ` + `web/typescript/people.ts` (role
  rungs `:40-68`, `submitMarkParticipation` `:33`, ceiling `:80-83`); anti-escalation
  `mayAssignParticipation` `api/person.go:334-347`, `validParticipation` `:320-347`.
- **Profile card:** `web/template/personprofile.templ:27-65` shows fair name / legal
  name / role / wristband; populated by `openPersonProfileModal`
  (`web/typescript/ims.ts:1346-1405`) from `GET /ims/api/personnel?person_id=&event=`
  (`api/personnel.go:201+`). Roster JSON `json/personnel.go:40-44` carries
  `ParticipationType` + `Wristband`.

## Plan — three PRs

Sequence: **PR 1 (schema + registry) → PR 2 (event Crews page + membership) → PR 3
(derived `crew_leader` role + crew-scoped report review)**. The old plan's PR 3
(redefine the rung) and PR 4 (report scoping) collapse into one PR here, because with
admin-only crews and a *derived* role the authz change and the report scope are the
same small, tightly-coupled step.

### PR 1 — `CREW` + `CREW_MEMBERSHIP` schema, queries, retire TEAM ✅ IMPLEMENTED

**Status: built and green** (PR #184, rebased onto master). No authz or UI behavior
change yet — schema, generated queries, and dead-code removal only.

1. **Migrations** (`00025`–`00027`; the picture/password migrations hold `00023`/`00024`
   on master, so crews start at `00025`):
   - `00025_create_crew.sql` — `CREW(EVENT, SLUG, NAME, SORT_ORDER)`, PK `(EVENT, SLUG)`,
     FK `EVENT → EVENT(ID)`. **No approval columns** (admin-only).
   - `00026_create_crew_membership.sql` — `CREW_MEMBERSHIP(EVENT, CREW_SLUG, PERSON_ID,
     IS_LEADER)`, PK `(EVENT, CREW_SLUG, PERSON_ID)`, composite FK `(EVENT, CREW_SLUG) →
     CREW(EVENT, SLUG)` (mirrors `INCIDENT.LOCATION_AREA_SLUG → AREA`) + FK
     `PERSON_ID → PERSON(ID)`. `IS_LEADER` carries leadership (multiple leaders allowed).
   - `00027_retire_team_tables.sql` — `drop table PERSON__TEAM` then `TEAM` (join first;
     its FK references TEAM). `Down` recreates the baseline shapes best-effort for dev.
   - `store/integration/migrate_test.go` asserts `CREW`/`CREW_MEMBERSHIP` exist and
     `TEAM`/`PERSON__TEAM` are gone at head.
2. **Retired dead teams plumbing** (`directory/`): removed the `teams`/`teamCache`
   read-through, `GetPositionsAndTeams`' team half (now `GetPositions`),
   `Person.TeamIDs/TeamNames`, and the `PeopleTeams`/`PeopleTeamsList` queries; also
   dropped the never-read JWT `tea` (teams) claim. `POSITION` is untouched (still stamped
   on the action log).
3. **sqlc queries** (`store/queries.sql`): registry CRUD — `Crews`, `Crew`, `CreateCrew`,
   `UpdateCrew` (SLUG immutable), `DeleteCrew`; membership — `CrewMembers` (JOIN PERSON
   for display + leader flag), `PersonCrews`, `CrewsLedByPerson` (backs PR 3's role
   derivation + report scoping), `AddCrewMember` (upsert), `SetCrewMemberLeader`,
   `RemoveCrewMember`, `RemoveAllCrewMembers` (clear before crew delete). **No**
   `LatestEventWithCrews` copy-forward yet — whether the crew *list* carries year-over-
   year is a PR 2 decision (membership does not).

**Verified:** `go run bin/build/build.go`, `go vet ./...`, `go test ./...`,
`go test ./store/integration` (migrations apply to real MariaDB), golangci-lint clean.

### PR 2 — Crews page in the event nav + membership management (admin-only)

1. **API `api/crew.go`** (mirror `api/area.go`, minus propose/approve):
   - `GetCrews` — `GET /ims/api/events/{eventName}/crews`, served from a per-event
     `crewsCache`. Include each crew's members + leader flags (or a sibling members
     endpoint) so the page can render membership.
   - `EditCrews` — `POST /ims/api/events/{eventName}/crews`: create / update / delete
     crews **and** manage membership (add/remove a person, toggle `IS_LEADER`). **Admin
     only** — gate on a new `GlobalAdministrateCrews` (add to `lib/authz/permission.go`
     + `RolesToGlobalPerms[Administrator]`, mirror `GlobalAdministrateAreas`); there is
     **no** non-admin propose branch. Deleting a crew calls `RemoveAllCrewMembers` then
     `DeleteCrew`. **Mutating routes register `LogRequest(true, …)`.**
   - Routes in `api/mux.go` next to the areas routes.
2. **Event Crews page** `web/template/crews.templ` + `web/typescript/crews.ts` — mounted
   at **`/ims/app/events/{event}/crews`**, linked from the **event nav next to People**
   (`web/template/nav.templ`), **not** the global admin root. List crews (create/rename/
   delete), and per crew a member list with an add-person combobox (scoped to the event)
   and a per-member **leader** checkbox. Gate the whole page on `GlobalAdministrateCrews`.
3. **Show crew on the person views (read-only):** surface a person's crew(s) on the
   People roster and/or the profile card (`personprofile.templ` + `openPersonProfileModal`)
   via `PersonCrews`. Display-only; management stays on the Crews page.

**Verify:** `go test ./... ./api/integration`; `npx eslint`. Manual: as an admin, create
a crew from the event's Crews page, add members, mark one or more as leader; a non-admin
gets no Crews link and a 403 from the API.

### PR 3 — Derive the `crew_leader` role from leadership + crew-scoped report review

1. **Derive the role (`lib/authz/permission.go`).** In `EventPermissions`, after
   computing the participation-derived mask, **OR in** a `crewLeaderReadOnlyMask` when
   the caller leads any crew for that event (`CrewsLedByPerson` non-empty):
   ```
   crewLeaderReadOnlyMask = EventReadEventName | EventReadIncidents | EventReadAreas
   effective = participationToEventPerms(participationType)
   if CrewsLedByPerson(event, caller) not empty: effective |= crewLeaderReadOnlyMask
   ```
   "Unless higher role" is automatic: a writer's mask already supersets these bits, and
   admins bypass entirely. Report reading is **not** a flat bit here — it's crew-scoped
   in step 2. Drop the now-unused `EventInviteReporters` from the static `crew_leader`
   rung in `participationToEventPerms` (the derived path replaces it); keep the
   `crew_leader` enum value.
2. **Journal entries stay blocked** — journal creation is gated on `EventWriteIncidents`
   (`api/incident.go:1060-1071`), which the read-only mask never grants. Add a test: a
   crew leader (no other role) POST-ing an incident edit / journal payload → **403**.
3. **Crew-scoped report review (`api/report.go`).** A crew leader may read reports whose
   **creator is a member of a crew they lead**. Add a query joining
   `REPORT.CREATED_BY → CREW_MEMBERSHIP` for the crews from `CrewsLedByPerson`, and a
   branch in `getReports` that unions these with the caller's own reports. Least-
   privilege: do **not** grant a flat `EventReadAllReports`; the crew branch is the scope.
4. **People roster dropdown:** remove `crew_leader` from the assignable role options
   (`web/typescript/people.ts`) — the role is now a consequence of being marked a crew
   leader on the Crews page, not a hand-assigned rung. Update `mayAssignParticipation`/
   `validParticipation` copy if they enumerate it.
5. **Plan-53 note:** `crew_leader` no longer carries reporter-invite; writers still hold
   `EventInviteReporters`, so invites survive. Update plan 53's status note.

**Verify:** `go test ./... ./api/integration` (a crew leader can GET incidents read-only,
POST-edit/journal → 403, sees their crew's reports but not other crews'; a plain crew
*member* who is not a leader gets no elevated access). `npx eslint`. Manual: log in as a
crew leader → incidents visible read-only, no journal/edit controls, reports list shows
the crew's reports.

## Sequencing & risks

- Order: **PR 1 → PR 2 → PR 3**. PR 1 is done. PR 2 and PR 3 share the membership tables
  but are otherwise independent (PR 2 = admin UI, PR 3 = authz + reports); PR 3 can even
  precede PR 2's UI since it only needs the schema, but building the assignment UI first
  makes PR 3 manually testable.
- **Behavior change to a shipped feature:** the `crew_leader` rung changes meaning (was
  reporter + invite; becomes a derived read-only viewer). Coordinate with anyone relying
  on crew-leader invites and update plan 53's doc/status.
- **Decisions confirmed with the user (2026-07):**
  - Crew registry is **per-event** (mirrors AREA), for "that year".
  - **Membership join table** with **multiple crews per person** and **multiple leaders
    per crew** (`CREW_MEMBERSHIP.IS_LEADER`). No single-valued `PERSON__EVENT.CREW_SLUG`
    / `CREW.LEADER_PERSON_ID`.
  - **Admins alone** create/modify crews (no propose/approve); the **Crews page lives in
    the event nav next to People**.
  - The `crew_leader` role is **derived** from `IS_LEADER`, capped by any higher role;
    it is **removed from the People roster's role dropdown**.
