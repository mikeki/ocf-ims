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

**Status: ✅ Built.** As built, PR A is purely additive — it creates the OUTCOME table
+ API + admin page and **does not touch INCIDENT at all** (no `OUTCOME_ID`/backfill).
That kept it fully independent of the in-review two-state slice (10b) and left the
`INCIDENT.OUTCOME` enum untouched, so incidents still record outcomes via the enum
until PR B rewires them. Decisions baked in: **alphabetical sort** (per the user),
`NAME`/`HIDDEN`/`APPROVED`/`PROPOSED_BY_PERSON_ID` only (no group/description), and
migration numbered **`00019`** (not 00018 — that number is taken by 10b's state
migration; 10a should land after 10b).

1. **Migration `00019_create_outcome_table.sql`** — create the global `OUTCOME`
   table (`ID`, `NAME` unique, `HIDDEN`, `APPROVED` default true,
   `PROPOSED_BY_PERSON_ID` FK→PERSON), mirroring `INCIDENT_TYPE`'s approval shape, and
   seed the fourteen current dispositions as approved rows (the display names from the
   incident form). No INCIDENT change; `migrate_test.go` needs no bump (tables-exist +
   idempotency only). The `INCIDENT.OUTCOME_ID` FK + backfill + enum drop are **PR B**.
2. **sqlc queries** in `store/queries.sql`: `Outcomes`, `OutcomesWithProposer` (LEFT
   JOIN PERSON), `Outcome`, `OutcomeByName`, `CreateOutcome`, `ApproveOutcome`,
   `UpdateOutcome` (mirror the `IncidentType*` set, minus group/description). No
   `CreateIncident`/`UpdateIncident` change in PR A.
3. **API `api/outcome.go`** (mirrors `api/itype.go`, minus the metrics cache — outcome
   edits don't move any incident's disposition yet): `GetOutcomes`
   (`GET /ims/api/outcomes`, served from a new `outcomesCache`, sorted alphabetically),
   `EditOutcomes` (`POST /ims/api/outcomes`, admin create/approve/update),
   `ProposeOutcome` (`POST /ims/api/events/{eventName}/outcomes`, writer-gated, dedups
   by name). Routes in `api/mux.go` next to the incident-type routes; mutating routes
   `LogRequest(true, …)`.
4. **Permissions** — added `GlobalReadOutcomes` (every authenticated user, like
   `GlobalReadIncidentTypes`) and `GlobalAdministrateOutcomes` (Administrator) to
   `lib/authz/permission.go` + `RolesToGlobalPerms`.
5. **Admin page** `web/template/adminoutcomes.templ` + `web/typescript/admin_outcomes.ts`
   (simplified clone of `admintypes` — Name + Hidden toggle + Approve + Edit + Add, no
   group). Page route in `web/mux.go`, admin-root link in `adminroot.templ`. See
   [97-admin-enum-pages.md](97-admin-enum-pages.md) (`adminoutcomes`).
6. **Tests** — `api/integration/outcome_test.go`: admin create + hide/unhide + rename,
   and the propose → approve → duplicate-resolves → reporter-403 flow.

**Verified** via `docker build --target build` (sqlc/templ/tsgo generation + `go build`
+ TS transpile) and `go vet ./...` (compiles the new integration tests). CI runs the
integration tests against a live MariaDB.

### PR B — Data-drive the incident form; remove hardcoded lists

**Status: ✅ Built.** The incident form's disposition picker is now data-driven from the
`OUTCOME` table and the legacy `INCIDENT.OUTCOME` enum is gone end-to-end (schema →
API → client). As built:

1. **Migrations** — `00020_add_incident_outcome_id.sql` adds the nullable
   `INCIDENT.OUTCOME_ID` FK (named constraint `INCIDENT_OUTCOME_TO_OUTCOME`) and
   backfills it from the enum by matching each enum value to its seeded `OUTCOME.NAME`;
   `00021_drop_incident_outcome_enum.sql` then drops the `INCIDENT.OUTCOME` column.
   (Two migrations, add-then-drop, so the backfill runs before the source column
   disappears.)
2. **Queries** — `UpdateIncident` writes `OUTCOME_ID = ?`; `MetricsIncidents`
   `left join OUTCOME` and selects `o.NAME as OUTCOME_NAME` for follow-up detection.
3. **Server** (`api/incident.go`) — JSON is now `outcome_id *int32`
   (`json/incident.go`): **nil** leaves it unchanged, **0** clears it, any other value
   must reference an existing `OUTCOME` row (else **400**). Outcomes are loaded
   pre-transaction to validate and to resolve the display name for the journal line
   (`"Changed outcome: <name>"`). `outcomeToString` removed; read path serializes
   `conv.SqlToInt32(OUTCOME_ID)`.
4. **Metrics** (`api/metrics.go`) — follow-up detection keys on the joined
   `OUTCOME_NAME == "Follow-Up Required"` (package const `outcomeFollowUpRequired`,
   with a comment that renaming that seeded outcome would need a matching update).
5. **Client** (`web/typescript`) — deleted the `IncidentOutcome` union and the
   `outcomeNameFromID` switch; added `ims.loadOutcomes()` (alphabetical, mirrors
   `loadIncidentTypes`). `incident.ts` loads outcomes at init and
   `drawOutcomesToSelect()` populates the `<select>` (visible outcomes + the incident's
   current one even if hidden); `editOutcome` sends `outcome_id` (0 to clear). The
   journal render drops the code→label translation since the server now logs the
   display name directly.
6. **Tests** — `TestIncidentOutcome` and the metrics test resolve seeded outcome IDs by
   name via a new `outcomeIDByName` helper (no hardcoded auto-increment IDs).

**Deviation from the original sketch:** the **propose-new-outcome affordance on the
incident form was intentionally left out.** The picker is a single-`<select>`, for which
an inline "type-a-new-one" combobox (the incident-type pattern) is a poor UX fit, and
admins already manage the outcome vocabulary from the admin page delivered in PR A. The
`ProposeOutcome` API (`POST /ims/api/events/{event}/outcomes`) still exists if a
writer-facing propose UI is wanted later. Flagged for the user; easy follow-up if
desired.

**Verified** via `docker build --target build` (sqlc/templ/tsgo generation + `go build`
+ TS transpile), `go vet ./...`, and the non-integration unit suite
(`go test $(go list ./... | grep -v integration)` — all green bar the testcontainer
directory test, which needs Docker-in-Docker and passes in CI). The integration tests
(`TestIncidentOutcome`, metrics) exercise the new FK path against a live MariaDB in CI.

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
