# 95 — Crews: registry, per-event membership, crew-leader view + report review

## Context

Three related feedback items (round 10, slice 10c):

- **Item 3:** add a **Crew** field to the person↔event table (track which crew a person
  is on *that year*), and add a **Crews** DB table handled like Incident Types / Areas /
  Outcomes (data-driven, admin-managed, with a propose/approve workflow).
- **Item 4:** the **Crew Leader** role can **view incidents**, but may **not edit
  anything or add journal entries**.
- **Item 5:** Crew Leaders can **review the reports of their crew**; a crew has a person
  **marked as its Crew Leader**.

These form one cohesive feature: a crew registry, a per-event crew assignment on each
person, a designated leader per crew, and a redefinition of the existing `crew_leader`
participation rung into a read-only viewer.

## Decisions locked with the user

- **Reuse/rename the dormant `TEAM` table into `CREW`**, reshaping it to fit (see the
  TEAM analysis below) rather than adding a brand-new table — and **retire the dead
  teams plumbing** so we don't carry that debt forward.
- **Redefine the existing `crew_leader` participation rung** to **read-only**: read all
  incidents + review own-crew reports; **no** writes, journal entries, or
  reporter-invite. (This replaces the plan-53 grant where `crew_leader` = reporter +
  invite.)

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
| One crew per person per event, as a field on person↔event | global M:N `PERSON__TEAM` | drop the join; add `PERSON__EVENT.CREW_ID` |
| A designated leader | none | add `LEADER_PERSON_ID` |
| Propose/approve like types/areas | none | add `APPROVED` + `PROPOSED_BY_PERSON_ID` |

**Conclusion:** honor "reuse/rename" by **renaming `TEAM`→`CREW` and reshaping it to
mirror `AREA`** (per-event, `SLUG`/`NAME`, `SORT_ORDER`) **plus** a `LEADER_PERSON_ID`
and the two approval columns; **drop `PERSON__TEAM`** (replaced by
`PERSON__EVENT.CREW_ID`); and **delete the dead teams plumbing** in `directory/`. This
is close to "a new table shaped like AREA" but keeps the rename lineage and removes the
Burning-Man-era debt, exactly as requested.

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

## Plan — four PRs

### PR 1 — `CREW` table + `PERSON__EVENT.CREW_ID` (schema + registry, no authz change)

1. **Migrations** (pinned goose scaffold; one logical change each; bump
   `store/integration/migrate_test.go`):
   - `rename table TEAM to CREW;`
   - Reshape `CREW` to mirror `AREA` + leader + approval. Target shape:
     ```sql
     CREW(
       EVENT                 integer      not null,
       SLUG                  varchar(128) not null,   -- immutable, like AREA
       NAME                  varchar(255) not null,
       LEADER_PERSON_ID      integer,                 -- item 5: crew's leader
       SORT_ORDER            integer      not null default 0,
       APPROVED              boolean      not null default true,
       PROPOSED_BY_PERSON_ID integer,
       primary key (EVENT, SLUG),
       foreign key (LEADER_PERSON_ID)      references PERSON(ID),
       foreign key (PROPOSED_BY_PERSON_ID) references PERSON(ID)
     )
     ```
     (Since old `TEAM` was global with an integer PK and no event, this is effectively
     a rebuild — if a rename+alter is awkward given existing rows, `drop table
     PERSON__TEAM; drop table TEAM; create table CREW …` is acceptable because TEAM
     carries no production data OCF relies on. Note the choice in the PR.)
   - `drop table PERSON__TEAM;`
   - `alter table PERSON__EVENT add column CREW_ID …` — **FK to the crew.** Because
     `CREW` is keyed `(EVENT, SLUG)`, the person↔event crew field is best a
     `CREW_SLUG varchar(128)` with a composite FK `(EVENT, CREW_SLUG) → CREW(EVENT,
     SLUG)` (mirrors how `INCIDENT.LOCATION_AREA_SLUG` references `AREA`,
     `00001_baseline.sql:352-354`). Nullable = "no crew".
2. **Retire dead teams plumbing** (`directory/`): remove `teams`/`teamCache`/
   `GetPositionsAndTeams`' team half / `Person.TeamIDs/TeamNames` / `PeopleTeams` /
   `PeopleTeamsList` (`directory/directory.go:36,72-73,90-92,127-137,152-153`,
   `directory/local.go:54-82,90+`, `store/queries.sql:1066-1068,1074-1076`). Keep
   POSITION untouched (still stamped on the action log). Regen sqlc.
