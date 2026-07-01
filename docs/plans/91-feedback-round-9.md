# Feedback round 9: Fair Name / Legal Name rename, profile card, create rules

## Context

Beta feedback focused on how a **person** is identified and shown. Ships as
**three small PRs straight to master** (no stacking; merge each manually after CI
is green).

The through-line: the **fair name** is the operational identity everyone uses,
and it should lead. Today the system does the opposite — the shared display helper
and every `ORDER BY` resolve `COALESCE(NAME, HANDLE)`, so a person's **full legal
name** is the primary label and the fair name is the fallback. We flip that, and
we sharpen the person form's wording and validation to match.

### Naming: rename the identifiers, not just the labels

Per the user, this is a **real rename through every layer**, not a label alias:

- **DB columns:** `PERSON.HANDLE` → `PERSON.FAIR_NAME`, `PERSON.NAME` →
  `PERSON.LEGAL_NAME` (goose migration, `RENAME COLUMN`). `PERSON`-table only —
  `EVENT`/`INCIDENT_TYPE`/`TEAM`/`POSITION` etc. keep their own `NAME`. (`legal_name`
  already exists in-schema as `GUEST_LEGAL_NAME`.)
- **Go:** sqlc-generated `Person.Handle`/`Person.Name` become `FairName`/`LegalName`
  after regen; every hand-written `.Handle`/person-`.Name` reference follows.
- **JSON keys:** `handle` → `fair_name`, `name` → `legal_name` (snake_case, matching
  `person_id`/`guest_legal_name`).
