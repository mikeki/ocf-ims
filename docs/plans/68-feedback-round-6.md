# Phase 6 — Feedback round 6

Beta feedback, four independent items. Each slice below is sized to land as its
**own PR straight to master** (no stacking), continuing the round-5 letter
sequence (6k/6l/6m → **6n/6o/6p/6q**).

| Slice | Item | Size | Touches |
|---|---|---|---|
| **6n** | People tab: show **"admin"** in the Role column for admins | tiny | frontend only |
| **6o** | **Areas** → move into event scope, admin-only edit/create, **approve** writer quick-creates, link the 2 maps | large | schema + API + web + TS |
| **6p** | **Home page**: replace the "what's new" changelog with "what the system is **for**" (OCF) | small | one template (+ copy) |
| **6q** | **Sessions**: explain/curb the frequent logouts | small | mostly deploy config; optional code |

Suggested order: **6n** (warm-up) → **6p** → **6q** → **6o** (the big one).

---

## 6n — People Role column shows "admin" for admins

**Feedback:** *"In People tab, the Role column should display 'admin' for admins;
the role is worthless here."*

**Why it's right:** an admin has unrestricted access to every event
(`PERSON.IS_ADMIN`, admin-bypass in `lib/authz`), so the per-event
*participation_type* ("writer" / "reporter" / …) shown in the Role column is
meaningless — and misleading — for an admin.

**Current state (verified):**
- The Role cell is a participation dropdown rendered by
  `drawParticipationDropdown()` — `web/typescript/people.ts:462–515` — driven by
  the per-event `participation_type` field.
- `is_admin` is **already** delivered to admin viewers (`api/personnel.go:125–127,144`
  → `json/personnel.go` `is_admin` → `ims.ts` Personnel type → `people.ts`), and a
  small dark **"admin" pill already renders next to the person's name**
  (`people.templ:258`, `people.ts:345–347`).

