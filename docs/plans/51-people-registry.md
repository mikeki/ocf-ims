# Phase 5e — Unified People Registry

> **Status:** Plan / for review. **Owner:** TBD · **Last updated:** 2026-06-12
> (**R3 revised** — classification is now an explicit per-event enum, not derived).
>
> A new slice in the **Phase 5** family ([`50-roles-permissions.md`](50-roles-permissions.md)),
> added 2026-06-11 from beta-usage feedback (Stakeholder A + maintainer; see
> [`60-feedback-round-1.md`](60-feedback-round-1.md) for the full feedback round —
> the people items were routed here because they reshape `PERSON`, which 5c/5d
> build on).
>
> **Guiding principle:** **identity is global, participation is per-event.** A
> person's name and login live on `PERSON` (stable across years); their wristband,
> classification, and access for a given fair live on `PERSON__EVENT` /
> `EVENT_ACCESS` (they differ every fair).

## 1. Goal

Make `PERSON` the **single registry of every person the IMS touches**, not just
people who can log in:

1. **Pre-event:** crew members are loaded with login access (handle + password) —
   today's model, unchanged.
2. **During the event:** people encountered at White Bird visits or on incidents
   who weren't previously registered get added **ad-hoc from those flows** — no
   login, no handle, just identity. Some will already exist (hence
   typeahead-before-create).
3. Everyone ends up **in the same table**, findable later via **typeahead search**
   (by name, handle, or **wristband number**) — so "if we need to talk to people
   later, we know who was there — besides just us" (Stakeholder A).

## 2. The disconnect today (grounding)

- `PERSON(ID, HANDLE, EMAIL, STATUS, ON_SITE, PASSWORD, CREATED, IS_ADMIN)` was
  built in Phase 3 as a **login-directory replacement for Clubhouse**. It has no
  name field; `HANDLE` is `not null unique` and is the only human identifier.
- **Visit guests never become `PERSON` rows.** Their identity lives as freeform
  text on the `VISIT` row itself (`GUEST_PREFERRED_NAME`, `GUEST_LEGAL_NAME`,
  `GUEST_DESCRIPTION`, camp fields…). Meanwhile people *involved* in a visit
  (`VISIT__PERSON`) and people on incidents (`INCIDENT__PERSON`) **do** require
  real `PERSON` rows. Same concept, two storage models.
- Admin People page gaps: **email is frozen at create time** (`EditPersonRequest`
  only accepts status + on-site; `api/person.go`), **no search/filter** on
  `GET /ims/api/personnel`, no pagination.
- Attach endpoints key on handle in the URL:
  `…/incidents/{n}/people/{personHandle}` (`api/mux.go:198,208,338,348`) — which
  cannot address a person who has no handle.

## 3. Decisions (settled 2026-06-11)

| # | Decision | Outcome |
|---|---|---|
| R1 | One table or two? | **Unified**: `PERSON` is the single registry; visit guests link to it. The registry grows organically from operational contact (no bulk import of non-crew people). |
| R2 | Wristband scoping | **Per-event link table** (`PERSON__EVENT`), unique per event. Wristbands reissue each fair; a 2027 wristband is a new row, 2026 history stays intact. |
| R3 | Person classification (crew / participant / public) | **Explicit enum on `PERSON__EVENT`** (`PARTICIPATION_TYPE`), *not* derived and *not* on `PERSON`. **Revised 2026-06-12** (maintainer): the original "derive from `PASSWORD`" was wrong — login capability is **global and permanent** (you keep your password across years), but crew/participant/public is a **per-event** relationship that changes every fair (a 2026 crew member may be a participant or absent in 2027 while still holding their login). Storing it per-event makes it correct and editable; a sensible **default** is still applied on create (wristband → `participant`, none → `public`, `crew` set when loading rosters), but it's an explicit value, not a function of the password. |
| R4 | Typeahead search exposure | **Any logged-in user** — matches the existing gate (`GlobalReadPersonnel` is already granted to `AnyAuthenticatedUser`). Typeahead returns **minimal fields only** (name, handle, wristband, per-event participation type) — nothing about *why* someone is in the registry. Sensitive visit details stay gated by visit access. |

