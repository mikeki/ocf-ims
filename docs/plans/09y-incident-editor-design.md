<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09y — The 3c.2 round: the incident editor

> **Status:** Brief written 2026-09-14; the round is the maintainer's to run. The 3c.2
> acceptance criteria are written here after the pick.
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, §6 **D2** and the 3c.2 row)
> under [09-proto-connect-platform.md](09-proto-connect-platform.md)
> **Follows:** [09x](09x-dispatch-design.md) (D2 / 3c.0 / 3c.1): the shell, the table, the
> drawer and the full page are built (#274, #275). The incident they show is the 3b screen,
> **read-only below the journal's composer** — 09x criterion 8 says so, and defers every
> field to this slice.
> **Owner:** Design (the round, run by the maintainer) → Architect (this brief, the rules
> below, the acceptance criteria after the pick) → Builder (3c.2).
> **The skills:** Emil Kowalski's skills govern all UI work (the maintainer's rule,
> 2026-09-10) — `prototype` for the round, `animate-expo` for anything that moves,
> `review-animations` before the resulting PR is called done.
> **Last updated:** 2026-09-14

## Objective

09x's table answers "what is happening"; this slice answers **"change it"**. Dispatch
opens a row and, without leaving it, closes the incident, raises its priority, adds a
type, moves it to an area, attaches the ranger who called it in and grants them access,
links the report that just came in, strikes the entry that was posted to the wrong
incident, and appends a note — then goes back to the table. templ does all of this on one
page, in the shape Bootstrap gave it: a grid of labelled controls above a journal, every
control saving on change.

The editor's question is the one 09x set aside: **how forty fields and a journal share
one pane.** The pane is fixed by the pick — the drawer is 66 % of the content width
(~676 px at 1024, ~950 at 1440), the full page is centred at `pageMaxWidth` (720). The
fields are fixed by the wire (below). What is open is the shape: whether the values are
themselves the controls, whether the fields sit above the journal or beside it, and what
the composer does when the journal is long.

## What is already true on the wire (verified 2026-09-14)

Everything the editor needs exists; **no proto change is needed for 3c.2.** Three things
the plan row wording overstates are corrected here.

