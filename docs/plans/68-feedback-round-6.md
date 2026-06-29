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

**Change (frontend only) — decided N1:**
- **Move the word "admin" into the Role column.** In `drawParticipationDropdown()`
  (`people.ts`), early-return a **static "admin" pill** (the existing dark-pill
  style, text "admin") in the Role cell when `person.is_admin` — i.e. don't render
  the participation `<button>`/dropdown for admins (their per-event participation
  doesn't change their access, so it's non-editable).
- **Keep a badge next to the name, but as an icon, not the word.** Replace the
  name-adjacent `admin` text pill (`people.templ:258`, shown via `people.ts:345–347`)
  with a small **icon** (e.g. Bootstrap Icons `shield-fill` / `shield-lock-fill` /
  `star-fill`, with a `title="Admin"` tooltip). The app already uses inline
  Bootstrap-Icons SVGs via the sprite in `nav.templ` (`<svg class="d-none">` symbols
  referenced with `<use>`); add the chosen symbol there and `<use>` it in the badge.
- Net effect: the word "admin" appears once (in the Role pill), and the name still
  carries a compact admin marker as an icon.

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
- **Decided M2 — hard-code for now.** Put the two URLs straight in `adminareas.templ`.
  (They're year-stamped `2024-…`, so a future PR can lift them to env config when OCF
  bumps them; not worth the plumbing yet.)

### (C) Admin-only create & edit

- Tighten the **create** path in `api/area.go`: a *direct* create from the Areas
  page requires `GlobalAdministrateAreas`. The writer `EventWriteIncidents` create
  is **not** removed — it becomes the *proposal* path (D). Distinguish them by **who**
  is calling (admin perm present?) and set the new `APPROVED` flag accordingly; both
  still hit `create()`.
- Update is already admin-only — no change.
- Frontend: in `admin_areas.ts`, only show the create/edit controls when the viewer
  has `GlobalAdministrateAreas` (read-only otherwise).

### (D) Writer proposals & admin resolution

**Decided model:** a non-admin **writer proposes** a new place name; an **admin
resolves** each proposal in the Areas tab by **editing**, **approving**, or **marking
it a duplicate and linking it to an existing area**.

**Who proposes, and from where:**
- **Within an incident** — the existing `incident.ts` quick-create
  (`createLocationArea()`, gated on `EventWriteIncidents`) now creates a **proposed**
  (un-approved) area, immediately usable on that incident so the writer isn't blocked.
- **In the Areas tab** — a writer gets a **"Propose a new area"** control (same
  `EventWriteIncidents` gate) that creates a proposed area. (Admins on the Areas page
  create *approved* areas directly — see (C).)

