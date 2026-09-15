<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09ab — The 3c.5 round: the dashboard on a wide window

> **Status:** Brief written 2026-09-15; the round surface next, then the pick, then the
> 3c.5 acceptance criteria here.
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

_Written after the pick._

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
- [ ] The surface built, loaded in a browser, verified
- [ ] The round run; the pick, the reasons and the six decisions recorded
- [ ] The 3c.5 acceptance criteria written
- [ ] The winner promoted, reviewed, the surface deleted — the 3c.5 PR

## Open questions

1. **A time window.** "Today" versus "the whole fair" is the filter a dashboard reader
   reaches for first, and the wire has none. A `GetMetricsRequest.since` (or a day key) is a
   small server slice; until then the per-day columns are the only time view.
2. **Is the dashboard a phone screen?** Recommendation: no (decision 1).
3. **The glow.** Only through a DESIGN.md amendment (decision 3).
