<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09z — The 3c.3 round: reports on a wide window

> **Status:** Brief written and the round surface built 2026-09-14 (§ What was built);
> **Ledger picked 2026-09-16** (§ The pick); the 3c.3 acceptance criteria written the same day.
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, §6 **D2** and the 3c.3 row)
> under [09-proto-connect-platform.md](09-proto-connect-platform.md)
> **Follows:** [09x](09x-dispatch-design.md) (the shell, the table, the drawer, the page —
> 3c.1) and [09y](09y-incident-editor-design.md) (the Ledger — 3c.2). The report model
> and the phone's report screen are [09t](09t-reports.md) (3b.3).
> **Owner:** Design (the round, run by the maintainer) → Architect (this brief, the rules,
> the criteria after the pick) → Builder (3c.3).
> **The skills:** Emil Kowalski's skills govern all UI work — `prototype` for the round,
> `animate-expo` for anything that moves, `review-animations` before the PR is called done.
> **Last updated:** 2026-09-14

## Objective

A report is somebody's account of what happened (09t). Dispatch reads them for two
reasons: to **review** what a ranger wrote about an incident it is working, and to
**find a home** for an account that arrived on its own — link it to the incident it
belongs to, or raise an incident from it. templ gives dispatch a reports table (Report# ·
IMS# · Brief Description · Created · Created by; search with regex; show-days and
show-rows menus; `n` new, `/` search, `m` search across events) and a report page
(number, an editable IMS# field with a link, created by, an editable summary, the
instructions accordion, the journal with history / stricken toggles, the on-behalf-of
composer, attach file). The phone client has the Board's Reports segment and the 3b.3
report screen; a wide window has neither a reports list nor a shell around the report.

**The table is not up for design.** It is the 3c.1 table with the report columns, the
same filter bar, drawer, page, URL state and keyboard map (§ The table). **What is open is
the pane:** what a report *is* in the dispatcher's hands — a record like the incident, a
document to be read, or a companion to the incident it belongs to.

## What is already true on the wire (verified 2026-09-14)

- `ListReports(event_id, exclude_system_entries)` → `ReportView[]`; `GetReport` → one.
  `ReportView` = `Report` + `may_edit_summary` + `may_add_journal_entry`. `Report` =
  `event`, `number`, `created`, `created_by?` (`PersonRef`), `summary?` (≤ 1024),
  `incident?` (the linked incident number; unset = standalone), `journal_entries[]`.
- **Scoping is the server's.** `ListReports` answers the reports the caller may read:
  everything with `EventReadAllReports`; own (creator or a previous entry author) with
  `EventReadOwnReports`; plus the crew's reports for a crew leader with
  `EventReadCrewReports` (`crewReportNumberSet`, 10c). `GetReport` applies the same
  three-way test and answers 404 outside it. **Nothing on the wire says which rule
  admitted a report** — the client cannot tell "my crew's" from "mine"; the crew-leader
  review read is simply the table showing what the server answered.
- `UpdateReport(event_id, report_number, report)` takes a plain `Report`. `summary`
  present = edit it (creator or admin only, else PermissionDenied); `incident` present
  and > 0 links, present and ≤ 0 detaches, absent leaves it (the visit-field convention;
  a change writes a system entry, a same-value write does not; a nonexistent incident is
  404); `journal_entries` present = append (creator, writer or admin). The write gate is
  `EventWriteAllReports` or `EventWriteOwnReports` + the ownership floor. So the three
  writes the pane makes are three shapes of one RPC: summary, link, entry.
- `UpdateReportJournalEntry` = strike / unstrike; a reporter may strike only their own
  entries, a writer or admin any (plan 90 M1). **The client has never called it** — the
  fake has no handler; the round adds one.
- Attachments: `POST /ims/api/events/{eventName}/reports/{n}/attachments` (REST,
  Bearer), the same gate as the write plus the ownership floor; served by the 3b.4
  blob helper. The report composer has no photo control yet (09t said it comes with the
  helper; it did not).
