# Phase 6 — Feedback Round 5, Slice 6l (IMS# on a new report + attach-on-create)

> **Status:** Plan — for review. **Owner:** TBD · **Last updated:** 2026-06-28
>
> Part of **Feedback round 5** (see [6k](65-report-entry-submit.md) for the round
> intro). Sibling slices: [6k entry submit](65-report-entry-submit.md),
> [6m reporter/submitter](67-report-reporter-submitter.md).

## 1. Goal

Show the **IMS # (incident number) field on a *new* (unsaved) report** so the
report can be attached to an incident **at creation time** — that's how reports
get collected onto an incident (Maintainer: *"IMS# still makes sense to show when
preparing a new report; that's how we collect reports attached to an incident"*).

**Decision:** show **IMS#** on a new report; keep **Report #** hidden until saved
(it's assigned server-side sequentially on save, so there's nothing real to show
before then).

## 2. Background — why both were hidden

- PR #83 hid the IMS# field, then **PR #99** (`ba3ea2b`, *"hide the Report #
  field on a new (unsaved) report"*) hid Report# too, on the reasoning that on a
  brand-new report neither has a meaningful value. We're reversing that **for
  IMS# only**, because we now want to set the incident during creation.

## 3. Current state (verified)

- `report.ts` `drawIncident()` (~L305) toggles `incident_number_field` **hidden**
  when `report.number == null` (new), and `drawNumber()` (~L292) hides
  `report_number_field` on new. Both fields exist in `report.templ` (L53-70).
- Attaching today is **post-save only**: `updateIncident()` (`report.ts:240`)
  POSTs `?action=attach&incident=N` and requires an existing `report.number`. It
  also client-gates on `eventAccess.writeIncidents`.
- The server **forbids** creating a report already attached:
  `api/report.go` `newReport()` L500-502 returns
  *"A new Report may not be attached to an incident"*. `CreateReport`
  (`store/queries.sql`) already has an `INCIDENT_NUMBER` column — today it's
  passed `sql.NullInt32{}`.
- The existing post-save attach maps a missing incident via MySQL FK error
  **1452** → `herr.NotFound("No such Incident")` in `handleLinkToIncident`
  (`api/report.go:418-423`). Reuse that mapping.

## 4. Design

**Server (`api/report.go` `newReport`).** Replace the L500-502 rejection with
attach-on-create:

- When `report.Incident != nil`:
  - require the incident-write permission
    (`eventPermissions & authz.EventWriteIncidents`); 403 otherwise (the client
    already gates on `writeIncidents`, but the server must enforce it too);
  - pass it into `CreateReport` (`IncidentNumber: conv.Int32ToSql(report.Incident)`);
  - map FK error **1452** → `herr.NotFound("No such Incident", …)`;
  - add a generated journal entry `"Attached to incident: N"` via the existing
    `addJournalEntry(..., generated=true)` (consistent with `handleLinkToIncident`).
- When `report.Incident == nil`, behavior is unchanged.

**Client (`report.ts`).**

- `drawIncident()`: on a new report, **don't hide** `incident_number_field`; make
  `incident_number` editable when `eventAccess.writeIncidents`, placeholder
  "(none)". Keep `create_incident` and `history_toggle` hidden on new (no report
  / no history yet).
- `drawNumber()`: unchanged — Report# stays hidden on new.
- `updateIncident()`: add a new-report branch — when `report.number == null`,
  **don't POST**; validate the typed value is a number, mark the field
  success/error, and let it ride along with the create.
- `reportSendEdits()`: when creating (`number == null`), include `incident` in
  the create body if one was entered.

No template structural change (fields already present); just the
JS visibility/edit logic flips.

## 5. Files

- `api/report.go` — `newReport()` attach-on-create + permission gate + FK mapping
  + generated entry.
- `web/typescript/report.ts` — `drawIncident()`, `updateIncident()`,
  `reportSendEdits()`.

## 6. Tests / verification

- Build/lint: `go run bin/build/build.go`, `npx eslint`,
  golangci-lint v2.12.2.
- `go test ./...`. Add an **api/integration** case: create a report with an
  existing `incident` → report is created already attached (and a generated
  "Attached to incident" entry exists); a bad incident # → 404 "No such
  Incident"; a non-incident-writer supplying an incident → 403.
- Manual: open a new report, set IMS# to an existing incident, submit → report is
  created and linked; the incident's detail shows the attached report.

## 7. Notes

- This slice and **6m** both touch `report.ts` `reportSendEdits()` create-payload
  and the identifiers row; whichever lands second rebases trivially. Suggested
  order: 6l then 6m.