- **JWT (full-rename, user's call):** claim field + **wire key** `json:"han"` →
  `json:"fair_name"`, accessor `PersonHandle()` → `PersonFairName()`. Because access
  **and** refresh tokens share `IMSClaims`, this invalidates **all** outstanding
  tokens on deploy — **every user re-logs in once.** Acceptable for the beta; note
  it in the deploy runbook.
- **TS / templ:** person object fields (`fair_name`/`legal_name`) and form
  IDs/labels updated to match.

Rationale for the *name* "Fair Name" (not "Radio Handle"): the public and no-access
people don't carry a radio, but everyone at the Fair has a fair name, so it's the
identity label that fits every person in the registry.

### Decisions locked with the user

- **Prefer Fair Name, fall back to legal name.** Wherever a single person label
  is shown, show the fair name (handle) if present, else the legal name.
  (Legal-name-only registry people — reporters, contacts, guests — have no fair
  name, so their legal name still shows as the fallback.)
- **A person is valid with either a fair name or a legal name**, never both empty
  (existing identity invariant). **When a field flow gives us a single typed
  identifier, assume it is the fair name (handle)** — store it in `HANDLE`, not
  `NAME`. Today's inline-create paths do the opposite (store as `NAME`); PR C
  flips them.
- **Full legal name stays visible to writers.** The profile card / roster show the
  full legal name to writers/reporters (Option A). Only **email and phone** remain
  **admin-only** (`GlobalAdministratePersonnel`) — the user previously declined
  widening those to writers, and that stands. So the profile card is role-gated
  only on email/phone; handle, legal name, and per-event participation are visible
  to any viewer who can already see the person.
- **Full identifier rename (PR 0).** `Handle`→`FairName`, `Name`→`LegalName`
  through DB, sqlc, queries, JSON keys, TS, templ, and the JWT claim (wire key
  included). One atomic breaking PR that lands first; A/B/C rebase onto it. See PR
  0.

### Current state (verified, file:line)

- Display helper `personDisplayLabel` (`web/typescript/ims.ts:1098-1104`) returns
  `name` if non-empty, else `handle`. Used by: incident involvement
  (`incident.ts:756`), on-behalf-of (`ims.ts:1973`), person combobox
  (`ims.ts:1372`), @mention typeahead (`ims.ts:2556`). @mention token rendering
  (`ims.ts:2119`) already prefers handle. Journal-entry author renders a bare
  string `entry.author` (`ims.ts:1963`) — **source of that string must be
  checked** (see PR A).
- People roster shows **name and handle in separate columns**
  (`people.templ:320`, `:338`) via `.person-name`/`.person-handle` — not the
  helper, so unaffected by the flip.
- Personnel JSON (`json/personnel.go:19-39`): `Handle`, `Name` (omitempty),
  `Email`/`Phone` (omitempty, **admin-gated**), `Password` (`json:"-"`),
  `IsAdmin`, `PersonID`, per-event `Wristband`/`ParticipationType`. **No
  positions/teams fields today.**
- Email/phone gate: only emitted when
  `globalPermissions & authz.GlobalAdministratePersonnel != 0`
  (`api/personnel.go:75`). Search (`?q=&event=`) and non-admin event roster omit
  them.
- Personnel routes (`api/mux.go:481-499`): `GET /ims/api/personnel` (query-scoped:
  `?all=true`, `?q=`, `?event=`) and `POST /ims/api/personnel`. **No by-id
  single-person lookup exists.**
- Person create (`api/person.go`): identity invariant — handle OR name required,
  never both empty (`:116-118`); password requires handle **or** email
  (`:190-191`); max lengths handle 64 / name 255 (`:40-44`).
- Person form (`web/template/people.templ`): Name label **"Full name"**
  (`:96-98`, id `add_person_name`); Handle label **"Handle (required for login)"**
  (`:125-128`, id `add_person_handle`). Client validation in
  `web/typescript/people.ts:848-914` (name required; when "Provide Access to IMS"
  is on: handle, email, password all required).
- Schema (`store/schema/migrations/00001_baseline.sql:69-90`): `HANDLE varchar(64)`
  **nullable** unique; `NAME varchar(255)` **nullable**. A person may have name
  without handle (and vice-versa). Enforced invariant: at least one.

---

## PR 0 — Rename `Handle`→`FairName`, `Name`→`LegalName` (foundational)

**One atomic PR, lands first.** Pure rename — **no behavior change** (display still
prefers legal name here; PR A flips that afterward). Must be atomic because the DB
column, JSON key, and TS field can't disagree across a deploy. Breaking: DB column,
API JSON keys, and JWT wire key all change together (see re-login note in Naming).

Order of operations (each step compiles before the next):

1. **Migration.** Scaffold with the pinned goose (per CLAUDE.md), one migration =
   the person-identity rename:
   ```sql
   -- +goose Up
   alter table PERSON rename column HANDLE to FAIR_NAME;
   alter table PERSON rename column NAME  to LEGAL_NAME;
   -- +goose Down
   alter table PERSON rename column FAIR_NAME to HANDLE;
   alter table PERSON rename column LEGAL_NAME to NAME;
   ```
   `RENAME COLUMN` is metadata-only; the `UNIQUE (HANDLE)` key auto-follows the
   column (nothing FKs to it). MariaDB DDL isn't transactional, so the two
   statements can't atomically roll back together — acceptable for renames; the
   `Down` reverses. Bump `store/integration/migrate_test.go` per the new migration.
2. **sqlc regen** (`go tool sqlc generate`) — `Person.Handle`→`FairName`,
   `Person.Name`→`LegalName` in `store/imsdb/`. Update every `HANDLE`/person-`NAME`
   reference in `store/queries.sql` (~50 handle refs, incl. the `COALESCE(NAME,
   HANDLE)` in `AllPeople`/`SearchPeople`/`EventRoster` → `COALESCE(LEGAL_NAME,
   FAIR_NAME)` — order preserved, still legal-name-first until PR A).
3. **Go.** Fix the hand-written refs the compiler flags: `api/personnel.go`,
   `person.go`, `incident.go`, `auth.go`, `helpers.go`, `visit.go`, `report.go`,
   `admin.go`, `password.go`, `ratelimit.go`, `directory/local.go`,
   `directory/directory.go`, `lib/log/prettylog.go` (person-handle only — **skip
   the `mux.HandleFunc`/slog false positives**).
4. **JWT (`lib/authz/claim.go` + token builders).** `Handle` field + `json:"han"`
   → `FairName` + `json:"fair_name"`; `WithPersonHandle`/`PersonHandle()` →
   `WithPersonFairName`/`PersonFairName()`; `refreshtoken.go`/`accesstoken.go`
   param `personHandle` → `personFairName`. All outstanding tokens invalidate on
   deploy (documented).
5. **JSON (`json/personnel.go`, `json/person.go`, any person JSON).** `Handle`→
   `FairName json:"fair_name"`, `Name`→`LegalName json:"legal_name"`. Keep
   `omitempty`/gating exactly as-is.
6. **TS.** Person object fields across `ims.ts`, `incident.ts`, `people.ts`,
   `report.ts`, `incidents.ts`, `sanctuary_visit*.ts`, etc.: `handle`→`fair_name`,
   person `name`→`legal_name` (match the JSON keys). `personDisplayLabel` param
   type + body updated (still legal-name-first). Login TS field.
7. **templ.** Form input IDs and hidden fields (`add_person_handle`→
   `add_person_fair_name`, etc.), and user-facing **labels**: "Handle"/"Full name"
   → **"Fair Name"/"Full Legal Name"** across `people.templ`, `quickaddperson.templ`,
   `incident.templ`, `login.templ` ("Email or handle" → "Email or fair name"),
   `sanctuary_visit.templ`. (This absorbs items 3 & 5's label changes.)

**Verify:** `go run bin/build/build.go` (regen + compile catches missed refs);
`go test ./...` + `go test ./store/integration ./api/integration` (migration applies
cleanly; personnel round-trips new keys); `npx eslint`; grep for stray
`"handle"`/person `"name"` JSON keys and leftover `.Handle`. Manual: log out/in
works; People page, incident involvement, person search all render.

---

## PR A — Prefer Fair Name over Legal Name (display)

Lands on PR 0's names. Flip the preference at the single shared helper so every
consumer follows.

- **`web/typescript/ims.ts` `personDisplayLabel`:** flip to prefer fair name:
  ```ts
  export function personDisplayLabel(p: {fair_name?; legal_name?}): string {
      if (p.fair_name != null && p.fair_name.trim() !== "") return p.fair_name;
      return p.legal_name ?? "";
  }
  ```
  Cascades to incident involvement, on-behalf-of, the person combobox, and the
  @mention typeahead — all route through the helper. Confirm by grep that no caller
  depends on the old legal-name-first behavior.
- **Journal-entry author (`ims.ts:1963`, `entry.author`).** Renders a
  server-supplied string, not a person object. **Verify where the string is built**
  (grep the Go builder for the journal-entry `author` field). If it emits the legal
  name, switch it to prefer the fair name so the author line matches the rest of the
  UI. Document which it was.
- **`ORDER BY` (low-priority polish).** Flip the **search/combobox** ordering to
  `COALESCE(FAIR_NAME, LEGAL_NAME)` so list order matches the now-fair-name-first
  labels. **Leave the People roster sort as-is** (distinct legal-name column,
  intentional). Skip if in doubt; the helper flip is the substance.

**Verify:** `npx eslint`; `go run bin/build/build.go`. Manual: on an incident,
people with a fair name now show it; a legal-name-only reporter still shows the
legal name. @mention typeahead, on-behalf-of, and the attach-person combobox all
lead with the fair name.

---

## PR B — Person profile card on click (role-gated)

Clicking a person from an incident opens a modal showing what the viewer's role
permits.

### Data — single-person fetch, reusing the admin gate

There is no by-id personnel lookup today. Add one that **reuses the exact
email/phone admin gate** so PII can't leak to under-privileged viewers.

- Extend `GET /ims/api/personnel` to accept **`?person_id=N&event=<event>`**,
  returning a single person (mirrors the existing query-scoped handler in
  `api/personnel.go`; run the same `GlobalAdministratePersonnel` check at
  `:75` to decide whether `Email`/`Phone` are populated). Read-only →
  `LogRequest(false, …)`. (Alternative: a `GET /ims/api/personnel/{personID}`
  sub-path — pick whichever fits `api/mux.go` more cleanly; the query-param form
  reuses the existing handler with least new surface.)
- **Do NOT** add a second, ungated code path. The card's data must flow through
  the same gate as the admin People page.

### Card contents by role

| Field | Non-admin (writer/reporter) | Admin |
|---|---|---|
| Fair name | ✅ | ✅ |
| Full legal name | ✅ | ✅ |
| Per-event participation / wristband (event context) | ✅ | ✅ |
| Email / phone | ❌ (omitted) | ✅ |

- **Positions / teams — scope decision at build time.** The personnel JSON does
  **not** carry positions/teams today. If a POSITION/TEAM read query is readily
  available to join, include them (visible to all viewers — not sensitive).
  Otherwise **defer** to a fast-follow and ship the card without them; note the
  decision in the PR. Do not block the card on this.

### UI

- **`web/template/incident.templ`** (People/involvement list, ~L168): make each
  person label a clickable affordance (button/link with the person id), and add a
  profile-card modal (reuse the existing modal pattern — `@QuickAddPersonModal`
  in the same file is the template to mirror).
- **`web/typescript/incident.ts`** (~L756): on click, fetch
  `GET /ims/api/personnel?person_id=<id>&event=<event>` and populate the modal.
  Show email/phone rows only when present in the response (they're simply absent
  for non-admins — the client renders what it's given, it does not gate).
- Card rows use the PR-0 field names/labels: **"Fair Name"**, **"Full Legal Name"**.

**Verify:** `go test ./...` plus an `api/integration` case asserting the by-id
fetch returns email/phone for an admin caller and **omits** them for a writer
caller. `npx eslint`. Manual: as a writer, click a person → card shows fair name +
legal name, no email/phone; as an admin, the same click shows email + phone.

---

## PR C — Person create: validity + "typed value is the fair name" (behavior)

Item 4 behavior (labels/rename already done in PR 0). All names below are the PR-0
identifiers (`fair_name`/`FairName`).

### Validity + "a single typed value is the fair name"

- **A person is valid with either a fair name or a legal name.** Already enforced
  by the identity invariant (`api/person.go:116-118`); no change, but add/keep a
  test for the legal-name-only no-access path.
- **Inline quick-create stores the typed value as the fair name, not the legal
  name.** Today's field flows do the opposite:
  - `createRegistryPerson` (`web/typescript/ims.ts:1139-1149`) POSTs
    `{legal_name: value, …}` → change to `{fair_name: value, …}`.
  - `openQuickAddPersonModal` (`ims.ts:1156`) prefills the legal-name field
    (`:1175`) → prefill the **fair-name** field instead; clear legal-name.
  - **Caveat:** `FAIR_NAME` has a UNIQUE key; two registry people with the same
    fair name now collide (a duplicate legal name previously did not, since
    `LEGAL_NAME` is non-unique). The create handler must surface MySQL 1062
    duplicate-key as a friendly `herr` (409/400 "That fair name is already taken"),
    not a raw 500. Verify dup-key handling covers the field-flow POST.

### Validation — fair name required when granting access

For a **password/access** person the server currently requires fair-name **or**
email (`api/person.go:190-191`); the client already requires fair-name+email+password.

- **Tighten the server:** when a password is provided, require the **fair name**
  specifically. Replace the fair-name-or-email check with:
  if `body.Password != "" && fairName == ""` →
  `herr.BadRequest("A fair name is required to provide IMS access", nil)`.
  (Email stays required by the round-8 rule; this makes the fair name mandatory
  too, matching the client, and codifies item 4.)
- **Client (`web/typescript/people.ts`):** already requires the fair name when
  access is on — keep, and ensure the validation message says "fair name".

**Verify:** `go test ./...` (add/adjust a `TestCreatePerson` case: name-only
no-access succeeds; access without a fair name is rejected 400; access with fair
name + email + password succeeds; a field-flow `{fair_name}`-only create succeeds
and a duplicate fair name returns a friendly 409/400, not 500). `npx eslint`.
Manual: create a legal-name-only person (no access) → OK; toggle "Provide Access to
IMS" without a fair name → blocked; from an incident, type a new person into the
combobox and quick-add → the typed text lands in **Fair Name**, not Full Legal Name.

---

## Sequencing

Target master directly, no stacking. **PR 0 must land first** — the others are
authored against its renamed identifiers.

1. **PR 0** (rename, atomic + breaking) — foundational. Deploy = one-time re-login
   for all users (JWT wire-key change); note in the runbook.
2. **PR A** (display flip: prefer fair name) — on PR 0's names.
3. **PR C** (create behavior: typed-value-is-fair-name + fair-name-required) —
   independent of A; on PR 0's names.
4. **PR B** (profile card) — after A so the card's fair-name-first label is
   consistent; codewise independent.

Each merges manually after CI is green.