## 4. Design

### 4.1 Schema (migration number assigned at implementation time¹)

- **`PERSON`** (global **identity** only — no per-event/classification columns):
  - add `NAME varchar(255) null` — preferred/display name. Display resolution is
    `COALESCE(NAME, HANDLE)`.
  - `HANDLE` → **nullable** (`varchar(64) null`, keep `unique` — MySQL allows
    multiple NULLs in a unique key). Handle exists **only for login-capable
    people**; app-level invariant: at least one of `NAME`/`HANDLE` is set.
  - `PASSWORD` stays as-is (nullable): "can log in" is a **global, permanent**
    attribute — it is **not** the classification (see R3). A person keeps their
    login across years regardless of whether they're crew this fair.
  - Migrations are **schema-only** (no data transforms), so existing dev rows get
    `NAME` backfilled in `fakeimsdb/seed.sql`, not in the migration. Fine for
    prod: OCF launches fresh.
- **`PERSON__EVENT`** (new — the **per-event participation** record):
  ```sql
  create table PERSON__EVENT (
      PERSON_ID          integer not null,
      EVENT              integer not null,
      WRISTBAND          varchar(32) null,
      PARTICIPATION_TYPE enum('crew','participant','public') not null default 'public',
      primary key (PERSON_ID, EVENT),
      unique key (EVENT, WRISTBAND),
      foreign key PE_TO_PERSON (PERSON_ID) references PERSON(ID),
      foreign key PE_TO_EVENT  (EVENT)     references EVENT(ID)
  )
  ```
  One row per (person, event) captures **how this person related to this fair**:
  their wristband and their explicit classification. The row is created lazily —
  when a person is first associated with the event (loaded from a crew roster, or
  encountered on an incident/visit). A person with **no** `PERSON__EVENT` row for
  the current event simply has no classification for it yet. `PARTICIPATION_TYPE`
  is a small **extensible** enum (could later gain e.g. `vendor`/`performer`);
  three values cover the beta. (A future shift/onduty model could hang off the
  same row.)
- **`VISIT`**: add `GUEST_PERSON_ID integer null` + FK → `PERSON(ID)`; **drop**
  `GUEST_PREFERRED_NAME` (it moves to `PERSON.NAME`). Visit-*episode* data —
  `GUEST_DESCRIPTION`, `GUEST_ACTION_PLAN`, camp fields, arrival/departure —
  **stays on `VISIT`**, gated by visit access as today. The registry holds
  *identity*; the visit holds *the episode*. (Legal name: see D-P2.)
- **`INCIDENT__PERSON` / `JOURNAL_ENTRY`**: no schema change — they already FK to
  `PERSON(ID)`.

> ¹ Both this slice and 5c claim "the next" migration number — whichever lands
> first takes it; the other rebases. Append columns last in `current.sql` per the
> replay test's `SHOW CREATE TABLE` ordering.

### 4.2 API

- **Search**: `GET /ims/api/personnel?q=<term>&event=<name>` — prefix/substring
  match over `NAME`, `HANDLE`, and the event's wristband. The result LEFT-JOINs
  `PERSON__EVENT` for the named event so each hit carries that event's
  `wristband?` and `participation_type?` (null = not yet associated with this
  event). Gate: `GlobalReadPersonnel` (= any logged-in user, per R4). Minimal
  typeahead shape: `id`, `display name`, `handle?`, `wristband?`,
  `participation_type?`.
- **Create** (`POST /ims/api/personnel`): `handle` becomes optional; `name`
  added; a person must have at least one. Wristband + `participation_type`
  settable at create (event-scoped → writes a `PERSON__EVENT` row); if omitted,
  the row defaults `participation_type` from the wristband (present →
  `participant`, absent → `public`). Gating split per **D-P1** (below): minimal
  no-login creation from the field vs. full creation by personnel admins.
