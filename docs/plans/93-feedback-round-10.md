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
| 2 | Only two states, **Open** / **Closed**; start Open; "Mark Closed" + "Reopen" buttons | 10b | this doc |
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
- **10b (States):** collapse the five-state enum to **`open` / `closed`** (decided
  with the user; supersedes the earlier "Active/Resolved" wording). New incidents
  start **`open`**; `closed` is retained (keeping its existing `CLOSED`-timestamp
  coupling). Replace the state dropdown with a **"Mark Closed"** button and a
  **"Reopen"** button.
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

## Slice 10b — Two incident states: Open / Closed

**Status: ✅ Built.** Shipped as **`open` / `closed`** (the user chose these over the
earlier "Active/Resolved" wording — `closed` already existed and its CLOSED-timestamp
coupling carried over unchanged, making this the lower-churn collapse).

As built:

1. **Migration `00018_collapse_incident_state.sql`** — widen the enum to add `open`,
   remap `new`/`on_hold`/`dispatched`/`on_scene` → `open`, then narrow to
   `enum('open','closed') not null default 'open'`. `closed` is retained. Down reverses
   best-effort (`open`→`new`). The migration test (`store/integration/migrate_test.go`)
   needs no change — it checks tables exist + idempotency, not enum values.
2. **Server (`api/incident.go`):** new-incident default → `imsdb.IncidentStateOpen`
   (`:524`). The `CLOSED`-timestamp coupling (`:663-671`, keyed on
   `imsdb.IncidentStateClosed`) is unchanged — closing sets it, reopening clears it.
   The lenient "unknown state silently ignored" behaviour is kept (so old
   `new`/`on_scene` payloads resolve to the default `open`).
3. **Metrics (`api/metrics.go`):** `stateLabel` → `Open`/`Closed`; the closed/open
   derivation and follow-up filter already key on `IncidentStateClosed` (unchanged);
   the by-state chart auto-reshapes to two buckets via `AllIncidentStateValues()`.
4. **UI (`web/template/incident.templ`):** the state `<select>` is replaced by a state
   **label** + a **"Mark Closed"** button (shown when open) and a **"Reopen"** button
   (shown when closed), both gated on `writeIncidents`. `incident.ts` gains
   `markClosed()`/`reopenIncident()` (the "add an incident type before closing" alert
   moved onto `markClosed`); `drawState()` sets the label + toggles button visibility.
   Button-driven edits use a new `ims.editValue(jsonKey, value)` primitive.
5. **Shared TS (`ims.ts`):** `IncidentState` → `'open'|'closed'|'null'`;
   `stateNameFromID` (now exported) and `stateSortKeyFromID` collapsed to two states.
6. **List filter:** the three-way `["all","open","active"]` becomes
   **`["all","open","closed"]`** (default `open`), mapping 1:1 onto the state; the
   `incidents.templ` dropdown + tooltips updated. Old persisted `"active"` prefs fall
   back to the default gracefully (`isValidIncidentsTableState` rejects it).

**Verified** via `docker build --target build` (generate + `go build` + tsgo) and
`go vet ./...`; integration tests (`metrics_test`, `incident_test`, `incident_grant_test`,
`person_test`, `area_test`) updated from the old state strings and run in CI.

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

- **10b list-filter** — resolved: collapsed the three-mode filter to
  **All / Open / Closed** to match the two states.
- **10c report scoping** references the redefined `crew_leader` rung and the new
  `PERSON__EVENT.CREW_ID`; sequence 10c after 10e so the report code is stable. See
  [95-crews.md](95-crews.md).
- All migrations follow CLAUDE.md: pinned goose scaffold, append-only, one logical
  change, and a `store/integration/migrate_test.go` bump.
</content>
</invoke>
