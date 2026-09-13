<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09t — Reports: the model decision, and slice 3b.3

> **Status:** **Merged** — 3b.3a #261 and 3b.3b #262, 2026-09-13. The maintainer answered 09q's open question 4
> (below); this document turns the answer into a model, a server slice (3b.3a,
> "request a report") and the client slice (3b.3b). Both are built, as a stack of two
> PRs (3b.3a first); open questions 2 and 3 were taken on their recommendations
> (a request always grants; its own RPC), and 1 was answered with screenshots of the
> built People section rather than a prototype round. What remains is the phone hand
> check and the maintainer's word on how the People section reads.
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, the 3b.3 row)
> under [09-proto-connect-platform.md](09-proto-connect-platform.md)
> **Follows:** [09q](09q-field-flows.md) (the Board, where reports are a segment and
> where this question was raised), [09r](09r-file-and-append.md) (the filing form and
> composer this slice reuses; "on behalf of" moved here from there).
> **Owner:** Architect (this document, the server slice, review) → Builder (Sonnet, the
> screens).
> **The skills:** Emil Kowalski's skills govern all UI work (the maintainer's rule,
> 2026-09-10) — `animate-expo` for anything that moves, `review-animations` before a PR
> is called done. Whether 3b.3b gets a `prototype` round is open question 1.
> **Last updated:** 2026-09-12 (built)

## The decision

09q open question 4 asked whether a Report and an Incident are the same kind of thing at
different times. Two readings were in play: a Report as *somebody's account of an incident*
(what the schema does: `Report.incident` links one to an incident, and a report can stand
alone) versus a Report as *a phase of an incident* (one record with a lifecycle, and the
split an accident of history).

**The maintainer's answer, 2026-09-12: keep both.** A report stays its own record, filed
on its own by whoever has something to report. A report is *also* how an incident collects
accounts — and the way that happens is a **request**: the people working an incident ask
someone for their report, that person is notified, and the report they file lands attached
to the incident.

So the schema's shape stands. What was missing is the *ask*. Today a writer can attach a
person to an incident (the person is told "you were added to incident #N", and nothing
more), and a reporter can type an incident number onto a new report if they happen to know
it. There is no way to say "we need your report on #N", no way for the incident to show who
was asked and who has delivered, and nothing in the app that carries a person from the ask
to the form. That is 3b.3.

What this decides beyond a screen: the Board keeps two kinds of row (an incident, a
report), the Reports segment stays, and "My work" for a reporter gains one more thing —
the reports they owe.

## What is already true on the wire (verified, 2026-09-12)

| Question | Answer | Source |
|---|---|---|
| File a report | `CreateReport{event_id, report: {summary?, incident?, journal_entries[]}}` → `report_number`. A positive `incident` links on create and writes a system entry on **both** timelines ("Attached to incident: N" / "Report added: R") | `internal/incident/connect.go` `CreateReport` |
| Who may file | `EventWriteOwnReports` or `EventWriteAllReports` — the reporter rung has the first, the writer both; `AccessForEvent.write_reports` is the OR of them | `reportWriteContext`; `lib/authz/permission.go` |
| Linking to an incident the caller cannot read | **Not checked.** The link is a foreign key: an unknown number is `NotFound`, a private one links fine. A reporter can therefore attach to any incident whose number they were given — which is exactly what a request hands them | `CreateReport`, `reconcileReportLink` |
| An entry | `JournalEntry{text, mentions[], on_behalf_of?}` — `on_behalf_of.person_id` is read on the **report** write only (6m, plan 67): the person the entry is *about* when the author files for someone else | `reportWriteToJSON` |
| Append / relink | `UpdateReport{report: {summary?, incident?, journal_entries[]}}` — presence-tracked; `incident` unset = unchanged, positive = link, non-positive = detach. Ownership floor: `WriteAllReports`, or the creator, or a previous author | `UpdateReport` |
| Gating flags | `ReportView.may_edit_summary` (creator or admin), `may_add_journal_entry` (also the writer role) | `reportEditRights` |
| Who sees which reports | `ReadAllReports` sees all; otherwise own (creator or previous author) plus, for a crew leader, their crew members' reports (`ReadCrewReports`) | `ListReports` |
| Attaching a person to an incident | `AttachPersonToIncident{event_id, incident_number, person_id, involvement?, granted_access}` — writer-gated, privacy-gated; a *new* attach creates an `ADDED_TO_INCIDENT` notification and a push ("You were added to incident #N") | `AttachPersonToIncident`; `internal/notification`; `internal/server/pushfanout.go` |
| The grant | `granted_access` (52f) gives a non-writer read of that one incident and journal-only append; it is what lets a reporter see the incident they are reporting on | `IncidentPersonHasGrant`; CLAUDE.md "Private incidents" |
| Notifications | `Notification{type, event, incident_number?, incident_summary?, report_number?, report_summary?, journal_entry_id?, actor?, created, read}`; `NotificationType` is `MENTIONED` \| `ADDED_TO_INCIDENT`, backed by a MariaDB `enum` column | `resources/v1/notification.proto`; migration `00008` |
| Push | `Pusher.fanOut` drops the actor and dedupes; each kind has one body string and a URL; web push and Expo push share it (3b.0c) | `pushfanout.go` |
| The incident's side | `Incident.reports[]` (numbers only); `IncidentUpdate.reports: Int32List` links / clears from the incident side; `IncidentPerson{person, involvement?, granted_access, has_event_access}` | `resources/v1/incident.proto` |
| The templ client's report page | IMS# typed on a new report to attach on create (6l, plan 66); an "on behalf of" picker over personnel; instructions ("How to write a great Report") opened by default for people without incident access | `web/typescript/report.ts`; `web/template/report.templ` |

