# Phase 6 — Feedback Round 5, Slice 6m (submitter + "on behalf of" reporter, per journal entry)

> **Status:** Plan — REVISED for review. **Owner:** TBD · **Last updated:** 2026-06-28
>
> Part of **Feedback round 5** (see [6k](65-report-entry-submit.md) for the round
> intro). Sibling slices: [6k entry submit](65-report-entry-submit.md),
> [6l new-report IMS#](66-new-report-incident-link.md). Largest of the three —
> touches schema, API, JSON, and UI.
>
> **⚠️ Supersedes the first draft.** The original design stored
> `SUBMITTER_PERSON_ID` + `REPORTER_PERSON_ID` on **REPORT**; that shipped as
> **PR #113** and is now being **reworked** to the per-entry model below. The
> Maintainer's correction: a report grows more journal entries over time, and any
> of them may be taken on someone else's behalf — so attribution belongs on the
> **journal entry**, not the report.

## 1. Goal

Record, per journal entry:

- **Submitter** — the account that wrote the entry. **Already stored** as
  `JOURNAL_ENTRY.AUTHOR_PERSON_ID`; nothing to add.
- **"On behalf of" (reporter)** — the person the entry is *about*, when that's
  someone other than the author. Optional; absent means the author is reporting
  for themselves.

Rationale: booth staff take reports on others' behalf, and they may add several
entries over time — each entry stands on its own, so the attribution is per
entry, not a single report-level fact.

**Decisions (settled with the Maintainer):**
- **D1 — Pure per-entry.** Only `JOURNAL_ENTRY` carries the new person ref. **No
  report-level `SUBMITTER`/`REPORTER` columns.** Any report-level "reporter"
  shown (header/list) is **derived** from the first user entry at render time.
- **D2 — Reports only (for now).** `JOURNAL_ENTRY` is shared with incidents; the
  column lives on the shared table but the **picker + composer UI is exposed only
  on the report page**. Incident entries keep author-only (the shared entry
  renderer still shows an on-behalf legend if one is ever present).

## 2. Current state (verified)

- `JOURNAL_ENTRY` (`store/schema/migrations/00001_baseline.sql:150`) already has
  `AUTHOR_PERSON_ID` (FK PERSON, **not null**) — the account that wrote the entry.
  Reports/incidents derive "author" from it; the read queries
  (`Report_JournalEntries`, `Reports_JournalEntries`, `Incident(s)_JournalEntries`)
  `join PERSON … AUTHOR_PERSON_ID` and return `HANDLE as AUTHOR`.
- Entries are written through `addJournalEntry()` (`api/report.go:571`) →
  `CreateJournalEntry` with `AUTHOR_PERSON_ID`. The same helper is used by the
  incident path.
- The client submits entries via `submitJournalEntry()` (`ims.ts`, **shared** by
  incident + report) sending `{text, id:-1, mentioned_person_ids}` through
  `sendEditsFunc({journal_entries:[…]})`.
- **Incident view already merges + tags report entries** (this answers the third
  question): `incident.ts` `drawMergedJournalEntries()` pushes each attached
  report's `journal_entries` with `entry.reportNum` set, and the shared
  `journalEntryElement()` (`ims.ts:1869`) already renders `author (via report
  #N)` with a link. So **"show report # in the header" is already done**; only
  the **"on behalf of" legend** is new (and it lands in the same shared renderer,
  so it shows on both the report page and the incident merged view for free).
- A reusable person picker exists: `setupPersonCombobox` + `openQuickAddPersonModal`
  + `createRegistryPerson` (`ims.ts`), with `@QuickAddPersonModal()` (templ).

## 3. Design

### Schema (rework migration `00010`)
Instead of REPORT columns, add **one nullable column to `JOURNAL_ENTRY`**:
`ON_BEHALF_OF_PERSON_ID integer`, FK → `PERSON(ID)`. Nullable (null = author is
the reporter), no backfill. Best-effort `Down`. Then `go tool sqlc generate`.
*(00010 is unmerged/undeployed — safe to rewrite rather than add a new migration;
once applied anywhere real it would be append-only.)*

### Store (`store/queries.sql`)
- `CreateJournalEntry`: add `ON_BEHALF_OF_PERSON_ID`.
- The four entry-read queries (`Report_JournalEntries`, `Reports_JournalEntries`,
  `Incident_JournalEntries`, `Incidents_JournalEntries`): add
  `left join PERSON obo on obo.ID = re.ON_BEHALF_OF_PERSON_ID` and select
  `obo.HANDLE` / `obo.NAME` (+ the id from the embed) so the renderer can show the
  legend everywhere entries appear.

### JSON (`json/journalentry.go`)
- `JournalEntry` gains read-only `on_behalf_of *ReportPerson` (reuse a small
  `{person_id, handle, name}` — promote/rename to a shared `Person`), and a
  write-only `on_behalf_of_person_id *int32` for the create path.
- **Revert** the report-level `Reporter`/`Submitter`/`ReporterPersonID` added to
  `json/report.go` in the PR #113 draft.

### API (`api/report.go`)
- `addJournalEntry(...)` gains an `onBehalfOfPersonID sql.NullInt32` param,
  written into `CreateJournalEntry`. The **report** call sites (NewReport,
  EditReport) pass it from the submitted `journal_entries[i].on_behalf_of_person_id`;
  the incident call sites pass `sql.NullInt32{}` (D2).
- Validate the person: a bad id trips the PERSON FK (1452) → **400** "No such
  person". (Do this where the entry is created.)
- Populate `on_behalf_of` in `journalEntryToJSON` from the joined handle/name.
- **Revert** the PR #113 report-level reporter/submitter plumbing (`reportToJSON`
  extra params, `fetchReport` signature growth, `reportPersonJSON` if unused,
  `CreateReport` submitter/reporter args, the `requireEqualReport` exclusions).