- `CreateReport` is 3b.3's form; unchanged here. **No proto change is needed.**

## What the client is today

- `features/board/ReportScreen.tsx` (3b.3, phone): `ScreenHeader` "R-n", the summary as
  read-only text, created by, the incident as a row that opens it — or, for a writer with
  no link, *Attach to incident* (a number field + Attach) and *Create an incident from
  this report* — then "Journal", the entries oldest first through `JournalEntryRow`, and
  the docked `ReportComposer` (on-behalf-of folded in the footer, sticky per event) when
  `may_add_journal_entry`. No summary edit, no strike, no history / stricken toggles, no
  photo, no detach.
- `/events/[eventId]/reports/[number]` renders that screen at every width, without the
  shell. `/reports/new` is the 3b.3 form (a modal). The Board's Reports segment is the
  phone list. `IncidentScreen`'s Reports section (3c.2 `ReportsEditor`) opens a report
  through `onOpenReport` → that route.
- The shell (`features/shell/Shell.tsx`) has Incidents and Alerts; 09x criterion 2 left
  a Reports item to this slice. The dispatch pieces this slice reuses are `Table`
  (`columns.ts`, `IncidentRow`), `FilterBar`, `Drawer`, `IncidentPage`, `useDispatchQuery`
  + `query.ts` (URL state, `open=` / `sel=`), `useKeyboardMap`, `neighbours.ts`. They are
  typed on the incident `Row`; § The table says how the report table shares them.

## The table (fixed by 3c.1; the round shows it, does not vary it)

- Reached from the shell's **Reports** item, at `/events/[eventId]/reports` (a new
  index route; the phone keeps the Board — the route renders `BoardScreen` on the
  Reports segment below 1024, as `/incidents` renders the Board).
- Columns: **Report#** (fixed, tabular) · **IMS#** (fixed; the number, or "—") ·
  **Summary** (flexible) · **Created** (fixed, the minute clock) · **Created by**
  (fixed). Sort on any, default Report# descending. Row density, hover, the selected and
  opened marks, live rows and the number-as-a-column rule are 3c.1's.
- The filter bar: the search field (summary, created by, the entries' text — templ's
  regex `/…/` form included, it is a rule people rely on), the chips **Unlinked · Linked
  · All** where the incident table has Open · Closed · All (an unlinked report is the one
  that needs dispatch), sort. No priority / type / area / people menus. The URL carries
  `q`, `link`, `sort`, `dir`, `sel`, `open` exactly as 09x's does.
- The keyboard map is 09x's: `j` `k` move, Enter opens in the drawer, Enter again the
  page, Esc closes, `/` search, `n` new report (with `writeReports`), `a` the composer,
  `h` history, `?` help. A bare number in the search is a jump to R-n.
- **New report** in the shell's action slot when `writeReports` (the 3b.3 form).
- Search across events (templ `m`) is out of scope; it goes on the 3c.6 list.

## The prototype round (the maintainer's to run)

Dispatch is chosen; the pane is chosen (09x: the drawer at 66 % of the content width,
~676 px at 1024, the page centred at 720). The Ledger is chosen for the incident (09y).
**What is open is the report pane**, and the three shapes below are the three honest
answers to what a report is on a dispatcher's screen. Each is judged in the drawer at
1024 and on the page at 1440 with the same fixture reports.