### The gap, precisely

Three things do not exist and cannot be faked client-side:

1. **The ask.** No record says "person P owes a report on incident N". Attaching P with a
   grant is the closest thing, and it means "P is involved", which is a different
   statement — a witness is involved without owing anything, and a person asked for a
   report may not be involved at all.
2. **The state.** The incident cannot show who was asked and who delivered. "Delivered"
   *can* be derived where the viewer sees the reports (a linked report whose creator is
   P), but a reporter rung sees only their own, and a request with no answer is invisible
   to everyone.
3. **The nudge.** A notification of the right kind, carrying the incident, that the app
   can turn into "file your report on #N" with the link already set.

## What 3b.3 builds

### 3b.3a — server: "request a report" (Architect; own PR, first)

**The record.** The ask lives on the involvement row — it *is* an involvement, of a
specific kind — as one nullable column: `INCIDENT__PERSON.REPORT_REQUESTED` (the moment
of the latest ask; `NULL` = never asked). One migration. A second migration extends the
`NOTIFICATION.TYPE` enum with `report_requested` (one logical DDL change each; MariaDB
DDL is not transactional).

**The RPC.** `RequestReport(RequestReportRequest{event_id, incident_number, person_id})
returns (RequestReportResponse{})`, in `service.proto` beside `AttachPersonToIncident`:

- Gate: `incidentWriteContext` — the write bit, then visibility (`404` on a private
  incident the caller may not view), like every incident write.
- Attaches the person if they are not attached (involvement left empty; the writer can
  set it separately), and **sets `granted_access = true`** so the person can read the
  incident they are asked to write about — a request implies the grant (open question 2).
  An already-attached person keeps their involvement.
- Stamps `REPORT_REQUESTED = now()`; a repeat request re-stamps and re-notifies (the
  only "remind" this slice has).
- Writes a system entry on the incident: `Report requested from <handle>`.
- Creates a `report_requested` notification for the person (`incident_number` set,
  `actor` = the requester) and pushes `"<actor> asked for your report on incident #N"`
  with the URL of the new-report form for that incident (the app's deep link; the web
  app's report page until Phase 4).
- Audited like every mutation (Connect interceptor); `LogRequest` is REST-only and does
  not apply.

Why a dedicated RPC rather than a flag on `AttachPersonToIncident`: the ask is a distinct
act with its own audit line, its own notification and its own push text, and a client
that only wants to attach a witness should not be able to send one by accident.

**The read side.** `IncidentPerson` gains two output-only fields:
`report_requested` (`google.protobuf.Timestamp`, optional) and `report_number`
(`optional int32`: the newest report linked to this incident whose creator is this
person — "delivered"). Computed in the incident read from the reports the incident already
joins, so the reporter rung sees their own state through the grant without a reports
list. `Notification` gains no field: the type and `incident_number` say everything.

**Tests.** `api/integration`: a writer requests from a reporter → the reporter's
involvement row carries the stamp and the grant, the incident's journal has the system
entry, the reporter's notifications hold one `report_requested` with the incident, the
push sender received one message with the deep link; the reporter files
`CreateReport{incident: N}` and the incident read shows `report_number` on their row; a
repeat request re-stamps and produces a second notification; a non-writer is
`PermissionDenied`; a private incident the requester may not view is `NotFound`; an
unknown person is `NotFound`. `buf lint`, `buf breaking` (additive), the Go protocol.

### 3b.3b — client (Builder)

**The report form** (`reports/new`, a modal like the incident form; `?incident=N` from a
request or from the incident screen):

- *Summary* (one line, max 1024), *On behalf of* (a person picker over `ListPersonnel`,
  blank = yourself; **sticky per event for the session** — the 09i rule — and clearing it
  reverts to yourself), *Details* (the `Composer` with mentions), *Incident* (read-only
  and prefilled when it came from a request or the incident screen; a free number field
  for a writer filing on their own; absent for a reporter with no request — they cannot
  browse incidents anyway).
- *How to write a great report*: the templ instructions as a collapsible section, **open
  by default when the person has no reports in this event** (`ListReports` own = empty),
  collapsed otherwise; the state remembered per event on the device.
- File → `CreateReport`; the new report replaces the form (`router.replace`), and the
  incident's queries are invalidated when a link was set. Drafts as in 09r (`"report-new"`
  target; the on-behalf-of choice is part of the draft).

