# Phase 6 — Feedback Round 5, Slice 6m (reporter vs submitter on a report)

> **Status:** Plan — for review. **Owner:** TBD · **Last updated:** 2026-06-28
>
> Part of **Feedback round 5** (see [6k](65-report-entry-submit.md) for the round
> intro). Sibling slices: [6k entry submit](65-report-entry-submit.md),
> [6l new-report IMS#](66-new-report-incident-link.md). Largest of the three —
> touches schema, API, JSON, and UI.

## 1. Goal

Distinguish two people on a report (Maintainer: *"we need a reporter and a
submitter"*):

- **Submitter** — the logged-in account that creates the report. An audit fact;
  always the authenticated user; read-only.
- **Reporter** — the person the report is *about*. **Defaults to the submitter**,
  but can be overridden, **including by creating a new person inline** when the
  reporter isn't found.

Rationale: booth staff take reports **on behalf of** other people, so the account
submitting often isn't the person the report concerns.

## 2. Current state (verified)

- `REPORT` (`store/schema/migrations/00001_baseline.sql:278-290`) has
  `EVENT, NUMBER, CREATED, SUMMARY, INCIDENT_NUMBER` — **no person column**.
  "Author" is implicit: the first journal entry's `AUTHOR_PERSON_ID`
  (`JOURNAL_ENTRY`), and limited-access reads use
  `containsAuthor(entries, handle)` (`api/report.go:124,174`).
- `newReport()` (`api/report.go:485`) captures `authorPersonID =
  jwtCtx.Claims.PersonID()` and uses it only as the journal-entry author;
  `CreateReport` gets no person id.
- `json.Report` (`json/report.go:22`) has no person fields.
- A reusable **person picker** already exists and is used on incidents/visits/
  people: `setupPersonCombobox` (`ims.ts:1233`) + `openQuickAddPersonModal`
  (`ims.ts:1119`) + `createRegistryPerson` (`ims.ts:1102`). Inline person
  creation goes through `POST /ims/api/personnel` (`CreatePerson`,
  `api/person.go`), which a field-reporter/writer may call to create a name-only
  registry person. `AuthInfo` (`api/auth.go:186`) exposes the current user's
  handle as `user` (no person_id/name) — enough for a placeholder.

## 3. Design

### Schema (new goose migration)
Scaffold with the pinned goose (CLAUDE.md). One logical change = report
attribution: add to `REPORT`
- `SUBMITTER_PERSON_ID integer` (nullable),
- `REPORTER_PERSON_ID integer` (nullable),
each a **FK to `PERSON(ID)`**. **Nullable, no backfill** — existing rows keep
NULL (migrations are schema-only; the UI renders NULL gracefully). Best-effort
`Down`. Then `go tool sqlc generate`.

### Store (`store/queries.sql`)
- `CreateReport`: add `SUBMITTER_PERSON_ID`, `REPORTER_PERSON_ID` to the insert.
- `Report` (:one) and `Reports` (:many): `LEFT JOIN PERSON` twice (reporter +
  submitter) to return each one's `HANDLE`/`NAME` for display (mirrors the
  journal-entry author join).

### JSON (`json/report.go`)
- Read: `Reporter *ReportPerson` and `Submitter *ReportPerson`, where
  `ReportPerson = {person_id, handle, name}` (mirror `imsjson.Mention`).
- Write: `ReporterPersonID *int32 \`json:"reporter_person_id,omitzero"\`` for the
  create payload.

### API (`api/report.go` `newReport`)
- `submitterID := jwtCtx.Claims.PersonID()` — always.
- `reporterID := submitterID; if report.ReporterPersonID != nil { reporterID =
  *report.ReporterPersonID }` — **server defaults reporter to submitter** when
  omitted.
- Pass both into `CreateReport`; map FK error 1452 → 400/404 ("No such person").
- Populate `Reporter`/`Submitter` in `reportToJSON` and the `Reports` builder
  from the joined handle/name.
- **Scope:** reporter/submitter are set **at creation**; on a saved report
  they're **display-only** for v1 (submitter is permanent audit data). Editing
  the reporter later is a deferred follow-up. **No authz change** — the submitter
  is the initial journal-entry author, so existing own-reports read/write logic
  (`containsAuthor`) still holds. Inline person creation stays the existing
  `CreatePerson` flow (no new server work for it).

### Web UI
- `web/template/report.templ`: add a **Reporter** row (`reporter_add` input +
  `reporter_add_results` dropdown, mirroring `incident.templ:182-194`), shown on
  new reports; add a read-only **Submitter** display and a read-only reporter
  display for saved reports; include `@QuickAddPersonModal()`
  (mirroring `incident.templ:33`).
- `web/typescript/report.ts`:
  - Wire `ims.setupPersonCombobox({ input, results, eventName, allowCreate:true,
    onPick, onCreate: name => ims.openQuickAddPersonModal(name, eventName) })` for
    the reporter input; `onPick` stores `reporterPersonID` + shows the label.
  - Default UX: leave the reporter input **empty** with placeholder
    "Defaults to you: <handle>" (`authInfo.user`). If left blank, the server sets
    reporter = submitter — no need to add person_id to `AuthInfo`.
  - `reportSendEdits()`: when creating (`number == null`), include
    `reporter_person_id` if one was picked/created.
  - On reload, render `report.reporter` / `report.submitter` (handle/name)
    read-only.

## 4. Files

- `store/schema/migrations/000NN_*.sql` (new) + sqlc regen.
- `store/queries.sql` (`CreateReport`, `Report`, `Reports` joins).
- `json/report.go` (`ReportPerson`, read + write fields).
- `api/report.go` (`newReport`, `reportToJSON`, `Reports` builder).
- `web/template/report.templ`; `web/typescript/report.ts`.

## 5. Tests / verification

- After the migration + queries: `go tool sqlc generate`, then
  `go run bin/build/build.go`; lint (golangci-lint v2.12.2 — watch `noinlineerr`,
  `misspell`; `npx eslint`).
- `store/integration/migrate_test.go`: bump the head version for the new
  migration; the integration replay applies it to real MariaDB.
- **api/integration**: a created report carries `submitter` = caller and
  `reporter` = submitter by default; an explicit `reporter_person_id` is honored;
  a bogus `reporter_person_id` → 400/404.
- Manual (`docker compose -f docker-compose.dev.yml up`): new report defaults
  reporter to you; override by searching an existing person **and** by creating a
  new person inline; a saved report shows reporter + submitter.

## 6. Notes

- Shares `report.ts` `reportSendEdits()` create-payload with **6l**; land 6l
  first, then 6m. Target master directly; merge manually after CI is green.
- Possible follow-ups (out of scope): editable reporter on saved reports;
  backfill historical reports' submitter from their first journal-entry author.