- **No authz change**: read access still keys on `containsAuthor` (the entry
  author), unaffected.

### Web
- **`web/template/report.templ`**: add an **"on behalf of"** person picker to the
  journal-entry composer (text input + results dropdown, mirroring the incident
  person combobox), plus `@QuickAddPersonModal()`. **Remove** the report-level
  Reporter/Submitter row from the PR #113 draft.
- **`web/typescript/report.ts`**: wire `setupPersonCombobox` on the composer's
  on-behalf input (allowCreate via `openQuickAddPersonModal`); store the pick and
  hand it to the shared submit via a small ims.ts state setter (see below). Show a
  derived read-only "Reporter" in the report header from the first user entry
  (D1) — optional, lightweight.
- **`web/typescript/ims.ts`**:
  - `submitJournalEntry()` (shared) includes `on_behalf_of_person_id` from a
    module-level value (default null → incidents never set it), then clears it
    after a successful submit.
  - `journalEntryElement()` header: when `entry.on_behalf_of` is present (and ≠
    author), render `author on behalf of <reporter>`. Works on the report page
    **and** the incident merged view (alongside the existing `(via report #N)`).
  - `JournalEntry` TS type gains `on_behalf_of` (+ the write id is sent in the
    submit payload).
- **Composer picker stickiness (open detail):** a booth may file several entries
  for the same person. Lean: the picker **persists its selection across submits**
  within the page (visible in the composer so it's never silent), with an easy
  clear — decide in the PR. The legend on each posted entry keeps it auditable.

## 4. Files

- `store/schema/migrations/00010_*.sql` (rewrite → JOURNAL_ENTRY column) + sqlc regen.
- `store/queries.sql` (`CreateJournalEntry` + 4 entry-read joins).
- `json/journalentry.go` (on_behalf_of read + write); `json/report.go` (revert).
- `api/report.go` (`addJournalEntry` param, validation, `journalEntryToJSON`,
  revert report-level plumbing); check `api/incident.go`/`api/attachment.go` call
  sites of `addJournalEntry` compile with the new param.
- `web/template/report.templ`; `web/typescript/report.ts`; `web/typescript/ims.ts`.

## 5. Tests / verification

- After the migration + queries: `go tool sqlc generate`, `go run
  bin/build/build.go`; golangci-lint v2.12.2 (`noinlineerr`, `misspell`); tsgo is
  the TS gate (eslint config is non-functional in this repo).
- `store/integration/migrate_test.go`: keep head at **v10** (00010 is rewritten,
  not added).
- **api/integration**: a report entry created with `on_behalf_of_person_id`
  round-trips (`on_behalf_of` populated on GET) and appears on **both** the report
  GET and the incident GET (merged); an entry with no on-behalf has it null; a
  bogus id → 400. (Replace PR #113's `TestCreateReportReporterSubmitter`.)
- Manual (`docker compose -f docker-compose.dev.yml up`): on a report, set "on
  behalf of" (existing person + inline-created person), submit an entry → the
  entry header reads `you on behalf of <name>`; open the incident the report is
  attached to → the same entry shows `… on behalf of <name> (via report #N)`.

## 6. Notes / impact

- **PR #113 rework, not a new PR**: edit the same branch — swap the migration,
  move the column to `JOURNAL_ENTRY`, revert the report-level JSON/API/UI, add the
  composer picker + shared-renderer legend. Update the PR description.
- Still overlaps **6l (#112)** in `report.ts` create-payload / `newReport`; land
  6l first, rebase. Dev seed: drop the PR #113 REPORT submitter/reporter stamp;
  optionally stamp the demo report's user entry with an `ON_BEHALF_OF_PERSON_ID`
  to showcase the legend.
- Deferred follow-ups: expose the on-behalf picker on **incident** entries (D2
  reversal); a stored/denormalized report-level reporter if list-query cost ever
  matters.
