# Phase 7 — Dashboards & Metrics

> **Status:** ✅ Built. 7a (metrics API) shipped in PR #43; 7b (dashboard page +
> Chart.js) in PR #44. Scope locked 2026-06-16 (see Decisions). **Last updated:**
> 2026-06-16
>
> Management-facing reporting OCF will actually use (Maintainer ask). Builds on
> the Phase 4 domain model (categories, areas, outcomes) and the Phase 5e people
> work — all merged. Two slices, sequenced 7a → 7b; both land before the fair.
>
> **As-built notes (7b):** Chart.js v4.5.0 vendored via `fetchbuilddeps` →
> `web/static/ext/chartjs/chart.umd.min.js` (UMD global `Chart`), embedded in
> `web/static.go` and gated in `head.templ` behind a new `usesCharts` flag
> (added as a 4th `Head(...)` param; all callers pass `false` except the
> dashboard). The nav link (`active-event-dashboard`) reuses the People reveal
> rule from 6e — revealed in `ims.ts` only when an event is active AND the viewer
> is an admin, deliberately NOT tagged `.if-admin`. `dashboard.ts` stops on
> `!authInfo.admin` (the D3 gate). Server-side render is smoke-covered by
> `web.TestTemplEndpoints`; a `dashboard` Playwright spec was added (not in CI).

## 1. Objective & grounding

A read-only **dashboard** that summarizes the incidents of one event at a glance:
counts by category/type, a status overview, the busiest areas, and the
follow-up/closure picture. Audience is **management** (admins), not field users.

What the data already supports (verified 2026-06-16 — **no schema changes needed
for v1**):

- `INCIDENT` carries `STATE`, `PRIORITY`, `CREATED`/`STARTED`/`CLOSED` (Unix
  doubles), `OUTCOME` (nullable enum), `LOCATION_AREA_SLUG`, `LOCATION_BOOTH`
  (`store/schema/current.sql`).
- `INCIDENT_TYPE.GROUP` gives the four categories (`safety` / `conduct` /
  `operations` / `compliance`, plus ungrouped); `INCIDENT__INCIDENT_TYPE` joins
  incidents to their types.
- `CLOSED` is set when `STATE → closed` and cleared otherwise
  (`api/incident.go`), so **time-to-close = `CLOSED − CREATED`** is computable for
  closed incidents.
- Open follow-ups = `OUTCOME = 'follow_up_required'` and `STATE != 'closed'`.

What is **not** computable without new schema (explicitly out of v1): time-in-each
-state, SLA tracking, mean-time-to-first-response, escalation timing — none are in
the master-plan candidate list. State transitions are only reconstructable by
parsing `GENERATED` journal entries; we do **not** do that for v1.

There is no existing aggregation code and no charting library in the tree
(`fetchbuilddeps` pulls only jQuery, Bootstrap, DataTables, FlatPickr).

## 2. Decisions (locked 2026-06-16)

| # | Decision | Outcome |
|---|---|---|
| D1 | Build approach | **New server-side aggregation API + Chart.js.** A dedicated metrics endpoint runs `GROUP BY` queries; the page renders with Chart.js (added via `fetchbuilddeps`). Chosen over client-side aggregation of the existing incidents list — keeps the heavy lifting in SQL and gives real charts. |
| D2 | v1 metric set | **All four bundles:** (a) by category & type, (b) status overview (state / priority / open-vs-closed), (c) by area + ranked repeat-locations, (d) open follow-ups + average time-to-close. |
| D3 | Access | **Admin-only for v1, framed as a permission seam.** A single capability ("view dashboard") that today only admins hold: the API gates on `claims.PersonAdmin()` and the page/nav-link on `authInfo.admin`. It is deliberately **not** modelled as "this is an admin page" — when Phase 5 roles grow, this becomes a grantable global/role permission (e.g. a future `GlobalViewDashboard`, or per-event read), and only the gate check changes; the page does not move. See D4 for why placement matters here. |
| D4 | Placement & scope | **Regular event nav, not the Admin section.** A normal event-scoped page at `GET /ims/app/events/{eventName}/dashboard`, beside Incidents / Reports / White Bird Visits. Event scope comes from the **URL path + the existing nav event dropdown** (`pathIds.eventName`), exactly like those pages — so **no standalone event picker and no `localStorage`** (simpler than the Admin Areas pattern). All-time aggregate for the active event in v1. The nav link is shown **only to admins for now** (carries the `if-admin` class). Living in the regular section is the whole point of D3's seam: a future non-admin role can be granted access in place, with no relocation. |
| D5 | Date-range / per-day filtering | **Deferred past v1.** `by-day` is shown as a static series for the selected event; an interactive from/to filter is a later slice. |
| D6 | Chart.js delivery | **Vendored** like the other front-end deps — `fetchbuilddeps` downloads the UMD build into `web/static/ext/chartjs/`; `head.templ` loads it for the dashboard page only (mirroring the optional DataTables load). No npm/CDN at runtime. |