| Variant | Axis | The claim it makes | What it costs |
|---|---|---|---|
| **Ledger** | *A record* — the incident's shape, shorter | The 3c.2 Ledger applied as is: the summary as the heading with Edit (creator / admin), a Details card of `label · value · ›` rows (incident, created, created by), the journal newest first with the composer at its top, the on-behalf-of in the composer's footer, strike on the entry's header line, the history / stricken toggles. The incident row is the link control: a press is a hard cut to a number field with Detach; unlinked reads "None · Link…". | Nothing here is new, which is also its cost: a report reads like a small incident, and the thing dispatch does most with one — read the account start to end — is fighting a newest-first journal built for a live incident. |
| **Account** | *A document* — read start to end | The report as a page: the summary as a title, a byline (`created by · created · R-n`, "on behalf of" on each entry that has one), the entries as dated paragraphs oldest first with no card chrome and no row borders, the composer at the end where the account continues. The controls live in one thin strip under the byline: the incident link (the number as a `TextButton`, Link… / Detach), Edit summary, History / Stricken toggles. Strike is hover-only on web, a long-press on native. | The strip is a new piece of chrome and must read as controls without becoming a toolbar. Newest first is lost, so a long report puts the newest entry a scroll away; `a` still jumps. The phone must decide whether its 3b screen becomes this. |
| **Companion** | *Beside its incident* — review is comparison | The pane splits: the report (Account's body) on the left, the linked incident on the right as a read-only column — its summary, state · priority · area marks, and its journal filtered to the same hours — so the dispatcher reads the account against the record. Unlinked, the right column is the link control itself: a search over the incident table (summary, number) whose result row links on press, above "Create an incident from this report". | At 1024 in the drawer two columns are ~330 px each; the right one is a real second incident fetch (`GetIncident`, 404 when private → the column says "Not visible to you"). On the page (720) it is barely wider. The phone stacks the columns, which is the Ledger's report screen plus an incident excerpt below. |

Every variant shows, with fixture data: **R-7** linked to #47, by a reporter, six entries
(one on behalf of another person, one with a photo, one stricken, two system entries —
"Changed summary", "Linked to incident #47"); **R-12** standalone by a reporter, two
entries — the one dispatch must find a home for; **R-3** the viewer's own (a reporter's
view: `may_edit_summary`, `may_add_journal_entry`, no other reports in the table);
**a poke arriving while the summary is being edited** (a new entry lands on R-7, the
half-typed summary stays); **a save that fails** (the summary write answers Unavailable:
the field keeps the typed value, the error at the field, nothing else greys out); the
crew leader's view (three reports in the table, every one read-only: no composer, no
Edit, no link control, no New report); the empty table; reduced motion on. At **1024
(drawer) and 1440 (page)**, both schemes, and a **400 px pass** on each (decision 1).

**How to run it:**

```
/prototype 3c.3 — the report pane for plan 09i (docs/plans/09z-reports-design.md).
Three variants on the axes in that file's prototype-round table: Ledger, Account,
Companion. Dispatch is chosen, the pane is chosen, the Ledger is chosen for incidents —
diverge on WHAT A REPORT IS IN THE PANE, not on colour, the table or the drawer; read
tokens through useTheme() and reuse the existing primitives, LedgerRow, SavingField,
JournalEntryRow, ReportComposer, PersonPicker. Do not modify src/design/* or the
existing src/features/*. Dev-only Expo Router route outside the session gates, the
report table (§ The table, copied into the surface with report columns) inside the real
Shell, the variant rendered inside the 3c.1 Drawer and page chrome at 1024 and 1440;
fixtures plus createFakeIms(), no server. Saves are fake and per field (the fake answers
after 300 ms, the summary configured to fail). Motion: only PressFeedback and StateFade
from src/design/motion.tsx — a value becoming a control is a hard cut; nothing enters
with an animation on a list.
```

The surface lives at `app/(dev)/reports.tsx` + `src/prototypes/reports/` and is deleted
in the 3c.3 PR. The 09x harness (`Picker.tsx`, `Harness.tsx`, the stage) is recoverable
with `git show 88d4152:packages/interface/src/prototypes/dispatch/Picker.tsx`; the 09y
surface was never committed, but its `useEditIncident` / `SavingField` landed in
`src/features/incidents/` and are the pattern for the report's `useEditReport`.

### What was built — the surface (2026-09-14)

