# Phase 6 — People page → event navigation (slice 6e)

> **Status:** ✅ Built (PR #42). **Last updated:** 2026-06-16
>
> **As-built notes (PR #42):** Shipped as designed (P1–P6). Neutral rename done
> (`adminpeople.templ`→`people.templ`/`template.People`, `admin_people.ts`→`people.ts`;
> no collisions). One deviation from §3: the `active-event-people` nav link is **not**
> tagged `.if-admin` — that class auto-unhides on every event-less admin page, which
> would surface the link with no event context. Instead `setupNav` reveals it only when
> an event is active **and** `authInfo.admin`, which satisfies "admins only, when an
> event is active." `commonPageInit()` takes no args (event read from
> `ims.pathIds.eventName`). Event doorway disables (locks) the picker pinned to the URL
> event. Playwright `people_event_nav` spec added (not in CI; run locally).
>
> Surface the People registry in the regular **event navigation** (beside
> Incidents / Reports / White Bird Visits), so people are seen as part of an event
> rather than only from the admin panel. The existing **Admin → People &
> Passwords** doorway is **retained** for global identity work (passwords, admin
> toggle, no-event bootstrap) — both doorways drive the **same page and API**.
> Admin-only for now; who-can-see-it is refined later. A front-end + routing
> change only — no schema, no API, no authz change. Builds directly on **5e.4**
> (the event-scoped admin People page, [`51-people-registry.md`](51-people-registry.md))
> and mirrors the dashboard placement decision in
> [`70-dashboards.md`](70-dashboards.md) (D3/D4).

## 1. Why & grounding

Identity is global but **participation is per-event** (wristband, participation
type live on `PERSON__EVENT`; 5e.1). The current admin People page
(`/ims/app/admin/people`) handles this with an in-page event picker that includes
a "— no event —" option (5e.4). In practice people are managed *in the context of
an event*, so the natural primary home is the event nav, where the event is
already established by the URL + the nav event dropdown — the same scoping the
Incidents / Reports / Visits pages use.

But some person operations are **genuinely global**, not event-scoped, and must
keep a home (the question that shaped this plan):

- **Password reset** — `POST /ims/api/personnel/{personId}/password`, gated on
  `GlobalAdministratePersonnel` (`api/password.go`, `api/mux.go:478`).
- **Admin toggle** — `POST /ims/api/personnel/{personId}/admin`, gated on
  `claims.PersonAdmin()` and refuses to clear the last admin (409)
  (`api/admin.go:62`, `api/mux.go:488`).
- **Handle / name / email / on-site / create-person** — global identity on
  `PERSON` (`api/person.go`).

These controls live on each **person row** in the all-people list, so they work
regardless of the selected event. They are kept reachable two ways (see P1/P5).

Verified current state (2026-06-16):

- **Route:** `GET /ims/app/admin/people` → `template.AdminPeople`
  (`web/mux.go:96`); linked from `web/template/adminroot.templ:54`.
- **Page:** `web/template/adminpeople.templ` + `web/typescript/admin_people.ts`.
  Carries its own event picker (`<select id="event-name">` with a "— no event —"
  option), `changeEvent()` / `reflectEventSelection()`, and a `localStorage` key
  `admin_people_event` (5e.4). Per-event sections in the Add/Edit modals show only
  when an event is selected.
- **Access:** page gated on `authInfo.canManagePersonnel`
  (`admin_people.ts:77`) = `GlobalAdministratePersonnel` (`api/auth.go:233`). The
  personnel API endpoints are independently gated on the same permission
  (`api/personnel.go:75`, `api/person.go`, `api/password.go`).
- **API is already event-aware:** `GET /ims/api/personnel?all=true&event=<name>`
  lists every person with the named event's wristband/participation badges
  (`api/personnel.go:68–86`); identity is global, those columns are per-event.
  **No API change is needed.**

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| P1 | Placement (event doorway) | **Add `GET /ims/app/events/{eventName}/people`** in the event nav as the primary, intuitive home. Event comes from the URL path + nav event dropdown (`pathIds.eventName`); the in-page picker is **pre-set to the URL event** (not a free chooser) when reached this way. Mirrors [`70-dashboards.md`](70-dashboards.md) D4. |
| P2 | Access ("just admins for now, refine later") | **Leave the authz gate exactly as-is** — page + API stay gated on `GlobalAdministratePersonnel` (`canManagePersonnel`). That *is* the refine-later seam (already delegatable to a future crew-leader role). The **event-nav link** carries the `if-admin` class so only admins see it for now; aligning the link's visibility to the actual capability is the later refinement. No authz code changes. |
| P3 | List scope on the page | **Keep listing all people** (global registry) with the selected event's participation badges, preserving 5e.4 behaviour and the search-first model — you must see everyone to attach someone to the event. A "this event only" filter toggle is **deferred**. |
| P4 | File / symbol naming | **Rename to neutral** `people.templ` / `people.ts` / `template.People` — the component now serves both an event and an admin doorway, so neither "admin" nor "event" prefix fits. *Check for collisions first* (the Phase 3 rename introduced `/people/` API fragments; this is a page, not an API route). Lower-churn alternative: keep `adminpeople.*`. Recommend the neutral rename. |
| P5 | Global doorway (decided after review — keep it) | **Retain `/ims/app/admin/people` and its `adminroot.templ` link** as the global/no-event entry. Same page + same API as P1 — *no duplication*. Reached this way, the page shows the picker defaulting to "— no event —" (today's behaviour, with `localStorage`), so global identity work (password, admin, create-with-no-event) and the **zero-events bootstrap** still have a UI path. The event-nav doorway (P1) is the new primary; this is the fallback for genuinely global work. |
| P6 | API stays global/query-scoped (do **not** convert to the path pattern) | Personnel is a **global collection**, not an event sub-resource — a person is not a child of an event (identity is global; only `PERSON__EVENT` is per-event). So the API correctly stays `/ims/api/personnel` with an **optional `?event=`** decoration, unlike `/ims/api/events/{e}/incidents`. The event-nav **page** URL (`/ims/app/events/{e}/people`) follows the path convention for nav-UX uniformity; the **API** it calls stays query-scoped. This page-URL-vs-API-URL asymmetry is **intentional and correct** — documented here so it isn't "fixed" later. |

### How one page serves both doorways

`people.ts` branches on whether `ims.pathIds.eventName` is present:

- **Event doorway** (`/ims/app/events/{e}/people`): use the URL event; the picker
  is locked/pre-set to it (or hidden, showing the event as fixed). Per-event
  Add/Edit sections always visible for that event.
- **Admin doorway** (`/ims/app/admin/people`): no URL event → today's behaviour:
  the picker (with "— no event —" + `localStorage`) and the show/hide of the
  per-event sections. Global identity work needs no event.

Both doorways hit the same `GET /ims/api/personnel?all=true[&event=…]` and the
same global per-person endpoints (P6), and both are gated on
`GlobalAdministratePersonnel` (P2).

## 3. Slice 6e — the work

One PR; no migration; no API/authz change.

- **Route:** add `GET /ims/app/events/{eventName}/people` in `web/mux.go` using
  the same `eventName`-path `AdaptTempl` wrapper as the incidents app route
  (`web/mux.go:118` is the model). **Keep** the `/ims/app/admin/people` handler
  (`web/mux.go:96`) — same template (P5).
- **Nav:** add an `active-event-people` link to the event-links `<ul>` in
  `web/template/nav.templ` (after White Bird Visits), tagged `if-admin`. In
  `ims.ts` `setupNav` (~`:442`), set its `href` via `urlReplace(url_viewPeople)`
  and reveal it **only when an event is active *and* the user is an admin** (the
  other active-event links unhide unconditionally; this one additionally honours
  admin, like the dashboard link in 7b). Add `url_viewPeople =
  "/ims/app/events/<event_id>/people"` (and the `people.js` static URL) to
  `web/typescript/urls.ts` beside the other `url_view*` constants. **Keep** the
  Admin → "People & Passwords" link in `adminroot.templ` (P5).
- **Templ:** rename to `people.templ` / `template.People` (P4); accept an
  **optional** `eventName` (event doorway passes it, admin doorway passes ""). On
  the event doorway use `@Nav(eventName)` so the event dropdown shows and lock the
  picker to it; on the admin doorway keep `@Nav("")` and the full picker.
- **TS:** rename to `people.ts` (P4); `commonPageInit({eventName})`; keep the
  existing `if (!authInfo.canManagePersonnel)` gate (P2); **branch on
  `ims.pathIds.eventName`** (see §2): when present, drive everything from the URL
  event and lock/hide the picker; when absent, keep `loadEventOptions`,
  `changeEvent`, `reflectEventSelection`, and the `admin_people_event`
  `localStorage` path unchanged. Always request
  `?all=true&event=<currentEvent>` when an event is in play.
- **Tests:** add a Playwright check for the event-nav doorway (URL-scoped, locked
  picker) and keep the admin-doorway spec (not in CI; run locally). No Go test
  changes expected — the personnel API and its `api/integration` tests are
  untouched. Run the full build/`go test ./...`/lint gate regardless (the route +
  templ/ts changes regenerate).

## 4. Sequencing & risk

Independent of the Phase 7 dashboard slices and of the remaining Phase 5 slices;
sequence freely. **Risk Low** — no schema, no API, no authz change; the surface is
one new route, one nav entry, and the page's doorway-aware scoping. Verify the
rename (P4) has no collisions and that the shared page behaves on both doorways.

## 5. Exit criteria

- An admin, viewing an event, sees a **People** link in the event nav and opens
  it at `/ims/app/events/{event}/people`, scoped to that event (locked picker);
  non-admins see no link and the page refuses them (the existing
  `GlobalAdministratePersonnel` gate, unchanged).
- **Admin → People & Passwords still works** as the global/no-event doorway:
  password reset, admin toggle, and create-with-no-event all function, including
  when zero events exist.
- Both doorways share one page + one API; per-event wristband/participation
  editing targets the in-context event; global identity editing works for any
  person from either doorway.
- The personnel API remains `/ims/api/personnel` with optional `?event=` (not
  converted to a path sub-resource) — P6.
- `go run bin/build/build.go`, `go test ./...`, and lint are green.
