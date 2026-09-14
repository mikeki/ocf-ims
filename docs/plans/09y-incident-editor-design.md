<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09y — The 3c.2 round: the incident editor

> **Status:** Brief written 2026-09-14; the round run and **Ledger picked** 2026-09-14
> (§ The pick); the 3c.2 acceptance criteria written the same day (§ 3c.2 acceptance
> criteria) — the builders' brief.
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
> **Last updated:** 2026-09-14 (the 3c.2 PR opened)

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

### What was built — the surface (2026-09-14)

`app/(dev)/editor.tsx` + `src/prototypes/editor/` (throwaway, outside the session
gates, no server, deleted in the 3c.2 PR). Run it with `pnpm -F @ocf-ims/interface start`
(never `CI=1`) and open `http://localhost:8081/editor?v=1` (`1`/`2`/`3` or `←`/`→` flip
the picker). The harness band above the stage takes the shape-independent decisions:
pane (drawer / page / phone), a fixed stage width (1024 / 1440 / 400 / fit), scheme,
the viewer (dispatcher / grantee / admin — the runtime is rebuilt per role), the
incident (#47 every field set with the 60-entry journal, #48 private and not mine,
#49 empty journal), and the pokes ("Poke priority  P" now; "Poke in 3 s" so you can be
typing when it lands). The shell, filter bar, table, the drawer's and the page's headers
and the keyboard map are the real 3c.1 pieces over `useDispatchQuery`; only the pane's
body is the variant, so `j` `k` `a` `h` `?` Esc mean what 09x says.

The data layer is real: the same `createRuntime` over `createRouterTransport` and
`createFakeIms()` the Jest harness uses, signed in as the fixture's viewer. The fake is
seeded from `data.ts` and wrapped in `fake.ts`: every write answers after 300 ms, the
field writes on `UpdateIncident` land with the wire table's presence semantics (the
stock fake only appends entries), the **booth** is the field configured to fail
(Unavailable), and the four RPCs nothing on the client called before — attach / detach
person, `UpdateIncidentJournalEntry`, `ListOutcomes` / `ProposeOutcome` — are
implemented. `useEditIncident.ts` is § One field, one request as code (per-field setters
over one mutation, optimistic per field, the error at the control, the invalidations on
settle); `controls/SavingField.tsx` is § A poke never overwrites an unsaved field. Both
are shape-independent and are what the winner promotes, whichever it is.

| Variant | Axis | When it is the right choice | Its cost, measured |
|---|---|---|---|
| Ledger | In place | The page is read far more than it is edited; a writer and a reader see the same thing | Round 2: a ledger of `label · value · ›` rows, the labels in one aligned column; a press is a hard cut to the control in the value column. Eleven rows above the journal on #47; an empty field is a muted "Add …" value. A control with no natural blur (state, priority, outcome, area, types, private) needs a Done or a same-value press to hand back |
| Form | Two regions | Dispatch edits a lot and already knows templ's shape; every control is visibly a control | In the drawer at 1024 the grid (state · priority · outcome · started · private · summary · area · booth · details · types) runs about two screens before People; the journal and the composer are a long scroll away and `a` is the only way to the composer. The type chooser (search + every chip) is the tallest cell |
| Columns | The journal is the workspace | Reading and writing entries is the job; the fields are a reference beside it | The rail is 240 px: the outcome chips stack eight rows, the type chooser another eight; the rail scrolls on its own. On the page (720) the journal column is 480 px. People / Links / Reports are counts that open a side sheet in the pane |

At 400 px: Ledger and Form are one scroll each, the composer at the end; Columns stacks
the rail above the journal with the composer pinned, so the fields are the whole first
screen. In both schemes; reduced motion drops only the press scale.

**Found by running it, not by reading it:**

1. **`useDispatchQuery` normalises `open=` / `sel=` in an effect.** Mounted on a route's
   first render (a direct link with `open=47`) that effect runs before the root layout
   has mounted and expo-router throws "Attempted to navigate before mounting the Root
   Layout". The surface mounts the hook a render later, once the rows are in. The real
   `DispatchScreen` is reached by navigation so it has never seen this — but a cold web
   load of `/events/1/incidents?open=47` may; a 3c.1 follow-up to verify on staging.
2. **A poke lands mid-edit and the rule holds.** The fake's priority change reaches the
   open incident through the real hub: the badge and the table row change while the
   summary field keeps its typed text; its blur then saves it. No version on the wire.