| Field (the 3c.2 row) | On the wire | Notes |
|---|---|---|
| State, priority | `IncidentUpdate.state` / `.priority` | UNSPECIFIED = unchanged; there is no "clear". `closed` is server-stamped on the OPEN → CLOSED change. |
| Started | `IncidentUpdate.started` | absent = unchanged. templ has a datetime input; the client needs a date-time control that works on web and native (09r deferred it at filing time). |
| Summary | `optional string summary` (≤ 1024) | present = set, "" clears. |
| Location | `IncidentLocation{area_slug?, description?, booth?}` | A present location updates **only its set fields**; "" clears that piece. Area proposals go through `CreateArea` (the 09r flow, already in `AreaChooser`). |
| Types | `optional Int32List incident_type_ids` | present-but-empty **clears**; absent leaves. Send the whole list on every change. "Other" → `ProposeIncidentType` (the 09r `TypeChooser` flow). |
| Outcome | `optional int32 outcome_id` | absent = unchanged, **0 clears**, positive sets. `ListOutcomes` (event-scoped, approved + this event's proposals) and `ProposeOutcome` (a writer's proposal from the form, returns the id, collision-safe). **New to the client**: no hook or picker exists. |
| Private | `optional bool private` | The server accepts it only from an admin or the creator; templ enables the checkbox for exactly those. The client derives the enabled state from `isAdmin(auth)` and `created_by.person_id === me`; the server's answer stays authoritative. |
| People | `AttachPersonToIncident{person_id, involvement?, granted_access}` / `DetachPersonFromIncident` | Not on `IncidentUpdate` — two RPCs, one row each. `has_event_access` (output-only, privacy-aware) drives the "already has access" hint; the grant control shows only for a person who lacks it. Involvement is free text with templ's seven suggestions (Witness, Reporting Party, Subject, Injured Party, First Responder, Staff, Other), max 128 on the wire (templ caps the input at 50). Re-attaching an attached person updates their row. |
| Linked incidents | `optional IncidentRefList linked_incidents` | Send `{event_id, incident_number}` only; whole list; present-but-empty clears. templ accepts `1`, `3,4,5` and `2015#2` (another event). |
| Attached reports | `optional Int32List reports` | Whole list, present-but-empty clears — the "clear-vs-unchanged" semantics the row names. `RequestReport` (09t) attaches-and-asks in one step and already lives in `PeopleSection`. |
| Entries, mentions | `repeated NewJournalEntry{text, mentioned_person_ids}` | The 09r composer, unchanged. |
| **On-behalf-of** | **Not on the incident write.** `NewJournalEntry` has no such field; `internal/incident/connect.go` says "6m is reports-only for now"; templ's incident page has no picker. | **Corrected:** the editor **shows** `on_behalf_of` on read (an attached report's entries carry it; `JournalEntryRow` renders it already) and never writes it. Booked as open question 4, not a 3c.2 gap. |
| Strike | `UpdateIncidentJournalEntry{…, entry}` | The server honours **only** `entry.stricken`; any writer may strike or unstrike any incident entry. Send a `JournalEntry` with `id` and `stricken` set. There is no edit-text and no delete route. |
| Changes history | `JournalEntry.system_entry`; `GetIncidentRequest.exclude_system_entries` | The phone already fetches all and filters client-side (`h` toggles it in the dispatch map). Keep that: one fetch, three client toggles. |
| Attached reports' entries | Not on `GetIncident`. | templ's journal is "Entries from Incident and attached Reports", built from one `GetReport` per attached number and interleaved by time. The client needs the same fetches (cached per report; report reads are gated on their own, a 404 hides that report's entries). Decision 3 below. |
| Attachments | The 09s upload route (`attach_files` gates it) and the inline preview / `AttachmentScreen`. | Kept as 3b built them; nothing new on the wire. |
| Print | No RPC; templ is `@media print` CSS (`no-print` classes). | Web-only `window.print()` on the full page. Decision 5 below. |
| Concurrency | No version or etag on `UpdateIncident`. | Presence-tracked partial updates are the concurrency model: a control that sends only its own field cannot clobber another dispatcher's edit to a different field. Two edits to the *same* field are last-write-wins, and that is accepted for the fair (open question 2). |

Gates, all already on the client: `AccessForEvent.write_incidents` (every control, as
09x has it gating `n` and the composer), `viewer_may_add_journal` (the composer for a
grantee), `attach_files` (uploads), `isAdmin(auth)` + creator (the private toggle). A
row the viewer holds by grant renders read-only controls, not hidden ones, so the shape
does not shift between roles.

## What the client is today

- **The screen.** `features/incidents/IncidentScreen.tsx` (474 lines): number + state /
  priority / private badges, the summary as a heading, a meta card (started, created by,
  last modified, closed), then Location, Types, People (`PeopleSection`: ask-for-report
  rows, "Ask someone…"), Linked incidents, Reports (numbers that open), the journal
  (`JournalEntryRow`: system / stricken recession, inline photo, mentions, on-behalf-of)
  with the system-entry toggle, and the 09r `AppendComposer` (mentions, photo). Every value
  is text. It renders on the phone, in the drawer (no header) and on the full page.
- **The controls that exist** (`features/compose/`): `TypeChooser` (multi + propose),
  `AreaChooser` (search + create), `PersonPicker` (over `ListPersonnel`), `Chip`,
  `QuickBar` (priority at filing time), `PhotoAttach`, the composer, `drafts.ts`. The
  new-incident form (09r) sets summary, priority, types and location **at filing time
  only**; nothing edits after.
- **The hooks**: `useAppendEntry` (optimistic entry, invalidates incident + list),
  `useProposeType`, `useCreateArea`, `useRequestReport`, `useLinkReport` (the report side).
  Nothing calls `AttachPersonToIncident`, `DetachPersonFromIncident`,
  `UpdateIncidentJournalEntry`, `ListOutcomes` or `ProposeOutcome` yet.
- **Live**: a poke for the open incident refetches it (09x criterion 10). The screen has
  no local edit state today, so there is nothing a refetch can overwrite — that changes
  with the first field.

## The prototype round (the maintainer's to run)

Dispatch is chosen; its tokens and primitives are the material. The pane is chosen
(09x). **What is open is how the values become controls**, and the three shapes below
are the three honest answers. Each is judged in the drawer at 1024 (the tight case) and
on the full page at 1440, with the same fixture incident.

| Variant | Axis | The claim it makes | What it costs |
|---|---|---|---|
| **Ledger** | *In place* — the value is the control | The read screen as built, every value pressable: the state badge becomes a segmented Open / Closed, the summary a field, a type chip gains an ×, "Add type" is a chip, a person row's involvement is a field, the private badge is the toggle. No edit mode, nothing moves; a writer and a reader see the same page, one of them can press it. The journal keeps its place below. | Forty affordances that must read as affordances without forty outlines: the round decides how a pressable value announces itself (a dotted underline? the `borderStrong` field on hover / focus only?). Dynamic type and a 44 pt target on every value. |
| **Form** | *Two regions* — fields above, journal below | templ's shape done properly: a labelled two-column grid at the top (state · priority · outcome · started · private · summary · area · booth · details · types), then People, Links, Reports as list cards, then the journal and the composer, one scroll. Every control saves on change, as templ does. Dispatch already knows it. | At 1024 in the drawer the journal starts below the fold; the composer is a scroll away; `a` (jump to add) is the only thing that saves it. The fields eat the height whether or not anyone edits them. |
| **Columns** | *The journal is the workspace* — fields in a rail | The pane splits: a narrow left rail holds the fields, stacked, sticky; the right holds the journal with the composer **pinned at the bottom**. Reading and writing entries never scrolls the fields away; the fields never scroll the journal away. | ~240 px for the rail at 1024 (the drawer is ~676): stacked controls, labels above values, People and Links as counts that open a sheet. On the full page (720) the rail is no wider. |

One variant may carry a **sheet** for the long editors (People, Linked incidents,
Attached reports) — a side sheet in the pane, not a modal over the table — if its axis
needs it; the round then also decides whether the phone gets that sheet.

Every variant shows, with fixture data: an incident with **every field set** (outcome,
booth, details, three types, four people of whom one lacks event access and one has a
report delivered, two linked incidents including one from another event, one attached
report whose entries interleave), a **60-entry journal** with system entries, one stricken
entry, one photo and one on-behalf-of entry from the attached report; a **private
incident the viewer did not create** (toggle disabled, copy visible); a **grantee's view**
(`viewer_may_add_journal` true, `write_incidents` false: composer live, every field
read-only); **a poke arriving while the summary is being edited** (the poke's new priority
lands, the half-typed summary stays); **a save that fails** (the field keeps the typed
value, the error sits at the field, nothing else greys out); the empty journal; reduced
motion on. At **1024 (drawer) and 1440 (page)**, both schemes, and a **400 px pass on
each** so the phone is not surprised by the winner (decision 1).

**How to run it:**

```
/prototype 3c.2 — the incident editor for plan 09i (docs/plans/09y-incident-editor-design.md).
Three variants on the axes in that file's prototype-round table: Ledger, Form, Columns.
Dispatch is chosen and the pane is chosen — diverge on how VALUES BECOME CONTROLS, not on
colour or on the drawer; read tokens through useTheme() and reuse the existing primitives
and the compose controls (TypeChooser, AreaChooser, PersonPicker, Chip, AppendComposer).
Do not modify src/design/* or the existing src/features/*. Dev-only Expo Router route
outside the session gates, rendered inside the 3c.1 Drawer and IncidentPage chrome at 1024
and 1440; the fixture incident from src/test/fixtures.ts plus createFakeIms(), no server.
Saves are fake and per field (the fake answers after 300 ms, one field configured to fail).
Motion: only PressFeedback and StateFade from src/design/motion.tsx — a value becoming a
control is a hard cut; nothing enters with an animation on a list.
```

The in-code route is the recommendation, as in 09x: the poke-while-editing case and the
failing save can only be judged by running them. The throwaway surface is deleted after
the pick, as 09x's was.

### Decisions the round must also take (shape-independent, but only visible when run)

1. **The phone.** `IncidentScreen` is one component on three surfaces; the write gate is
   the same everywhere. Recommendation: **the phone edits too**, with the winner's shape
   at 400 px — a ranger who filed from the tent should be able to close from the tent.
   The round's 400 px pass decides whether the winner survives the width or the phone
   gets the Ledger regardless of the pick.
2. **Save on change, no Save button.** templ's model and the proto's stated purpose. The
   round confirms it reads as safe: a control that has just saved shows nothing (the
   value is the confirmation), a control that is saving shows nothing for the first
   300 ms, a control that failed shows the message at itself and keeps the typed value
   until the next attempt. Text fields (summary, details, booth, involvement) save on
   blur and on Enter; everything else on change.
3. **The attached reports' entries.** templ interleaves them under a "Reports" toggle.
   Recommendation: interleave, one `GetReport` per attached number, cached, the toggle
   defaulting on as templ's does — a dispatcher reading an incident must see what the
   ranger wrote. Each report's entries carry a small "Report #n" mark so the origin is
   never in doubt.
4. **The composer when the journal is long.** Pinned (Columns), at the end (Form, Ledger),
   or pinned in every variant. `a` jumps to it in all three; the round judges whether
   pinning earns the height it takes at 1024.
5. **Print.** Web-only, the full page only, `window.print()` behind a header word and a
   print stylesheet that drops the shell and the composer. Recommendation: **defer to
   3c.6** unless dispatch says it prints incidents in a normal shift (open question 3);
   templ keeps it either way until Phase 4.
6. **Started.** A date-time control that works on web (native `<input type="datetime-local">`
   through RN Web is acceptable) and on native (`@react-native-community/datetimepicker`
   or a text field with a strict format). The round shows one; 09r deferred this at filing
   time for the same reason.

## The rules the winner inherits (shape-independent)

### One field, one request

Every control sends **only its own field** on `IncidentUpdate`; lists (types, links,
reports) send their whole current list. A control never sends the fields around it, so
two dispatchers editing two fields never collide. The hook is one `useEditIncident`
returning per-field setters over a single `updateIncident` mutation; each setter's
`onMutate` writes its field into the cached `GetIncident` optimistically, `onError`
restores that field only and surfaces the error at the control, `onSettled` invalidates
the incident and the list (09x's live rows then patch the table). People go through the
attach / detach RPCs with the same shape; strike through `UpdateIncidentJournalEntry`,
optimistic on the entry.

### A poke never overwrites an unsaved field

09x's rule, made concrete: each control holds a local value only while it is **focused or
mid-save**; a refetch (poke, pull, settle) writes the server's values into every control
that is not, and into that one when it blurs or its save settles. A text field being
edited when a poke changes the same field keeps the typed value; the next save wins.
Nothing here needs a version on the wire.

### Gating

`write_incidents` enables every control; without it the winner renders **the same shape
read-only** (a disabled control, not a missing one, so nothing shifts between a writer
and a reader). `viewer_may_add_journal` alone (a grantee) lights only the composer.
`attach_files` gates the attach chip. The private toggle is enabled for `isAdmin(auth)`
or the creator, with templ's copy on it ("When private, only admins, the incident's
creator, and people granted per-incident access can see this incident."); the grant
checkbox on a person appears only when `has_event_access` is false. A 404 stays "Not
found" (the phone's state); a permission error on save is the field's error, never a
redirect.

### The colour language, applied to controls

The state control wears **Open = `info`**, Closed = neutral; the priority control wears
**High = `danger`**, Normal nothing, Low neutral; the private toggle `restricted`. The
selected segment carries the tone, the unselected ones `border`; a control never invents
a colour, and colour is never the only carrier (the label is always there). Field
boundaries are `borderStrong` (3:1); focus is `focus`.

### Keyboard

The dispatch map (`j` `k` `n` `a` `h` `?` `/` `q` Esc) is not extended with letters:
every letter belongs to a text field once one is focused. `a` focuses the composer, `h`
toggles history, **Esc blurs first** (09x's order), then closes the drawer. The composer
submits on **Ctrl / ⌘ + Enter**; Enter inserts a newline (templ's default; the
Enter-to-submit preference is a 3c.6 line item). Every control is reachable by Tab in
reading order; a segmented control moves with the arrows.

### Motion

Press feedback on every control (the budget). A value becoming a control, a chip
appearing, a sheet opening: **hard cuts**. The composer's error uses its `StateFade`.
Under reduced motion the press scale drops and nothing else changes. `review-animations`
runs before the PR.

### Privacy

Rows and incidents arrive already filtered; the editor never decides visibility. The
private toggle's disabled state and the server's 404 are the truth. An attached report's
entries that 404 are simply absent.

### The phone is not regressed

3b's screen, tracer and Jest suites stay green. The editor is the same component; if
decision 1 gives the phone the editor, the 3b briefs' read paths (09q, 09r, 09s, 09t) are
unchanged in behaviour and the composer keeps its drafts.

## Out of scope

- **Reports' editor** — 3c.3 (the report page's summary, link and on-behalf-of already
  exist from 09t; 3c.3 places them in the shell).
- **Editing an entry's text, deleting an entry, removing an attachment** — no route.
- **On-behalf-of on an incident entry** — reports-only on the server (open question 4).
- **Any proto change.** None is needed; a version on `UpdateIncident` is open question 2.
- **The Enter-to-submit preference, a hideable-columns preference, a theme preference** —
  3c.6's list.
- **Web push on Expo web** — 3d.5.

## Verification (for the round)

`pnpm -F @ocf-ims/interface typecheck`, `pnpm lint`, `pnpm -F @ocf-ims/interface test`
unchanged and green with the throwaway surface in the tree; `export:web` builds; the
smoke e2e passes. Hand: the three variants in the drawer at 1024 and on the page at 1440
in both schemes, the 400 px pass, the poke-while-editing case, the failing save, the
grantee's view, the private-not-mine view, reduced motion. Nothing goes to staging.

## Checklist

- [x] Brief written; the contract verified; the three overstated fields corrected (2026-09-14)
- [ ] The surface built, verified and the scripted walk green
- [ ] The round run; the pick recorded here with its reasons
- [ ] The 3c.2 acceptance criteria written (architect)
- [ ] The throwaway surface deleted in the 3c.2 PR

## Open questions

1. **Does the phone edit?** Recommendation above: yes, same component, same gate. The
   round's 400 px pass answers whether the winner's shape survives there.
2. **Same-field collisions.** Last-write-wins per field, no version on the wire. Accepted
   for the fair; if dispatch reports lost edits, an `expected_last_modified` on
   `UpdateIncident` is a small server slice (a 409 → the field refetches and shows "changed
   by <person>").
3. **Print.** Confirm with dispatch whether incidents are printed in a normal shift;
   if not, print is a 3c.6 line item and templ carries it until Phase 4.
4. **On-behalf-of on incident entries.** Reports-only by design (6m); the 3c.2 plan-row
   wording is corrected here. If dispatch wants it on incidents it is a proto + server
   slice (`NewJournalEntry.on_behalf_of_person_id`, the write path in
   `internal/incident`), not a client one.
5. **Attached reports' entries** — interleave (recommended) or a section under Reports.
   Decided by the round (decision 3).
