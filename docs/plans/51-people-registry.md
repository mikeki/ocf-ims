# Phase 5e — Unified People Registry

> **Status:** Plan / for review. **Owner:** TBD · **Last updated:** 2026-06-11
>
> A new slice in the **Phase 5** family ([`50-roles-permissions.md`](50-roles-permissions.md)),
> added 2026-06-11 from beta-usage feedback (Stakeholder A + maintainer; see
> [`60-feedback-round-1.md`](60-feedback-round-1.md) for the full feedback round —
> the people items were routed here because they reshape `PERSON`, which 5c/5d
> build on).

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
| R3 | Person classification (crew / participant / public) | **Derived, no column**: `PASSWORD` set → **crew**; wristband for the event → **participant**; otherwise → **public**. *Accepted edge case:* a crew member with no login yet derives as participant/public — correct it by setting their password (or live with the label; classification is cosmetic, it drives no authorization). |
| R4 | Typeahead search exposure | **Any logged-in user** — matches the existing gate (`GlobalReadPersonnel` is already granted to `AnyAuthenticatedUser`). Typeahead returns **minimal fields only** (name, handle, wristband, derived type) — nothing about *why* someone is in the registry. Sensitive visit details stay gated by visit access. |

## 4. Design

### 4.1 Schema (migration number assigned at implementation time¹)

- **`PERSON`**:
  - add `NAME varchar(255) null` — preferred/display name. Display resolution is
    `COALESCE(NAME, HANDLE)`.
  - `HANDLE` → **nullable** (`varchar(64) null`, keep `unique` — MySQL allows
    multiple NULLs in a unique key). Handle exists **only for login-capable
    people**; app-level invariant: at least one of `NAME`/`HANDLE` is set.
  - Migrations are **schema-only** (no data transforms), so existing dev rows get
    `NAME` backfilled in `fakeimsdb/seed.sql`, not in the migration. Fine for
    prod: OCF launches fresh.
- **`PERSON__EVENT`** (new):
  ```sql
  create table PERSON__EVENT (
      PERSON_ID integer     not null,
      EVENT     integer     not null,
      WRISTBAND varchar(32) null,
      primary key (PERSON_ID, EVENT),
      unique key (EVENT, WRISTBAND),
      foreign key PE_TO_PERSON (PERSON_ID) references PERSON(ID),
      foreign key PE_TO_EVENT  (EVENT)     references EVENT(ID)
  )
  ```
  Carries per-event attributes; for now just the wristband. (A future shift/onduty
  model could hang off the same row.)
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

- **Search**: `GET /ims/api/personnel?q=<term>` (or a `/search` sub-path) —
  prefix/substring match over `NAME`, `HANDLE`, and the **current event's**
  wristband (`?event=` param for the wristband scope). Gate:
  `GlobalReadPersonnel` (= any logged-in user, per R4). Returns the minimal
  typeahead shape: `id`, `display name`, `handle?`, `wristband?`, derived `type`.
- **Create** (`POST /ims/api/personnel`): `handle` becomes optional; `name`
  added; a person must have at least one. Wristband settable at create
  (event-scoped). Gating split per **D-P1** (below): minimal no-login creation
  from the field vs. full creation by personnel admins.
- **Edit** (`POST /ims/api/personnel/{…}`): grows `name` and **`email`** (the
  frozen-email gap). Status/on-site as today. Wristband set/clear per event.
- **Addressing**: attach/detach and personnel-edit URLs move from
  `{personHandle}` to **`{personId}`** (D-P3) — registry people have no handle.
  Breaking, but the API is web-UI-only (same posture as the Phase 3 renames).
- `?all=true` listing keeps feeding the admin page; consider pagination only if
  the registry grows past what one response handles comfortably (post-fair).

### 4.3 UI

- **Incident & visit attach flows**: the person box becomes a registry-wide
  typeahead (name/handle/wristband) with an inline **"+ Add new person"** option
  (name required, wristband optional) so field users capture people on the spot.
- **Visit page**: guest identity becomes a person picker (typeahead + inline
  create) populating `GUEST_PERSON_ID`; episode fields unchanged.
- **Admin People page**: search box (same `?q=` endpoint), per-row profile edit
  (name, email, status, on-site), per-event wristband editor, derived
  type badge (crew / participant / public).

### 4.4 Roles & permissions tie-in

- 5b's tiers (Basic Reporter / Coordinator / Management) apply to **login-capable
  people only**; registry-only people hold no access and never appear in authz.
- 5c crew membership (`PERSON__TEAM`) naturally only ever references crew people.
- 5d's people-admin UI work should land **after** (or fold in) 5e's admin-page
  changes to avoid building it twice.

## 5. Slices

Branch-per-slice, PR-per-slice, each independently green.

- **5e.1 — Schema + sqlc**: `PERSON.NAME` + nullable `HANDLE`, `PERSON__EVENT`,
  `VISIT.GUEST_PERSON_ID` (+ guest-name column drop), seed updates, query updates.
- **5e.2 — Search + typeahead**: `?q=` endpoint, incident/visit attach typeahead +
  inline create, handle→ID URL migration.
- **5e.3 — Visit guest linkage**: visit page person picker; visit JSON gains
  `guest` person ref.
- **5e.4 — Admin registry UX**: search, profile/email edit, wristband editor,
  type badge.

## 6. Decisions needed before build

| # | Decision | Recommendation |
|---|---|---|
| D-P1 | Who may create **no-login** people inline from incident/visit flows? Field users don't hold `GlobalAdministratePersonnel`. | Allow **event writers** (`EventWriteIncidents` / `EventWriteVisits`) to create *minimal* registry entries (name + wristband only). Full profiles, emails, logins, status stay on `GlobalAdministratePersonnel`. |
| D-P2 | Where does **guest legal name** live? | Keep `GUEST_LEGAL_NAME` on `VISIT` (episode-scoped, gated by visit access) — it's sensitive and White Bird-specific; `PERSON.NAME` is the *preferred* name. Revisit if legal name turns out to be needed cross-visit. |
| D-P3 | Attach/edit URLs: handle → person ID | **Switch to `{personId}`** — registry people have no handle; IDs are the stable key (`person_id` was the whole point of Phase 3). Web-UI-only API makes the break cheap. |
| D-P4 | Does typeahead require a minimum query length? | Yes, ≥2 chars (avoids dump-the-registry-in-one-keystroke; cheap guard). |

## 7. Sequencing & risk

Within Phase 5, sequence freely **except**: 5e.1 (schema) should land **before
5d** (whose people-admin UI would otherwise be built against the old shape), and
migration numbers coordinate with 5c. Risk **Med**: nullable `HANDLE` touches
login/JWT/authz code paths that assume a handle exists (login by handle keeps
working — login users always have one — but audit every `HANDLE`-keyed lookup);
the handle→ID URL migration is mechanical but broad.

## 8. Exit criteria

- One `PERSON` table holds crew, participants, and public; visit guests are
  linked rows, not freeform text.
- Field users can find-or-create a person from the incident/visit flows;
  typeahead matches name/handle/wristband.
- Wristbands are per-event and searchable; people without one read as "public".
- Admins can edit the full profile **including email**, and search the registry.
- `go test ./...`, generators, build green; migration replay == `current.sql`.