3. **The failing save reads as intended.** The booth keeps "418", the error sits under
   the field, nothing else greys out, the next Enter retries.
4. **A segmented control needs a same-value path.** In Ledger a pressed state badge that
   is not then changed would stay a control forever; pressing the current segment now
   hands back without a request. The pickers (outcome, area, types, private) carry a Done.
5. **The strike control is loud.** One "Strike" word under each of 52 entries, even at
   caption size, is the noisiest thing in the journal in every shape. The 3c.2 criteria
   should hide it behind the entry (a press on the row, or hover-only on web).
6. **The Form's disabled state needs more than muted text.** A grantee's summary field
   looked live until the disabled fields sank to `surfaceSunken`; the segmented controls
   read as disabled at 0.6 opacity.
7. **The started control** is one text field in the strict `YYYY-MM-DD HH:mm` local
   format on every platform (decision 6); a native picker is a later choice.
8. **The attached report's entries interleave** under a small "Report #7" mark, and the
   on-behalf-of line renders through `JournalEntryRow` unchanged (decision 3, as
   recommended).

Verified with the surface in the tree: `typecheck`, `lint` and Jest (46 suites, 320
tests) green; `export:web` builds; the smoke e2e passes; the console is clean on every
variant, pane, width and viewer above.

**Round 2 — the Ledger riffed (2026-09-14).** The maintainer leaned Ledger and listed
what read wrong in the first cut; the second cut answers each, the other two variants
untouched except where they share a control:

- The drawer's header row ("Incidents  #47  … Prev Next Full page") is now the real
  `ScreenHeader` (back "Incidents", the number as the title, Prev / Next / Full page at
  the right) — the same bar the page and the phone use.
- The dotted-underline values are gone. The Ledger is a settings list: `label · value · ›`
  rows in cards (Details: state, priority, private, outcome, started, created, modified,
  closed; Location: area, details, booth; Types), the labels in one 104 px column, the
  chevron only for a writer. A press swaps the value column for the control in place;
  the label stays where it was. The read-only marks (state, priority, private) sit as
  badges beside the number at the top.
- The summary is the heading with an **Edit** word at its right; Edit is a hard cut to
  the summary field.
- People: each person is a block — name; `involvement · access` as a caption; the report
  badge; the grant switch; then one actions line (Involvement · Ask for a report ·
  Detach) — instead of a name column and a ragged right column.
- The add controls left the cards' last row. In the Ledger the section header carries
  the word (Attach someone… / Link an incident… / Attach a report…) and the picker or
  field opens at the **top** of the card; the Form and the Columns sheet keep the inline
  word, now behind a hairline rule so it is not the last row's.
- Strike / Unstrike moved onto the entry's header line after the time, in every variant.
- The journal in the Ledger is **newest first with the composer at its top**, framed in
  a `border` box under the "Journal" heading; the Form keeps oldest-first with the
  composer at the end and Columns keeps it pinned, so decision 4 is now visible in the
  picker as three answers.

Verified again: typecheck, biome, Jest (46 / 320) green; the console clean on Ledger
at 1024 drawer / 400 phone / 1440 page and on Form and Columns at 1440.

### The pick — Ledger (2026-09-14)

The maintainer picked **Ledger** after the second cut ("keep the ledger style as
designed"). The reasons, as the round showed them:

- **A writer and a reader see one page.** The rows are the read screen; the chevron is
  the only thing a reader lacks. 3b's `IncidentScreen` grows into it rather than being
  replaced by a form, so the phone (decision 1) is the same component at 400 px — the
  round's 400 px pass was clean.
- **It is the shortest.** Eleven rows above People on #47 against the Form's two screens
  of grid; the journal is one scroll away in the drawer at 1024.
- **Nothing in it is new chrome.** Cards, `Badge`, `TextButton`, `ScreenHeader`, the
  compose controls; the one new thing is the row that becomes its control, which is a
  `Pressable` around a row and a hard cut.

The shape the builder implements is the round-2 Ledger exactly (§ Round 2): the marks
beside the number; the summary heading with Edit; the Details, Location and Types cards
of `label · value · ›` rows; People / Linked incidents / Reports as sections whose header
carries the add word and whose add control opens at the top of the card; the journal
newest first with the composer at its top. The second cut was checked at the three
widths as the dispatcher and as the grantee on the private #48 in dark (no chevron, no
Edit word, "None" values, the row shape unchanged); reduced motion was verified on the
first cut only and the criteria must still name it.