- **Edit** (`POST /ims/api/personnel/{…}`): grows `name` and **`email`** (the
  frozen-email gap). Status/on-site as today. Per-event `wristband` and
  `participation_type` set/clear (upserts the `PERSON__EVENT` row) — so an admin
  can promote someone to `crew` or fix a misclassification for the current fair.
- **Addressing**: attach/detach and personnel-edit URLs move from
  `{personHandle}` to **`{personId}`** (D-P3) — registry people have no handle.
  Breaking, but the API is web-UI-only (same posture as the Phase 3 renames).
- `?all=true` listing keeps feeding the admin page; consider pagination only if
  the registry grows past what one response handles comfortably (post-fair).

### 4.3 UI — search-first, create-as-fallback

The add-person interaction is **search-first**: you look for the existing person
before you ever create one (the whole point of a unified registry is to avoid
duplicate rows). Flow (decided 2026-06-12, maintainer):

1. User types into the person box → debounced query to the `?q=` search endpoint
   (≥2 chars, D-P4) over name/handle/wristband, scoped to the current event.
2. **While there are matches**, show them in a results dropdown (display name +
   wristband + participation badge) to pick from. No "create" noise yet.
3. **Only when the search returns no match** (or the user dismisses the matches)
   does the UI surface **"Create new person '<typed text>'"** — name prefilled
   from what they typed, wristband optional. This avoids accidental duplicates
   and makes "find the existing person" the default path.

- This needs a **real combobox** (server-driven results + a create affordance),
  **not** the native `<input list=datalist>` used today — which also delivers the
  visible dropdown affordance that round-2 **6d.3** asks for. Build the two
  together if 6d and 5e.2 are scheduled near each other.
- **Incident & visit attach flows** both use this component. Inline create from
  the field writes a minimal `PERSON` (+ `PERSON__EVENT` for wristband/type) per
  D-P1 gating.
- **Visit page**: guest identity uses the same picker, populating
  `GUEST_PERSON_ID`; episode fields unchanged.
- **Admin People page**: search box (same `?q=` endpoint), per-row profile edit
  (name, email, status, on-site), per-event wristband + **participation-type**
  editor, and a per-event type badge (crew / participant / public).

### 4.4 Roles & permissions tie-in

- 5b's tiers (Basic Reporter / Coordinator / Management) apply to **login-capable
  people only**; registry-only people hold no access and never appear in authz.
- **`participation_type = 'crew'` (5e) vs. crew *membership* (`PERSON__TEAM`, 5c)
  are different granularities.** 5e's enum is the coarse per-event flag "is this
  person staff this fair"; 5c's `PERSON__TEAM` records *which specific crews*.
  They're related but not redundant — and note **`PERSON__TEAM` is currently
  global** (not per-event), so we can't derive the per-event `crew` flag from it
  today. That mismatch (should crew membership itself be per-event?) is **D-P6**,
  parked with 5c; 5e stores the explicit per-event flag regardless.
- 5d's people-admin UI work should land **after** (or fold in) 5e's admin-page
  changes to avoid building it twice.

## 5. Slices

Branch-per-slice, PR-per-slice, each independently green.

- **5e.1 — Schema + sqlc** *(this slice — migration `42-from-41.sql`, schema v42)*:
  `PERSON.NAME` + nullable `HANDLE`; `PERSON__EVENT` (`WRISTBAND` +
  `PARTICIPATION_TYPE`); `VISIT.GUEST_PERSON_ID` + FK; seed updates (NAME backfill,
  a registry-only handle-less person, per-event participation rows). **Two items
  were deferred out of 5e.1 to keep the product green between PRs** (expand-now /
  contract-later):
  - the **`GUEST_PREFERRED_NAME` drop moved to 5e.3** — dropping it before the
    visit UI populates `GUEST_PERSON_ID` would strip guest-name capture from the
    visit page in the interim;
  - the **LEFT-JOIN search query moved to 5e.2** — it's built and tested with its
    endpoint rather than left as a dead, untested query in the foundation PR.

  Implementation note: nullable `HANDLE` rippled to only ~6 raw sqlc-row reads
  (`directory/local.go` seam + the incident/visit people + journal-author joins +
  `person.go` create/edit params); the `directory.User` domain type absorbs the
  `NullString`, so login / JWT / authz were untouched.
