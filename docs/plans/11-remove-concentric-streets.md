# Phase 1 — Remove the Concentric Streets feature

> **Status:** ✅ Done — shipped in **PR #1** (`cleanup/remove-concentric-streets`,
> merged 2026-06-05 as commit `032e92b`). Both stages landed as two commits:
> Stage 1 (management surface) + Stage 2 (schema migration `32-from-31.sql`).
> Verified against real MariaDB via `go test ./store/integration`. &nbsp;·&nbsp;
> **Parent:** [10-cleanup-pass.md](10-cleanup-pass.md)
> → [00-master-plan.md](00-master-plan.md) &nbsp;·&nbsp; **Last updated:** 2026-06-05

## Why this has its own plan

This is the **single largest piece of dead/deprecated code** in the repo, and the
clearest example of cruft to clear before OCF work begins. The admin UI already
announces it: *"Event Concentric Streets — no longer used as of late 2025"* and
the admin page itself states *"as of late 2025, these concentric streets are no
longer used by IMS, since addresses are now only free-form strings."*

It's also a Burning Man-specific geography concept (clock addresses: radial
hour/minute + concentric ring streets) that has **no place in OCF**, whose
geography is named areas. So removing it is both clean-up *and* a head start on
Phase 3 (location model). Unlike the small items in `10-cleanup-pass.md`, it spans
every layer and includes a schema migration — hence a dedicated plan.

## The deprecation is partial — this is the key fact

| Layer | State today |
|---|---|
| Admin streets **management UI** (page, JS, API, queries, permissions) | **Deprecated & unused** — page renders but is struck-through and labeled dead |
| `INCIDENT.LOCATION_CONCENTRIC / _RADIAL_HOUR / _RADIAL_MINUTE` columns | **Vestigial** — still read/written by the API, but **no UI edits them**; data already migrated into `LOCATION_ADDRESS` |
| `CONCENTRIC_STREET` table | **Vestigial** — seeded & FK'd, but only the dead admin page manages it |
| `Location.Concentric/RadialHour/RadialMinute` JSON fields | **Vestigial** — `omitempty`, accepted/returned by API, set by no first-party client |

**Crucial precedent:** migration `24-from-23.sql` already concatenated
`radial_hour:radial_minute & concentric_name` into the new free-form
`LOCATION_ADDRESS` column (e.g. `"10:05 & Esplanade"`). **The data these columns
held is already preserved in `ADDRESS`.** Removing the columns loses nothing.

## Decision (recommended) — remove the whole feature, columns included

Because (a) the management surface is already dead, (b) the columns are vestigial
with their data preserved in `ADDRESS`, and (c) OCF will replace the location
model wholesale in Phase 3, the recommendation is to **remove the entire feature
now, end to end, including the DB columns and table.**

> ⚠️ **One call to confirm before executing:** drop the columns now (this plan) vs.
> remove only the dead UI/API now and defer column drops to Phase 3's location
> rework. Recommendation: **drop now** — a clean slate is the whole point of
> Phase 1, and the data is already safe in `ADDRESS`. If there's any external
> API consumer reading `location.concentric/radial_*`, flag it first; we believe
> there is none (no first-party caller sets them).

Execute in two stages so each is independently reviewable and green.

---

## Stage 1 — Remove the management surface (no schema change)

Pure deletion of the dead admin feature. Low risk; no migration.

- [ ] **Web templates**
  - Delete `web/template/adminstreets.templ` (entire page).
  - `web/template/adminroot.templ:49-51` — remove the struck-through
    `Event Concentric Streets` link + "no longer used" note.
- [ ] **TypeScript**
  - Delete `web/typescript/admin_streets.ts` (entire file).
  - `web/typescript/ims.ts:538-563` — remove `concentricStreetNameByID`,
    `loadStreets()`, `concentricStreetFromID()`.
  - `web/typescript/incident.ts:138` — remove the `loadStreets()` call.
  - Grep for any other `loadStreets`/`concentricStreetFromID` callers.
- [ ] **API handlers**
  - Delete `api/street.go` (`GetStreets`, `EditStreets`).
  - Remove the streets route registration in `api/mux.go` (`/ims/api/streets`
    GET/POST).
- [ ] **JSON types**
  - Delete `json/street.go` (`EventsStreets`, `EventStreets`).
- [ ] **Authorization** (`lib/authz/permission.go`)
  - Remove `GlobalReadStreets` and `GlobalAdministrateStreets` constants.
  - Remove them from the role bitmasks (`AnyAuthenticatedUser`,
    `Administrator`, lines ~102-103).
  - Update `lib/authz/permission_test.go` permission matrices accordingly.
- [ ] **SQL queries** (`store/queries.sql`)
  - Remove `ConcentricStreets` (`:many`) and `CreateConcentricStreet` (`:exec`).
  - Leave the `UPDATE INCIDENT` location-column writes for Stage 2.
