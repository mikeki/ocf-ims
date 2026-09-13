<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09x — D2 and slice 3c.0: Dispatch on a wide screen

> **Status:** **Picked 2026-09-13: Drawer, with the top bar, and the drawer opens the full
> page.** The surface is merged (#272) and stays in the tree until 3c.1 promotes and
> deletes it; **the 3c.1 acceptance criteria are written below (2026-09-13)** — the next
> step is the builder, a fresh Sonnet session with that section as the brief.
> Taken ahead of the 3b gate on the 3b.0 precedent: the gate is held by accounts and
> hardware, not code, and this slice ships no code — it decides shape.
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, §6 **D2** and the 3c.0 row)
> under [09-proto-connect-platform.md](09-proto-connect-platform.md)
> **Follows:** [09w](09w-store-readiness.md) (3b.7, the last field-app slice). 3b built
> the phone; **nothing in the client yet knows it is on a wide window** — a form stops
> growing at `formMaxWidth` and sits centred, and that is the whole of it.
> **Owner:** Design (the round, run by the maintainer) → Architect (this brief, the rules
> below, the 3c.1 acceptance criteria after the pick) → Builder (3c.1).
> **The skills:** Emil Kowalski's skills govern all UI work (the maintainer's rule,
> 2026-09-10) — `prototype` for the round, `animate-expo` for anything that moves,
> `review-animations` before any resulting PR is called done.
> **Last updated:** 2026-09-13

## Objective

3c is the reason the client is a redesign: **the dispatch tent has to run the fair on the
Expo web build.** Dispatch sits at a laptop for a shift, works one event, and lives in
one table — reads it, filters it, opens rows from it, edits, comes back, and expects the
table to be where it was. The phone app answers "what is mine"; dispatch answers "what is
happening", for everyone, all at once.

D2 in 09i §6 covers the whole of 3c: the split list/detail, the dense table with filters,
the full editor, report review, the roster and the dashboard. **This brief takes what 3c.1
needs and nothing more:** the wide-window **shell**, the **table**, and **where an
incident opens from it.** The editor gets its own round with 3c.2, reports with 3c.3,
the roster and dashboard with theirs — 09q's rule, that a round is worth running against
a real question, holds here twice over: the editor's question (how forty fields and a
journal share a pane) is not the table's (how two hundred rows and a selection share a
window).

## What is already true on the wire (verified 2026-09-13)

Everything the table needs is in the contract. No proto change, no server slice.

| Question | Answer | Source |
|---|---|---|
| The rows | The **whole event**, one call, no server-side filter, sort, search or page | `ListIncidents{event_id, exclude_system_entries}` |
| Lighter rows | `exclude_system_entries = true` drops the generated journal entries | same request; the Board already asks for it |
| The columns | `number`, `state`, `priority`, `incident_type_ids`, `location.area_slug`, `summary`, `started`, `created`, `last_modified`, `people[].person`, `private`, `outcome_id` | `resources.v1.Incident` |
| State / priority | `OPEN`, `CLOSED` · `LOW = 1`, `NORMAL = 3`, `HIGH = 5` — priority is numeric on the wire, so it sorts as a number and displays as a word for free | `IncidentState`, `IncidentPriority` |
| Types, areas, outcomes, people | Lookups already used by 3b | `ListIncidentTypes`, `ListAreas`, `ListOutcomes`, `ListPersonnel{event_id, query}` |
| Live | Pokes per incident, per subscriber, privacy-filtered on the server | `WatchEvent` (09p) → the hub (09v) |
| Who may do what | `read_incidents`, `write_incidents`, `write_reports`, `attach_files`, `invite_reporters`, `read_incidents_via_grant` | `AccessForEvent` on `GetAuthStatus` |
| Private rows | Never reach a viewer who may not see them; the client infers nothing | `mayViewIncident` on every read and every poke |

Two consequences shape the table and are not up to the round:

1. **Filtering, sorting and search are client-side, over the whole list**, as the templ
   table does today. The templ page has run whole fairs this way; 09q's round ran at
   185 rows — a fair-scale Saturday evening — and found React Native Web's
   virtualization weak (156 of 185 rows in the DOM), a finding the table inherits:
   fixed-height rows and `getItemLayout`, or a windowed list, are a 3c.1 criterion,
   not a later optimisation. The table is a *view* over the cached
   list the Board already holds (`useIncidentsForBoard`), so a poke that patches the
   cache patches both, and dispatch never holds a second copy of the event.
2. **The multi-event search** (templ's `m`) is one `ListIncidents` per other event, run
   on demand, never on load. It is a feature of the search box, not of the table.

**Contract gaps found: none.** Two things are worth writing down as *not* gaps: there is
no server-side text search (the client has the whole list, so it needs none), and there
is no paging (the list is small, and paging would break "a poke patches a row").

## What the client is on a wide window today

Nothing. The route tree is one stack, `(app)/_layout.tsx` renders it the same at every
width, the Board is a `FlatList` of `WorkRow`s that stretches to the window, and 09k's
E15 — *"≥ 1024 px: sidebar + split list/detail, decided at the layout component, not per
screen"* — is a decision with no code behind it. So the round has a question the D1 round
did not: **what the shell is.** The Board decided what the phone's front door is; this
round decides what the laptop's is, and E15's "sidebar" is a starting position, not a
verdict.

The Board itself does not survive at dispatch width: it is the phone's answer, and
"mine" becomes one filter among the table's. Below the breakpoint the phone layout stays
exactly as 3b shipped it — a portrait tablet is a large phone; a landscape one is a
small laptop. The breakpoint is the E15 number, 1024 CSS px of window width, read in one
place.

## The prototype round (the maintainer's to run)

Dispatch is chosen (D0, [09o](09o-design-v0.md)); its tokens and primitives are the
material, and the round does not revisit them. **What is open is where an incident opens
from the table** — the one decision every later 3c slice inherits, because it fixes how
much width the table keeps, how much the editor gets, and what "back" means.

| Variant | Axis | The claim it makes | What it costs |
|---|---|---|---|
| **Split** | *Persistence* — the table is the workspace | Table left, the selected incident right, both always on screen; arrow keys walk the table and the pane follows. The plan's stated default (E15). The strongest answer to "keep an eye on everything while I work one". | Halves the table: at 1280 px the summary column is the first thing squeezed; the editor gets a phone's width and forty fields to fit in it |
| **Drawer** | *Focus* — the table is the backdrop | Table full width; a row opens the incident as a wide panel over the right two-thirds, the table dimmed but visible behind, `Esc` closes back to the same scroll and selection. | The panel hides most of the rows it claims to keep in view; live pokes to the table arrive behind a scrim; a second incident means closing the first |
| **Page** | *Sequence* — the table is a place you return to | Table full width; a row is a route (`/incidents/214`), the incident a full page with the table's filters and selection kept in the URL so back lands where you left. What templ does today, and what dispatch already knows. | Loses the table while editing; "what changed while I was in there" is a badge at best; the cheapest to build and the least redesign |

Every variant shows, with fixture data: **≥ 185 rows** (09q found the scale question
only by hitting it), a mix of open/closed and all three priorities, several types per
row, areas, private rows (the `restricted` tone), rows with four attached people and
rows with none, summaries long enough to truncate, one selected incident with a long
journal, the filter bar with a non-default state, a live poke patching a row **while a
different row is selected**, the empty filter result ("no open incidents" is a good
state at the end of a shift), and the keyboard walk `/` → type → `Enter` → `j`/`k` →
open → `Esc`. At **1024 and 1440 px**, both schemes, reduced motion on.

**How to run it:**

```
/prototype D2 — the dispatch table for plan 09i slice 3c.0 (docs/plans/09x-dispatch-design.md).
Three variants on the axes in that file's prototype-round table: Split, Drawer, Page.
Dispatch is already chosen — diverge on SHAPE, not colour; read tokens through useTheme()
and reuse the existing primitives. Do not modify src/design/* or the existing src/features/*.
Dev-only Expo Router route outside the session gates; ≥185 rows from src/test/fixtures.ts,
no server. One shared row component across the three so the comparison is about shape.
Motion: only PressFeedback and StateFade from src/design/motion.tsx — the pane, drawer and
page open as a hard cut; nothing enters with an animation on a list.
```

The in-code route (D0's route B, D1's too) is the recommendation: the keyboard walk and
the live-poke-behind-a-selection case can only be judged by running them, and the
primitives exist. Claude Design artboards (§6's route A) are fine for the shell and the
column layout if the maintainer prefers to iterate those on a canvas first; the pick
itself should be made on a running surface. The throwaway surface is deleted after the
pick, as 09q's was.

### What was built — the surface (2026-09-13)

`app/(dev)/dispatch.tsx` + `src/prototypes/dispatch/` (throwaway, outside the session
gates, no server, deleted after the pick). One `useDispatch` state machine (the URL codec,
the client-side filter/sort/search, the cached rows with pokes patched in, the keyboard
map), one `IncidentRow`, one `Table`, one `FilterBar`, one `IncidentPane`, one `Shell`;
the three variants differ only in what "open" means. Run it with
`pnpm -F @ocf-ims/interface start` and open `http://localhost:8081/dispatch?v=1`
(`1`/`2`/`3` or `←`/`→` flip the picker). The harness band above the stage takes the
shape-independent decisions: shell (sidebar / top bar), a fixed stage width (1024 / 1440 /
fit), scheme (light / dark / OS), rows (compact 33 px / comfortable 41 px), and the two
pokes (`p` another row, `P` the selected row). The query string is this brief's schema
verbatim plus `open=` (the Page variant's stand-in for the path segment) and the harness
keys `v`, `shell`, `w`, `scheme`, `density`; switching variants keeps the table's state, so
the comparison is about shape. The fixture event holds 196 incidents; #173 carries the
30-entry journal; `?state=closed&priority=high&days=1&q=zzz` is the empty result.

| Variant | Axis | When it is the right choice | Its cost, measured |
|---|---|---|---|
| Split | Persistence | The dispatcher works one incident while watching the rest | The pane takes 40 % (never under 360 px): at 1440 with the sidebar the table keeps 732 px and loses Type, Started and People; at 1024 with the sidebar it keeps 444 px — number, state, priority, summary only. The top bar gives the table 220 px back |
| Drawer | Focus | Reading and appending is the job; the table is context | The panel (66 %) covers the summary column and everything right of it; the filter bar stays live and a poke behind the scrim is visible only in the number / state / priority columns |
| Page | Sequence | The table is where you return to; the incident deserves the whole window | The table is gone while an incident is open; prev / next in the header (`j` / `k` too) is the only "what else is there" |

**Found by running it, not by reading it** (each is a 3c.1 criterion or a thing to verify):

1. **`router.replace` remounts the screen** — the search lost focus after one character,
   the scroll bookkeeping reset, the pokes vanished. Every in-place change is
   `router.setParams` (absent keys passed as `undefined` so a stale key clears); only
   the Page's open pushes.
2. **A push leaves the table screen mounted beneath the page**, so two keyboard
   listeners fired on every key and fought over the URL (Esc cleared the selection *and*
   went back). The map is gated on `useFocusEffect`. In 3c.1 the map lives in one place
   and is focus-gated, whatever the shape.
3. **A wrong first diagnosis, kept as a warning.** Before finding 2 was understood, the
   lost state after Esc looked like `router.back()` restoring the table route from a
   stale snapshot, and the surface briefly closed the page with `window.history.back()`.
   With the keyboard map focus-gated, `router.back()` restores the live params correctly
   and the surface uses it. Do not carry the snapshot theory into 3c.1.
4. **Windowing is fine with fixed rows**: 196 rows in the event, 64 in the DOM (33 px
   rows, a 900 px window, `windowSize` 5) — against 09q's 156 of 185 with variable rows.
   Fixed height + `getItemLayout` is enough; no windowed-list dependency needed.
5. **`onViewableItemsChanged` is not reliable on the web build** for "scroll only when
   the selection leaves the viewport"; the surface tracks `contentOffset` and the
   viewport height by hand and calls `scrollToOffset` — a click, a poke or a filter never
   moves the scroll, and a 30-row walk scrolls exactly enough.
6. **The hide rule is an order, not breakpoints**: people → started → types → area →
   changed, dropped one at a time until the summary keeps ≥ 200 px; number, state,
   priority and the summary never hide. The order is the round's to argue with.
7. **Enter on a focused chip toggles the chip** (React Native Web's `Pressable` handles
   the key before the window does), which is correct browser behaviour but surprised the
   scripted walk; the `?` sheet says shortcuts pause while a control has focus.

Defaults the surface took that the round can flip: the number column shows the bare
number under a `#` header (the phone and the radio say `#214`); Normal priority is an
empty cell; a private row carries its chip in the State column; Split's Enter puts the
cursor in the composer (the pane already follows the selection); Drawer walks with
`j` / `k` while open; the pane's fields are read-only with a line saying the editor is
3c.2's. Verified: typecheck, lint, Jest (39 suites), `export:web`, the smoke e2e, and a
scripted walk of `/` → type → Enter → `j` / `k` → Enter → Esc across all three variants
with no console errors. Reduced motion has nothing to drop: the only motion on the
surface is press feedback and the two `StateFade`s (the empty result, the help sheet).

### The pick (2026-09-13)

**Drawer, with the top bar, and the drawer opens the full page.** The maintainer's
reasons: the drawer keeps the table as the workspace without halving it, and the top bar
matches the templ interface dispatch already knows. The amendment: a row opens the
drawer (`sel=` + `open=` in the URL, set in place), and from the drawer a second Enter or
the "Full page" control pushes the incident as a full page — in 3c.1 the real route
`/events/:eventId/incidents/:number`, with the table's query carried in its search string
so back lands on the drawer, then on the table. The surface has this as `full=1`
(`Drawer.tsx`, `openFull` / the two-step `close` in `useDispatch.ts`), verified by a
scripted walk: Enter → drawer, Enter → full page, `j` walks the page, Esc → drawer, Esc →
table with the selection and search kept; a deep link straight into the full page
unsets it in place.

**Sidebar as a user setting?** Cheap in code — the shell is one component with one
switch, and a stored preference is a line in the person menu — but it doubles the surface
every later 3c round has to check (the roster, the dashboard, each at two shells), and
09o's rule against a user-facing scheme preference argues the same way here: one shell
until dispatch asks for the other. **Recommendation: 3c.1 ships the top bar only**; the
`Shell` switch stays in the promoted component so a setting is a 3c.6 line item if the
tent wants it, not a rewrite.

### Decisions the round must also take (shape-independent, but only visible when run)

- **The shell.** A left sidebar (event switcher at top; Incidents · Reports · Roster ·
  Dashboard · Alerts; the person and sign-out at the bottom) versus a single top bar
  with the same items. Judge it by what it costs the table: a 220 px sidebar on a
  1280 px laptop is a summary column.
- **The filter bar.** Toolbar chips above the table (state · priority · type · area ·
  person · mine · days · search) versus a facet column. Chips are the starting position;
  a facet column is a second sidebar and should have to earn it.
- **The columns and their widths.** Number (fixed, `ledgerColumn`), state, priority,
  types, area, summary (flexible, the one that yields), started, last modified, people.
  Which are hidden first at 1024, and whether the user can hide any.
- **Density.** One line per row is the claim of the direction ("the incident number is
  a column not a prefix"); the round decides the row height and whether a second line
  is ever allowed (a wrapped summary, or never).

## The rules the winner inherits (shape-independent)

### The URL is the state

Every filter, the sort, the search text and the selection live in the query string, so a
view is a link: a dispatcher pastes it into the radio log and the next shift opens the
same table. Precedence for the state filter: **URL > stored preference > default
(open)**; every other filter: URL > default. Schema (fixed now so 3c.1 does not invent
one):

```
/events/:eventId/incidents?state=open|closed|all&priority=high,normal&type=3,7
  &area=main-stage&person=42&mine=1&days=2&q=text&sort=started:desc&sel=214
```

Absent means default; `sel` is the selected incident and is the one key the Page
variant turns into a path segment. A bare integer in `q` plus `Enter` jumps to that
number (the templ behaviour); `/regex/` search syntax is carried.

### Live rows

A poke patches the affected row in the cached list — never a refetch of the table on a
single poke, never a lost selection, never a scroll jump. A `reload` poke refetches the
whole list and keeps selection and scroll if the row still exists. A poke for the
selected incident refetches the pane; the editor, when it comes (3c.2), never overwrites
an unsaved field.

### Keyboard

Dispatch works from the keyboard. Carried from templ: `?` help, `/` focus search, `n`
new incident, `m` multi-event search; on an incident: `a` focus the composer, `h` toggle
system entries; `Enter` vs `⌘/Ctrl+Enter` submit is a stored preference. Added: `j`/`k`
or the arrows move the selection, `Enter` opens, `Esc` closes or clears. Shortcuts are
suppressed while an input has focus. **Every shortcut has a visible affordance** — a
keyboard-only feature is not a feature — and the `?` sheet lists them. Focus is always
visible: the `focus` token, the same ring `Field` draws.

### The colour language, applied to a table

State and priority follow `DESIGN.md`'s language, unchanged: **Open** carries `info`
and is the only state with colour, **Closed** is neutral and recedes; **High** is
`danger`, **Low** neutral, **Normal** wears no badge; private is `restricted`, and the
label text is always present. Nothing new is introduced for the table;
if the round needs a colour the tokens lack, that is a finding for the brief, not a
literal in a prototype.

### Motion

The motion budget is press feedback (`DESIGN.md`). A pane swapping to another incident,
a drawer opening, a page pushing: **hard cuts, or `StateFade` at most.** Nothing on the
table enters with an animation. `/review-animations` runs before 3c.1 is called done.

### Privacy and gating

Rows arrive already filtered; the client renders what it is given and never decides
visibility. `write_incidents` gates `n`, the composer and every edit control;
`attach_files` gates uploads; the private toggle's disabled state is authoritative and
is the server's (admin or creator). A row the viewer holds via `read_incidents_via_grant`
looks like any other row.

### The phone is untouched

3c.1 adds a layout, not a screen: below the breakpoint the Board and the incident
screen render exactly as 3b shipped them, the tracer stays green, and nothing in
`src/features/board` or `src/features/incidents` changes behaviour. The wide layout is a
sibling, decided once, in one layout component (E15).

## 3c.1 acceptance criteria (the builder's list, after the pick)

Written 2026-09-13, the day of the pick. **The brief for the builder is this section plus
"The rules the winner inherits" above; the surface is the reference implementation of the
mechanics (the codec, the reducers, the scroll bookkeeping, the keyboard map) and the
promotion map below says what of it survives.** The pick: the Drawer with the top bar, and
a second Enter opens the full page. Reasons: the table stays the workspace without being
halved; the top bar is what dispatch knows from templ. Rule 2 applies: no contract gap is
expected (verified above); one found stops the builder and is filed in the slice notes.

### The shape

1. **One decision, one place.** `useLayoutMode()` (`src/features/shell/layoutMode.ts`)
   returns `"wide"` at a window width ≥ `wideBreakpoint` (a new token, 1024) and
   `"phone"` below, on every platform. Exactly two routes branch on it: the incidents
   index renders `DispatchScreen` inside `Shell` when wide and `BoardScreen` otherwise; the
   `[number]` route renders `IncidentPage` inside `Shell` when wide and `IncidentScreen`
   otherwise. Below the breakpoint nothing changes: no file under `src/features/board`
   changes, `IncidentScreen` gains one prop whose default is today's behaviour (criterion
   8), the phone tracer stays green.
2. **The shell is the top bar.** Promoted `Shell` keeps its `mode` switch but nothing in
   the UI sets `"sidebar"`. Items, as data: the event name (→ `/events`), **Incidents**
   (active), **Alerts** with the unread count (→ `/alerts`), the stream state (nothing while
   `useLiveEvent` is true, "Reconnecting…" when it is not — the client's first visible
   stream state; the phone still shows none), the person's name and **Sign out**, and
   **New incident** (→ `…/incidents/new`, shown only with `writeIncidents`). Reports, Roster and Dashboard are added by 3c.3–3c.5,
   one item each; a wide window has no reports list until 3c.3 and this is accepted.
3. **The table.** The surface's columns, labels, widths and order, with the widths moved
   into a `dispatch` block in `tokens.ts` (the only file that may hold them). One density:
   the surface's comfortable row, `rowHeight(lineHeight, spacing.md)`; the `Density` prop is
   dropped (a preference is a 3c.6 line item). The hide order is finding 6's, the summary
   never under 200 px, number / state / priority / summary never hidden; hidden columns
   are still searched. Fixed-height rows with `getItemLayout` and the by-hand scroll
   tracking of finding 5 — no windowed-list dependency. The header row is the sort
   affordance: a click sorts by `defaultDir`, a second click flips, the direction is
   visible, the summary header sorts too. The surface's defaults stand: the bare number
   under a `#` header, Normal an empty cell, the private chip in the State column,
   started / changed as `formatShortTime` in `src/lib/format.ts` renders them.
4. **Data.** `useIncidents(eventId)` as it is (the whole event, the 30 s poll), filtered,
   searched and sorted client-side by the promoted `applyQuery` over `IncidentView[]`;
   lookups from `useIncidentTypes()` and `useAreas(eventId, readAreas)`; `me` from the
   session as the Board reads it. **"Mine" is the Board's four rules** —
   `whyMineIncident(view, me) !== undefined` — not the surface's two. `useLiveEvent(eventId)`
   is held while the screen is mounted. No new RPC: the person chip's choices are the
   people who appear on any loaded row, sorted by label.
5. **The filter bar.** Chips: state (Open / Closed / All), priority, type, area, person,
   mine, days, and the search field; **Clear** appears when `isFiltered`. The empty result
   names what is filtered and offers Clear. The search filters as you type; a bare integer
   matches numbers by prefix and Enter opens that incident when it exists (templ's jump);
   `/re/` is a regex and a half-typed one matches nothing.
6. **The URL is the state**, per the schema above plus `open=`; **`full` is not a key** —
   the full page is the path segment. Every in-place change is `router.setParams` with the
   absent keys passed as `undefined` (finding 1); only the full page pushes. `open` implies
   `sel` (a link with `open=214` alone selects 214; a mismatch is normalised in place).
   The state filter's stored preference: `statePreference.ts`, pure over `AsyncStorageLike`
   like `features/events/selected.ts`; precedence URL > stored > default (open); the chip
   writes it, loading never rewrites the URL.
7. **Selection and the drawer.** A row click selects and opens; `j` / `k` and the arrows
   move `sel`, and move `open` with it while the drawer is open (the surface's walk). Esc
   in order: blur a focused input → close the help sheet → close the drawer → clear the
   selection → clear the search text. The drawer is the surface's panel: 66 % of the
   content width (a token), the scrim, the `borderStrong` left rule, `elevation[2]`, and a
   header with **Incidents** (closes), the number, prev / next among the visible rows, and
   **Full page**.
8. **The drawer's body is the 3b incident, not a second one.** `IncidentScreen` renders in
   the drawer without its own `ScreenHeader` — one new prop, default unchanged — with the
   journal, the people section, the attachments and the append composer exactly as the
   phone has them (`viewer_may_add_journal` gates the composer as it does there). Its
   callbacks: open incident → `open` in place; open report, file report, open attachment →
   push, as the phone's route does. Fields stay read-only; the editor is 3c.2.
9. **The full page.** Enter in the drawer or **Full page** pushes
   `/events/:eventId/incidents/:number` with the table's query (minus `sel` / `open`) as
   its search string. `IncidentPage` is the Shell, a page header (back word, prev / next
   over the carried query's visible rows in its sort, `j` / `k`) and the `IncidentScreen`
   body centred at `pageMaxWidth` (a new token, 720). Prev / next update the path segment
   in place with `setParams`; if that remounts the screen (finding 1 was about `replace`),
   report it — do not fall back to `replace`. Back is `router.back()` when the router can
   go back (the table beneath still holds `sel` and `open`, so back lands on the drawer),
   otherwise `dismissTo` the incidents list. A deep link with no query shows no prev / next.
10. **Live rows patch, they do not refetch.** In `features/live/hub.ts` an
    `INCIDENT_CHANGED` poke calls `GetIncident` for that number and writes the row into
    every cached `listIncidents` for the event with `setQueryData`: replace by number,
    insert when new, **remove on a not-found** (the incident became private to the viewer
    or was never theirs); system journal entries are stripped so the cache matches
    `excludeSystemEntries: true`; `GetIncident` answers an `IncidentView`, so
    `viewerMayAddJournal` comes with the row. The `getIncident`
    invalidation stays (the drawer refetches); the `listIncidents` invalidation on a single
    poke goes; the full refetch on reopen after a gap stays. Selection, scroll and the
    open drawer do not move (a test). `REPORT_CHANGED` is unchanged. **This file is
    shared with the phone: the architect reviews it line by line (rule 4)** and the
    existing `__tests__/features/live` suite must stay green.
11. **The keyboard map is one hook**, `useKeyboardMap`, web only, gated on `useFocusEffect`
    (finding 2), suppressed while an input has focus except Esc (which blurs it), ignoring
    modifier chords. Bound: `?` help sheet, `/` search, `j` / `k` / arrows, Enter (selection →
    open; drawer open → full page; nothing selected → first row), Esc (the chain above), `n`
    (→ `…/incidents/new`, only with `writeIncidents`), `a` (composer focus, drawer or page),
    `h` (the incident's existing system-entries toggle). **`m` is not bound** — the client
    has no multi-event search; 3c.6 decides. `p` / `P` die with the surface. Every binding
    has a visible affordance and a line in the `?` sheet; focus is the `focus` token ring.
12. **Every state is designed**: loading, error with retry and no-access reuse
    `src/features/shell/`; the empty filtered result is criterion 5's; the stream state is
    criterion 2's word in the shell. Reduced motion has nothing to drop: press feedback and the two
    `StateFade`s (the empty result, the help sheet) are the whole of the motion. No new
    dependency. `/review-animations` runs before the PR is called done.
13. **Privacy and gating** as the rule above: rows as given, `n` and the composer gated, a
    granted row indistinguishable but for its chip. No file in rule 3's list changes.
14. **The surface is deleted in the same PR**: `app/(dev)/dispatch.tsx` and
    `src/prototypes/`; nothing imports `@/prototypes`.
15. **`DESIGN.md` gains a short "The table" section** from this brief: one line per row,
    the row height, the number column, the hide order, what carries colour.
16. **Tests.** Jest, in `__tests__/features/dispatch/`: the codec (round-trip, absent means
    default, garbage dropped, `full` rejected); `applyQuery` (each filter alone, their
    union, mine by the four rules, days, the number prefix, the regex and the half-typed
    one); the sort (each key, `defaultDir`, the number tie-break); `columnsFor` at 1024,
    1280 and 1440 minus the shell; `neighboursOf` at both ends; the state preference's
    precedence; the hub patch (replace, insert, remove on not-found, entries stripped, no
    list refetch, the phone's suite still green); and a `DispatchScreen` render over
    `createRouterTransport` + `createFakeIms()`: rows, a chip writes its key, a poke keeps
    the selection, Enter opens the drawer with the incident's journal, no **New incident**
    without `writeIncidents`. Playwright: `e2e/dispatch.spec.ts` at 1440 × 900, gated like
    the tracer, walking sign-in → events → table → `/` type → Enter → `j` / `k` → Enter →
    Enter (page) → `j` → Esc → Esc → sign-out; the smoke and the phone tracer unchanged.
17. **The 09i §9 list passes** (`typecheck`, `lint`, `test`, `export:web`, `e2e`); hand checks
    on staging at 1024 and 1440 in both schemes, the poke-behind-the-drawer case among
    them.

### The promotion map

| Surface (`src/prototypes/dispatch/`) | Lands as | What changes |
|---|---|---|
| `state.ts` | `src/features/dispatch/query.ts` | Over `IncidentView[]`; `full` dropped; mine via `whyMineIncident` |
| `columns.ts` | `src/features/dispatch/columns.ts` | Widths read from `tokens.ts` |
| `IncidentRow.tsx` | `src/features/dispatch/IncidentRow.tsx` | `Density` dropped; takes an `IncidentView` |
| `Table.tsx` | `src/features/dispatch/Table.tsx` | The scroll bookkeeping intact; the header sorts |
| `FilterBar.tsx` | `src/features/dispatch/FilterBar.tsx` | Real lookups; the person chip from the rows |
| `neighbours.ts` | `src/features/dispatch/neighbours.ts` | As is |
| `useDispatch.ts` | `useDispatchQuery.ts` + `useKeyboardMap.ts` | Split; pokes, notices and the harness keys gone; `openFull` pushes the real route |
| `Overlays.tsx` | `src/features/dispatch/HelpSheet.tsx` | The `?` sheet only; the notice toast goes |
| `Shell.tsx` | `src/features/shell/Shell.tsx` | Items as props, real data, `onNotice` gone |
| `Drawer.tsx` | `src/features/dispatch/Drawer.tsx` | The panel and scrim; the body is criterion 8's |
| `IncidentPane.tsx`, `Split.tsx`, `Page.tsx`, `Picker.tsx`, `Harness.tsx`, `data.ts` | deleted | The pane is replaced by the 3b `IncidentScreen`; the fixtures by `createFakeIms()` |

New: `DispatchScreen.tsx`, `IncidentPage.tsx`, `statePreference.ts` (dispatch);
`layoutMode.ts` (shell); tokens `wideBreakpoint`, `dispatch.*` column widths,
`drawerShare`, `pageMaxWidth`. Edited: the two routes, `hub.ts` and its tests,
`IncidentScreen.tsx` (the header prop), `tokens.ts`, `DESIGN.md`, the client README (one
line: the wide layout). The slice runs well past the `Agent` ceiling of rule 5: **a fresh
Sonnet session with this section as the brief, one PR** — if the maintainer asks for a
stack, the seam is shell + table + URL + keyboard first, drawer + page + live patch second.

## Out of scope

- The editor's internals — every `IncidentUpdate` field, on-behalf-of, the strike, the
  attachments preview, print (3c.2, its own round).
- Report review, the roster, the dashboard (3c.3–3c.5, their own rounds; the round here
  only places them in the shell).
- A user-facing theme preference (templ has light/dark/auto; the client follows the OS,
  09o — revisit in 3c.6 if the list demands it).
- Web push on Expo web (3d.5, only if 3c.6 asks).
- Any proto change. None is needed.

## Verification (for the round)

`pnpm -F @ocf-ims/interface typecheck`, `pnpm lint`, `pnpm -F @ocf-ims/interface test`
unchanged and green with the throwaway surface in the tree; `export:web` builds; the
smoke e2e passes. Hand: the three variants at 1024 and 1440 px in both schemes, the
keyboard walk, the poke-behind-selection case, reduced motion. Nothing goes to staging.

## Checklist

- [x] Brief written; the contract verified; the URL schema fixed (2026-09-13)
- [x] The surface built, verified and the scripted walk green (2026-09-13)
- [x] The round run; the pick recorded here with its reasons (2026-09-13: Drawer + top bar + full page)
- [x] The 3c.1 acceptance criteria written (architect, 2026-09-13)
- [ ] The throwaway surface deleted; `/review-animations` on anything promoted (in the 3c.1 PR)

## Open questions

1. **Sidebar or top bar** — answered: the top bar (2026-09-13); the sidebar stays one
   prop away in the promoted `Shell`, a possible 3c.6 setting, not a 3c.1 feature.
2. **Tablets at 768–1023 px** — the phone layout, by the breakpoint rule. If the tent
   runs iPads in landscape (1024+) they get dispatch; portrait gets the phone. Confirm
   with dispatch before 3c.6.
3. **User-hideable columns** — answered: not in 3c.1. With the top bar, 1024 px keeps
   number, state, priority, summary, area and changed under the hide order; a preference
   is a 3c.6 line item if dispatch asks.
4. **The Board at ≥ 1024** — answered: it does not render there (mine is a filter,
   criterion 4). The unread watermark is not a column in 3c.1; if dispatch misses it,
   3c.6 books it.
5. **Selection in the URL vs the route** — answered by the pick: `sel=` and `open=` for
   the table and the drawer, the path segment for the full page; the full page carries
   the table's query in its search string.
