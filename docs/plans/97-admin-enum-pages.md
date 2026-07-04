# 97 — Admin pages for the admin-managed taxonomies

## Context

The system has four **admin-managed taxonomies** (data-driven reference lists an admin
curates, most with a propose-then-approve workflow):

| Taxonomy | Scope | Admin page today | Plan |
|---|---|---|---|
| **Incident Types** | global | ✅ `admintypes` | shipped |
| **Areas** | per-event | ✅ `adminareas` | shipped |
| **Outcomes** | global (planned) | ❌ to build | [94-outcomes-registry.md](94-outcomes-registry.md) |
| **Crews** | per-event (planned) | ❌ to build | [95-crews.md](95-crews.md) |

Slices 10a (Outcomes) and 10c (Crews) each already list "add an admin page" as a step.
This doc is the **shared design** for those pages so the two new ones are built to the
exact pattern the existing two already follow — same page skeleton, same nav/doorway
wiring, same permission model, same propose/approve UX — rather than each PR
reinventing it. **Docs-only; no product code here.** The build steps live in 94/95;
this doc is the reference they point at.

## The shared admin-page pattern (verified against Incident Types)

Every admin taxonomy page is the same skeleton. Reference: `web/template/admintypes.templ`
+ `web/typescript/admin_types.ts` (Areas mirror it in `adminareas.templ` /
`admin_areas.ts`).

**Templ page skeleton** (`admintypes.templ:19-110`):
1. `@Head("Edit …", "admin_<x>.js", …)` → `@Header` → `@Nav("")` → `<h1 id="doc-title">`.
2. `@LoadingOverlay()` + `@ErrorInfo()` (`:29-30`).
3. An **edit modal** (`#editIncidentTypeModal`, `:32-61`) with the per-field inputs,
   each wired `onchange="set<Field>(this)"`.
4. A **card** (`:63-104`) whose body is a `list-group`, containing:
   - a `<template id="<x>_li_template">` row (`:69-91`) with: the item name
     (`.type-name-text`), a **"proposed" badge** (`.type-proposed … hidden`, `:87`),
     and per-row action buttons — **Edit** (`.show-edit-modal`), **Approve**
     (`.approve-type … hidden`, shown only for proposals, `:82`), and any toggle
     (Types have Active/Hidden, `:71-78`).
   - a **card-footer "Add:" input** (`:93-102`, `onchange="create<X>(this)"`) that is
     `disabled` until the client confirms the viewer may create.

**TS controller** (`admin_types.ts`): on load, GET the list, clone the `<template>` per
row, fill name/description, reveal the "proposed" badge + **Approve** button when
`!approved` (`admin_types.ts:136-147`), and wire create/approve/edit/toggle to the POST
endpoint. `approveIncidentType` (`:181-186`) posts `{approved:true}`. Areas add a
**mark-duplicate** control (`admin_areas.ts:241-254,285`) and a `canProposeAreas` gate
(`:69`).

**Doorway / nav wiring:**
- **Admin root list** (`web/template/adminroot.templ:32-63`): one `<li><a href="/ims/app/admin/…">`
  per page (Events, Action Logs, Incident Types, Event Areas, People & Passwords,
  Debug).
- **Page routes** (`web/mux.go`): `GET /ims/app/admin/types` → `template.AdminTypes(…)`
  (`:111-112`); `GET /ims/app/admin/areas` → `template.AdminAreas(…, "")` (`:120-121`).
- **Per-event doorway (Areas pattern)** — Areas has *two* mounts: the global
  `/ims/app/admin/areas` doorway with an **event picker** (eventName `""`,
  `web/mux.go:117-121`) **and** an event-scoped variant `template.AdminAreas(…,
  r.PathValue("eventName"))` mounted under the event path (`web/mux.go:182-190`).
  Any **per-event** taxonomy (→ Crews) needs both mounts; a **global** one (→ Outcomes)
  needs only the single `/ims/app/admin/<x>` route like Types.
- **Top nav** (`web/template/nav.templ`): the "Admin" dropdown link is
  `.if-admin hidden` (`:276`). Note the deliberate special-casing: People and Areas are
  **not** tagged `.if-admin` (that class auto-unhides on every admin page regardless of
  context) — see the comments at `nav.templ:162-178`. New admin pages reached only from
  the admin root inherit the plain admin-root link and need no extra nav entry.

**Permission model:** the page route and the API mutation are **both** gated on a
`GlobalAdministrate<X>` permission, enforced **inside the handler** (there is no
`RequireGlobalPermission` mux adapter — `EditIncidentTypes`/`EditAreas` check the bit
themselves). GETs are open to authenticated users (list is not sensitive). The propose
endpoint is event-writer-gated, not admin-gated.

## Design for the two new pages

### `adminoutcomes` (global — mirrors Incident Types)

- **Page:** `web/template/adminoutcomes.templ` + `web/typescript/admin_outcomes.ts`,
  cloned from `admintypes`. Title "Incident Outcomes". Fields per row: **Name**, and a
  **Hidden/Active** toggle (Outcomes carry `HIDDEN`, matching Types — see 94). No
  Group. Edit modal has just the Name field (+ description if 94 keeps one).