**The decisions, as the round settled them:** (1) the phone edits too, the Ledger shape at
400 px; (2) save on change, no Save button — confirmed, the failing booth reads right;
(3) interleave the attached reports' entries under the "Report #n" mark; (4) **the composer
at the top of a newest-first journal** — not pinned, not at the end; (5) print deferred to
3c.6; (6) started is the strict-format text field until a later slice picks a native
control.

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

## 3c.2 acceptance criteria (the builder's list, after the pick)

Written 2026-09-14, the day of the pick. **The brief for the builder is this section plus
"The rules the winner inherits" above; the surface (`src/prototypes/editor/`) is the
reference implementation of the mechanics and the round-2 Ledger is the shape — copy its
files into place and edit, do not retype them.** Rule 2 applies: no contract gap is
expected (the wire table above is verified); one found stops the builder and is filed in
the slice notes. The slice runs past the `Agent` ceiling, so it is **two builders in
sequence, one PR**: the first lands the data layer, the fake and the shape-independent
controls (criteria 1–6); the second lands the screen, the drawer header, the deletion
and the screen specs (criteria 7–17).

### The data layer and the fake (builder 1)

1. **`useEditIncident(eventId, number)`** lands as `src/features/incidents/useEditIncident.ts`,
   the surface's file with its comment: per-field setters (`setState`, `setPriority`,
   `setPrivate`, `setOutcome`, `setStarted`, `setSummary`, `setArea`, `setDescription`,
   `setBooth`, `setTypes`, `setLinks`, `setReports`, `attachPerson`, `updatePerson`,
   `detachPerson`, `setStricken`) and `status(field)` → `{ pending, error }`. Every
   field write is one `UpdateIncident` carrying **only that field** and
   `journalEntries: []` (lists send their whole current list; location pieces send
   `{ location: { [piece]: value } }`, empty string clears); people go through
   `AttachPersonToIncident` (re-attach updates involvement / grant) and
   `DetachPersonFromIncident`; strike through `UpdateIncidentJournalEntry` with only
   `stricken` set. Each write cancels the incident query, patches that field into the cached
   `GetIncident` optimistically, on error restores **that field only** and exposes
   `toAppError(e)` at `status(field)`, and on settle invalidates the incident and
   `listIncidents` for the event. Errors are `AppError`; nothing here redirects.
2. **`SavingField`** lands as `src/features/incidents/SavingField.tsx` as it is: a `Field`
   that holds a local value only while focused or mid-save, saves on blur and on Enter
   (single line) when the text changed, validates before sending, keeps the typed value
   and shows the save error at itself when the save fails, and renders read-only in
   `surfaceSunken` with muted text when `disabled`. A refetch while it is not focused
   writes the server's value into it.
