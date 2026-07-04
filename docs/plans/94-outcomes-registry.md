# 94 — Outcomes registry (feedback round 10, slice 10a)

## Context

Feedback item 1: **"Update Outcomes to work similarly to Incident Types and Areas —
database-backed, with proposed outcomes."**

Today, Outcomes is the odd one out of the three incident taxonomies:

| | Incident Types | Areas | **Outcomes (today)** |
|---|---|---|---|
| Storage | table `INCIDENT_TYPE` | table `AREA` | **`ENUM` column `INCIDENT.OUTCOME`** |
| Reference from incident | join `INCIDENT__INCIDENT_TYPE` | FK `INCIDENT.LOCATION_AREA_SLUG` | inline scalar enum value |
| Admin CRUD UI | yes (`admintypes`) | yes (`adminareas`) | **none** |
| Propose → approve | yes (`00014`) | yes (`00011`) | **none** |
| Values live in | DB rows (data-driven) | DB rows (data-driven) | **hardcoded in 4 places** |

Adding one outcome today means editing an **enum migration** plus **three front-end
locations** and regenerating sqlc. The goal is to promote Outcomes to a data-driven
table with the same propose/approve workflow, so admins manage outcomes from an admin
page and event writers can propose new ones from the incident form.

**Decision:** model Outcomes on **Incident Types** (a **global** registry, not
per-event) — outcomes are Fair-wide dispositions, not event-scoped like Areas. Outcome
stays **single-valued** per incident (an incident has at most one outcome), so the
incident↔outcome link is an **FK column**, not a join table.

### Current state (verified, file:line)

- **Enum column:** `INCIDENT.OUTCOME` nullable `ENUM`, defined inline
  `store/schema/migrations/00001_baseline.sql:191-195` (original 8 values), extended
  to 14 by `00013_add_ocf_outcomes.sql:5-12` (appends `taken_to_big_bird`,
  `taken_to_little_wing`, `asked_to_leave`, `booted`, `arrested`,
  `transported_in_ambulance`).
- **No outcome query** — read/written only inline as part of INCIDENT: set in
  `UpdateIncident` `store/queries.sql:41`, read in dashboard aggregate
  `store/queries.sql:1099`. sqlc generates `imsdb.IncidentOutcome` /
  `NullIncidentOutcome`; constants used e.g. `api/metrics.go:258`.
- **No API route/handler.** Outcome handled inline in incident edit only:
  `api/incident.go:675-686` (parse string → `imsdb.IncidentOutcome`, `.Valid()`,
  reject invalid with 400, empty clears); serialize back `outcomeToString`
  `api/incident.go:1276-1283`; JSON `Outcome *string` `json/incident.go:54`.
- **Hardcoded values in the front end (3 spots):**
  - `<option>` list `web/template/incident.templ:124-138`.
  - TS union `IncidentOutcome` `web/typescript/ims.ts:3494-3499`.
  - display-name `switch` `outcomeNameFromID` `web/typescript/ims.ts:1050-1071`.
  - edit wiring `editOutcome` `web/typescript/incident.ts:1388-1389`, draw `:685-688`.

### The pattern to mirror (Incident Types)

- Table `INCIDENT_TYPE(ID, NAME unique, HIDDEN, DESCRIPTION, GROUP)` +
  `APPROVED bool default true` + `PROPOSED_BY_PERSON_ID` (`00001_baseline.sql:23-32`,
  `00014_add_incident_type_approval.sql:9-12`).
- Queries: `IncidentTypes`, `IncidentTypesWithProposer` (LEFT JOIN PERSON for proposer),
  `IncidentType`, `IncidentTypeByName`, `CreateIncidentType`, `ApproveIncidentType`,
  `UpdateIncidentType` (`store/queries.sql:214-243,616-627`).
- Handlers: `GetIncidentTypes` (cache-served, `api/itype.go:40-75`), `EditIncidentTypes`
  (admin-gated create/approve/update, `:110-215`), `ProposeIncidentType` (event-writer,
  creates unapproved with proposer, dedups by name, `:222-288`). Routes
  `api/mux.go:448,458,471`. Admin gate `GlobalAdministrateIncidentTypes`.
- Admin UI: `web/template/admintypes.templ` + `web/typescript/admin_types.ts` (proposed
  badge, Approve button, `approveIncidentType`); page route `web/mux.go:111-112`.
- Incident-form combobox + propose wiring `web/typescript/incident.ts:34-35,144-145,849`.

## Plan

Recommend **two PRs**: (A) data model + API + admin page (Outcomes become
DB-backed and manageable), then (B) flip the incident form + propose flow to the new
data source and remove the hardcoded lists. A can ship without B (the enum column can
coexist during transition — see migration note).

### PR A — Outcome table, queries, API, admin page

1. **Migration `00018_create_outcome_table`** (pinned goose scaffold). Create a global
   table mirroring `INCIDENT_TYPE`'s approval shape:
   ```sql
   -- +goose Up
   create table OUTCOME (
       ID                    integer      not null auto_increment,
       NAME                  varchar(128) not null,
       HIDDEN                boolean      not null default false,
       APPROVED              boolean      not null default true,
       PROPOSED_BY_PERSON_ID integer,
       primary key (ID),
       unique key (NAME),
       foreign key (PROPOSED_BY_PERSON_ID) references PERSON(ID)
   ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
   -- seed the 14 current enum values as approved rows (reference data, like 00015)
   insert into OUTCOME (NAME, APPROVED) values ('Handled', true), … ;
   -- +goose Down
   drop table OUTCOME;
   ```
   - Seed the human-readable names that `outcomeNameFromID` (`ims.ts:1050-1071`)
     currently renders for the 14 enum values — that switch is the canonical
     enum→label map to copy.
   - **Incident link — do it in a follow-on migration in this PR** (append-only, one
     logical change each): add `INCIDENT.OUTCOME_ID integer` FK → `OUTCOME(ID)`, then
     **backfill** `OUTCOME_ID` from the existing `OUTCOME` enum string by joining on
     the seeded `NAME`, then keep the old `OUTCOME` enum column **for one release** (or
     drop it in PR B once nothing reads it). Backfill mapping: enum value →
     `outcomeNameFromID` label → `OUTCOME.NAME` → `OUTCOME.ID`.
   - Bump `store/integration/migrate_test.go`.