### Counting semantics (call out in the API + UI so numbers aren't misread)

- **An incident can have multiple types** → it can land in multiple categories.
  By-category and by-type counts therefore **sum to ≥ total incidents**. We count
  **distinct incidents per category/type** and label the charts "incidents with a
  type in this category", not "share of incidents".
- **By-area is clean** — each incident has at most one `LOCATION_AREA_SLUG`;
  incidents with no area fall under an "Unassigned" bucket. Repeat-locations =
  by-area sorted descending.
- **avg time-to-close** is over closed incidents only; show the N it averages.

## 3. Slices

Branch-per-slice, PR-per-slice, each independently green. 7b depends on 7a.

### 7a — Aggregation API (server-side)

**Plan.** One admin-only endpoint that returns every v1 metric in a single
payload, so the page does one fetch.

- **Route:** `GET /ims/api/events/{eventName}/metrics`, registered in
  `api/mux.go` with `LogRequest(false, …)` (read-only) and admin gating
  (`claims.PersonAdmin()`; 403 otherwise). Mirror an existing event-scoped read
  handler for the event-name → ID resolution.
- **Queries** (`store/queries.sql`, sqlc): a small family of `GROUP BY` queries,
  all filtered by `EVENT`, run concurrently in the handler —
  - `MetricsIncidentCountByState` — `GROUP BY STATE`
  - `MetricsIncidentCountByPriority` — `GROUP BY PRIORITY`
  - `MetricsIncidentCountByCategory` — join `INCIDENT__INCIDENT_TYPE` →
    `INCIDENT_TYPE`, `COUNT(DISTINCT INCIDENT_NUMBER) GROUP BY GROUP`
  - `MetricsIncidentCountByType` — same join, `GROUP BY INCIDENT_TYPE` (id+name)
  - `MetricsIncidentCountByArea` — `LEFT JOIN AREA`, `GROUP BY LOCATION_AREA_SLUG`
    (null → "Unassigned"), returns name for display
  - `MetricsOpenFollowUps` — rows where `OUTCOME='follow_up_required' AND
    STATE!='closed'` (number + summary, capped/ordered)
  - `MetricsTimeToClose` — `AVG(CLOSED - CREATED)` + `COUNT(*)` where
    `CLOSED IS NOT NULL`
  - `by-day`: aggregate in Go from the incidents' `CREATED` timestamps bucketed
    to **server-local calendar days** (avoids SQL tz-function portability; one
    pass over a lightweight `SELECT CREATED` or reuse of the state query). The tz
    used is the app's configured local zone — same one the UI already displays in.
- **JSON** (`json/`): a `Metrics` struct with `total`, `open`, `closed`, and the
  per-bucket slices (`[]{key,label,count}` shapes), `byDay []{date,count}`,
  `openFollowUps []{number,summary}`, `avgTimeToCloseSeconds *float64`, `closedCount`.
- **Tests:** `api/integration` — seed a handful of incidents across
  states/types/areas/outcomes and assert each bucket; assert non-admin → 403;
  assert multi-type incident counted once per distinct category.

