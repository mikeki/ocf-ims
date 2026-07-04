# Feedback round 10: outcomes registry, two-state incidents, crews, profile pictures, report polish

## Context

A batch of stakeholder feedback covering nine items. This doc is the **umbrella**:
it records the decisions locked with the user, groups the nine items into slices,
sequences them, and fully specifies the four small/self-contained slices. The three
large features get their own dedicated plan docs (linked below) so this file stays
readable.

All slices target **master directly** (no stacking) unless a dedicated doc says
otherwise; each PR merges manually after CI is green.

### The nine feedback items → slices

| # | Feedback | Slice | Plan |
|---|---|---|---|
| 1 | Outcomes should work like Incident Types & Areas (DB-backed, with proposed outcomes) | 10a | [94-outcomes-registry.md](94-outcomes-registry.md) |
| 2 | Only two states, **Active** / **Resolved**; start Active; "Mark Resolved" + "Reopen" buttons | 10b | this doc |
| 3 | Add a **Crew** field to person↔event; add a **Crews** table handled like types/areas/outcomes | 10c | [95-crews.md](95-crews.md) |
| 4 | Crew Leader can **view** incidents, but not edit anything or add journal entries | 10c | [95-crews.md](95-crews.md) |
| 5 | Crew Leaders can review their **crew's reports**; a crew has a person marked as Crew Leader | 10c | [95-crews.md](95-crews.md) |
| 6 | **Profile picture** per person, shown on the profile card | 10d | [96-person-profile-picture.md](96-person-profile-picture.md) |
| 7 | Reporters can **attach an IMS #** to a report they're creating/created; IMS # before Summary | 10e | this doc |
| 8 | Rename the **"Summary"** label to **"Brief Description"** on incidents & reports | 10f | this doc |
| 9 | **Remove** the "Create incident from report" button | 10g | this doc |

### Decisions locked with the user

- **10a (Outcomes):** promote the hardcoded `INCIDENT.OUTCOME` enum to a **DB table
  with a propose/approve workflow**, mirroring Incident Types (global registry).
  Outcome stays **single-valued** per incident. See [94](94-outcomes-registry.md).