- **5e.2 — Search + create-as-fallback**: the `?q=` endpoint **and its LEFT-JOIN
  search query** (carried over from 5e.1), the search-first **combobox** on
  incident/visit attach flows (replaces the native datalist; delivers 6d.3's
  affordance), inline minimal-create, handle→ID URL migration.
- **5e.3 — Visit guest linkage**: visit page person picker; visit JSON gains
  `guest` person ref; **drop `VISIT.GUEST_PREFERRED_NAME`** once guests link to a
  `PERSON` row (deferred here from 5e.1).
- **5e.4 — Admin registry UX**: search, profile/email edit, per-event wristband +
  participation-type editor, type badge.

## 6. Decisions needed before build

| # | Decision | Recommendation |
|---|---|---|
| D-P1 | Who may create **no-login** people inline from incident/visit flows? Field users don't hold `GlobalAdministratePersonnel`. | Allow **event writers** (`EventWriteIncidents` / `EventWriteVisits`) to create *minimal* registry entries (name + wristband only). Full profiles, emails, logins, status stay on `GlobalAdministratePersonnel`. |
| D-P2 | Where does **guest legal name** live? | Keep `GUEST_LEGAL_NAME` on `VISIT` (episode-scoped, gated by visit access) — it's sensitive and White Bird-specific; `PERSON.NAME` is the *preferred* name. Revisit if legal name turns out to be needed cross-visit. |
| D-P3 | Attach/edit URLs: handle → person ID | **Switch to `{personId}`** — registry people have no handle; IDs are the stable key (`person_id` was the whole point of Phase 3). Web-UI-only API makes the break cheap. |
| D-P4 | Does typeahead require a minimum query length? | Yes, ≥2 chars (avoids dump-the-registry-in-one-keystroke; cheap guard). |
| D-P5 | Where does **follow-up contact** (phone) live? (from round-2 feedback, [`61-feedback-round-2.md`](61-feedback-round-2.md) §3) | Add `PERSON.PHONE` — contact info is reusable identity, global on `PERSON`; a one-off witness's incident-specific detail stays on the incident. Witness itself = an involved person with `involvement = "witness"`. |
| D-P6 | Should crew **membership** (`PERSON__TEAM`, 5c) become per-event, to match the per-event `participation_type`? | **Parked with 5c.** For beta, 5e stores the explicit per-event `crew` flag; specific crew membership stays global until 5c decides. Revisit if the global-membership vs per-event-flag split causes confusion. |

## 7. Sequencing & risk

Within Phase 5, sequence freely **except**: 5e.1 (schema) should land **before
5d** (whose people-admin UI would otherwise be built against the old shape), and
migration numbers coordinate with 5c. Risk **Med**: nullable `HANDLE` touches
login/JWT/authz code paths that assume a handle exists (login by handle keeps
working — login users always have one — but audit every `HANDLE`-keyed lookup);
the handle→ID URL migration is mechanical but broad.

## 8. Exit criteria

- One `PERSON` table holds all people (identity only); each person's wristband
  and **explicit per-event classification** live on `PERSON__EVENT`; visit guests
  are linked rows, not freeform text.
- Field users **search first** and only create a new person when no match is
  found; search matches name/handle/wristband.
- Wristbands and participation type are per-event and editable; a person's
  classification for one fair is independent of their (global, permanent) login.
- Admins can edit the full profile **including email** and per-event
  wristband/type, and search the registry.
- `go test ./...`, generators, build green; migration replay == `current.sql`.