2. **sqlc queries** (mirror the `IncidentType*` set) in `store/queries.sql`: `Outcomes`,
   `OutcomesWithProposer` (LEFT JOIN PERSON), `Outcome`, `OutcomeByName`,
   `CreateOutcome`, `ApproveOutcome`, `UpdateOutcome`. Update `CreateIncident`/
   `UpdateIncident` to write `OUTCOME_ID` (keep writing the legacy enum too until PR B
   drops it, or switch fully if PR A also owns the incident form — see PR B).
3. **API `api/outcome.go`** (mirror `api/itype.go`):
   - `GetOutcomes` — `GET /ims/api/outcomes`, served from a new `outcomesCache`.
   - `EditOutcomes` — `POST /ims/api/outcomes`, admin-gated (add a
     `GlobalAdministrateOutcomes` global permission to `lib/authz/permission.go` in
     the same style as `GlobalAdministrateIncidentTypes`, granted to `Administrator` in
     `RolesToGlobalPerms`). Handles create / approve / update.
   - `ProposeOutcome` — `POST /ims/api/events/{eventName}/outcomes`, event-writer-gated,
     creates unapproved with `PROPOSED_BY_PERSON_ID = caller`, dedups by name via
     `OutcomeByName`.
   - Register routes in `api/mux.go` next to the incident-type routes
     (`:448,458,471`). **All mutating routes: `LogRequest(true, …)`** (CLAUDE.md).
4. **Admin page** `web/template/adminoutcomes.templ` + `web/typescript/admin_outcomes.ts`
   (mirror `admintypes`): list with proposed badge + Approve button, create/edit form.
   Add a page route in `web/mux.go` (next to `/ims/app/admin/types`, `:111-112`) and a
   nav entry.
5. **`GlobalAdministrateOutcomes`** — add the permission bit + role mapping; confirm the
   admin nav reveals the page only for holders.

**Verify:** `go run bin/build/build.go`; `go test ./... ./store/integration ./api/integration`
(migration seeds 14 outcomes, backfills `OUTCOME_ID` correctly, `EditOutcomes`
create/approve/update round-trip, `ProposeOutcome` writes unapproved with proposer).
`npx eslint`. Manual: admin outcomes page lists the 14 seeded outcomes; create one;
propose one as a writer → shows "proposed" → approve it.

### PR B — Data-drive the incident form; remove hardcoded lists

1. **Incident form** (`web/template/incident.templ:124-138`): replace the hardcoded
   `<option>`s with a placeholder the client populates from `GET /ims/api/outcomes`
   (mirror how incident types load into their combobox, `incident.ts:849`
   `drawIncidentTypesToAdd`). Include a **propose-new-outcome** affordance for writers,
   like the incident-type propose flow.
2. **Client (`web/typescript`):** delete the `IncidentOutcome` union (`ims.ts:3494-3499`)
   and the `outcomeNameFromID` switch (`ims.ts:1050-1071`); replace with a data-driven
   lookup keyed on `OUTCOME.ID`/`NAME` fetched at load (add a loader analogous to
   `loadIncidentTypes`). Update `editOutcome` (`incident.ts:1388-1389`) and the draw
   path (`:685-688`) to send/read `outcome_id`.
3. **Server incident edit** (`api/incident.go:675-686`, `outcomeToString` `:1276-1283`,
   `json/incident.go:54`): switch from parsing the enum string to accepting/serializing
   `outcome_id` (nullable) validated against the `OUTCOME` table. Update
   `UpdateIncident`/`CreateIncident` to persist `OUTCOME_ID`.
4. **Migration `000NN_drop_incident_outcome_enum`** — once nothing reads the legacy
   `INCIDENT.OUTCOME` enum, drop the column. (Append-only; separate migration.)
5. **Metrics** (`api/metrics.go:258` and the by-outcome aggregate, `queries.sql:1099`):
   repoint from the enum to `OUTCOME_ID`/name.

**Verify:** `go run bin/build/build.go`; `go test ./...`; `npx eslint`. Manual: set an
incident's outcome from the (now data-driven) dropdown; propose a new outcome from the
incident form as a writer; confirm dashboards' outcome breakdown still renders.

## Notes / decisions to confirm

- **Global vs per-event:** chosen **global** (like Incident Types). If OCF ever wants
  event-specific outcome sets, the Areas pattern (per-event + `LatestEventWithAreas`
  copy-forward) is the alternate; not needed now.
- **`HIDDEN` column:** included to match `INCIDENT_TYPE` (lets an outcome be retired
  without deleting historical references). Drop it if we prefer the leaner `AREA` shape
  (Areas have no `HIDDEN`).
- **Single-valued** confirmed — FK column, not a join table. If multi-outcome is ever
  wanted, that's a schema change to a join table (out of scope).
</content>
