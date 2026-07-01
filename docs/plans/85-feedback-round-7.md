# Feedback round 7 — incident-type UX, outcomes, involvement, favicon, areas, dashboard cache

Seven beta-feedback items, to ship as **independent small PRs straight to master**
(no stacked branches; each independently reviewable; merge manually after CI is
green). Verified file/line references from a codebase sweep are inline.

Decisions already made with the user are marked **[decided]**.

---

## PR 1 — Outcomes: add the OCF disposition set (item 3)

Add six outcomes: **Taken to Big Bird**, **Taken to Little Wing**, **Asked to
Leave**, **Booted**, **Arrested**, **Transported in Ambulance**.

Outcome is a MySQL `enum` on `INCIDENT.OUTCOME`; adding values touches four
layers in lock-step (the Go layer is regenerated, not hand-edited):

- **Migration** (new goose file, scaffold with pinned goose): `ALTER TABLE INCIDENT
  MODIFY OUTCOME enum(<all 8 existing> , 'taken_to_big_bird',
  'taken_to_little_wing', 'asked_to_leave', 'booted', 'arrested',
  'transported_in_ambulance')`. Best-effort `Down` restores the original 8.
  Enum baseline is `store/schema/migrations/00001_baseline.sql:191`.
- **sqlc regen** → `store/imsdb/models.go` auto-updates the `IncidentOutcome`
  consts, `Valid()`, `AllIncidentOutcomeValues()` (lines 13–87). Do **not** edit
  by hand.
- **TypeScript** `web/typescript/ims.ts`:
  - union type `IncidentOutcome` (~L3223) — add the six string literals.
  - `outcomeNameFromID()` switch (~L1047) — add the six display cases.
- **Template** `web/template/incident.templ` (~L111–134) — add six `<option>`s to
  the `#incident_outcome` select.
- **API** needs no change — `api/incident.go:666` validates via `parsed.Valid()`,
  which the regen updates automatically. Optional: extend
  `api/integration/incident_test.go` `TestIncidentOutcome`.

**Order the list** so the OCF-relevant outcomes are grouped sensibly in the
dropdown (leave the existing 8 first, append the 6, or interleave — cosmetic).

---

## PR 2 — Involvement field: always visible + preset suggestions (item 4) **[decided: datalist presets + free-text]**

The per-person "involvement" input on an incident is free-text
(`INCIDENT__PERSON.INVOLVEMENT varchar(128)`, `00001_baseline.sql:213`) and its
placeholder is hidden until hover by CSS. Make it clearly visible and offer preset
suggestions **without losing free-text** (no schema change).

- **CSS** `web/static/style.css:446–453`: the `.hover-placeholder::placeholder {
  opacity: 0 }` rule is what hides it. Make the field read clearly when empty —
  either drop the rule or keep the placeholder always visible. Prefer a real,
  always-visible affordance (label/placeholder) over the hover trick.
- **Template** `web/template/incident.templ:159–177` (the
  `#incident_people_li_template`): add `list="involvement_presets"` to the input
  and add a `<datalist id="involvement_presets">` with the preset `<option>`s.
  Keep `type="text"` + `maxlength` so free-text still works.
- **Preset values** (proposed — confirm/adjust): Witness, Reporting Party,
  Subject, Injured Party, First Responder, Staff. (A datalist is suggestions only;
  users can still type anything.)
- **TypeScript** `web/typescript/incident.ts` — no functional change; the
  `setPersonInvolvement` handler (~L1328) still sends the string value.
- No schema, JSON, or API change. Involvement stays `*string`.

---

## PR 3 — Favicon: OCF peach behind the IMS letters (item 5) **[decided: use the peach silhouette]**

Current icon is a flat tan square with dark "IMS". The OCF logo is a **peach**;
`web/static/logos/ocf-logo-white.png` (300×300) is that peach as a white
silhouette. Composite the peach behind the "IMS" wordmark on the brand
background, and regenerate the full icon set.

- Regenerate: `favicon.ico` (16+32), `favicon-16x16.png`, `favicon-32x32.png`,
  `apple-touch-icon.png` (180), `android-chrome-192x192.png`,
  `android-chrome-512x512.png` — all under `web/static/logos/`, referenced from
  `web/template/head.templ:32–35` + `site.webmanifest` (paths unchanged, so no
  template edit needed).
- Tooling: Pillow in a scratchpad venv (already verified working). Font used by
  the current icon is Reddit Sans Condensed (`logos/about.txt`); exact match not
  critical at favicon sizes.
- Design note: at 16px a detailed peach mostly disappears, so the small sizes will
  read as "IMS on brand color with a peach tint"; the 180/512 sizes show the peach
  clearly. **Generate candidates and get sign-off before committing** (the images
  are the deliverable — send them for review).