**Change (frontend only):**
- In `drawParticipationDropdown()` (`people.ts`), early-return a **static "admin"
  label** (the existing dark pill style) in the Role cell when `person.is_admin`
  is true — i.e. don't render the participation `<button>`/dropdown for admins.
  The role is non-editable for admins (changing their per-event participation
  doesn't change their access).
- Keep the existing name-adjacent admin pill, or fold it into the Role column —
  **decision N1** below.

**Decision N1 — keep or move the admin badge?** Recommended: show **"admin" in the
Role column** (per the feedback) and **drop the now-redundant name-adjacent pill**
so admin appears once, in the column the user is reading. (Alt: keep both.)

**Test:** an admin row shows Role = "admin" (no dropdown); a non-admin row is
unchanged. No API/template structural change beyond the cell content.

---

## 6o — Areas into the event, admin-only, with approval of quick-creates

**Feedback:** *"Move the Areas tab into an event, similar to the People tab;
include links to the 2 maps above the list of areas. Areas should only be editable
and created by admins. Areas 'quick created' by a writer while writing an incident
should be approved by an admin."*

Four sub-parts: **(A) move the page into the event**, **(B) the 2 map links**,
**(C) admin-only direct edit/create**, **(D) approval workflow for writer
quick-creates.** Could ship as one PR or split A+B / C+D.

### Current state (verified)

- **API is already event-scoped:** `GET/POST /ims/api/events/{eventName}/areas`
  (`api/mux.go:379–397`, `api/area.go`). The **page** is *not*: it lives at the
  global `/ims/app/admin/areas` (`web/mux.go:104–106`, `template.AdminAreas(...)`
  — no `eventName` param) and uses its own localStorage event picker
  (`admin_areas.ts`, key `admin_areas_event`).
- **Permissions today** (`api/area.go`):
  - read areas → `EventReadAreas` OR `GlobalAdministrateAreas`
  - **create** (empty slug) → `GlobalAdministrateAreas` **OR `EventWriteIncidents`**
    ← this is the writer "quick-create" path
  - **update** (has slug) → `GlobalAdministrateAreas` only (already admin-only)
- **Schema** `AREA` (`00001_baseline.sql:333–348`): PK `(EVENT, SLUG)`, `NAME`,
  `PARENT_SLUG`, `SORT_ORDER`. **No** approved/status/created-by column.
- **Quick-create flow:** `incident.ts createLocationArea()` POSTs `{name, sort_order}`
  to the areas API; slug returned in `IMS-Area-Slug`. Allowed for `EventWriteIncidents`.
- **Pattern to mirror — People page in the event** (plan 62 / PR #42): event-scoped
  page `/ims/app/events/{e}/people` **and** global `/ims/app/admin/people`, same
  template taking an `eventName` param, nav link `active-event-people`
  (`nav.templ:163–165`), admin doorway in `adminroot.templ`. (Note People kept the
  **API** global with `?event=`; Areas' API is **already** path-scoped per event,
  so only the *page* needs the event doorway.)

### (A) Move the Areas page into the event

Mirror People:
- Add event-scoped page route `GET /ims/app/events/{eventName}/areas` in
  `web/mux.go`; give `template.AdminAreas` an **`eventName`** param and pass
  `@Nav(eventName)` so the event is pinned in nav.
- Keep the global `/ims/app/admin/areas` doorway (event picker, "— no event —")
  for cross-event admin work, exactly like People keeps `/admin/people`.
- Add an **"Areas"** nav link under the active event, admin-gated, next to
  `active-event-people` (`nav.templ`). Keep the "Event Areas" link in
  `adminroot.templ:44–46`.
- `admin_areas.ts`: when the URL carries an event (`ims.pathIds.eventName`), lock the
  picker to it (disabled), like `people.ts:155`; otherwise keep the picker.

### (B) The 2 map links above the area list

- Render two prominent links **above** the area list in `adminareas.templ`,
  opening in a new tab (`target="_blank" rel="noopener"`, they're PDFs):
  - **Operations map** — https://oregoncountryfair.net/wp-content/uploads/2024/03/2024-operations-map.pdf
  - **Peach Pit map** — https://www.oregoncountryfair.org/wp-content/uploads/2024/07/2024-PeachPit-Map.pdf
- **Decision M2 — hard-code vs. config?** These are year-stamped URLs (`2024-…`) that
  OCF will likely bump annually. Recommended: make them **env config**
  (`IMS_OPERATIONS_MAP_URL` / `IMS_PEACHPIT_MAP_URL` → `conf`, passed to the
  template, defaulting to the two URLs above) so the maps can be updated each year
  without a code change; hide a link if its URL is blank. (Alt: hard-code now, move
  to config later — simpler first PR.)

### (C) Admin-only create & edit

- Tighten the **create** path in `api/area.go`: a *direct* create from the Areas
  page requires `GlobalAdministrateAreas`. The writer `EventWriteIncidents` create
  is **not** removed — it becomes the *quick-create → pending* path (D). Distinguish
  them by **who** is calling (admin perm present?) and set the new approval flag
  accordingly; both still hit `create()`.
- Update is already admin-only — no change.
- Frontend: in `admin_areas.ts`, only show the create/edit controls when the viewer
  has `GlobalAdministrateAreas` (read-only otherwise).

### (D) Approval workflow for writer quick-creates

**Goal:** a writer can still drop in a missing area mid-incident (don't break that
flow), but it's **provisional** until an admin approves it.

- **Schema (new migration):** add `APPROVED boolean not null default 1` to `AREA`
  (existing rows + admin-created = approved). One logical change; goose Up/Down;
  bump `store/integration/migrate_test.go` version.
  - *Alt considered:* a `STATUS enum('pending','approved','rejected')`. Boolean is
    simpler and enough if **reject = delete** (below). **Decision D1.**
- **Queries (`queries.sql`):** `Areas` returns `APPROVED`; `CreateArea` sets it;
  add `ApproveArea` (set APPROVED=1) and `DeleteArea` (for reject). `sqlc generate`.
- **JSON (`json/area.go`):** add read field `Approved *bool` (`approved`).
- **API (`api/area.go`):**
  - `create()`: set `APPROVED = caller has GlobalAdministrateAreas` (admin → true;
    writer quick-create → false).
  - New admin-only actions: **approve** (flip to true) and **reject**. Reject =
    `DeleteArea`, **guarded**: refuse with 409 if an incident already references the
    area (incident→AREA FK from Phase 4), with a message to reassign first.
    **Decision D2** — reject semantics (delete-if-unreferenced vs. a `rejected`
    hidden state). Recommended: delete-if-unreferenced (simplest; pending areas are
    brand-new so usually unreferenced beyond the originating incident).
- **Visibility decision D3 — are pending areas selectable?** Recommended: **yes** —
  the writer needs the area *now*, so pending areas stay selectable in the incident
  area picker (`incident.ts`) but render with a **"(pending)"** marker; approval just
  clears the marker. (Alt: hide pending from everyone except admins → breaks the
  writer's own incident.)
- **Areas page UI (`adminareas.templ` / `admin_areas.ts`):** surface pending areas
  (a "Pending approval" group or a per-row badge + **Approve** / **Reject** buttons),
  admin-only.
- **Action log:** approve/reject are mutating → register `LogRequest(true, …)`.

**Tests:** api/integration — writer quick-create yields `approved=false`; admin
create yields `approved=true`; admin approve flips it; reject deletes (and 409s when
referenced); non-admin can't approve/reject/edit. migrate_test version bump.

---

## 6p — Home page: "what the system is for", not a changelog

**Feedback:** *"Update the home page — I keep landing on it via the URL and it still
hasn't been updated for OCF. We don't need a summary of what has changed, we mostly
need a summary of what the system is for."*

**Current state (verified):** `web/template/root.templ` (route `GET /ims/app`,
`web/mux.go:89–91`) shows an `<h1>Incident Management System</h1>`, a "Jump to the
current event" link, and a **"Summary of what's new in 2026"** bullet list that is
both a *changelog* and full of **Burning-Man-isms** that don't apply to OCF
(autopopulated "camp/art/MV" location data, "Green Dots", "White Bird Visit"
tracking — and Visits are disabled for 2026 anyway).

**Change (one template, copy-only):**
- Replace the "what's new in 2026" `<div>` with a short **"what the IMS is for"**
  description for OCF: e.g. *"The OCF Incident Management System is where Oregon
  Country Fair Rangers and coordinators log, track, and follow up on incidents and
  field reports during the Fair. Use it to record what happened, who was involved,
  and what was done — and to hand off open issues across shifts."* (Final wording —
  **open input P1**, OCF to confirm voice.)
- Keep the **"Jump to the current event"** link (it's rewritten to the active event
  by `root.ts` per #100/#101 — leave that logic).
- Remove the BRC-specific bullets entirely. No route/JSON/schema change.

---

## 6q — Sessions: why they time out so often, and how to curb it

**Feedback / question:** *"How long are the sessions open for? Sessions time out
regularly."*

### Answer (verified)

Two tokens (`conf/imsconfig.go:44–45`):
| Token | Default | Env override |
|---|---|---|
| Access token | **15 min** | `IMS_ACCESS_TOKEN_LIFETIME` (seconds) |
| Refresh token | **8 hours** | `IMS_TOKEN_LIFETIME` (seconds) |

The browser silently refreshes the access token ~10 s before it expires
(`lib/authz/accesstoken.go`, `ims.ts`), so the **15 min isn't the felt limit**. The
felt limit is the **refresh token**, and there are **three** reasons it bites on the
demo:

1. **The refresh token is NOT sliding.** It's valid for a fixed 8 h **from login**
   regardless of activity — so even an actively-used session is hard-cut at 8 h.
2. **`IMS_JWT_SECRET` defaults to a random value generated at each boot**
   (`conf/imsconfig.go` `JWTSecret: rand.Text()`). If it isn't set, **every server
   restart invalidates all tokens** → everyone is logged out.
3. The **demo `docker-compose.dev.yml` sets neither** `IMS_JWT_SECRET` nor
   `IMS_TOKEN_LIFETIME`. With air rebuilding on every code change **and** the
   **nightly 02:00 reboot** (see deployment notes), the random secret is regenerated
   constantly → frequent surprise logouts on top of the 8 h ceiling.

### Proposed fixes (in priority order)

1. **Deploy config (no code, biggest win):** set a **stable `IMS_JWT_SECRET`** and a
   longer **`IMS_TOKEN_LIFETIME`** (e.g. `604800` = 7 days, as in `.env.example`) on
   the demo/prod deployment so restarts and the nightly reboot stop nuking sessions.
   *This is an ops change on the host — needs the user to set it.*
2. **Sliding refresh (code, optional):** re-issue the refresh-token cookie on each
   successful `POST /ims/api/auth/refresh` (`api/auth.go:312–381`) so an active user
   is never cut mid-use; only true inactivity (no refresh within the window) logs
   them out. Keep an absolute cap if desired.
3. **Fail-loud secret (code, defensive):** at boot, **warn** (or refuse to start in a
   non-`dev` deployment) when `IMS_JWT_SECRET` is unset, so production never silently
   runs on a per-boot random secret. Prevents this class of bug recurring.

**Decision Q1:** which of 2/3 to include now vs. just do (1). Recommended: do **(1)**
immediately (config) and ship **(3)** (cheap guardrail); treat **(2)** sliding-refresh
as a small follow-up if 7-day tokens aren't enough.

---

## Verification (all slices)

- Build/codegen: `go run bin/build/build.go` (6o regenerates after migration +
  queries). Lint: golangci (`noinlineerr`, `misspell`); tsgo is the TS gate.
- Go tests `go test ./...`; integration `go test ./store/integration ./api/integration`
  (Docker). 6o: migrate_test version bump + area approval cases.
- Action log: 6o's approve/reject are new mutating endpoints → `LogRequest(true, …)`.

## Open inputs to confirm before/while coding
- **N1** — admin badge: Role column only, drop the name pill? (recommended yes)
- **M2** — the 2 map links (Operations + Peach Pit, URLs in §6o B): env-config or hard-coded?
- **D1/D2/D3** — approval schema (boolean vs enum), reject semantics, pending visibility
- **P1** — final home-page copy
- **Q1** — sessions: config-only now, or also sliding-refresh / fail-loud secret