### 7b — Dashboard page + Chart.js

**Plan.** A regular event-scoped page (D4), admin-gated for now (D3), four metric
sections.

- **Dep:** add Chart.js to `bin/fetchbuilddeps/fetchbuilddeps.go` (vendored UMD →
  `web/static/ext/chartjs/`); extend `head.templ` with an optional charts flag
  (mirror the DataTables conditional) and load it only for this page.
- **Route:** `GET /ims/app/events/{eventName}/dashboard` in `web/mux.go` via the
  same `AdaptTempl` + `eventName`-path wrapper the incidents/reports/visits app
  routes use (`web/mux.go:118` is the model).
- **Nav:** add an `active-event-dashboard` link to the event-links list in
  `web/template/nav.templ` (beside Incidents/Reports/Visits), tagged with the
  `if-admin` class so non-admins never see it. In `ims.ts` `setupNav` (~`:442`),
  set its `href` via `urlReplace(url_viewDashboard)` and reveal it **only when an
  event is active and the user is an admin** (the existing active-event links
  unhide unconditionally; this one additionally honours admin). `url_viewDashboard`
  joins the other `url_view*` template-injected URLs.
- **Templ:** `web/template/dashboard.templ` — `@Head("Dashboard | "+eventName,
  "dashboard.js", …)` with the charts flag, `@Nav(eventName)` (event-scoped, so
  the nav event dropdown shows), and four cards (category/type, status, areas +
  repeat-locations table, follow-ups + avg close). Model it on
  `web/template/incident.templ`'s shell, not `adminareas.templ` — there is **no**
  in-page event picker; the event comes from the URL.
- **TS:** `web/typescript/dashboard.ts` — `commonPageInit({eventName})`; redirect
  if not authenticated; **`if (!authInfo.admin)` → error + stop** (D3 gate — the
  one line that later swaps to a role check); read the event from
  `ims.pathIds.eventName`; fetch `/ims/api/events/{event}/metrics` once and render.
  Chart types: doughnut for category, bars for type/priority/area, line for
  by-day; tables for repeat-locations and open follow-ups (each row links to its
  incident page). No event picker / no `localStorage` (D4).
- **Tests:** Playwright smoke (page renders, a chart draws, a non-admin is
  refused) — not in CI, run locally. Logic-light page; the numbers are covered by
  7a's tests.

## 4. Sequencing & risk

7a before 7b (the page needs the endpoint). Both are independent of the remaining
Phase 5 slices (5b–5d) and of the 6a areas reseed — sequence freely around them.

Risk **Low–Med**. The aggregation queries are read-only and additive (no schema,
no migration). The two things to get right: the **multi-type/multi-category
double-count semantics** (documented above; covered by a test) and the **by-day
timezone** (use the app's configured zone, consistent with existing display). The
new vendored dependency (Chart.js) is the only build-surface change; isolated to
the dashboard page.

## 5. Exit criteria

- An admin, viewing an event, sees a **Dashboard** link in the event nav and
  opens it to: incidents by category & type, a status overview
  (state/priority/open-vs-closed), busiest areas with a repeat-locations ranking,
  open follow-ups, and average time-to-close — all for that event.
- Non-admins see **no** Dashboard nav link and cannot reach the page or the
  `/metrics` endpoint (403). The access gate is a single check, sited so a future
  Phase 5 role can be granted it without moving the page (D3).
- Counts are correct, including the multi-type/multi-category case, and the UI
  labels make the "≥ total" category counting unambiguous.
- `go test ./...`, generators (`sqlc`/`templ`/`tsgo`), and `go run
  bin/build/build.go` all green; new endpoint registered with `LogRequest`.

## 6. Deferred (post-v1)

- Interactive **date-range / per-day filtering** (D5).
- Cross-event / season-over-season comparisons.
- Operational SLA metrics needing new schema (time-in-state, time-to-first-
  response, escalations) — see §1.
- Export (CSV/PDF) of a dashboard view.