3. **The controls** land in `src/features/incidents/controls/`: `Segmented.tsx` (the
   radiogroup with the tone on the selected segment, arrows move, `FieldError` under it),
   `fields.ts` (`STARTED_FORMAT`, `formatStarted`, `validateStarted`, `parseStarted`,
   `parseLinks`, `parseNumbers`), `StartedField.tsx`, `OutcomeChooser.tsx` (single-select
   `success` chips plus "Other" → the propose field), `PrivateToggle.tsx` (the `restricted`
   switch with templ's copy; disabled adds "Only an admin or the creator can change
   this."), `InPlace.tsx` (`InPlace` and `ControlWithDone` only — `PressableValue` is not
   promoted), `Controls.tsx` (`StateControl`, `PriorityControl`, `PrivateControl`,
   `SummaryControl`, `StartedControl`, `DetailsControl`, `BoothControl`, `AreaControl`,
   `TypesControl`, `OutcomeControl`, and the helpers `areaLabel`, `outcomeName`), and
   `bits.tsx` (`saveErrorText`, `FieldError`, `Label`, `Card`, `Section` with its `right`
   slot, `Meta` — `IncidentScreen`'s private `Card` / `Section` / `Meta` move here). The
   controls take `{ data, edit, eventId, disabled?, onDone?, autoFocus?, labelled? }` where
   `data` is criterion 4's `EditorData`. A same-value press on a segmented control calls
   `onDone` without a request.
4. **The data, in the existing hooks.** `src/features/incidents/hooks.ts` gains
   `useOutcomes()` (`ListOutcomes`) and `useAttachedReports(eventId, numbers)` (one
   `getReport` per number through `useQueries` + `createQueryOptions`, each cached under the
   connect-query key so 3c.3 shares it; a 404 leaves that report absent). The surface's
   `useEditorData` is replaced by a small `useEditorData(eventId, number)` in the same
   folder that composes `useIncident`, `useAreas`, `useIncidentTypes`, `useOutcomes`,
   `useEvents`, `useEventAccess`, the session and `useAttachedReports` into the
   `EditorData` shape the controls read (`view`, `lookups`, `gates` — `writeIncidents`,
   `attachFiles`, `mayAppend`, `mayTogglePrivate = writeIncidents && (isAdmin(auth) ||
   creator === me)`, `me`, `author` — and `journal`: the incident's entries and the loaded
   reports' interleaved by `created`, each item carrying `report?: number`). No new
   query key, no new RPC on the client beyond the five the surface already calls.
5. **The fake grows the five RPCs and the field semantics.** `src/test/fakeIms.ts`:
   `updateIncident` applies the update with the wire table's presence semantics (state /
   priority unspecified = unchanged; `optional` scalars present = set, empty string clears
   summary; `outcomeId` 0 clears; `location` present updates only its set pieces; the
   `Int32List` / `IncidentRefList` wrappers present-but-empty clear; `closed` stamped on
   the Closed transition and cleared on Open; `lastModified` bumped) and still appends the
   entries; `attachPersonToIncident` (re-attach updates the row; `hasEventAccess` from
   `fake.people`'s event access), `detachPersonFromIncident`, `updateIncidentJournalEntry`
   (only `stricken`), `listOutcomes` over a new `fake.outcomes` (seeded, with
   `makeOutcome` in `fixtures.ts`), `proposeOutcome` (a name collision answers the existing
   id). Each has a `behaviour` key and a recorder (`attachRequests`, `detachRequests`,
   `entryUpdateRequests`); the 52f rule stays (a grantee's non-journal update is a
   permission error). The stock 300 ms delay of the surface is **not** promoted — tests
   control timing.
6. **Specs for builder 1**, in `__tests__/features/incidents/`: `useEditIncident.test.tsx`
   (a summary save sends `{ summary, journalEntries: [] }` and nothing else; the cache
   shows the value before the fake answers; a failing save restores only that field and
   `status("summary").error` is set while another field's optimistic value survives; a
   booth save sends `{ location: { booth } }`; `attachPerson` / `detachPerson` hit the two
   RPCs; `setStricken` sends only `stricken`; every settle invalidates the incident and the
   list), `SavingField.test.tsx` (saves on blur and on Enter, an unchanged blur sends
   nothing and calls `onDone`, a value change from outside while focused does not replace
   the typed text, a failed save keeps the text and shows the error, `validate` blocks the
   send), and `fakeIms` cases for the presence semantics in the existing fake spec or a new
   one. `typecheck`, `lint` and `test` green at the end of builder 1 with `IncidentScreen`
   untouched.

### The screen (builder 2)

7. **`IncidentScreen` is the Ledger.** Same props (`chrome`, `handle`, the callbacks),
   same states (loading, "Not found", error with retry, pull to refresh), same
   `KeyboardAvoidingView` and the "File your report" dock. The body, in reading order: the
   number with the read-only marks (state `info` / Closed neutral, priority High `danger` /
   Low neutral / Normal absent, Private `restricted`); the summary as the heading with an
   **Edit** `TextButton` at its right for a writer (a hard cut to `SummaryControl`, back on
   settle or an unchanged blur); the Details card of rows State, Priority, Private,
   Outcome, Started, Created (read-only, "… by <creator>"), Modified (read-only), Closed
   (read-only, only when set); the Location section with rows Area, Details, Booth; the
   Types section with one row of `info` badges; People, Linked incidents, Reports as
   sections (criterion 9); the journal (criterion 10). Empty values read "None" for a
   reader and "Add …" muted for a writer.
8. **The row** is `src/features/incidents/LedgerRow.tsx`: `label · value · ›` with the
   label in a fixed 104 px column (a `ledger.labelWidth` token in `tokens.ts` — the only
   file that may hold it) and the chevron only when the row has a control and the viewer
   may write. The whole row is one `Pressable` with `PressFeedback`, accessibility label
   "Edit <label>"; a press swaps the value column for the control in place and the label
   stays where it was; `onDone` (a settled save, an unchanged blur, Done on the pickers, a
   same-value press) is the hard cut back. No animation on either cut. A reader's row is
   not pressable and has no chevron; nothing else differs.
9. **The lists.** `PeopleSection.tsx` becomes `PeopleEditor.tsx` (the surface's): a person
   is a block — name; `involvement · access` caption (the involvement a `SavingField`
   with the seven suggestion chips when pressed; the access one of "Has event access" /
   "Granted access to this incident" / "No event access"); the report line (the "Report
   filed" badge with the `R-n` figure, or "Report requested" with the time); the grant
   switch (`restricted`, only for a writer and only when `hasEventAccess` is false); then
   one actions line — Involvement / Add involvement, Ask for a report / Ask again /
   Asking…, Detach. The section header carries **Attach someone…** and the `PersonPicker`
   opens at the top of the card; picking attaches with no involvement and no grant. Linked
   incidents: one row per ref — this event's as the `figure` button, another event's as
   "<event> #n" text — with Unlink; the header word **Link an incident…** opens the field
   (`1`, `3, 4, 5`, `<event>#n`; an unknown event name is the field's error). Reports: one
   row per number opening the report, with the caption "Its entries are in the journal
   below" / "Not readable by you — its entries are absent", and Detach; the header word
   **Attach a report…**. The existing `ask-report-<id>`, `person-row-<id>` and
   `incident-report-<n>` test ids stay; `ask-someone-*` become `attach-someone-*`.
   The read-only PeopleSection specs are folded into the editor's.
10. **The journal is newest first with the composer at its top.** Under the "Journal"
    heading and the "Show system entries" switch, the `AppendComposer` (unchanged: drafts,
    mentions, the photo chip gated on `attachFiles`, `Ctrl / ⌘ + Enter`) in a `border`
    box, then the entries newest first. `JournalEntryRow` gains `report?: number` (the
    "Report #n" caption after the author) and `onStrike?: () => void` (a caption
    `TextButton` "Strike" / "Unstrike" after the time, `testID="strike-<id>"`, only on the
    incident's own non-system entries for a writer); the on-behalf-of line and the inline
    image are unchanged. The attached reports' entries interleave (decision 3), a report
    that 404s is simply absent. The `handle` keeps `focusComposer` and `toggleSystemEntries`;
    `a` and `h` in the dispatch map work as before.
11. **Gating** as the rule above: `writeIncidents` lights every row, the Edit word, the
    add words, the involvement, the grant switch and Strike; without it the same shape
    renders read-only; `viewerMayAddJournal` alone lights the composer; the private row's
    control is disabled unless `mayTogglePrivate`. A save that fails with a permission
    error is that field's error. `useLiveEvent` stays held; a poke refetches and rule
    "A poke never overwrites an unsaved field" holds through `SavingField`.
12. **The drawer's header is the `ScreenHeader`**: `src/features/dispatch/Drawer.tsx`
    replaces its own header row with `ScreenHeader` (back "Incidents" → close, the number
    as the title, right: "‹ Prev", "Next ›", "Full page"), the same bar `IncidentPage` and
    the phone draw. The dispatch specs and `e2e/dispatch.spec.ts` are adjusted only where
    they name that header.
13. **The phone is not regressed.** The `[number]` route is untouched; below the
    breakpoint `IncidentScreen` renders the same Ledger with its own header; the 3b read
    paths and the composer's drafts behave as before; the tracer's steps (open an incident,
    append an entry, open a photo) still find their targets by the same names.
14. **The surface is deleted in the same PR**: `app/(dev)/editor.tsx` and
    `src/prototypes/editor/` go; nothing under `src/prototypes/` remains.
15. **`DESIGN.md` gains a short "The editor" section** after "The table": the row that is
    its control (label column, chevron, hard cuts), the colour language on controls, the
    save-on-change contract in one line each. The client README gains one line under the
    wide layout: the incident edits in place.
16. **Specs for builder 2**, in `__tests__/features/incidents/`: `IncidentScreen.test.tsx`
    extended — a writer sees the chevrons and Edit, pressing the Priority row shows the
    segmented control and choosing High sends `{ priority: HIGH, journalEntries: [] }` and
    hands back; Edit on the summary shows the field and Enter saves; a reader (no
    `writeIncidents`) has no chevron, no Edit, no Strike and a disabled private row; a
    grantee (`viewerMayAddJournal` only) sees the composer and nothing else lit; the
    private row is disabled for a writer who is neither admin nor creator; a failing booth
    save (`behaviour.updateIncident = "unavailable"`) keeps the typed booth and shows the
    error at the row; a poke that changes the summary while the summary field is focused
    does not replace the typed text; Attach someone → `attachPersonToIncident`; Detach →
    `detachPersonFromIncident`; Strike → `updateIncidentJournalEntry` with `stricken`; the
    attached report's entries carry "Report #n"; the journal renders newest first with the
    composer above the first entry. `LedgerRow.test.tsx` (reader / writer / editing / done)
    and `PeopleEditor.test.tsx` (the folded read cases plus the actions line).
17. **The 09i §9 list passes** (`typecheck`, `lint`, `test`, `export:web`, `e2e` smoke);
    hand check on staging by the maintainer after merge: the drawer at 1024, the page at
    1440, the phone, both schemes, reduced motion, a poke while editing, a failing save.

**Built 2026-09-14** by two builder `Agent`s in sequence against this section (builder 1:
195 calls / 335K; builder 2: 147 calls / 279K — both past the rule-6 budget, as 3c.1's
halves were; the next slice of this size is a session). The architect review found one
defect, fixed before the PR: `IncidentDetail` was not keyed by the incident number, so
Prev / Next (which update the number in place) carried an open row and its typed text
onto the next incident when that incident was already cached; `key={number}` and a spec
that fails without it.

### The promotion map

| Surface (`src/prototypes/editor/`) | Lands as | What changes |
|---|---|---|
| `useEditIncident.ts` | `src/features/incidents/useEditIncident.ts` | As is |
| `controls/SavingField.tsx` | `src/features/incidents/SavingField.tsx` | As is |
| `controls/{Segmented,StartedField,OutcomeChooser,PrivateToggle,Controls,bits,fields}` | `src/features/incidents/controls/` | `INVOLVEMENTS` moves to `PeopleEditor.tsx`; `Card`/`Section`/`Meta` replace `IncidentScreen`'s private ones |
| `controls/InPlace.tsx` | `src/features/incidents/controls/InPlace.tsx` | `PressableValue` dropped |
| `Ledger.tsx` (the `Row`) | `src/features/incidents/LedgerRow.tsx` | The width from `tokens.ts` |
| `Ledger.tsx` (the body) | `IncidentScreen.tsx`'s `IncidentDetail` | The states, the header, the report dock and the composer's `handle` stay `IncidentScreen`'s |
| `controls/PeopleEditor.tsx` | `src/features/incidents/PeopleEditor.tsx` | Replaces `PeopleSection.tsx`; controlled `adding` only |
| `controls/LinksEditor.tsx`, `controls/ReportsEditor.tsx` | `src/features/incidents/` | Controlled `adding` only; the inline word goes |
| `controls/Journal.tsx` | `src/features/incidents/Journal.tsx` | `EntryRow` folds into `JournalEntryRow` (`report`, `onStrike`); `order` fixed newest first; `header` prop dropped |
| `useEditorData.ts` | `src/features/incidents/useEditorData.ts` | Over the existing hooks (criterion 4) |
| `fake.ts` | `src/test/fakeIms.ts` | The five RPCs and the presence semantics; the delay and `pokePriority` dropped |
| `data.ts` | `src/test/fixtures.ts` | `makeOutcome` only; the fixture incident stays the 3b one |
| `types.ts`, `EditorHost.tsx`, `Stage.tsx`, `Form.tsx`, `Columns.tsx`, `controls/PaneSheet.tsx`, `runtime.ts`, `Picker.tsx`, `Harness.tsx`, `app/(dev)/editor.tsx` | deleted | |

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
- [x] The surface built, verified and the scripted walk green (2026-09-14; § What was built)
- [x] Round 2: the Ledger riffed on the maintainer's notes (2026-09-14; § Round 2)
- [x] The round run; Ledger picked, the reasons and the six decisions recorded (2026-09-14; § The pick)
- [x] The 3c.2 acceptance criteria written (2026-09-14; § 3c.2 acceptance criteria)
- [x] The Ledger promoted (two builders against § 3c.2 acceptance criteria), reviewed, the surface deleted — the 3c.2 PR (2026-09-14)

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