- Assets-only PR; no Go/TS.

---

## PR 4 — Areas visible to everyone with access; controls role-gated (item 6)

Today the Areas tab is hard-gated to **admins** in the nav
(`web/typescript/ims.ts:711–719`, `authInfo.admin` only), even though the read API
already allows non-admins (`api/area.go:64` — `EventReadAreas OR
GlobalAdministrateAreas`). Open the **read view** to anyone with event access, and
**hide mutating controls** from those who can't use them.

- **Nav reveal** `web/typescript/ims.ts:711–719`: broaden the condition from
  `authInfo.admin` to "authenticated + has access to the active event" (read).
  Confirm the exact per-event flag on `authInfo.event_access[event]` (there's
  `writeIncidents`; verify a read/readAreas flag exists — if not, gate on "has any
  event_access entry").
- **Controls, role-aware** in `web/template/adminareas.templ` +
  `web/typescript/admin_areas.ts`. Current authz (`api/area.go`):
  - **Read**: `EventReadAreas` or admin (L64).
  - **Create**: admin → approved; writer (`EventWriteIncidents`) → *proposed* (L113).
  - **Update / Approve / Mark-duplicate**: admin only (L125).
  So the UI must show:
  - **read-only viewer** → list only, no buttons.
  - **writer** → "New area" (creates a proposal) only; no Edit/Approve/Mark-dup.
  - **admin** → everything (unchanged).
  Buttons are built in `admin_areas.ts:appendAreaRow` (~L194–234) and the
  `#add_area_button` in the templ (L144); gate their render/attachment on the
  viewer's role, which the page reads from `commonPageInit()` `authInfo`
  (`admin_areas.ts:62`). Approve/Mark-dup already start `hidden`; extend the same
  pattern to Edit + New-area for non-admins/non-writers.
- Backend authz already enforces this (defence in depth) — this PR is
  visibility/UX so the server's 403s are never hit by the UI.
- Manual check: as a plain reporter, the Areas tab appears and lists areas with no
  controls; as a writer, only "New area"; as admin, full controls.

---

## PR 5 — Dashboard cache invalidation on writes (item 7)

The metrics/dashboard cache (`api/metrics.go`) is a per-event
`InMemory[imsjson.Metrics]` with a **1-minute TTL** and **no write-driven
invalidation** — after a mutation the dashboard can be up to 60s stale. Add
targeted invalidation.

- **New method** on `metricsCache` (`api/metrics.go:47`):
  ```go
  func (c *metricsCache) InvalidateEvent(eventName string) {
      c.mu.Lock(); defer c.mu.Unlock()
      if e, ok := c.byEvent[eventName]; ok { e.Invalidate() }
  }
  ```
  (`lib/cache/InMemory.Invalidate()` already exists, cache.go:76.)
- **Share one cache instance.** It's currently created inline for `GetMetrics`
  only (`api/mux.go:399`). Hoist it to a local in `AddToMux` and pass the same
  pointer into the mutation handlers that change dashboarded data.
- **Wire invalidation** after each successful, event-scoped mutation
  (`action.cache.InvalidateEvent(event.Name)`):
  - Incidents: **create** + `EditIncident.editIncident` (`api/incident.go:1033`) —
    state/priority/area/outcome all feed metrics.
  - Areas: `create` / `approve` / `markDuplicate` / `update`
    (`api/area.go:140/185/204/251`) — area counts + repointing.
  - Incident types: `EditIncidentTypes` create/update (`api/itype.go:122/141`) —
    hidden flag + category/type counts.
- Follow the established `userStore.InvalidateUsers()` pattern (e.g.
  `api/person.go:251`).
- Test: an api/integration case that reads metrics, mutates an incident, re-reads,
  and asserts the change is reflected immediately (not after TTL).
- Scope note: invalidate by `event.Name` (the cache key) so other events' caches
  are untouched.

---

## PR 6 — Incident-type picker: category-grouped combobox (item 1)

The incident-type input is a **flat, alphabetical `<datalist>`**
(`web/template/incident.templ:223–234`, populated in
`web/typescript/incident.ts:drawIncidentTypesToAdd` ~L819) with **no visible
category grouping** — even though the taxonomy already has a `GROUP` enum
(`safety`/`conduct`/`operations`/`compliance` + ungrouped) and both the admin page
and the info-modal already group by it. Native `<datalist>` can't group, so
replace the picker with a **search-first, category-grouped combobox**.

- Build a grouped combobox for the incident-type input, reusing the
  `setupPersonCombobox` pattern in `ims.ts` (~L1318 — typeahead dropdown, keyboard
  nav, `list-group` styling) but rendering **category section headers** using the
  existing `incidentTypeGroups` / `incidentTypeGroupName` /
  `compareIncidentTypesByGroup` helpers (`ims.ts:3358–3387`).
- Data already available client-side (`loadIncidentTypes`), each type carries its
  `group`; no API change.
- Preserve current behaviour: fuzzy match on type, validate before attach
  (`addIncidentType` ~L1437), and the attached-types list rendering.
- UI-only PR (templ + TS). This lands **before PR 7**, which hangs the inline
  "propose a new type" affordance off this combobox.

---

## PR 7 — Incident-type taxonomy + inline propose/approve (item 2) **[decided: add missing & keep all; writer proposes → admin approves]**

Two parts: (a) add the four missing types; (b) let a writer **propose** a new type
inline from the incident form, which an admin **approves** on the Admin → Types
page — mirroring the Areas approval flow (`00011_add_area_approval.sql`,
`api/area.go`).

### Taxonomy (add missing, keep all)
- Reference-data migration (INCIDENT_TYPE is the sanctioned reference-data
  exception to "schema-only") — idempotent `INSERT ... ON DUPLICATE KEY UPDATE` /
  `INSERT IGNORE` by unique `NAME` for the four new types, so a fresh DB and an
  adopted one converge:
  - **Theft** → `conduct` · **Policy Violation** → `compliance` ·
    **Code Black** → `safety` · **Violence** → `safety`
    (category assignments proposed — confirm at implementation).
- Mirror the additions into `store/fakeimsdb/seed.sql` if it enumerates types
  (keep the drift test green).

### Propose/approve (mirror Areas)
- **Schema** (same migration or a sibling): add to `INCIDENT_TYPE`
  `APPROVED boolean not null default true` + `PROPOSED_BY_PERSON_ID integer` FK →
  `PERSON(ID)` — copy `00011_add_area_approval.sql` verbatim in spirit (default
  true so all existing/seeded types are already approved; only a fresh writer
  proposal starts unapproved). `sqlc generate` after.
- **queries.sql**: a types-with-proposer read (LEFT JOIN PERSON), an approve
  query, and a propose-create that sets `APPROVED=false` +
  `PROPOSED_BY_PERSON_ID`. Mirror `AreasWithProposer`/`ApproveArea`.
- **JSON/TS** (`json/itype.go`, `ims.ts`): add `approved` + `proposed_by`
  (handle/name) read fields.
- **API** (`api/itype.go`): today create is gated on
  `GlobalAdministrateIncidentTypes` (L106). Split like areas:
  - a **writer** (event `EventWriteIncidents`) may create a **proposal**
    (`APPROVED=false`, proposer = caller) — new event-scoped path, or relax the
    global create to allow proposal-only for writers;
  - **approve** stays admin-only (`GlobalAdministrateIncidentTypes`).
  - Register the new mutating route with `LogRequest(true, …)` (per CLAUDE.md).
- **Admin → Types page** (`web/template/admintypes.templ`,
  `web/typescript/admin_types.ts`): show a "proposed" badge + **Approve** button on
  unapproved types (mirror the Areas tab's approve control).
- **Incident combobox** (from PR 6): add an "Add new type…" affordance when the
  typed name matches nothing — creates a proposal via the writer path, attaches it
  to the incident, and surfaces "pending approval".
- Decision to confirm at build time: do **unapproved** types show in the picker for
  everyone, or only to their proposer until approved? (Areas: proposed areas are
  visible on the admin tab; incident-type picker visibility for pending types
  needs a call — recommend: attached-to-incident works immediately, but a pending
  type isn't offered as a *suggestion* to others until approved.)

---

## Sequencing & conventions

- **Independent PRs**, any order for 1–5; **PR 6 before PR 7**.
- Branch off master, target master directly, **do not stack**; merge manually
  after CI is green (never `--auto`).
- Stage with `git add -A ':!.idea'`. Generated code (sqlc/templ/tsgo output) is
  git-ignored — **never commit it**; regenerate with `go run bin/build/build.go`.
- Migrations: scaffold with the pinned goose per CLAUDE.md; bump
  `store/integration/migrate_test.go` per new migration; `go test ./...` +
  `go test ./store/integration ./api/integration` (Docker).
- Lint: `npx eslint` (TS) + golangci (`noinlineerr`, `misspell`).
- Action log: PR 5 adds no endpoints; PR 7's new mutating route needs
  `LogRequest(true, …)`.

## Open confirmations (non-blocking, resolve at build)
- Involvement preset values (PR 2).
- Favicon candidates sign-off (PR 3).
- New-type category assignments (PR 7).
- Pending-type picker visibility (PR 7).