- **Rows:** name text + "proposed" badge + **Approve** (for proposals) + **Edit** +
  **Hidden/Active** toggle. Card-footer "Add:" input.
- **Route:** `GET /ims/app/admin/outcomes` → `template.AdminOutcomes(…)` in
  `web/mux.go` (next to `/types`, `:111-112`). Single global mount (no event picker).
- **Admin-root link:** add `<li><a href="/ims/app/admin/outcomes">Incident Outcomes</a></li>`
  to `adminroot.templ` (after Incident Types).
- **Permission:** `GlobalAdministrateOutcomes` (added in 94). GET open; POST admin-gated;
  propose via `POST /ims/api/events/{eventName}/outcomes` (writer-gated).
- **API it drives:** `GET /ims/api/outcomes`, `POST /ims/api/outcomes`,
  `POST /ims/api/events/{eventName}/outcomes` (see 94).

### `admincrews` (per-event — mirrors Areas)

- **Page:** `web/template/admincrews.templ` + `web/typescript/admin_crews.ts`, cloned
  from `adminareas` (so it inherits the per-event doorway + event picker + mark-duplicate
  affordances). Title "Event Crews". Fields per row: **Name** (SLUG immutable),
  **Sort order**, and — unique to Crews — a **Leader picker**.
- **Leader picker:** a person combobox **scoped to the event's roster**, writing
  `CREW.LEADER_PERSON_ID` (see 95 PR 2). Reuse the person-combobox component the
  incident People picker uses; the row shows the current leader's display name with an
  Edit/clear affordance. This is the one control the existing pattern doesn't have —
  everything else is Areas verbatim.
- **Rows:** name + "proposed" badge + **Approve** + **Edit** + **Mark duplicate**
  (repoint members + delete, mirroring Areas' `markDuplicate`) + **Leader**. Card-footer
  "Add:" input.
- **Routes:** global doorway `GET /ims/app/admin/crews` → `template.AdminCrews(…, "")`
  **and** event-scoped `template.AdminCrews(…, r.PathValue("eventName"))` under the
  event path — exactly the two Areas mounts (`web/mux.go:120-121` and `:182-190`).
- **Admin-root link:** add `<li><a href="/ims/app/admin/crews">Event Crews</a></li>` to
  `adminroot.templ` (after Event Areas).
- **Permission:** `GlobalAdministrateCrews` (added in 95). GET open; POST admin-gated;
  propose via the Crews create branch (writer-gated), matching Areas.
- **Note — crew member assignment is NOT on this page.** Assigning a *person* to a crew
  (`PERSON__EVENT.CREW_SLUG`) belongs on the **People roster** (95 PR 2), the same place
  role/wristband are edited. This page manages the *crew list + leaders*, not membership
  — the same split Areas uses (the area list is admin-managed here; an incident's area
  is set on the incident).

## Route & permission summary (all four, after 94/95/97)

| Page | Page route | List API | Mutate API | Propose API | Global perm |
|---|---|---|---|---|---|
| Incident Types | `/ims/app/admin/types` | `GET /ims/api/incident_types` | `POST /ims/api/incident_types` | `POST …/{event}/incident_types` | `GlobalAdministrateIncidentTypes` |
| Areas | `/ims/app/admin/areas` (+event) | `GET …/{event}/areas` | `POST …/{event}/areas` | (create branch) | `GlobalAdministrateAreas` |
| **Outcomes** | `/ims/app/admin/outcomes` | `GET /ims/api/outcomes` | `POST /ims/api/outcomes` | `POST …/{event}/outcomes` | `GlobalAdministrateOutcomes` |
| **Crews** | `/ims/app/admin/crews` (+event) | `GET …/{event}/crews` | `POST …/{event}/crews` | (create branch) | `GlobalAdministrateCrews` |

## Build checklist (per new page — folds into 94/95)

For each of `adminoutcomes` / `admincrews`:
1. `web/template/admin<x>.templ` cloned from the matching sibling (Types for global,
   Areas for per-event); adjust title, fields, and the `<template>` row controls.
2. `web/typescript/admin_<x>.ts` cloned from the sibling controller; repoint the
   endpoints and add the enum-specific control (Outcomes: Hidden toggle; Crews: Leader
   picker).
3. Page route(s) in `web/mux.go` (single global, or the two per-event mounts).
4. `<li>` link in `web/template/adminroot.templ`.
5. Confirm the `GlobalAdministrate<X>` gate on both the page and the POST handler; GET
   stays open to authenticated users.
6. Register mutating API routes with `LogRequest(true, …)` (CLAUDE.md checklist).

**Verify (when built):** `go run bin/build/build.go`; `npx eslint`. Manual: the page
appears under Admin root for an admin; the list renders; create → approve a proposal →
edit → (Outcomes) hide/unhide / (Crews) set a leader + mark-duplicate all work; a
non-admin cannot reach the page or POST.

## Notes

- This doc intentionally keeps **member/assignment** UX off the admin pages (crew
  membership on the People roster; incident's outcome/area on the incident) — matching
  the existing separation and keeping each admin page a pure taxonomy editor.
- If OCF later wants a single unified "Taxonomies" admin hub, all four share enough
  shape to be tabs on one page — out of scope now, noted as a possible future
  consolidation.
</content>