- **10b (States):** collapse the five-state enum to **`active` / `resolved`**. New
  incidents start **`active`**. Replace the state dropdown with a **"Mark Resolved"**
  button and a **"Reopen"** button. `resolved` sets/clears the existing `CLOSED`
  timestamp (today's `closed` coupling).
- **10c (Crews):** **rename/reshape the dormant `TEAM` table into `CREW`** (per-event,
  mirroring `AREA`, with `LEADER_PERSON_ID` + approval columns), **drop `PERSON__TEAM`**
  in favor of a new **`PERSON__EVENT.CREW_ID`** field, and **retire the dead teams
  plumbing** in `directory/`. **Redefine the existing `crew_leader` participation rung**
  to **read-only** (read all incidents, review own-crew reports; **no** writes, journal
  entries, or reporter-invite). See [95](95-crews.md).
- **10d (Profile picture):** stored via the existing `conf.AttachmentsStore`
  (local/S3) switch; a nullable filename column on `PERSON`. Upload/change is gated
  to **whoever can already edit the person** (admins via `GlobalAdministratePersonnel`
  + inviters via `EventInviteReporters`). See [96](96-person-profile-picture.md).
- **10e (Reporter IMS #):** allow a **reporter** to attach an IMS # to their report,
  including **at creation time** and **before a Summary exists**. Server must enforce
  the report-write gate that is today client-only; remove the "no attach on create"
  restriction.
- **10f (Label):** the user-facing label **"Summary"** becomes **"Brief Description"**
  on incidents and reports. **Label text only** — the DB column, JSON keys, and DOM
  ids stay `SUMMARY`/`summary`.
- **10g (Remove button):** delete the "Create new incident from Report" button and its
  client wiring; leave the generic server routes untouched (they're shared).

### Sequencing

Independent slices; recommended order for reviewability:

1. **10f** (label rename) and **10g** (remove button) — trivial, land first, no
   migration.
2. **10b** (two states) — one migration + focused UI change.
3. **10e** (reporter IMS # attach-on-create) — server gate + report form.
4. **10a** (outcomes registry) — its own doc; new table + admin page.
5. **10d** (profile picture) — its own doc; new column + upload/serve endpoints.
6. **10c** (crews) — its own doc; largest; touches schema, authz, People UI, reports.

10a–10d/10e are mutually independent. 10c is best last (it reshapes `PERSON__EVENT`
and redefines a rung that 10e's report scoping may reference).

---

## Slice 10b — Two incident states: Active / Resolved

### Current state (verified, file:line)

- **Enum (5 values):** `STATE enum('new','on_hold','dispatched','on_scene','closed')
  not null` — `store/schema/migrations/00001_baseline.sql:173-175`. No later migration
  alters it. sqlc generates `imsdb.IncidentState*` constants + `.Valid()` +
  `AllIncidentStateValues()` from it.
- **Column writes:** `CreateIncident` insert `store/queries.sql:28,34`; `UpdateIncident`
  `store/queries.sql:40` (`STATE = ?`); metrics read `store/queries.sql:1095`.
- **Server:** new incidents default `imsdb.IncidentStateNew` (`api/incident.go:524`).
  State-change on update at `api/incident.go:663-671` — validation is **lenient**
  (unknown/empty state silently ignored, no 400); the **only** state coupling is
  setting/clearing the `CLOSED` timestamp when the new state is/ isn't `closed`.
  Journal-only guard treats `State == ""` as "no change" (`api/incident.go:576-591`).
- **UI dropdown:** `web/template/incident.templ:87-98` (`<select id="incident_state">`
  with 5 `<option>`s, `onchange="editState()"`). `editState()`
  `web/typescript/incident.ts:1369-1382` (incl. the "add a type before closing" alert
  keyed on `"closed"`); `drawState()` `incident.ts:673-677`; new-incident default
  payload `"state":"new"` at `incident.ts:342,1303-1304`.
- **Shared TS:** `IncidentState` type `ims.ts:3490`; `stateNameFromID`
  `ims.ts:1013-1028`; `stateSortKeyFromID` `ims.ts:1031-1046`; `stateForIncident`
  `ims.ts:1573-1580`; `renderState` `ims.ts:1930-1944`; action-log decode
  `ims.ts:2095-2096`.
- **Metrics:** `stateLabel` `api/metrics.go:391-406`; closed/open derivation
  `api/metrics.go:241-242,266`; follow-up excludes closed `api/metrics.go:257-259`;
  zero-filled `ByState` iterates `AllIncidentStateValues()` `api/metrics.go:270-277`;
  dashboard card `web/template/dashboard.templ:89-90`, render `dashboard.ts:188`.
- **⚠️ Naming collision to resolve:** the **incidents-list filter** already uses the
  words **"Active"** and **"Open"** for *filter modes* that are distinct from the
  incident state: `incidentTableStates = ["all","open","active"]` (`ims.ts:3239-3246`);
  filter logic `incidents.ts:713-735` (`"active"` = new/dispatched/on_scene,
  hides on_hold+closed; `"open"` = everything except closed); dropdown
  `web/template/incidents.templ:82,91-98`; default `"open"` `incidents.ts:38`.

### Plan

1. **Migration** (`00018_collapse_incident_state`). Scaffold with the pinned goose.
   Two-step, data-preserving:
   ```sql
   -- +goose Up
   -- widen to include both old and new values so existing rows remain valid…
   alter table INCIDENT modify STATE enum
     ('new','on_hold','dispatched','on_scene','closed','active','resolved') not null;
   update INCIDENT set STATE = 'resolved' where STATE = 'closed';
   update INCIDENT set STATE = 'active'   where STATE in ('new','on_hold','dispatched','on_scene');
   alter table INCIDENT modify STATE enum('active','resolved') not null default 'active';
   -- +goose Down
   alter table INCIDENT modify STATE enum
     ('new','on_hold','dispatched','on_scene','closed','active','resolved') not null;
   update INCIDENT set STATE = 'new'    where STATE = 'active';
   update INCIDENT set STATE = 'closed' where STATE = 'resolved';
   alter table INCIDENT modify STATE enum('new','on_hold','dispatched','on_scene','closed') not null;
   ```
   Note MariaDB DDL isn't transactional; keep the migration append-only and bump
   `store/integration/migrate_test.go`. Consider adding a DB `default 'active'` so a
   bare insert is Active even if a code path forgets (belt-and-suspenders with step 3).
2. **sqlc regen** — `imsdb.IncidentState` now has only `Active`/`Resolved`.
3. **Server (`api/incident.go`):** default `IncidentStateActive` (`:524`); in the
   update path (`:663-671`) key the `CLOSED` timestamp on `IncidentStateResolved`
   (set when resolving, clear when reopening). Consider tightening the lenient
   validation to reject an unknown non-empty state (optional; keep `""` = no change
   for the journal-only guard at `:576-591`).
4. **UI — replace the dropdown with two buttons** (`web/template/incident.templ:87-98`):
   a **"Mark Resolved"** button (visible when state is `active`) and a **"Reopen"**
   button (visible when `resolved`). Wire to a small `markResolved()`/`reopen()` in
   `incident.ts` that posts `{state:"resolved"|"active"}` via `ims.editFromElement`-
   equivalent. Move the existing "add an incident type before resolving" guard
   (`incident.ts:1370`) onto the Mark-Resolved handler (keyed on `"resolved"`).
   Remove `editState`/`drawState` dropdown logic or repurpose to toggle button
   visibility.
5. **Shared TS:** `IncidentState` type → `'active'|'resolved'|'null'` (`ims.ts:3490`);
   collapse `stateNameFromID`/`stateSortKeyFromID` (`ims.ts:1013-1046`); `renderState`
   still works via the label map.
6. **Metrics:** `stateLabel` (`api/metrics.go:391-406`) → 2 labels; the by-state chart
   auto-reshapes to 2 buckets via `AllIncidentStateValues()`; update closed/open
   derivation (`:241-242,266`) and follow-up filter (`:257-259`) to key on `resolved`.
   Confirm `dashboard.templ:89` copy ("By state" is still fine).
7. **Resolve the list-filter overlap** (`ims.ts:3239-3246`, `incidents.ts:713-735`,
   `incidents.templ:91-98`): with only two states the three-way filter is now
   redundant. Simplest: reduce the filter to **All / Active / Resolved** mapping
   1:1 onto the state, default **Active**. Update the dropdown tooltips.

**Verify:** `go run bin/build/build.go`; `go test ./... ./store/integration ./api/integration`
(migration maps `closed→resolved`, others→`active`; a fresh insert is Active).
`npx eslint`. Manual: create an incident → Active; Mark Resolved → sets CLOSED and
label flips; Reopen → clears CLOSED; dashboard by-state shows 2 buckets; list filter
shows All/Active/Resolved.

---

## Slice 10e — Reporters can attach an IMS # (at create time, before a Summary)

### Current state (verified, file:line)

- **Schema:** `REPORT.INCIDENT_NUMBER integer` **nullable** (`00001_baseline.sql:284`),
  FK `(EVENT,INCIDENT_NUMBER)→INCIDENT(EVENT,NUMBER)` (`:287`). `SUMMARY varchar(1024)`
  **nullable** (`:283`). No ordering constraint between summary and incident link.
- **Attach route:** `POST /ims/api/events/{eventName}/reports/{reportNumber}` →
  `EditReport` (`api/mux.go:268-270`); `editReport` dispatches `action=attach|detach`
  → `handleLinkToIncident` (`api/report.go:322-331,399-455`). Bad incident # → 1452 →
  friendly `herr.NotFound` (`:436-438`).
- **Authorization (the gap):** `editReport` checks only
  `EventWriteAllReports|EventWriteOwnReports` (`api/report.go:284-286`) — so a
  **reporter can already attach server-side** (subject to the own-report author gate
  `:301-309`). The "only writers may attach" rule is **client-only** (`report.ts:270,355`).
- **New-report path:** `drawIncident()` (`report.ts:332-364`) already **shows** the
  IMS # field on a new report (readonly `(none)`) per plan 66's display half. But
  **attach-on-create is blocked**: `updateIncident()` requires a saved `report.number`
  (`report.ts:285`); the server rejects it — `"A new Report may not be attached to an
  incident"` (`api/report.go:516-518`) and `newReport` hardcodes empty `IncidentNumber`
  (`api/report.go:534`). `reportSendEdits()` create path sends no `incident` field
  (`report.ts:387-449`).

### Plan

1. **Server — allow attach at creation** (`api/report.go`):
   - In `newReport`, accept an optional incident number from the create body and set
     `IncidentNumber` instead of hardcoding empty (`:534`); remove/relax the
     `"A new Report may not be attached to an incident"` guard (`:516-518`). Validate
     the FK the same way `handleLinkToIncident` does (1452 → friendly `herr.NotFound`).
   - **No Summary precondition** — do not require `SUMMARY` before allowing the link
     (schema already allows null summary; just don't add a check).
2. **Server — the reporter gate is already correct** (report-write perms, not
   incident-write). Keep it; add an explicit test that a **reporter** attaching their
   own report succeeds and a non-author reporter is refused (`api/report.go:301-309`).
   Remove any implication that `EventWriteIncidents` is needed.
3. **Client (`web/typescript/report.ts`):**
   - Make the IMS # field **editable on a new report** for report-writers (today it's
     forced readonly on new; `drawIncident()` `:339-344`). Drop the client-only
     `writeIncidents` restriction (`:270,355`) so reporters can edit it.
   - Add an **attach-on-create ride-along**: in `reportSendEdits()` create path
     (`:387-449`) include the typed `incident` number in the create body; after the
     report is created, no second call needed (server attaches inline).
   - Keep post-save `updateIncident()` (`:268-304`) for editing an existing report's
     link.
4. **Ordering — IMS # before Summary:** already possible (both nullable, independent);
   just ensure the form doesn't gate the IMS # input on a non-empty summary. Verify no
   client validation requires summary first.

**Verify:** `go test ./... ./api/integration` (reporter creates a report with an
`incident` number → linked; bad incident # → friendly 404; report with an IMS # and
**no** summary → OK). `npx eslint`. Manual: as a reporter, new report → type an IMS #
before any summary → save → report is attached; edit the link afterward still works.

---

## Slice 10f — Rename the "Summary" label to "Brief Description"

**Label text only.** DB column `SUMMARY`, JSON key `summary`, and DOM ids
(`incident_summary`, `data:"summary"`, placeholders) all stay — only the visible
`<label>`/`<th>` strings change. Occurrences (verified):

- `web/template/report.templ:92` — `<label ...>Summary</label>` (report detail).
- `web/template/incident.templ:163` — `Summary<span>*</span>` (incident detail,
  keep the required `*`).
- `web/template/reports.templ:164,173` — `<th>Summary</th>` (two report-list views).
- `web/template/incidents.templ:215,229` — `<th>Summary</th>` (two incident-list views).
- `web/template/dashboard.templ:181` — `<th>Summary</th>` (follow-up table).

Leave prose comments alone or update for clarity (e.g. `report.templ:117` "brief
Summary"); optional. **Do not** touch the many `*.ts` hits — they are ids / JSON
keys / placeholders, not the label.

**Verify:** `go run bin/build/build.go`; grep confirms no visible `>Summary<` label
remains; the DOM ids/JSON keys are unchanged. Manual: incident & report forms and all
list/table headers read "Brief Description".

---

## Slice 10g — Remove the "Create incident from report" button

The button composes two generic calls client-side; **no server route is dedicated to
it**, so removal is UI-only.

- **Template:** delete the button block `web/template/report.templ:73-84`
  (`<button id="create_incident" ... onclick="makeIncident()">`).
- **TS (`web/typescript/report.ts`):** remove `makeIncident()` (`:460-506`), the
  `window.makeIncident` assignment (`:75`), the `makeIncident` interface member
  (`:23`), the `createIncident` typed element (`:44`), and the show/hide logic
  referencing `el.createIncident` in `drawIncident()` (`:355-359`).
- **No `api/mux.go` / `api/report.go` change** — `NewIncident` and the report
  `attach` action stay (used by normal flows).

**Verify:** `go run bin/build/build.go`; `npx eslint`. Manual: on a saved, unattached
report the "Create new incident from Report" button no longer appears; normal
incident creation and report→incident attach still work.

---

## Open items / cross-slice notes

- **10b list-filter overlap** — decide All/Active/Resolved vs keeping the legacy
  three-mode filter (recommended: collapse to match the two states).
- **10c report scoping** references the redefined `crew_leader` rung and the new
  `PERSON__EVENT.CREW_ID`; sequence 10c after 10e so the report code is stable. See
  [95-crews.md](95-crews.md).
- All migrations follow CLAUDE.md: pinned goose scaffold, append-only, one logical
  change, and a `store/integration/migrate_test.go` bump.
</content>
</invoke>