`app/(dev)/reports.tsx` + `src/prototypes/reports/` (throwaway, outside the session
gates, no server, deleted in the 3c.3 PR). Run it with `pnpm -F @ocf-ims/interface start`
(never `CI=1`) and open `http://localhost:8081/reports?v=1` (`1`/`2`/`3` or `←`/`→` flip
the picker). The band above the stage takes the shape-independent decisions: pane
(drawer / page / phone), a fixed stage width (1024 / 1440 / 400 / fit), scheme, the viewer
(dispatcher / reporter / crew leader / admin — the runtime is rebuilt per viewer), the
report (R-7 linked to #47 with the six entries; R-12 standalone; R-3 the viewer's own;
R-15 linked to the private #48), and the pokes ("New entry on R-7 now"; "in 3 s" so you
can be typing when it lands — through the real live hub). The shell copy carries the
Reports item and New report; the table (§ The table) is the 3c.1 table retyped on
`ReportView` with Unlinked · Linked · All; the drawer and the page carry the real
`ScreenHeader`; only the pane's body is the variant.

The data layer is real: the same runtime over `createRouterTransport` and
`createFakeIms()` the Jest harness uses. The wrapper (`fake.ts`) gives `UpdateReport` the
plain-Report presence semantics, a 300 ms delay and a summary write that always fails
(Unavailable), and adds the `UpdateReportJournalEntry` handler the stock fake lacks.
`useEditReport.ts` is § One field, one request as code and is what the winner promotes
whichever it is; `SavingField` is reused from 3c.2.

Built by two builder Agents in sequence (the harness, fixtures, fake, table and chrome:
163 calls / 357K — over the budget again; the three panes: 109 calls / 231K).

**Found by building it, not by reading it:**

1. **`ReportComposer` forwards no ref** (`AppendComposer` does), so `a` scrolls the
   composer into view instead of focusing it. 3c.3 gives `ReportComposer` the same
   `forwardRef` / `focus()` shape.
2. **No photo control on reports**: `ReportComposer` has no attach prop; the surface
   shows an "Add photo" word that logs. 3c.3 adds `PhotoAttach` to it (decision 4).
3. **Report attachments have no client source**: `useAttachmentSource` is keyed by
   incident number and `JournalEntryRow` renders no image for a report ("absent = no
   images (a report)"). The server's report attachment route exists; the client's blob
   helper (`src/api/blobs.ts`, architect-tier) needs a report-addressed source before a
   report's photo can render at all. **A 3c.3 criterion, architect-built.**
4. **Strike's gate is derivable, not on the wire per entry**: `may_add_journal_entry`
   admits the creator, a writer and an admin, but only a writer / admin may strike
   another's entry. The client rule: strike on the viewer's own entries when
   `may_add_journal_entry`; on others' only with `writeIncidents` (the writer role; an
   admin has it through the bypass). The server refuses the rest. No proto change.
5. **The Ledger's Incident row carries two meanings** — open the incident, and edit the
   link — so `LedgerRow`'s row-wide press could not be used; Link… / Detach are their
   own words on the row and the number opens. The criteria should keep that split.
6. **`HelpSheet` is dispatch-worded** ("New incident"); the surface shows nothing on
   `?`. 3c.3 parameterises the sheet or adds a report one.
7. **A surface must not import `@/test/harness`.** It loads
   `@testing-library/react-native`, which throws `expect is not defined` in a browser and
   takes the router down with it; typecheck, Jest, `export:web` and the smoke e2e all
   passed over it. The surface builds its runtime in `runtime.ts` instead, and a surface
   is not verified until it has loaded in a browser with a clean console.
8. Companion's incident excerpt shows the raw area slug (no lookup pulled in) — a
   surface shortcut, not a finding for the slice.