**The report screen** (`ReportScreen`, today read-only) gains the docked composer when
`may_add_journal_entry`, with the on-behalf-of picker folded into its footer ("Posting as
you" / "on behalf of <name>"); the link to the incident is a row that opens it; a writer
with no link gets *Attach to incident #…* (a number field) and *Create an incident from
this report* — the incident form opened with the report's summary, filing with
`IncidentUpdate.reports = [R]` so the link lands in the same call. Summary editing waits
for 3c's editor.

**The incident screen.** The *People* section shows each person's request state — nothing,
*report requested <when>*, or *R-38* (a row that opens the report when the viewer may
read it). A writer gets *Ask for a report* on each person and an *Ask someone…* row that
searches personnel and requests in one step; the person's row updates on the refetch. If
the viewer is the one asked and has not delivered, the screen shows a docked *File your
report* button above the composer that opens the form with the incident set.

**The Board.** The *Mine* classification (09q) gains a fourth rule: an incident where my
row carries `report_requested` and no `report_number` is mine, with an *owes a report*
mark on the row; the Reports segment is unchanged. Nothing here depends on 3b.5 — the
notification (3b.5) is the tap-through, the Board is the reminder.

**As built (2026-09-12), two details differ from the text above.** The Board gained the
report bar it needed for a reporter to file at all: the docked bar reads *Something to
report?* on the Reports segment (and on every segment for someone who can only write
reports), and *What's happening?* elsewhere for a writer. And "delivered" is derived on
the server from `REPORT.CREATED_BY` (a typed reports-by-incident query), not from a
subselect — sqlc could not type the aggregate.

**Photos** on reports come with 3b.4's helper once it exists (the report upload route
already has the right gate: own-or-all writes plus the ownership floor).

**Tests.** Form (file with link, on-behalf-of sticky and reverting, instructions open for
a first report), report screen (composer gated, attach, create-incident-from-report wire
shape), incident screen (request states, ask flow through the fake's `requestReport`,
file-your-report affordance), Board (the owed rule). The fake IMS grows `createReport`,
`updateReport`, `requestReport` and the two `IncidentPerson` fields. The tracer files a
report against staging.

## Acceptance criteria

1. A reporter files a standalone report from the Board in under a minute on a phone.
2. A writer asks a person for a report from the incident; that person sees the incident
   in *Mine* as owed, files from it, and the incident shows *R-n* on their row.
3. On-behalf-of sticks across entries in a session and clearing it reverts to the author.
4. A writer can create an incident from a report; the two are linked in one call.
5. A private incident never leaks through a request: `404` to a requester who may not
   view it; a granted reporter sees only that incident.
6. `ListReports` scoping is untouched; nothing in the client assumes it can list more
   than the server answers.
7. The 09i §9 list passes; `/review-animations` says Approve.

## Out of scope

- **Reminders, due dates, declining a request, un-requesting.** A repeat request is the
  reminder.
- **Crew-leader views** (their crew's reports) beyond what `ListReports` already scopes.
- **Editing a report's summary or striking entries** — 3c's editor.
- **The templ web client's request button** — the wire supports it; Phase 4 decides.

## Verification

3b.3a: the full Go protocol (build, vet, gofmt, golangci-lint v2.12.2, `go test ./...`
with `store/integration` and `api/integration` under a Docker daemon, `buf lint`, `buf
breaking --against master`, `go mod tidy`). 3b.3b: the 09i §9 list, then the tracer in
interim mode against staging.

## Checklist

- [x] 3b.3a: migrations (`REPORT_REQUESTED`; the enum value); sqlc regenerated
- [x] 3b.3a: `RequestReport` RPC, the grant, the system entry, the notification, the push
- [x] 3b.3a: `IncidentPerson.report_requested` / `report_number`; `buf breaking` clean
- [x] 3b.3a: integration tests as listed
- [x] 3b.3b: report form (summary, on-behalf-of sticky, details, incident, instructions)
- [x] 3b.3b: report screen composer + link + create-incident-from-report
- [x] 3b.3b: incident People states, ask flow, file-your-report
- [x] 3b.3b: Board "owes a report" rule
- [x] Tracer step (files a report from the Reports segment, appends); `/review-animations` Approve (nothing new moves: press feedback only, the help section swaps with no animation)
- [ ] Phone hand check
- [x] 09q Q4 and the 09i 3b.3 row point here (done in this PR)

## Open questions

1. **A `prototype` round for 3b.3b?** Recommendation: **no** for the form and the
   composer — they are 09r's Intake form and docked composer with two more fields. A
   round *could* be worth it for one thing: how the incident's People section shows
   asked / delivered and offers the ask, since that is the new idea on a screen that is
   already dense.
2. **Does a request grant per-incident access?** Recommendation: **yes, always** — a
   person cannot write a useful report on an incident they cannot see, and the requester
   is a writer choosing that person deliberately. The alternative (a request without the
   grant, the reporter files blind from the number in the notification) is cheaper on
   the server and worse in the field.
3. **Own RPC or a flag on attach-person?** Recommendation: **own RPC** (reasons above).
4. **Should "delivered" also mark the notification read?** Recommendation: no; 3b.5's
   mark-read on tap is enough, and a report can be filed without ever opening the alert.
