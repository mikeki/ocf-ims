<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09x — D2 and slice 3c.0: Dispatch on a wide screen

> **Status:** **Picked 2026-09-13: Drawer, with the top bar, and the drawer opens the full
> page.** The surface is on branch `feat/09x-d2-dispatch-round`; the 3c.1 acceptance
> criteria are the next step (architect), then the surface is deleted.
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

## What 3c.1 receives after the pick

The architect turns the round into the 3c.1 acceptance criteria in this file, in the
09q form: the pick and its reasons, the shell, the column set with the hide order, the
filter set, the URL schema above (amended if the round found it wanting), the keyboard
map, the row component to promote from the throwaway surface, the files to create and
the tests (Jest for the filter/sort/search reducers and the URL codec; Playwright for
the keyboard walk against the export; the hosted tracer unchanged).

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
- [ ] The 3c.1 acceptance criteria written (architect)
- [ ] The throwaway surface deleted; `/review-animations` on anything promoted

## Open questions

1. **Sidebar or top bar** — answered: the top bar (2026-09-13); the sidebar stays one
   prop away in the promoted `Shell`, a possible 3c.6 setting, not a 3c.1 feature.
2. **Tablets at 768–1023 px** — the phone layout, by the breakpoint rule. If the tent
   runs iPads in landscape (1024+) they get dispatch; portrait gets the phone. Confirm
   with dispatch before 3c.6.
3. **User-hideable columns** — a stored preference is cheap; the round says whether
   1024 px needs it or a good hide order is enough.
4. **The Board at ≥ 1024** — this brief says it does not survive there (mine is a
   filter). If the round finds the Board's unread watermark is something dispatch wants
   as a column, that is a 3c.1 criterion, not a second screen.
5. **Selection in the URL vs the route** — answered by the pick: `sel=` and `open=` for
   the table and the drawer, the path segment for the full page; the full page carries
   the table's query in its search string.