3. **sqlc queries** (mirror `Area*`): `Crews`, `CrewsWithProposer` (LEFT JOIN PERSON for
   proposer; and JOIN PERSON for the leader's display name), `LatestEventWithCrews`
   (year-over-year copy-forward like `LatestEventWithAreas` `queries.sql:690`), `Crew`,
   `CreateCrew`, `ApproveCrew`, `DeleteCrew`, `UpdateCrew` (SLUG immutable),
   `SetCrewLeader`. Plus `SetPersonEventCrew` (writes `PERSON__EVENT.CREW_SLUG`).

**Verify:** `go run bin/build/build.go`; `go test ./... ./store/integration` (rename/
reshape applies; `PERSON__EVENT.CREW_SLUG` FK holds). No behavior change yet.

### PR 2 — Crews admin page + propose/approve (mirror Areas)

1. **API `api/crew.go`** (mirror `api/area.go`):
   - `GetCrews` — `GET /ims/api/events/{eventName}/crews`, served from a `crewsCache`
     keyed by event.
   - `EditCrews` — `POST /ims/api/events/{eventName}/crews`: create (writer→proposal /
     admin→approved), approve, update, mark-duplicate/delete, **set-leader** (assign
     `LEADER_PERSON_ID`). Admin gate: add `GlobalAdministrateCrews` to
     `lib/authz/permission.go` + `RolesToGlobalPerms` (mirror
     `GlobalAdministrateAreas`); non-admins may only propose.
   - `ProposeCrew` if the propose flow lives on a separate event-scoped route like
     incident types, or fold into `EditCrews`' create branch like Areas — match Areas.
   - Routes in `api/mux.go` next to the areas routes (`:398,408`). **Mutating routes
     `LogRequest(true, …)`.**
2. **Admin page** `web/template/admincrews.templ` + `web/typescript/admin_crews.ts`
   (mirror `adminareas`): list with proposed badge + Approve + mark-duplicate, create/
   edit form, and a **leader picker** (person combobox scoped to the event) writing
   `LEADER_PERSON_ID`. Page route in `web/mux.go` (next to `/ims/app/admin/areas`
   `:120-121`) + nav entry gated on `GlobalAdministrateCrews`.
3. **Assigning a person's crew:** add the crew field to the People roster/edit UI
   (`web/template/people.templ`, `web/typescript/people.ts`) — a per-event crew select
   posting to a `SetPersonEventCrew` endpoint (mirror `submitMarkParticipation`
   `people.ts:33` / the participation route `api/mux.go:531`). Gate it like other
   person-event edits (admins + inviters).

**Verify:** `go test ./... ./api/integration`; `npx eslint`. Manual: admin creates a
crew, sets its leader; a writer proposes a crew → "proposed" → admin approves; assign a
person to a crew from the People page.

### PR 3 — Redefine `crew_leader` to read-only (authz)

1. **`participationToEventPerms`** (`lib/authz/permission.go:104-119`): change
   `crew_leader` from `RolesToEventPerms[EventReporter] | EventInviteReporters` to a
   **read-only mask**:
   ```
   EventReadEventName | EventReadIncidents | EventReadAllReports | EventReadAreas
   ```
   — **no** `EventWrite*`, **no** `EventInviteReporters`, **no** journal grant. (Item 4:
   view incidents, no edits, no journal.) Note `EventReadAllReports` is refined by PR 4
   to a crew-scoped read; include it here so the rung can see reports at all, then PR 4
   narrows *which* reports.
2. **Journal entries are already gated** on `EventWriteIncidents`
   (`api/incident.go:1060-1071`) — with the write bit gone, a crew leader cannot add
   journal entries. Add a test asserting a `crew_leader` POST to incident-edit with a
   journal payload is **403** (no write bit, no per-incident grant).
3. **Plan-53 fallout:** `crew_leader` no longer carries `EventInviteReporters`. Confirm
   invites still work for **writers** (they retain the bit, `permission.go:97`) and
   update any UI/copy that implied crew leaders can invite (`api/auth.go:213-216`
   `inviteReporters`, People UI reveal). Update plan 53's status note to reflect the
   redefinition.
4. **People UI:** crew_leader now reads as a view-only rung — adjust the role-rung
   labels/tooltips (`web/typescript/people.ts:40-68`) and `mayAssignParticipation`
   ceiling if the rung's assignability changes (it stays admin-assignable; confirm a
   non-admin inviter still cannot assign it, `api/person.go:334-347`).

