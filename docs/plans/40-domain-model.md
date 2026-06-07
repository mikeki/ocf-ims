# Phase 4 — Domain Model: Categories, Outcomes, Locations

**Status: PLAN — for review (drafted 2026-06-07).** No code yet. This document is the
plan; once approved it is implemented across a small series of PRs (one per slice — see
[§7 PR slicing](#7-pr-slicing)), following the same plan-doc-first workflow used in
Phase 3.

Parent plan: [`00-master-plan.md`](00-master-plan.md) → Phase 4. Phase 3 (remove
Clubhouse / local People) is complete (PRs #16–#19). Phase 1 already removed the Burning
Man "concentric streets" radial-clock geography (migration 32), which clears the ground
for the OCF location model here.

---

## Why this phase exists

The system still carries the Burning Man **domain**: incident types like *MOOP* and
*Found Child*, a flat type list with no grouping, free-text locations seeded with playa
addresses, and **no concept of an incident outcome** at all. Phase 4 reshapes the domain
to OCF:

- **4a — Categories.** Replace the BM incident taxonomy with OCF's, and group types into
  **Safety / Conduct / Operations / Compliance**.
- **4b — Outcomes.** Add a **disposition** distinct from operational state — what
  *happened* with the incident (Information Only, Resolved On Scene, Referred to
  Coordinator, …), a concept the model lacks entirely today.
- **4c — Locations.** Replace free-text playa locations with a **structured, validated,
  per-event area model** that supports a parent/child hierarchy.

**Scope (confirmed 2026-06-07): all three slices are beta must-haves.** Under the ~4-week
event deadline this is an aggressive scope; 4c is the heaviest piece and is split into an
additive **model** PR and a breaking **cutover** PR (the latter also fully retires the
Burning Man `PLACE` directory) so it can land incrementally and de-risk early.

**Fresh-DB assumption.** Per the master plan (§4), the Fair and the demo box both launch
on a **freshly seeded database** — there is no production data to migrate. This lets the
schema changes here be clean: migrations exist to satisfy the append-only convention and
the `store/integration` replay test, **not** to transform existing rows.

---

## Current model (verified 2026-06-07)

Grounding facts the design builds on, with file references:

**Categories** — `INCIDENT_TYPE(ID, NAME unique, HIDDEN bool, DESCRIPTION)`
(`store/schema/current.sql:25-33`) is a **flat list, no grouping**. Incidents link to
types **many-to-many by ID** via `INCIDENT__INCIDENT_TYPE` (`current.sql:163-173`) — so
**renames are safe** (nothing references a type by name except UI display and audit-log
text). Removal is a soft `HIDDEN` flag, never a delete. Admin UI
(`web/template/admintypes.templ`, `web/typescript/admin_types.ts`) and per-incident
selection (datalist of names → stores IDs, `web/typescript/incident.ts`) already exist.
Seeded types: `Admin`, `Junk` (`current.sql:35-36`) + `Sound Complaint`, `Found Child`,
`Lost Child`, `MOOP`, `Medical`, `Transport` (`store/fakeimsdb/seed.sql:271-277`).

**State** — `INCIDENT.STATE` is a MySQL `enum('new','on_hold','dispatched','on_scene','closed')`
(`current.sql:110-132`), mirrored as a generated Go const + `.Valid()`
(`store/imsdb/models.go:136-201`), validated in `api/incident.go:500` (invalid values are
**silently ignored** today), and **hardcoded** in the templ `<select>`
(`web/template/incident.templ:72-95`) and `web/typescript/ims.ts`. There is **no bag /
config endpoint** shipping enum lists — the frontend hardcodes them.
**No outcome/disposition/resolution concept exists anywhere** (verified by grep).

**Locations** — radial/concentric is **fully gone** (migration 32). `INCIDENT` now stores
free-text `LOCATION_NAME`, `LOCATION_ADDRESS`, `LOCATION_DESCRIPTION` (`current.sql:110-132`),
surfaced as `json.Location{Name,Address,Description}` (`json/incident.go:25-32`). A
separate `PLACE` table (`current.sql:260-270`) holds per-event BM DMV data
(`enum('camp','art','other','mv')` + `external_data` JSON) and **only feeds the
location-name autocomplete** (`web/typescript/incident.ts` `drawPlacesList()`) — there is
**no FK** from incident to place; locations are unvalidated free text.

---

## Decisions (locked 2026-06-07)

| Decision | Choice |
|---|---|
| **Scope** | **All three slices (4a, 4b, 4c) are beta must-haves.** |
| **4a grouping storage** | **`enum` `GROUP` column** on `INCIDENT_TYPE` (`'safety','conduct','operations','compliance'`), mirroring the existing `STATE` / `PLACE.TYPE` enum idiom. Integrity + free ordering (enum declaration order), minimal plumbing. Cleanly promotable to a `GROUP_ID` FK + group table later if OCF wants admin-managed groups. |
| **4b outcome storage** | **`enum` `OUTCOME` column** on `INCIDENT`, **nullable**, mirroring how `STATE` is plumbed end to end. Independent of `STATE` (no state-machine coupling). |
| **4b validation fix** | Reject invalid outcome values with **400**, rather than the silent-ignore the `STATE` path uses today (cleaner; applied to the new field only). |
| **4c location model** | **Structured + validated.** New per-event **`AREA`** table with a self-referential parent (hierarchy); `INCIDENT` gets a nullable **FK** to an area. Location dropdown offers only that event's areas. |
| **4c free-text detail** | **Keep** a free-text `LOCATION_DESCRIPTION` ("details") alongside the area FK, so spots that aren't a named area can still be pinned. Area FK is **optional** (nullable) — an incident can carry just a description. |
| **4c per-event** | Areas are **per-event** (keyed `(EVENT, SLUG)`), satisfying "areas change event to event." |
| **4c area key** | **`SLUG`** (a per-event-unique string **derived from `NAME`**, e.g. `chela-mela`), *not* the integer `(EVENT, NUMBER)` convention used by `INCIDENT`/`PLACE`/`REPORT`. Deliberate divergence: a human-readable, stable identifier reads better in URLs/API and as the incident FK. The slug is generated once at create-time and is **immutable** thereafter — `NAME` (the display label) can be edited freely without breaking incident references or child→parent links. |
| **4c area home** | A **dedicated `AREA` table**, *not* an overload of `PLACE` (different concept: `PLACE` is per-event camp/art DMV data with `external_data`). |
| **`PLACE` fate** (O2) | **Full retire.** `PLACE` is the Burning Man camp/art/mutant-vehicle directory (`enum('camp','art','other','mv')` + `BM*` `external_data`); its only incident-facing role is the location autocomplete that `AREA` replaces. Delete the table (migration), `api/place.go` + routes, both templ pages (`adminplaces`, `places`), both TS files (`admin_places.ts`, `places.ts`), the `BM*` types, and the nav links — a clean teardown like concentric-streets removal. Rides with the location cutover (PR 3). |
| **4c freeform place box** | The single retained free-text field (`LOCATION_DESCRIPTION`) doubles as the **freeform "place / details"** box, replacing the retired `PLACE` autocomplete. Incident location UI = **[structured Area select] + [freeform place/details text]**. |
| **Enum lists to frontend** | Continue the existing **hardcoded-in-frontend** approach for the new enums (group, outcome) — consistent with `STATE`; no new bag endpoint. |
| **Category/area name source** | Seed from the master plan's **draft** OCF lists (below), flagged pending OCF stakeholder confirmation. Wording can change with a reseed; it does not block the model. |

## Sub-decisions (resolved 2026-06-07)

| # | Question | Resolution |
|---|---|---|
| O1 | **Hierarchy depth** — single parent level, or arbitrary nesting? | **Single level.** An area has at most one parent (covers *White Bird → Big Bird/Little Wing*, *Main Camp → sub-areas*). The schema's self-FK physically allows deeper nesting, so we're not boxed in; UI/logic enforce one level for the beta. |
| O2 | **`PLACE`'s fate** | **Full retire** (see locked row above) — plus keep one freeform place box (the retained `LOCATION_DESCRIPTION`). |
| O3 | **Drop `LOCATION_NAME` / `LOCATION_ADDRESS`?** | **Drop both.** Area FK replaces `NAME`; `ADDRESS` was the playa-address carrier with no OCF analog. **Keep `LOCATION_DESCRIPTION`** as the freeform place/details field. |
| O4 | **Area admin UI this phase?** | **Yes — in-app per-event admin page** (mirror the existing Places/Types admin). Areas change event to event, so seed-only would force a SQL edit + redeploy per event. |
| O5 | **Outcome required to close?** | **No** — optional even at close; a soft UI nudge (like today's "add a type when closing" prompt), not a hard gate. |
| O6 | **Legacy seeded `Admin`/`Junk` types?** | **Drop** from the OCF seed — BM-ops filtering artifacts; nothing keys on their IDs. |

---

## 4a — Incident categories & grouping

**Target (draft OCF taxonomy, pending stakeholder sign-off):**

- **Safety:** Medical, Fire, Traffic/Vehicle, Child Welfare, Missing Person, Lost Child,
  Environmental Hazard
- **Conduct:** Personal Violation, Harassment, Threatening Behavior, Intoxication,
  Participant Conflict, Volunteer Conflict
- **Operations:** Construction Issue, Water Issue, Electrical Issue, Sound Complaint,
  Booth Issue, Camping Issue, Site Damage
- **Compliance:** Guideline Violation, Permit Violation, Amplified Sound Violation,
  Unauthorized Vehicle, Wristband/Credential Issue

**Schema** — add a `GROUP` enum to `INCIDENT_TYPE`:
```sql
alter table INCIDENT_TYPE
    add column `GROUP` enum('safety','conduct','operations','compliance') null;
```
(Nullable so a type can be ungrouped; the OCF seed sets it for all.) `current.sql` gets
the column inline; a new `36-from-35.sql` migration adds it + bumps `SCHEMA_INFO`.

**Layers touched:** `store/schema` (migration + current), `store/queries.sql`
(`CreateIncidentType`/`UpdateIncidentType` carry `GROUP`), sqlc regen (`models.go` gains a
generated `IncidentTypeGroup` enum), `json/itype.go` (`Group *string`), `api/itype.go`
(read/write group, validate), `web/template/admintypes.templ` + `admin_types.ts` (group
selector + group the list), `web/template/incident.templ` + `incident.ts` (group the
type-selection dropdown), `web/typescript/ims.ts` (type + display helpers),
`store/fakeimsdb/seed.sql` (reseed OCF categories with groups).

**Risk:** Low. ID-based links mean reseeding the taxonomy and renaming are safe. Grouping
is additive and presentation-driven.

---

## 4b — Incident outcome / disposition

**Target (draft):** Information Only, Resolved On Scene, Referred to Coordinator,
Referred to Management, Referred to Community Support, Referred to Mediation, Follow-Up
Required, No Action Needed.

**Concept:** `OUTCOME` is **orthogonal to `STATE`**. `STATE` is the operational workflow
(new → dispatched → closed); `OUTCOME` is the disposition classification. No coupling
between them.

**Schema** — mirror `STATE`:
```sql
alter table INCIDENT
    add column OUTCOME enum(
        'information_only','resolved_on_scene','referred_to_coordinator',
        'referred_to_management','referred_to_community_support',
        'referred_to_mediation','follow_up_required','no_action_needed'
    ) null;
```

**Layers touched:** exactly the layers `STATE` flows through —
`store/schema` (migration + current), `store/queries.sql` (`CreateIncident`/`UpdateIncident`
carry `OUTCOME`), sqlc regen (generated `IncidentOutcome` enum + `.Valid()`),
`json/incident.go` (`Outcome *string`), `api/incident.go` (validate → **400** on invalid;
include in response), `web/template/incident.templ` (outcome `<select>` beside state),
`web/typescript/incident.ts` (`editOutcome()` handler) + `ims.ts` (type + display helper).
Optionally surface outcome in the incidents-list row.

**Risk:** Low–Medium. Net-new field but follows an established pattern exactly. The only
behavioral nuance is the deliberate 400-on-invalid (vs. state's silent ignore).

---

## 4c — Structured locations (heaviest slice)

**Target areas (draft):** Main Camp, Dragon Plaza, Chela Mela, Xavanadu, Main Stage Area,
White Bird (→ Big Bird, Little Wing), Craft Loop, Food Booth Area, Community Village,
Energy Park, Far Side, Ritz, and camping areas (Miss Piggy, SCOF, South Woods, …).

**Requirements driving the model (from review):** (1) areas can belong to a greater area
(**hierarchy**); (2) areas change **event to event** (**per-event**); (3) incident
location is **structured/validated**, not free text.

**Schema — new per-event `AREA` table keyed on a name-derived slug, with a
self-referential parent:**
```sql
create table AREA (
    EVENT       integer      not null,
    SLUG        varchar(128) not null,             -- derived from NAME, immutable, e.g. 'chela-mela'
    NAME        varchar(255) not null,             -- display label, editable
    PARENT_SLUG varchar(128),                       -- null = top-level; same EVENT
    SORT_ORDER  integer      not null default 0,

    primary key (EVENT, SLUG),
    foreign key (EVENT) references EVENT(ID),
    foreign key (EVENT, PARENT_SLUG) references AREA(EVENT, SLUG)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```
**Incident location → validated FK** (+ retire the playa free-text name/address, keep
detail — see O3):
```sql
alter table INCIDENT
    add column LOCATION_AREA_SLUG varchar(128),      -- nullable: area optional
    add constraint INCIDENT_TO_AREA
        foreign key (EVENT, LOCATION_AREA_SLUG) references AREA(EVENT, SLUG),
    drop column LOCATION_NAME,                        -- O3
    drop column LOCATION_ADDRESS;                     -- O3
    -- LOCATION_DESCRIPTION retained as free-text "details"
```
**Slug generation:** on area create, slugify `NAME` (lowercase, spaces/punctuation →
hyphens, collapse repeats) in the Go handler; on a per-event collision, suffix `-2`, `-3`,
… The slug is then **immutable** — renaming an area changes `NAME` only, so incident FKs
and `PARENT_SLUG` links never break. The incident location UI becomes **[structured Area
select] + [freeform place/details]**, where the freeform box is the retained
`LOCATION_DESCRIPTION` (O3) standing in for the retired `PLACE` autocomplete.

**Layers touched:** `store/schema` (migration + current; new table + INCIDENT alter),
`store/queries.sql` (area CRUD + next-number + incident location read/write),
sqlc regen (`Area` model + queries), `json/` (new `Area` type keyed by `Slug`;
`json.Location` reshaped to carry `AreaSlug` + parent context + retained `Description`),
`api/` (new area handler — list/create/update per event, modelled on `api/place.go`,
slugifying `NAME` on create; `api/incident.go` location read/write switches to the FK +
validates the area belongs to the event),
`api/mux.go` (area routes), `web/template` + `web/typescript` (a per-event **Areas admin
page** per O4; incident location UI becomes a **grouped strict select** of the event's
areas + the freeform details box), `store/fakeimsdb/seed.sql` (seed OCF areas + hierarchy;
update seeded incidents to reference areas).

### Retire `PLACE` (O2 — full teardown, rides with the location cutover)

`PLACE` is the Burning Man camp/art/mutant-vehicle directory (origin: `DESTINATION` in
migration 23, `mv` type added in 28, renamed in 30). Its `external_data` is BM-published
metadata (`BMArt`/`BMCamp`/`BMMV` in `ims.ts`), populated by an admin pasting bulk JSON at
`/ims/app/admin/places`. Its only incident-facing use is the location autocomplete `AREA`
now replaces. Remove, in one coherent change with the location cutover:

- **Schema:** `drop table PLACE` (same migration as the INCIDENT location alter).
- **API:** delete `api/place.go` (`GetPlaces`/`UpdatePlaces`) + its routes in `api/mux.go`.
- **Queries:** remove `CreatePlace`/`RemovePlaces`/`Places` from `store/queries.sql`.
- **Web:** delete `web/template/adminplaces.templ` + `places.templ`,
  `web/typescript/admin_places.ts` + `places.ts`, their routes in `web/mux.go`, and the
  Places nav/admin links; remove the `drawPlacesList()` location-autocomplete path in
  `incident.ts`.
- **Types:** remove `Places`, `Place`, `BMArt`/`BMCamp`/`BMMV`/`OtherDest` from `ims.ts`.
- **Seed:** drop the `PLACE` inserts from `store/fakeimsdb/seed.sql`.
- **authz:** `EventReadPlaces` / `GlobalAdministratePlaces` become unused — remove or leave
  (decide at implementation; leaning remove for cleanliness, matching concentric-streets).

**Risk:** Medium–High — the most plumbing of the three (a hierarchy, a new admin surface,
a `json.Location` contract change, plus the `PLACE` teardown). Split into an **additive
4c-model** PR and a **breaking 4c-cutover** PR (see slicing) so only the cutover carries
the contract break + deletion.

---

## 7. PR slicing

Front-loads the heavy slice while delivering a quick win first. Each PR is independently
shippable, build + `go test ./...` green.

| PR | Slice | Why this order |
|---|---|---|
| 1 | **4a — categories + enum grouping** | Self-contained warm-up; validates the migration + reseed + UI-grouping pattern the later PRs reuse. Immediate, visible value. |
| 2 | **4c-model (additive) — `AREA` table + area queries/JSON/API + Areas admin page + seed areas** | Heaviest area; start early. Purely additive — `AREA` is new, incidents still use free-text location, nothing breaks. Ships green on its own. |
| 3 | **4c-cutover (breaking) — incident location → `AREA` FK + drop `LOCATION_NAME`/`ADDRESS` + full `PLACE` retire** | Depends on PR 2. The atomic breaking change: reshape `json.Location`, switch incident read/write + UI to the FK + freeform details box, and tear down `PLACE` (table/API/UI/types) in the same PR since that's when its autocomplete role ends. |
| 4 | **4b — outcome enum** | Smallest, lowest-risk, mirrors `STATE` exactly; safe to land last. |

Migrations (numbers assigned at implementation time, append-only; each adds to
`current.sql`, bumps `SCHEMA_INFO`, and is replayed by `store/integration`):
PR 1 → add `INCIDENT_TYPE.GROUP`; PR 2 → add `AREA` table; PR 3 → alter `INCIDENT`
(add `LOCATION_AREA_SLUG` FK, drop `LOCATION_NAME`/`LOCATION_ADDRESS`) + `drop table PLACE`;
PR 4 → add `INCIDENT.OUTCOME`.

> If PR 3 grows unwieldy, the `PLACE` teardown can be peeled into its own PR landing
> immediately after — but it must not precede the area-UI replacement, or incident-location
> entry briefly loses its helper on `master`.

---

## 8. Testing

- **Unit / API:** extend `api/integration` incident tests for the new `group`, `outcome`,
  and area-FK round-trips; assert 400 on invalid outcome and on an area from the wrong
  event.
- **Migration replay:** `go test ./store/integration` after each migration.
- **Build:** `go run bin/build/build.go` (sqlc + templ + tsgo + compile) green each PR.
- **gofmt gate:** run `gofmt -l` (or `uvx pre-commit run --all-files`) before push — the
  build script does **not** run gofmt, and CI's Linters job does (Phase 3 lesson).
- **Manual:** exercise grouped type selection, outcome set/clear, and area
  select/hierarchy on the fresh-seeded demo box.

---

## 9. Out of scope / deferred

- **Phase 6 dashboards** (counts by area/category/outcome, response times, open
  follow-ups) — depends on this phase's data; deferred.
- **Admin-managed groups** (promote 4a enum → `GROUP_ID` table) — only if OCF needs
  in-app group editing; clean follow-up migration.
- **Arbitrary area nesting** (O1) — beta is single-level; the self-FK already supports
  deeper if OCF later needs it.
- **Stakeholder-final category/area wording** — seeded from drafts; reseed when OCF
  confirms (tracks alongside the still-open Phase 2 2d terminology).
- **Map / geo integration** for areas — long-term, not beta.
