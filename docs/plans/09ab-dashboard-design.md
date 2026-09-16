<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09ab — The 3c.5 round: the dashboard on a wide window

> **Status:** Brief written and the round surface built and walked in a browser
> 2026-09-15 (§ What was built); **Board picked 2026-09-16** (§ The pick); the 3c.5 acceptance criteria
> written the same day — the builders' brief.
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, §6 **D2**, the 3c.5 row and
> open question 3, the chart library) under
> [09-proto-connect-platform.md](09-proto-connect-platform.md)
> **Follows:** [09x](09x-dispatch-design.md) (the shell — 3c.1). Independent of 3c.2–3c.4;
> the rounds may run in any order.
> **Owner:** Design (the round, run by the maintainer) → Architect (this brief, the rules,
> the criteria after the pick) → Builder (3c.5).
> **The skills:** Emil Kowalski's skills govern all UI work — `prototype` for the round,
> `animate-expo` for anything that moves, `review-animations` before the PR is called done.
> The chart rules below follow the data-visualization method (form before colour, thin
> marks, one axis, text in text tokens, a table twin for every chart).
> **Last updated:** 2026-09-15

## Objective

The dashboard answers **"how is the fair going"** for the people running it: how many
incidents, how many still open, how fast they close, where and what kind, which follow-ups
are still owed. templ's page (plans 70 / 7b / 7c) is a Bootstrap grid: four stat tiles,
doughnuts for state and category, bars for priority, type, area and role, a line of
incidents per day, a busiest-locations table and an open-follow-ups table, a Refresh
button with "Last updated", an auto-refresh interval, charts that animate in place and
cards that glow when their data changed. Chart.js is vendored for it. The client has no
chart dependency and no SVG library.

**What is fixed:** the one read, who sees it, the refresh model, the forms each number
takes (§ The forms). **What is open is the page's shape** — what the reader sees first —
and, with it, 09i's open question 3: which chart library, if any.

## What is already true on the wire (verified 2026-09-15)