Verified with the surface in the tree: `typecheck`, `lint`, Jest (50 suites, 365 tests)
green; `export:web` builds; the smoke e2e passes; loaded in Chrome at 1440 with a clean
console on Ledger, Account and Companion (R-7, and R-15's "Not visible to you"). The maintainer's hand pass (the three
variants at 1024 drawer / 1440 page / 400, both schemes, the four viewers, the poke while
editing, the failing save, R-15's "Not visible to you", reduced motion) is the round.

### The pick — Ledger (2026-09-16)

The maintainer picked **Ledger**: the incident is a Ledger (09y), so a report is one too,
and the two are iterated together later. One ask for now: **make it more visible that an
entry can be sent on behalf of someone else.** The composer's footer caption ("Posting as
Dee · For someone else") is too quiet for the thing a reporter does when writing up
another ranger's account. The second cut gives the composer an **On behalf of** row in the
Ledger's own `label · value · ›` language at the top of the composer card — "On behalf of ·
Yourself (Dee) ›" — a press opens the person picker in place, the value becomes the name,
Send reads "Send for Kai", and the sticky-per-event rule (09t) is unchanged. **Built and
walked in Chrome 2026-09-16** (`LedgerComposer.tsx`, a surface copy of `ReportComposer`;
the row is a `LedgerRow` whose control is the `PersonPicker`, which carries its own
Clear — the same mechanism as the incident's rows).

The decisions, as they stand: (1) the phone gets the Ledger at 400 px; (2) newest first
with the composer on top, as the incident; (3) the link control stays the number field
with Link… / Detach as their own words (finding 5); (4) photos on the composer — 3c.3
(finding 2); (5) strike on the entry's header line; (6) Create an incident from this
report stays under the link row. Account and Companion are kept in the surface until the
3c.3 PR deletes it.

### Decisions the round must also take (shape-independent, but only visible when run)

1. **The phone.** The 3b.3 `ReportScreen` is one component on three surfaces. The
   recommendation is the same as 09y's: the phone gets the winner at 400 px, the write
   gate unchanged. If Companion wins, the phone gets its stacked form.
2. **The journal's order.** Newest first (the incident's, 09y decision 4) or oldest
   first (an account). The round decides per the winner; the toggles and the composer
   position follow it.
3. **The link control's shape.** A number field (templ, the phone today) or a search over
   the incident table (Companion). Whichever wins, a nonexistent number reads as the
   404 at the field and linking a private incident the viewer cannot see is refused by
   the server the same way — the control must show that without leaking anything.
4. **Photos on reports.** The upload route exists; `PhotoAttach` is the 3b.4 helper.
   Recommendation: the report composer gets the same photo control the incident's has,
   in this slice, in every variant.
5. **Strike's visibility.** 09y finding 5 says the word is loud; 3c.2 hid it on the
   header line. The round shows Ledger's placement and Account's hover-only form.
6. **Create an incident from this report** stays (09t): a `TextButton` under the link
   control in every variant, opening the incident form with the report set.

## The rules the winner inherits (shape-independent)

### One field, one request

`useEditReport` mirrors `useEditIncident`: `setSummary`, `setIncident` (a number or
`0` to detach), `strike(entryId, stricken)`; each a plain `Report` (or entry) carrying
only that field; optimistic per field; the error at the control; on settle invalidate
`GetReport`, `ListReports` and — when the link changed — the incident's `GetIncident`
and `ListIncidents`. Text saves on blur and on Enter; the link on Enter / a result
press; strike on press.

### A poke never overwrites an unsaved field

`SavingField` as promoted in 3c.2, unchanged: the fetched value lands while a field is
not being edited; a field being edited keeps its text through a refetch.

### Gating

`may_edit_summary` gates Edit; `may_add_journal_entry` gates the composer and strike (the
server refuses a reporter striking another's entry — the client hides the control on
entries not authored by the viewer unless `writeReports`); the link control needs
`writeReports` (the write gate) — a reporter with own-only write may link their own
report, as templ allows. A viewer with none of these sees a page without controls and
without hints of them (no chevrons, no Edit word, no "Link…"). The table's New report
needs `writeReports`.

### The crew leader's read

Nothing marks a crew's report. The table shows what `ListReports` answered; the pane
shows what `GetReport` answered; a crew leader with no write bit sees the read-only
shape. If the fair wants "my crew's" as a filter, that is a `ReportView` field and a
server slice — an open question, not a client workaround.

### Keyboard

09x's map on the table; in the pane `a` focuses the composer, `h` toggles history,
Esc closes the drawer, Enter on the number field links. Nothing new.

### Motion

Press feedback only. A value becoming a control, a toggle, the drawer's columns
appearing — hard cuts. Reduced motion drops the press scale.

### Privacy

A report linked to an incident the viewer may not read shows the number as text (it is
on the report the server answered) and the row does not open — the press answers the
404 as "Not visible to you" where the incident would render, never a 403, never the
summary. Companion's right column obeys the same rule.

### The phone is not regressed

`ReportScreen`'s 3b.3 behaviours (the composer with on-behalf-of, attach, create an
incident, `dismissTo` back) stay; the phone's Jest specs stay green untouched except
where a behaviour is deliberately changed by a decision above.

## 3c.3 acceptance criteria (the builder's list, after the pick)

Written 2026-09-16, the day of the pick. **The brief for the builder is this section plus
"The rules the winner inherits" above; the surface (`src/prototypes/reports/`) is the
reference implementation and the second-cut Ledger is the shape — copy its files into
place and edit, do not retype them.** Rule 2 applies: no contract gap is expected; one
found stops the builder and is filed in the slice notes. The slice is one PR and runs past
the `Agent` ceiling: **an architect prerequisite, then two builders in sequence** — the
architect lands the report attachment source first (criterion 0, security-tier file); the
first builder lands the data layer, the fake and the composer changes (criteria 1–6); the
second the table, the pane, the routes, the shell item, the deletion and the specs
(criteria 7–16).

### The prerequisite (architect)

0. **A report-addressed attachment source.** `src/api/blobs.ts` gains
   `reportAttachmentUrl(eventName, number, entryId)` and `uploadReportAttachment(args)`
   over `/ims/api/events/{event}/reports/{n}/attachments` (the same Bearer + fetch shape
   as the incident pair); `useAttachmentSource` takes `{ kind: "incident" | "report",
   number }` instead of a bare number; `JournalEntryRow`'s `attachmentOn` becomes that
   object, so a report's photo renders on the report and an attached report's photo
   renders on the incident (today "absent = no images (a report)"). `FakeBlobs` mirrors
   both. Specs for the URL shape and the upload gate.

### The data layer and the composer (builder 1)

1. **`useEditReport(eventId, number)`** lands as `src/features/reports/useEditReport.ts`,
   the surface's file: `setSummary(text)`, `setIncident(number | 0)` (0 detaches),
   `strike(entryId, stricken)`; each a plain `Report` (or entry) carrying only that
   field; optimistic per field on the cached `GetReport`, the error at the control via
   `status(field)`, on settle invalidate `GetReport`, `ListReports` and — when the link
   changed — `GetIncident` / `ListIncidents` for the old and new incident.
2. **The fake** (`src/test/fakeIms.ts`) gains the surface's `UpdateReport` presence
   semantics (summary present = edit; incident present & > 0 links, ≤ 0 detaches, absent
   unchanged; a changed link appends the system entry; journal entries append) with
   `behaviours.updateReport` per shape, and the `UpdateReportJournalEntry` handler
   (`stricken` only; a reporter on another's entry → PermissionDenied). `fixtures.ts`
   gains `makeReportView` with the `may_*` flags.
3. **`ReportComposer`** (`src/features/compose/ReportComposer.tsx`) gains: `forwardRef` with
   `focus()` (as `AppendComposer`); the **On behalf of** row from the surface's
   `LedgerComposer` at the top of the card — a `LedgerRow` "On behalf of · Yourself (Dee)
   ›" that is a hard cut to the `PersonPicker`, "Clear" reverting to the author, Send
   reading "Send for <name>" with a pick; the sticky-per-event rule unchanged; the footer
   keeps only the restored-draft caption; and **`PhotoAttach`** (3b.4) uploading through
   `uploadReportAttachment` after the entry lands (decision 4). The phone's report specs
   are updated for the row, not loosened.
4. **`HelpSheet`** (`src/features/dispatch/HelpSheet.tsx`) takes its rows as a prop; the
   dispatch caller passes today's rows; the reports table passes its own.
5. **`JournalEntryRow`** shows Strike / Unstrike on the header line when `onStrike` is set;
   the report pane sets it per the strike gate (own entries with `may_add_journal_entry`;
   others' only with `writeIncidents`).
6. **`ListReports` search text** — `reportQuery.ts`'s `matches` (summary, created by, the
   entries' text, the `/regex/` form) lands in `src/features/reports/reportQuery.ts` with
   `parseQuery` / `serializeQuery` for `q`, `link`, `sort`, `dir`, `sel`, `open`.

### The table, the pane, the routes (builder 2)

7. **`ReportsScreen`** (`src/features/reports/ReportsScreen.tsx`, with `ReportRow`,
   `reportColumns.ts`, `useReportQuery.ts`, `ReportFilterBar.tsx`, `useReportKeyboardMap.ts`
   from the surface): the 3c.1 table typed on `ReportView` — Report# · IMS# ("—" when
   unlinked) · Summary · Created · Created by; sort on any, Report# desc by default; the
   chips Unlinked · Linked · All (`link=`); no other filters; a bare number jumps to R-n;
   `j` `k` Enter Esc `/` `n` `a` `h` `?` as 09x; live rows through the hub's report
   pokes; the drawer (66 %) and the full page.
8. **The pane is the Ledger** — `features/board/ReportScreen.tsx` grows into it (one
   component on three surfaces, as `IncidentScreen` did): the summary as the heading with
   **Edit** for `may_edit_summary` (a hard cut to `SavingField`, saves on blur / Enter,
   the failing save keeps the text with the error under the field); the Details card of
   rows Incident (the number opens it; for `writeReports` the words **Link…** / **Detach**
   beside it — a number field on Link…, Enter links; 404 at the field for a missing number;
   a private incident the viewer cannot read is a number that does not open, "Not visible
   to you" where it would render), Created, Created by; **Create an incident from this
   report** under the card when unlinked (`writeIncidents`); the journal newest first in a
   `border` box with History / Stricken toggles on its heading line and the composer at
   its top (criterion 3); a viewer with no flags sees no chevron, no Edit, no Link…, no
   composer.
9. **`ReportDrawer` / `ReportPage`** (`src/features/reports/`): the real `ScreenHeader`
   (back "Reports", `R-n`, Prev / Next / Full page); the page centred at `pageMaxWidth`;
   the keyboard `a` focuses the composer through the ref, `h` toggles history.
10. **Routes.** `app/(app)/events/[eventId]/reports/index.tsx` — the table in the shell on
    a wide window, the Board's Reports segment on a phone; `reports/[number].tsx` gains the
    wide branch (Shell + ReportPage). `IncidentScreen`'s Reports section and `ReportsEditor`
    open a report through the same route.
11. **The shell item** Reports after Incidents, always shown (the server scopes the list);
    **New report** in the action slot when `writeReports`.
12. **Gating and privacy** per the rules above: the strike gate (criterion 5), the link
    control on `writeReports`, no hint of a withheld control; a linked incident the viewer
    cannot read never leaks past its number.
13. **The phone is not regressed**: the 3b.3 behaviours (attach, create an incident,
    `dismissTo` back, the composer with the row) stay; existing Board and report specs pass
    with the row's new testIDs.
14. **The surface is deleted**: `app/(dev)/reports.tsx`, `src/prototypes/reports/`
    (Account, Companion, accountParts, the harness with them).
15. **Specs** in `__tests__/features/reports/`: `useEditReport` (three field shapes, the
    optimistic patch and its revert, the invalidations incl. the incident's on a link
    change), `reportQuery` (regex, bare number, URL round trip), `ReportsScreen` (the
    chips, sort, `open=`, the keys, the live poke), the pane (Edit for the creator and
    not the dispatcher, the failing summary, Link… / Detach and the 404 at the field,
    strike per gate, the toggles, newest first, the reader's view without controls,
    "Not visible to you"), the composer's On behalf of row (pick, Send for, Clear) and
    the photo upload through the report route.
16. 09i §9 passes; `/review-animations` says Approve.

### The promotion map

| Surface (`src/prototypes/reports/`) | Lands as | What changes |
|---|---|---|
| `useEditReport.ts` | `src/features/reports/useEditReport.ts` | `status(field)` as `useEditIncident` |
| `reportQuery.ts`, `reportColumns.ts`, `useReportQuery.ts`, `ReportRow.tsx`, `ReportTable.tsx`, `ReportFilterBar.tsx`, `useKeyboardMap.ts`, `neighbours.ts` | `src/features/reports/` (`ReportTable` → `ReportsScreen`) | Over the real hub; the help sheet's rows |
| `ReportDrawer.tsx`, `ReportPage.tsx` | `src/features/reports/` | The real `ReportScreen` as the body |
| `Ledger.tsx` | `features/board/ReportScreen.tsx` | The states and callbacks stay the screen's |
| `LedgerComposer.tsx` | `features/compose/ReportComposer.tsx` | The row, the ref, `PhotoAttach` |
| `fake.ts` | `src/test/fakeIms.ts` | The behaviours; the delay dropped |
| `data.ts` | `src/test/fixtures.ts` | `makeReportView` only |
| `Shell.tsx` (the item) | `src/features/shell/Shell.tsx` | One item, one action |
| `Harness.tsx`, `Picker.tsx`, `runtime.ts`, `types.ts`, `Account.tsx`, `Companion.tsx`, `accountParts.tsx`, `app/(dev)/reports.tsx` | deleted | |

## Out of scope

- Search across events (templ `m`) — 3c.6's list.
- Editing an entry's text, deleting an entry, removing an attachment — no route.
- A "my crew's" filter — needs a `ReportView` field (open question 2).
- Any proto change.
- The roster and the dashboard — 3c.4 / 3c.5, their own rounds.

## Verification (for the round)

`pnpm -F @ocf-ims/interface typecheck`, `pnpm lint`, `pnpm -F @ocf-ims/interface test`
unchanged and green with the throwaway surface in the tree; `export:web` builds; the
smoke e2e passes. Hand: the three variants in the drawer at 1024 and on the page at 1440
in both schemes, the 400 px pass, the poke-while-editing case, the failing save, the
reporter's view, the crew leader's view, the empty table, reduced motion. Nothing goes to
staging.

## Checklist

- [x] Brief written; the contract verified (2026-09-14)
- [x] The surface built and verified (2026-09-14; § What was built) — the hand pass is the maintainer's
- [x] The round run; Ledger picked, the reasons and the six decisions recorded (2026-09-16; § The pick)
- [x] The 3c.3 acceptance criteria written (2026-09-16)
- [ ] The winner promoted, reviewed, the surface deleted — the 3c.3 PR

## Open questions

1. **Does the phone get the winner?** Recommendation: yes (decision 1).
2. **"My crew's" as a filter.** Only if crew leaders ask; a `ReportView.crew_visible`
   (or the crew name) is a small server slice.
3. **Days filter.** templ's show-days menu has no analogue on the dispatch table; the
   reports table starts without one (sort by Created covers the shift). Add if asked.
4. **Enter-to-submit on the report composer.** templ deliberately has none on reports
   (6k); the client's `ReportComposer` follows that. Unchanged here; 3c.6 owns the
   preference.