**Verify:** `go test ./... ./api/integration` (a `crew_leader` can GET incidents but
POST-edit/journal → 403; cannot invite). `npx eslint`. Manual: log in as a crew_leader
→ incidents are visible read-only; no journal box / edit controls; no invite affordance.

### PR 4 — Crew Leaders review their crew's reports (report scoping)

Item 5: a crew leader reviews the reports **of their crew** — i.e. reports authored by
people whose `PERSON__EVENT.CREW_SLUG` matches the crew the leader leads.

1. **Define "their crew":** the crew(s) where `CREW.LEADER_PERSON_ID = caller`
   (a person may lead one crew). "Crew members" = people with
   `PERSON__EVENT.CREW_SLUG = <that crew>` for the event.
2. **Report visibility** (`api/report.go:54-124`): today `limitedAccess` filters to
   reports the caller **authored** (`containsAuthor` `:100-133`). Add a **crew-leader
   branch**: if the caller is a crew leader for the event, they may read reports whose
   **author/creator is a member of their crew** (not just their own). Implement via a
   new query joining `REPORT.CREATED_BY → PERSON__EVENT.CREW_SLUG` = the leader's crew
   (and/or journal-entry authorship for the legacy "own" definition — pick `CREATED_BY`
   as the crew-membership anchor since that is the deterministic creator link,
   `00017_*` / `json/report.go:26`). Add `ReportsForCrew`-style query in
   `store/queries.sql`.
3. **Permission shaping:** rather than granting `crew_leader` the broad
   `EventReadAllReports` from PR 3, consider a **crew-scoped read** so a crew leader
   sees *their crew's* reports, not every report. Two options:
   - (a) Keep `EventReadAllReports` off; add a dedicated capability/branch checked in
     `getReports` for crew leaders (cleanest — report scope is data-driven by crew).
   - (b) Grant `EventReadAllReports` and filter in the handler. (a) is preferred —
     least privilege. Update PR 3's mask accordingly (drop `EventReadAllReports`, rely
     on the crew branch).
4. **UI:** the reports list already renders what the server returns; ensure the
   crew-leader view is labeled (e.g. "My crew's reports") and that incident **journal**
   controls stay hidden for them.

**Verify:** `go test ./... ./api/integration` (crew leader sees reports created by crew
members, not reports from other crews; a non-leader crew member sees only their own).
`npx eslint`. Manual: as a crew leader, the reports list shows the crew's reports and
nothing outside the crew; still no edit/journal.

## Sequencing & risks

- Order: **PR 1 → PR 2 → PR 3 → PR 4** (schema → admin/assignment → authz → report
  scoping). PR 3 and PR 4 are coupled (the report mask); author them together if it
  reads cleaner, but keep the migration (PR 1) separate.
- **Land after slice 10e** (reporter IMS #) so the report handler is stable before PR 4
  reworks report scoping. See [93-feedback-round-10.md](93-feedback-round-10.md).
- **Behavior change to a shipped feature:** redefining `crew_leader` (PR 3) alters
  plan-53 semantics — coordinate with anyone relying on crew-leader invites and update
  plan 53's doc/status.
- **Decisions to confirm:**
  - Crew registry **per-event** (mirrors AREA, chosen) vs **global** (mirrors
    INCIDENT_TYPE). Per-event fits "that year" + per-year leadership; confirm.
  - One crew per person per event (a single `CREW_SLUG` field, chosen) vs many
    (would need to keep a join). Item 3 says "a Crew field" → single. Confirm.
  - Does a person have to hold the `crew_leader` **rung** to be a crew's
    `LEADER_PERSON_ID`, or can any person be marked leader while the rung is what
    grants the read-only view? Recommended: **rung grants the capability**,
    `LEADER_PERSON_ID` + the member's `CREW_SLUG` defines **scope** — keep them
    independent but expect them to align in practice.
</content>