**Schema (new migration):** add `APPROVED boolean not null default 1` to `AREA`
(existing rows + admin-created = approved; a proposal = `0`). Also add
`PROPOSED_BY_PERSON_ID integer null` FK `PERSON` so the admin sees **who** proposed
it (and a future notification can ping them when it's resolved) — **decision D-opt**,
recommended (cheap). One logical change; goose Up/Down; bump `migrate_test`.

**Pending stays selectable (decision D3 = yes):** a proposal is usable on incidents
right away, shown with a **"(proposed)"** marker in the area picker until resolved.

**Admin resolution actions (Areas tab, admin-only), per proposed area:**
1. **Edit** — fix name / parent / sort order (existing admin-only `update()`; slug
   stays immutable). Editing alone doesn't approve.
2. **Approve** — flip `APPROVED = 1`; the "(proposed)" marker clears everywhere.
3. **Mark as duplicate → link to an existing area** — admin picks the canonical area;
   the proposal is **merged into it**: transactionally re-point every reference from
   the proposed slug to the canonical slug (incident→AREA FK, Phase 4), then delete
   the proposed row. A bad-but-duplicate proposal is *linked*, not just discarded, so
   the incident keeps a valid area. (This replaces the earlier "reject" idea.)

**API (`api/area.go`):**
- `create()` sets `APPROVED = caller-has-GlobalAdministrateAreas` (admin → approved;
  writer proposal → not approved) and records `PROPOSED_BY_PERSON_ID` (D-opt).
- New admin-only actions: **approve** (flip flag) and **merge-duplicate** (re-point
  refs + delete), both `GlobalAdministrateAreas`. Edit = existing `update()`.
- All mutating → `LogRequest(true, …)`.

**Queries (`queries.sql`):** `Areas` returns `APPROVED` (+ proposer); `CreateArea`
sets approved/proposer; add `ApproveArea`, `RepointIncidentsArea` (the merge UPDATE),
`DeleteArea`. `sqlc generate`.

**JSON (`json/area.go`):** add read `Approved *bool` (`approved`) and a small proposer
`{handle, name}`.

**Areas page UI (`adminareas.templ` / `admin_areas.ts`):** a **"Proposed"** group /
per-row badge for un-approved areas. **Writers** see it read-only plus the "Propose"
control; **admins** get **Edit / Approve / Mark duplicate** (the last opens an
existing-area combobox — reuse the shared picker).

**Open decisions:**
- **D1** — `APPROVED` boolean (recommended) vs. a `STATUS` enum. Boolean suffices:
  "duplicate" resolves by merge+delete, so no persisted rejected/duplicate state.
- **D-opt** — record `PROPOSED_BY_PERSON_ID` (recommended yes).

**Tests (api/integration):** writer proposal → `approved=false`; admin create →
`approved=true`; admin approve flips it; mark-duplicate re-points an incident's area to
the canonical and deletes the proposal; non-admin can't approve/merge/edit.
migrate_test bump.

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
  description for OCF (decided P1): *"The OCF Incident Management System is where
  Oregon Country Fair Rangers and coordinators log, track, and follow up on incidents
  and field reports during the Fair. Use it to record what happened, who was involved,
  and what was done."*
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

### Why two tokens (and could we collapse to one)? — Q1

This is the standard JWT access/refresh split, and the two tokens do different jobs:

- **Access token** — short-lived (15 min), sent on **every** API request, stored in
  `localStorage` (readable by JS). The server trusts its signature and **does not hit
  the DB** to authorize each request — that's what makes requests cheap. It carries
  the user's identity **and current permissions** (admin flag, per-event access).
- **Refresh token** — long-lived, stored in an **HttpOnly cookie** (JS *cannot* read
  it, so it's much harder to steal), used **only** at `POST /ims/api/auth/refresh` to
  mint a fresh access token.

Three reasons the split is worth keeping:
1. **Security vs. UX, which a single token can't satisfy at once.** One token would
   have to be either long-lived (great UX, but if the `localStorage` copy leaks the
   attacker has a long window) **or** short-lived (safe, but you'd re-login every 15
   min). Two tokens give both: short blast-radius on the bearer token, long session
   on the well-protected cookie.
2. **Fresh permissions without a per-request DB lookup.** Each refresh re-reads the
   user's current roles/admin flag from the DB and bakes them into the next access
   token, so a granted/revoked permission takes effect within ~15 min — while normal
   requests stay DB-free. A single long-lived token would carry stale permissions
   until it expired.
3. **Revocation.** The HttpOnly refresh cookie is the thing the server can stop
   honoring (e.g. on logout); the access token just self-expires fast.

**Could we use one token?** Yes, mechanically — but it wouldn't fix the logouts (those
are caused by the items above, *not* by having two tokens) and it would cost us the
leak-window protection and the ~15-min permission freshness. **Recommendation: keep
two tokens.** The felt problem is entirely the refresh-token lifetime + the per-boot
secret, addressed below.

### Fix (decided Q1): deploy config only — no code this round

Keep the two-token design. Curb the logouts purely with deployment config:

1. **Stable `IMS_JWT_SECRET`** — so restarts (air rebuilds + the nightly 02:00 reboot)
   stop invalidating every session. **Must not be committed** — set it on the host
   (gitignored `.env` / host environment, referenced from `docker-compose.dev.yml`
   like the DB creds are: `IMS_JWT_SECRET: "${IMS_JWT_SECRET:?…}"`). Generate once,
   keep stable.
2. **`IMS_TOKEN_LIFETIME=604800`** (7 days, as in `.env.example`) — the refresh token
   is still non-sliding, but 7 days is long enough that the fixed window stops being
   the felt limit. This value is non-secret, so it **can** be added to
   `docker-compose.dev.yml`'s `environment:` directly.

So 6q is mainly an **ops change the user makes on the host** (the stable secret); the
only repo change is wiring `IMS_TOKEN_LIFETIME` (and a `${IMS_JWT_SECRET}` reference)
into the demo compose.

**Deferred (not this round):** sliding-refresh (re-issue the refresh cookie on each
`/auth/refresh`) and a boot-time fail-loud/refuse-to-start when `IMS_JWT_SECRET` is
unset in a non-`dev` deployment. Revisit only if 7-day tokens still aren't enough.

---

## Verification (all slices)

- Build/codegen: `go run bin/build/build.go` (6o regenerates after migration +
  queries). Lint: golangci (`noinlineerr`, `misspell`); tsgo is the TS gate.
- Go tests `go test ./...`; integration `go test ./store/integration ./api/integration`
  (Docker). 6o: migrate_test version bump + area approval cases.
- Action log: 6o's approve/reject are new mutating endpoints → `LogRequest(true, …)`.

## Decisions (all resolved — ready to implement)
- **N1** ✅ — word "admin" moves to the Role-column pill; name keeps an **icon** badge.
- **M2** ✅ — hard-code the two map URLs for now.
- **P1** ✅ — home-page copy finalized (sentence after the em dash dropped).
- **6o approval** ✅ — propose (writer) → admin **edit / approve / mark-duplicate-and-link**.
- **D1** ✅ — `APPROVED` **boolean** (not an enum).
- **D-opt** ✅ — record `PROPOSED_BY_PERSON_ID` on a proposal.
- **Q1** ✅ — keep two tokens; **deploy-config only** (stable secret + 7-day token);
  sliding-refresh / fail-loud deferred.
