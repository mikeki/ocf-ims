# Phase 6 — People page → event navigation (slice 6e)

> **Status:** Plan — for review. **Last updated:** 2026-06-16
>
> Move the People registry page out of the Admin section and into the regular
> **event navigation** (beside Incidents / Reports / White Bird Visits), so people
> are seen as part of an event rather than buried in the admin panel. Admin-only
> for now; who-can-see-it is refined later. A front-end + routing change only — no
> schema, no API, no authz change. Builds directly on **5e.4** (the event-scoped
> admin People page, [`51-people-registry.md`](51-people-registry.md)) and mirrors
> the dashboard placement decision in [`70-dashboards.md`](70-dashboards.md) (D3/D4).

## 1. Why & grounding

Identity is global but **participation is per-event** (wristband, participation
type live on `PERSON__EVENT`; 5e.1). The current admin People page
(`/ims/app/admin/people`) handles this with an in-page event picker that includes
a "— no event —" option (5e.4). In practice people are managed *in the context of
an event*, so the natural home is the event nav, where the event is already
established by the URL + the nav event dropdown — the same scoping the Incidents /
Reports / Visits pages use.

Verified current state (2026-06-16):

- **Route:** `GET /ims/app/admin/people` → `template.AdminPeople`
  (`web/mux.go:96`); linked from `web/template/adminroot.templ:54`.
- **Page:** `web/template/adminpeople.templ` + `web/typescript/admin_people.ts`.
  Carries its own event picker (`<select id="event-name">` with a "— no event —"
  option), `changeEvent()` / `reflectEventSelection()`, and a `localStorage` key
  `admin_people_event` (5e.4). Per-event sections in the Add/Edit modals show only
  when an event is selected.
- **Access:** page gated on `authInfo.canManagePersonnel`
  (`admin_people.ts:77`), which is `GlobalAdministratePersonnel`
  (`api/auth.go:233`). The personnel API endpoints are independently gated on the
  same permission (`api/personnel.go:75`, `api/person.go`, `api/password.go`).
- **API is already event-aware:** `GET /ims/api/personnel?all=true&event=<name>`
  lists every person with the named event's wristband/participation badges
  (`api/personnel.go:68–86`); identity is global, those columns are per-event.
  **No API change is needed** — the page simply always passes the URL event.

## 2. Decisions (proposed)

| # | Decision | Recommendation |
|---|---|---|
| P1 | Placement & event scoping | **Move to `GET /ims/app/events/{eventName}/people`** in the event nav. Event comes from the URL path + nav event dropdown (`pathIds.eventName`) — **drop the in-page event picker, the "— no event —" option, and the `localStorage` key**. The per-event Add/Edit sections are now always shown (an event is always present). Mirrors [`70-dashboards.md`](70-dashboards.md) D4. |
| P2 | Access ("just admins for now, refine later") | **Leave the authz gate exactly as-is** — page + API stay gated on `GlobalAdministratePersonnel` (`canManagePersonnel`). That *is* the refine-later seam (already delegatable to a future crew-leader role). The **nav link** carries the `if-admin` class so only admins see it for now; aligning the link's visibility to the actual capability is the later refinement. No authz code changes in this slice. |
| P3 | List scope on the page | **Keep listing all people** (global registry) with the current event's participation badges, preserving 5e.4 behaviour and the search-first model — you must see everyone to attach someone to the event. A "this event only" filter toggle is **deferred**. |
| P4 | File / symbol naming | **Rename** `adminpeople.templ`→`eventpeople.templ`, `admin_people.ts`→`event_people.ts`, `template.AdminPeople`→`template.EventPeople` for accuracy (it's no longer an admin-section page). *Check for name collisions first* (the Phase 3 rename introduced `/people/` API fragments; this is a page, not an API route). Lower-churn alternative: keep the file names. Recommend the rename — it's a deliberate move and the names would otherwise mislead. |
| P5 | Old admin URL | **Remove** `/ims/app/admin/people` and its `adminroot.templ` link. A redirect can't preserve the target (the old URL has no event to scope to), so stale bookmarks 404 — acceptable for an internal, pre-fair tool. |

### The one real behavioural change (call out)

Today you can land on the People page with **no event** selected to do purely
global identity work (create a person, reset a password, toggle admin) without
any event in mind. After the move you are **always within an event context** — but
that loses nothing: the list still shows *all* people globally, and every
person's global identity (handle, name, email, password, admin, on-site) remains
editable from there. You just reach it by being in *some* event, which OCF always
has. No global-only entry point is retained (P5).

## 3. Slice 6e — the move

One PR; no migration; no API/authz change.

- **Route:** add `GET /ims/app/events/{eventName}/people` in `web/mux.go` using
  the same `eventName`-path `AdaptTempl` wrapper as the incidents app route
  (`web/mux.go:118` is the model); remove the `/ims/app/admin/people` handler
  (`web/mux.go:96`).
- **Nav:** add an `active-event-people` link to the event-links `<ul>` in
  `web/template/nav.templ` (after White Bird Visits), tagged `if-admin`. In
  `ims.ts` `setupNav` (~`:442`), set its `href` via `urlReplace(url_viewPeople)`
  and reveal it **only when an event is active *and* the user is an admin** (the
  other active-event links unhide unconditionally; this one additionally honours
  admin, like the dashboard link in 7b). Add `url_viewPeople =
  "/ims/app/events/<event_id>/people"` (and the `people.js` static URL) to
  `web/typescript/urls.ts` beside the other `url_view*` constants.
- **Admin section:** delete the "People & Passwords" link from
  `web/template/adminroot.templ` (`:54`).
- **Templ:** rename to `eventpeople.templ` / `template.EventPeople` (P4); take
  `eventName` like `incident.templ`; `@Nav(eventName)` (so the event dropdown
  shows); **remove the event-picker markup** and the "— no event —" option; the
  per-event Add/Edit sections become always-visible.
- **TS:** rename to `event_people.ts` (P4); `commonPageInit({eventName})`; keep
  the existing `if (!authInfo.canManagePersonnel)` gate (P2); read the event from
  `ims.pathIds.eventName` instead of the picker; **remove** `loadEventOptions`,
  `changeEvent`, `reflectEventSelection`, and the `admin_people_event`
  `localStorage` logic; always request `?all=true&event=<urlEvent>`; the per-event
  sections are always shown with the URL event's name.
- **Tests:** update the Playwright people spec to the new URL and the removed
  picker (not in CI; run locally). No Go test changes expected — the personnel
  API and its `api/integration` tests are untouched. Run the full
  build/`go test ./...`/lint gate regardless (the route + templ/ts changes
  regenerate).

## 4. Sequencing & risk

Independent of the Phase 7 dashboard slices and of the remaining Phase 5 slices;
sequence freely. **Risk Low** — no schema, no API, no authz change; the surface is
one route, one nav entry, and the page's own scoping. The only thing to verify is
that nothing else linked to `/ims/app/admin/people` (grep before deleting) and
that the rename (P4) has no collisions.

## 5. Exit criteria

- An admin, viewing an event, sees a **People** link in the event nav and opens
  it at `/ims/app/events/{event}/people`; non-admins see no link and the page
  refuses them (the existing `GlobalAdministratePersonnel` gate, unchanged).
- The page scopes to the URL event with no in-page picker; per-event
  wristband/participation editing targets that event; global identity editing
  still works for any person.
- `/ims/app/admin/people` and its admin-root link are gone; no dangling
  references remain.
- `go run bin/build/build.go`, `go test ./...`, and lint are green.