- `GetMetrics(event_id)` → `Metrics`: `total`, `open`, `closed` (open + closed = total);
  `by_state`, `by_priority`, `by_category`, `by_type`, `by_role`, `by_area` as
  `MetricCount` (`key` stable, `label` human, `count`); `by_day` as `MetricDay`
  (`date` YYYY-MM-DD in the server's zone, `count`); `open_follow_ups` as
  `MetricIncidentRef` (`incident_number`, `summary`); `avg_time_to_close_seconds`
  (unset when nothing is closed) over `closed_count`; `generated_at`.
- **Read the breakdowns as the proto says:** `by_state` and `by_priority` sum to `total`;
  `by_category` and `by_type` can exceed it (an incident carries several types);
  `by_area` partitions incidents; `by_role` partitions the roster, not incidents.
  `IncidentState` is Open / Closed only, so `by_state` repeats the Open and Closed tiles.
- The gate: `EventWriteIncidents` (writers, and admins through the bypass; plan 52d),
  PermissionDenied otherwise. The client's proxy is `access.writeIncidents`.
- The server caches the aggregate per event for a minute (7c); `generated_at` is the
  data's true age. The read is whole-event: **no date range on the wire.**
- `NO_SIDE_EFFECTS`, so a connect-query `useQuery` with `refetchInterval`.
- **No proto change is needed.**

## What the client is today

Nothing dashboard-shaped. The shell (`features/shell/Shell.tsx`) has Incidents and Alerts
(Reports and People arrive with 3c.3 / 3c.4). `Badge` tones carry the state and priority
colour language (Open `info`, Closed `neutral`, High `danger`, Low `neutral`); `figure` is
the tabular type step. No chart, SVG or canvas package is installed.

## The forms (fixed; the round shows them, does not vary them)

Form before colour, per number:

| The number | Its form | Not |
|---|---|---|
| Total, Open, Closed, Avg. time to close (of n) | **Stat tiles**, a KPI row; the value in proportional figures; "—" and "No incidents closed yet" when unset | A chart |
| `by_state` | **Nothing** — it is the Open and Closed tiles again | templ's doughnut |
| `by_priority` (3) | A **bar list**: High · Normal · Low, the bar in the priority tone, the count at the tip | A doughnut |
| `by_category` (≤ 6), `by_type` (≤ ~20), `by_area` (≤ ~90) | **Bar lists**, sorted by count, one series so **one colour** for every bar; the long tail past the top 10 folds into "N more" that expands in place | A doughnut, a rainbow, a value ramp |
| `by_day` | **Columns**, one per day, one colour, the latest day and the busiest day labelled, the rest on press / hover | A line (one series of counts per day is columns) |
| `by_role` | A **bar list** in ladder order (not sorted), the roster's own caption ("People, not incidents") | Mixed in with the incident breakdowns |
| `open_follow_ups` | A **list** of incident rows (number column + summary) that open the incident | A chart |

Every chart is also its table: a bar list prints the label and the count beside every bar,
so the bars are an addition to a table, never the only way to read a value; the columns
carry a "Table" word that swaps them for a two-column date · count list (a hard cut).

**Marks:** bars ≤ 24 px thick with a 4 px rounded data-end and a square baseline end; a
2 px gap between adjacent columns; gridlines, if any, hairline and `border`; labels and
counts in text tokens (`text`, `textMuted`), never the bar's colour; tabular figures in
count columns only.

**Colour:** the bars of a single-series list wear one token (`accent`-family, read through
`useTheme()`); priority bars wear the priority tones because priority already means those
colours everywhere else. No categorical palette is needed — **nothing on this page has
more than one series** — so no new token family is added; if a variant wants one it adds
the tokens to `tokens.ts` in the round and runs the palette validator on both schemes.

## The chart library (09i open question 3)

Recommendation: **no chart library.** Every form above is a bar or a column of one
series: a `View` whose width (or height) is a fraction of the largest count, with the
label and the count as `Text`. That renders identically on web and native, weighs
nothing, reads its colours and spacing from tokens, and is accessible as text. A line
chart — the only form that would need `react-native-svg` — is not on the page. If a
variant needs a curve, it installs `react-native-svg` in the round and says so; the pick
then settles the dependency. Victory Native (Skia; CanvasKit on web, megabytes of wasm)
and Chart.js in a WebView are rejected for a page of bars.

## The refresh model (fixed)

- A toolbar row above everything: **Refresh** (`refetch`), **Updated 2 min ago** from
  `generated_at` (the minute clock), **Auto-refresh**: Off · 30 s · 1 min · 5 min,
  remembered per device (AsyncStorage, `dashboard.autoRefresh`), default Off.
- A refetch **keeps the frame**: the previous numbers stay, nothing blanks, no skeleton.
  A failed refetch keeps the numbers and puts the error in the toolbar ("Couldn't
  refresh — Retry"), not over the page.
- **What changed.** templ glows the cards whose data changed. A glow is an animation, and
  DESIGN.md's motion budget is press feedback only. Recommendation: **a hard-cut mark** —
  a changed tile or card shows a small `info` dot beside its title until the next refresh
  (or 60 s), no animation. The round shows the mark; if the maintainer wants the glow, it
  is a DESIGN.md amendment first (decision 3).

## The prototype round (the maintainer's to run)

Dispatch is chosen; the forms and the refresh model are fixed. **What is open is the
order of attention** — what the reader sees first on a 1024 / 1440 screen — and the three
shapes below are the honest answers.

| Variant | Axis | The claim it makes | What it costs |
|---|---|---|---|
| **Board** | *Everything at once* — templ's grid done properly | The KPI row, then a two-column grid of cards (Priority · Category; Type · Area; Per day across both; Roles · Open follow-ups), every card the same chrome, the whole event on one 1440 screen with a short scroll. | Everything is the same weight, so nothing is first; at 1024 the grid is one long scroll of equal cards; Area's 90 bars need the fold. |
| **Tables** | *Numbers first* — the dispatch table's language | No cards: dense sections separated by hairlines, each breakdown a table (label · count · share · an inline bar in its own column), Per day as a strip of thin columns under the KPI row, Open follow-ups in the right column as a table of incident rows. The page reads like the incident table. | The least "dashboard" of the three; the bars are small and supporting; the most information per screen, the least at a glance. |
| **Shift** | *What needs action first* | A hero line: Open (the hero figure, ≥ 48 px) with Total / Closed / Avg. close as its caption; beside it the **Open follow-ups** list, the only thing on the page someone acts on. Below: Per day across the width. Then the breakdowns in a narrower secondary grid, collapsed to their top five with "N more". | It takes a view on what matters (open work and follow-ups); the breakdowns are a scroll away and shorter; Roles sits last. |

Every variant shows, with fixture data: an event with **~180 incidents over 8 days**
(the busiest day ~40), 31 open, the three priorities, 6 categories including
"Ungrouped", ~18 types, **~40 areas** with long names ("Main Stage — Back of House"),
the roster by rung (writers 6 · crew leaders 4 · reporters 31 · volunteers 12 ·
public 3), **9 open follow-ups**, avg. close 2 h 14 m over 149; **an empty event** (every
tile "—" or 0, no avg, the empty follow-ups line, no bars); **a refresh that changes three
numbers** (the changed marks); **a refresh that fails**; **auto-refresh at 30 s** ticking
against the fake; the viewer without `writeIncidents` (the Not found state and no shell
item). At **1024 and 1440**, both schemes, reduced motion on.

**How to run it:**

```
/prototype 3c.5 — the dashboard for plan 09i (docs/plans/09ab-dashboard-design.md).
Three variants on the axes in that file's prototype-round table: Board, Tables, Shift.
Dispatch is chosen, the forms and the refresh model are fixed — diverge on THE ORDER OF
ATTENTION, not on colour, the chart forms or the shell; read tokens through useTheme()
and reuse the existing primitives, Badge, ScreenHeader, the 3c.1 row language. No chart
library: bars and columns are Views. Do not modify src/design/* or the existing
src/features/*. Dev-only Expo Router route outside the session gates inside a shell copy
with a Dashboard item, at 1024 and 1440; fixtures plus createFakeIms() over the surface's
own runtime.ts (never @/test/harness — it breaks the browser), no server. Motion: only
PressFeedback and StateFade from src/design/motion.tsx; the changed mark is a hard cut.
Verify by loading the route in a browser with a clean console, not only the checks.
```

The surface lives at `app/(dev)/dashboard.tsx` + `src/prototypes/dashboard/` and is
deleted in the 3c.5 PR. The 09z / 09aa surfaces are the harness pattern (`Picker.tsx`
verbatim, the band, `runtime.ts`, the shell copy); the fake gains a `getMetrics`
override with a "next refresh changes" and a "next refresh fails" switch.

### What was built — the surface (2026-09-15)

`app/(dev)/dashboard.tsx` + `src/prototypes/dashboard/` (throwaway, outside the session
gates, no server, deleted in the 3c.5 PR). Run it with `pnpm -F @ocf-ims/interface start`
(never `CI=1`) and open `http://localhost:8081/dashboard?v=1` (`1`/`2`/`3` or `←`/`→`
flip the picker). The band takes the width (1024 / 1440 / fit), the scheme, the viewer
(writer; reporter — no `writeIncidents`), the event (Fair 2026; Empty event) and two
one-shot switches, "Next refresh changes three numbers" and "Next refresh fails".

The fixture is the brief's: 180 incidents over 8 days, 40 areas, 9 follow-ups, avg. close
2 h 14 m. The fake answers `GetMetrics` (the stock fake has none), PermissionDenied for the
reporter. `useMetrics.ts` (the read, `keepPreviousData`, `changedKeys` diffed between
successful answers and cleared on the next one or after 60 s) and `useAutoRefresh.ts` are
what the winner promotes; `StatTile`, `BarList`, `DayColumns`, `FollowUps` and `Toolbar`
are shared by all three variants, which differ only in layout.

Built by one builder Agent (96 calls / 203K) and a mark-spec fix pass on the same agent
(17 calls). **Walked in Chrome** at 1440 and 1024, light and dark: the three variants, the
changed marks after a refresh that moves open / one area / today, a failing refresh
(numbers kept, "Couldn't refresh — Retry" in the toolbar), the reporter (Not found, no
Dashboard item), the empty event — the console clean. No horizontal scroll at 1024.

**Found by running it, not by reading it:**

1. **The first cut broke the brief's own mark spec** and every check passed: eight
   per-day columns each filled a ~170 px slot, and the list bars filled their rows. A
   column is now 20 px centred in its slot on a hairline baseline with a day tick under
   each, and a list bar is 10 px in a 20 px row. **3c.5 criterion:** the column and bar
   thickness are named in the criteria as token values, and a spec asserts the column's
   width does not grow with the slot.
2. **Decision 2 has its evidence:** View bars and columns read as charts at both widths
   and in dark. No chart library, no SVG.
3. **A card directly inside a vertical `ScrollView` took its `flexBasis` as a height**
   (RN's basis follows the main axis), leaving empty space under Per day. The card sits in
   a row container as its siblings do.
4. **Normal priority has no tone** (it wears no badge anywhere), but a bar needs a colour.
   The surface uses `neutral`, the same as Low. **3c.5 criterion:** name Normal's bar
   colour explicitly.
5. **A failed first load is not the gate.** PermissionDenied renders Not found; any other
   failure with no data yet renders "Couldn't load" with Retry. **3c.5 criterion:** both
   copies, and a mid-session failure keeps the numbers (toolbar message only).
6. **Switching events must reset the diff**, or every card shows the changed mark. The
   surface keys the body by event.
7. **The hero figure has no type step:** Shift's Open is `title` × 2.25 through a token.
   If Shift wins, a `hero` step goes into `tokens.ts` with a DESIGN.md line, not a
   multiplier.
8. Shift's four-up grid truncated long area and type names in the side-by-side layout;
   its bar lists stack the label above the bar. The Board and Tables keep the side-by-side
   rows.
9. The gate maps onto the fake's existing `writeIncidents`, so unlike the roster round no
   `GetAuthStatus` override was needed.

Verified with the surface in the tree: typecheck, biome, Jest (50 suites, 365 tests),
`export:web` and the smoke e2e green; the route walked in Chrome with a clean console.

### The pick — Board (2026-09-16)

The maintainer picked **Board**: the whole event on one screen, every card the same
chrome — the shape dispatch already knows from templ, done in the client's language. The
decisions, as they stand: (1) wide only; (2) **no chart library** — the bars and columns
are Views (the round is the evidence); (3) the hard-cut changed mark, no glow;
(4) a follow-up opens the incident table with the incident in the drawer
(`…/incidents?open=N`); (5) Area shows its top 10 with "N more" expanding in place;
(6) Per day labels the latest and the busiest, the rest on hover / press. Tables and
Shift stay in the surface until the 3c.5 PR deletes it.

### Decisions the round must also take (shape-independent, but only visible when run)

1. **The phone.** E15's phone tabs have no Dashboard. Recommendation: **wide only**; a
   phone dashboard is a 3c.6 line item if dispatch asks.
2. **The chart library.** Recommendation above: none. The round confirms the View bars
   read as charts at both widths and in dark.
3. **What changed: the mark or the glow.** Recommendation: the hard-cut mark; the glow
   needs a DESIGN.md amendment by the maintainer first.
4. **Where a follow-up opens.** The incident table with the incident in the drawer
   (`/events/[eventId]/incidents?open=N`, 09x's URL state) — recommendation — or the full
   page. 09y finding 1 says a cold `open=` link must be verified on staging.
5. **Area's long tail.** Top 10 + "N more" expanding in place (recommendation), a
   scrolling card, or a search.
6. **Per day's labels.** The latest and busiest labelled, the rest on hover (web) and
   press (native) — or every day labelled when there are ≤ 10.

## The rules the winner inherits (shape-independent)

### Gating

The Dashboard item and the route need `access.writeIncidents`; without it the item is
absent and the route renders the Not found state (the server's PermissionDenied is the
boundary, never shown as a 403).

### Privacy

`open_follow_ups` carries a summary. The server already withholds nothing here because
the gate is event-wide write; if the gate ever widens (a crew leader's dashboard), the
follow-ups list must go through the incident visibility rule first. Recorded, not built.

### One read

`useMetrics(eventId)` — `GetMetrics` with `refetchInterval` from the preference, no
`refetchOnWindowFocus` storm (one refetch on focus, then the interval); the live stream's
pokes do **not** refetch the dashboard (the server caches for a minute anyway).

### Keyboard and motion

`r` refreshes, `?` help; press feedback only; the changed mark, the "N more" expansion and
the Table swap are hard cuts; reduced motion drops the press scale.

### The phone is not regressed

Nothing on the phone changes.

## 3c.5 acceptance criteria (the builder's list, after the pick)

Written 2026-09-16, the day of the pick. **The brief for the builder is this section plus
"The rules the winner inherits" above; the surface (`src/prototypes/dashboard/`) is the
reference implementation and the Board is the shape — copy its files into place and edit,
do not retype them.** Rule 2 applies: no contract gap is expected (the wire above is
verified); one found stops the builder and is filed in the slice notes. The slice is one
PR; it runs past the `Agent` ceiling with its specs, so it is **two builders in sequence**:
the first lands the data layer, the fake and the shared pieces (criteria 1–7); the second
the screen, the route, the shell item, the deletion and the specs (criteria 8–15).

### The data layer and the shared pieces (builder 1)

1. **`useMetrics(eventId, interval)`** lands as `src/features/dashboard/useMetrics.ts`,
   the surface's file: `useQuery(getMetrics, { eventId })` with `refetchInterval` from the
   preference (`false` when Off), `refetchOnWindowFocus: true`, `placeholderData:
   keepPreviousData`; exposes `metrics`, `refresh()`, `isRefreshing`, `lastError`
   (`AppError` of the last failed refetch while data is held; cleared on the next success)
   and `changedKeys` — the card keys whose data differs between the last two successful
   answers, cleared on the next success or after 60 s. Pokes from the live hub do not
   touch it.
2. **`useAutoRefresh()`** lands as `src/features/dashboard/useAutoRefresh.ts`: Off · 30 s ·
   1 min · 5 min, persisted under `dashboard.autoRefresh` through the app's storage
   helper (`@/api/persist`'s `AsyncStorageLike`, as other per-device preferences do — grep
   `statePreference.ts` in dispatch for the precedent), default Off, every read and write
   in try/catch.
3. **The fake** gains `GetMetrics` in `src/test/fakeIms.ts`: `fake.metrics` (a `Metrics`
   per event id, `undefined` → the empty aggregate), `behaviours.getMetrics` ("ok" /
   "unavailable" / "forbidden"), `getMetricsRequests`, `generated_at` set on each answer.
   `src/test/fixtures.ts` gains `makeMetrics(overrides)` built from the surface's
   `buildFairMetrics` (the 180-incident event) and `makeEmptyMetrics()`.
4. **`StatTile`** (`src/features/dashboard/StatTile.tsx`): label, value in **proportional**
   figures (never the tabular `figure` step), optional caption, "—" for an unset value,
   the changed mark: an `info` dot with `spacing.xs` from the label while its key is in
   `changedKeys`; a hard cut.
5. **`BarList`** (`src/features/dashboard/BarList.tsx`): rows of label · bar · count. The
   bar is a `View` `barThickness` tall (a `chart.barThickness` token = 10 in `tokens.ts`,
   the one token this slice adds, with `chart.columnWidth` = 20 and `chart.plotHeight` =
   160 beside it — the three named in DESIGN.md's new "Charts" paragraph), centred in a
   `spacing.xl` row, width `count / max` of the track, 4 px radius on the data end only;
   `color` a theme colour; `sorted`, `limit` with an "N more" `TextButton` expanding in
   place, `caption`. Labels and counts in `text` / `textMuted`; tabular figures in the
   count column only. Never truncates a label: the label column wraps.
6. **`DayColumns`** (`src/features/dashboard/DayColumns.tsx`): one `chart.columnWidth`
   column per `by_day` entry centred in an equal slot, `chart.plotHeight` tall, a hairline
   `border` baseline with the day-of-month under each column, the latest and the busiest
   day labelled above their columns, a press / hover readout line (date · count), a
   **Table** word swapping the chart for a date · count list (a hard cut). The container
   includes the tick band (no inner scroll).
7. **`FollowUps`** (`src/features/dashboard/FollowUps.tsx`): rows of `figure` number ·
   summary, press → `onOpen(number)`; "No follow-ups owed" when empty.

### The screen (builder 2)

8. **`DashboardScreen`** (`src/features/dashboard/DashboardScreen.tsx`) is the surface's
   Board: the toolbar (Refresh, "Updated n min ago" on a 30 s clock from `generated_at`,
   the auto-refresh chips, and "Couldn't refresh — Retry" in the toolbar on a failed
   refetch while the numbers stay), the KPI row (Total, Open, Closed, Avg. time to close
   "of n" / "No incidents closed yet"), then the two-column grid of cards: Priority
   (bars in the priority tones: High `danger`, Normal and Low `neutral`) · Category;
   Type (top 10) · Area (top 10, "Top 10 areas" caption); Per day across both; Roles
   (ladder order, "People, not incidents") · Open follow-ups. Cards are the same chrome
   (`surface`, `border` hairline, `radii.lg`, `spacing.lg` padding); a card in a
   vertical `ScrollView` is wrapped in a row (09ab finding 3). Below 1024 the grid is one
   column.
9. **The states.** Loading (`LoadingState`) only before the first answer; PermissionDenied
   → `EmptyState` "Not found" (never a 403 message); any other failure with no data →
   `EmptyState` "Couldn't load" with Retry; the empty event renders every card with its
   empty line. Switching events resets the diff (the body is keyed by event).
10. **The route** `app/(app)/events/[eventId]/dashboard.tsx`: inside `Shell` on a wide
    window; on a phone the same screen without the shell, one column, with a
    `ScreenHeader` back to the Board — wide only is the design decision, the URL still
    works. A follow-up opens `/events/[eventId]/incidents?open=N` (decision 4; the 3c.1
    drawer's URL state) — the builder verifies a cold `open=` load renders (09y
    finding 1) and files it if not.
11. **The shell item.** `Shell.tsx` gets **Dashboard** after Reports, shown when
    `access.writeIncidents`, active on the route; the item order Incidents · Reports ·
    People · Dashboard · Alerts stays whatever of them exist when this merges.
12. **Keyboard.** `r` refreshes, `?` opens the dashboard's own help sheet (a
    `HelpSheet` parameterised by its rows — the dispatch one is incident-worded; make
    `rows` a prop if 3c.3 has not already).
13. **Gating and privacy** per the rules above; no `refetchOnWindowFocus` storm (the
    interval alone re-arms after a focus refetch).
14. **The surface is deleted**: `app/(dev)/dashboard.tsx` and `src/prototypes/dashboard/`
    (Picker, Harness, Shell, Tables, Shift, data, fake, runtime with them); `Picker.tsx`
    is duplicated in the two other surfaces and is not this slice's to touch.
15. **Specs** in `__tests__/features/dashboard/`: `useMetrics` (interval on / off,
    `changedKeys` between two answers and cleared after 60 s under fake timers, a failed
    refetch keeps data and sets `lastError`), `useAutoRefresh` (persists, default Off,
    storage throwing), `BarList` (limit + "N more", never truncates), `DayColumns` (the
    two labels, the Table swap), `DashboardScreen` (the four states, the changed mark
    after a second answer, the failing refresh keeps the numbers, the follow-up press
    path, the reporter's Not found, the phone header) and the route's shell item
    (present for a writer, absent for a reporter). 09i §9 passes; `/review-animations`
    says Approve (the only motion is press feedback).

### The promotion map

| Surface (`src/prototypes/dashboard/`) | Lands as | What changes |
|---|---|---|
| `useMetrics.ts`, `useAutoRefresh.ts` | `src/features/dashboard/` | Storage through `@/api/persist`; the interval type exported |
| `StatTile.tsx`, `BarList.tsx`, `DayColumns.tsx`, `FollowUps.tsx`, `Toolbar.tsx`, `format.ts` | `src/features/dashboard/` | Sizes from the three `chart` tokens; `BarList` drops `stacked` (Shift's) |
| `Board.tsx` | `DashboardScreen.tsx` | The states, the route callbacks; the card wrapper row |
| `fake.ts` (`GetMetrics`) | `src/test/fakeIms.ts` | The behaviours and the request log |
| `data.ts` | `src/test/fixtures.ts` | `makeMetrics`, `makeEmptyMetrics` |
| `Harness.tsx`, `Shell.tsx`, `Picker.tsx`, `Tables.tsx`, `Shift.tsx`, `runtime.ts`, `types.ts`, `app/(dev)/dashboard.tsx` | deleted | |

## Out of scope

- A date range or per-day drill-down — the wire is whole-event (open question 1).
- Export, print, per-area pages.
- The crew leader's dashboard (the gate stays write).
- Any proto change.

## Verification (for the round)

`pnpm -F @ocf-ims/interface typecheck`, `pnpm lint`, `pnpm -F @ocf-ims/interface test`
unchanged and green with the surface in the tree; `export:web` builds; the smoke e2e
passes; **the route loaded in a browser with a clean console** at 1024 and 1440 on every
variant. Hand: the three variants in both schemes, the empty event, the changed refresh,
the failing refresh, auto-refresh, the gated viewer, reduced motion. Nothing goes to
staging.

## Checklist

- [x] Brief written; the contract verified; the chart-library question answered as a recommendation (2026-09-15)
- [x] The surface built, loaded in a browser, verified (2026-09-15; § What was built)
- [x] The round run; Board picked, the decisions recorded (2026-09-16; § The pick)
- [x] The 3c.5 acceptance criteria written (2026-09-16)
- [ ] The winner promoted, reviewed, the surface deleted — the 3c.5 PR

## Open questions

1. **A time window.** "Today" versus "the whole fair" is the filter a dashboard reader
   reaches for first, and the wire has none. A `GetMetricsRequest.since` (or a day key) is a
   small server slice; until then the per-day columns are the only time view.
2. **Is the dashboard a phone screen?** Recommendation: no (decision 1).
3. **The glow.** Only through a DESIGN.md amendment (decision 3).