- [ ] **Regenerate & fix:** `go tool sqlc generate` (drops `ConcentricStreets`/
  `CreateConcentricStreet` from `store/imsdb/`), `go tool templ generate`,
  `go tool tsgo`. Fix compile fallout.
- [ ] **Tests:** remove streets endpoints from
  `api/integration/permissions_test.go:52,83`. Build + `go test ./...` green.

**Stage 1 exit:** admin streets page, API, queries, permissions, and JSON type
gone; build/tests/lint green. The vestigial columns still exist (Stage 2).

---

## Stage 2 — Drop the data model (schema migration)

Removes the now-orphaned columns/table and the code that reads/writes them.

- [ ] **Migration** — create `store/schema/32-from-31.sql`:
  - Drop FK `INCIDENT (EVENT, LOCATION_CONCENTRIC) → CONCENTRIC_STREET`.
  - `alter table INCIDENT drop column LOCATION_CONCENTRIC, drop column
    LOCATION_RADIAL_HOUR, drop column LOCATION_RADIAL_MINUTE;`
  - `drop table CONCENTRIC_STREET;`
  - `update SCHEMA_INFO set VERSION = 32;`
  - (Data already preserved in `LOCATION_ADDRESS` by migration 24 — no data
    migration needed. Note this in the migration's comment.)
- [ ] **`store/schema/current.sql`** — mirror the migration: remove the
  `CONCENTRIC_STREET` table (lines ~25-31), the three `LOCATION_*` columns and
  their FK in `INCIDENT` (lines ~81, 88-89), and bump version to 32.
- [ ] **SQL queries** (`store/queries.sql:86-89`) — remove
  `LOCATION_CONCENTRIC/_RADIAL_HOUR/_RADIAL_MINUTE` from the `UpdateIncident`
  `UPDATE`.
- [ ] **JSON types** (`json/incident.go:25-35`) — remove `Concentric`,
  `RadialHour`, `RadialMinute` from `Location`.
- [ ] **API** (`api/incident.go`)
  - `incidentToJSON` (~269-276) — drop the three fields from the `Location{}`
    literal.
  - `updateIncident` (~540-559) — remove the three `if newIncident.Location.…`
    blocks (and their action-log lines).
- [ ] **Regenerate:** `go tool sqlc generate` (drops `LocationConcentric`/
  `LocationRadialHour`/`LocationRadialMinute` from `store/imsdb/models.go` and
  query structs). Fix fallout.
- [ ] **Seed data** (`store/fakeimsdb/seed.sql`)
  - Remove the `CONCENTRIC_STREET` inserts (~11-24).
  - Remove the three location columns from `INCIDENT` inserts (~32-60).
  - The radial/concentric action-log rows (~251-253) are historical text in
    `REPORT_ENTRY`/action log — harmless to keep, but optionally tidy.
- [ ] **Tests**
  - `api/integration/incident_test.go` — remove `Concentric/RadialHour/
    RadialMinute` from `sampleIncident1` (~39-40) and the clear-location case
    (~254-256).
  - Re-scan `lib/authz/permission_test.go` for stragglers.
- [ ] **Integration test fixtures** — `store/integration/06.sql` is a *frozen
  historical schema snapshot* (version 6) used by the migration test; **do NOT
  edit it** — it must keep the columns to test the real upgrade path. Verify
  `go test ./store/integration` runs the new `32-from-31` migration cleanly.

**Stage 2 exit:** no concentric/radial/street code or columns remain anywhere
(except frozen historical migration fixtures); `go test ./...` and (Docker
permitting) `go test ./store/integration ./api/integration` green.

---

## Full file inventory (verified)

**Remove entirely:** `web/template/adminstreets.templ`,
`web/typescript/admin_streets.ts`, `api/street.go`, `json/street.go`.

**Edit:** `web/template/adminroot.templ`, `web/typescript/ims.ts`,
`web/typescript/incident.ts`, `api/mux.go`, `api/incident.go`,
`lib/authz/permission.go` (+`_test.go`), `store/queries.sql`,
`store/schema/current.sql`, `json/incident.go`, `store/fakeimsdb/seed.sql`,
`api/integration/incident_test.go`, `api/integration/permissions_test.go`.

**Create:** `store/schema/32-from-31.sql`.

**Regenerated (do not hand-edit):** `store/imsdb/models.go`,
`store/imsdb/queries.sql.go`, `store/imsdb/querier.go`, the `*_templ.go`, and
`web/static/*.js`.

**Do NOT touch (frozen history):** `store/schema/05-from-04.sql`,
`07-from-06.sql`, `24-from-23.sql`, `store/integration/06.sql`.

## Notes
- Keep Stage 1 and Stage 2 as separate commits (UI/API removal vs. schema drop)
  for clean review and easy revert.
- After Stage 2, free-form `LOCATION_ADDRESS` becomes the *only* structured
  location field — which is exactly the seam Phase 3 will build OCF's named-area
  location model on. Cross-link this when writing `30-domain-model.md`.
