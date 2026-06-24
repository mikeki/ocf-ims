# Plan 53 — Crew leaders & inviting reporters

Status: **Built** (53a #85, 53b #86, 53c #87, 53d) — all slices shipped.

## 1. Motivation

Today, bringing a new person into IMS is an **admin-only** act. Setting a
person's per-event participation and creating a login-capable person both require
`GlobalAdministratePersonnel`, which only admins hold (plan 52 keeps admin the one
global role). Event-writers can create a *name-only* person on the fly (the
incident/visit picker — plan 5e), but they cannot give that person a login or a
role.

For the fair we want **crew leaders** to onboard their own crew: a crew leader
should be able to **invite a person to the system as a `reporter`** — create their
login and put them on the event as a reporter — without an admin doing it for
them.

## 2. Decisions (locked with the maintainer)

- **`crew leader` is a new participation rung.** Its access is **reporter-level**
  (own reports only, *no* incident visibility — exactly what `reporter` gets) plus
  one extra capability: it can **invite reporters** to its event.
  - So `crew_leader` ⊃ `reporter` only by the invite power; their incident/report
    access is identical.
- **The invite power belongs to writers *and* crew leaders** (and admins, who can
  do everything). A plain `reporter` cannot invite. Concretely there is a new
  per-event capability **"invite reporters"** held by `writer` and `crew_leader`.
- **"Invite" means in-app add as a reporter** (the option chosen over email
  invites — there is no email infrastructure yet). The inviter creates (or finds)
  the person, gives them a **handle + an initial password** so they can log in,
  and sets their participation to **`reporter`** for the inviter's event.
- **The People tab opens to writers and crew leaders** (not just admins), since
  that is where the invite/roster UI lives.
- **Anti-escalation is the hard constraint.** A non-admin with the invite power
  may set a person's participation **only to `reporter` or a non-access rung**
  (`participant`/`public`/`not_present`/`ejected`) — **never** `writer` or
  `crew_leader`. They cannot mint other inviters, writers, or admins. Minting
  writers/crew-leaders and toggling admin stay admin-only, exactly as today.

### Resulting role table (extends plan 52)

| Rung | Incident/report access | Invite reporters? | Dashboard? |
|---|---|---|---|
| `writer` | all incidents + all reports | **yes** | yes |
| `crew_leader` *(new)* | own reports only (no incidents) | **yes** | no |
| `reporter` | own reports only (no incidents) | no | no |
| `participant` / `public` | none | no | no |
| `not_present` / `ejected` | none | no | no |

Admin (`PERSON.IS_ADMIN`) bypasses everything as before.

Ladder order (most → least privileged), used for the inline role menu and roster
display: `writer > crew_leader > reporter > participant > public > not_present >
ejected`.

## 3. Design

### 3.1 Schema (slice 53a)

- New migration: add `'crew_leader'` to the `PERSON__EVENT.PARTICIPATION_TYPE`
  enum (single squashed baseline + goose seq; bump the hardcoded goose version in
  `store/integration/migrate_test.go`). The enum becomes:
  `('writer','crew_leader','reporter','participant','public','not_present','ejected')`.
  Append-only, no data transform.
- `sqlc generate` picks up the new `PersonEventParticipationTypeCrewLeader`
  constant.

### 3.2 Authorization (slice 53a)

- New event permission bit **`EventInviteReporters`** in `lib/authz/permission.go`.
- `participationToEventPerms`:
  - `writer` → existing `EventWriter` perms **+ `EventInviteReporters`**
  - `crew_leader` → existing `EventReporter` perms **+ `EventInviteReporters`**
  - `reporter` → `EventReporter` perms (unchanged)
  - others → none
- Admin bypass already grants `EventAllPermissions`; add `EventInviteReporters` to
  `EventAllPermissions` so admins keep full coverage.
- `api/auth.go` `AccessForEvent`: add `inviteReporters bool` (= the bit is set), so
  the frontend can reveal the People tab and the invite UI. (TS `AuthInfoEventAccess`
  gains `inviteReporters`.)

### 3.3 Backend endpoint gating (slice 53b)

The two currently admin-only writes get a second, **scoped** path. In all cases
admins keep their existing unrestricted path; the new path is additive.

- **`CreatePerson`** (`api/person.go`): allow a caller with `EventInviteReporters`
  on the target event to create a **login-capable** person (handle + email +
  initial password) — today that requires `GlobalAdministratePersonnel`. The
  participation they may set on create is **ceilinged to `reporter`/non-access
  rungs** (see below). Admins are unchanged.
- **`SetPersonParticipation`** (`api/person.go`): allow a caller with
  `EventInviteReporters` on that event to set participation, **ceilinged**: a
  non-admin caller may set only `reporter`/`participant`/`public`/`not_present`/
  `ejected` — attempting `writer` or `crew_leader` → `403`. Admins unchanged.
- **Shared ceiling helper**: `mayAssignParticipation(callerIsAdmin, target)` →
  admins may assign anything; non-admins may not assign `writer` or `crew_leader`.
  Used by both endpoints (and by `EditPerson`/`CreatePerson`'s participation
  handling).
- `EditPerson` (profile fields: name/email; password/admin) stays
  `GlobalAdministratePersonnel`-gated. The invite flow does **not** let a crew
  leader edit arbitrary people's profiles or reset existing passwords — it only
  *creates* a person and *sets reporter participation*. (Resetting a reporter's
  password later stays an admin task for now; revisit if it bites.)
- **Action logging**: the new scoped create/participation paths are mutating —
  register/keep `LogRequest(true, …)`.

### 3.4 Frontend — People page redesign (slices 53c + 53d)

The People page is today a flat `<ul class="list-group">` where every row carries
a wall of colored badge-buttons (Set password / Admin / Edit / Remove), shown to
everyone regardless of what they may do. Opening it to writers/crew-leaders makes
both problems worse, so the redesign tackles **readability** and
**access-awareness** together.

- **Nav reveal** (`ims.ts`): reveal the People tab when
  `event_access[event].inviteReporters` (covers writer + crew_leader) **or**
  `admin`. (Mirrors the existing dashboard/People reveal pattern, OR-ing in the
  new flag.)

- **Layout → a roster table** (`people.templ` / `people.ts`): replace the
  list-group with a responsive Bootstrap table — columns **Name · Handle ·
  Wristband · Role · Actions** — wrapped in `.table-responsive` for phones. The
  **Role** cell keeps the 52e inline click-to-edit badge. All the per-row action
  buttons collapse into a **single per-row actions menu (a `⋯` kebab dropdown)**,
  which de-clutters the row and is the natural place to show/hide actions by
  access.

- **Access-aware actions.** The kebab menu and the "Add" button render only what
  the viewer may do to that target. Derived from the locked decisions:

  | Action | Admin viewer | Writer / Crew-leader (inviter) |
  |---|---|---|
  | Change role (inline badge) | any rung incl. `writer`/`crew_leader` | up to **`reporter`** (+`participant`/`public`); **only** on a target currently at reporter-or-below |
  | Reset password (existing person) | ✅ | ❌ (admin-only) |
  | Set **initial** password | on create | **on create / invite** |
  | Toggle admin | ✅ | ❌ |
  | Edit profile (name / email) | ✅ | ❌ |
  | Remove / eject from event | ✅ | only on a reporter-or-below target |
  | Top "Add" button | **Add person** (full form) | **Invite reporter** (scoped form) |

  - A row whose target **outranks the viewer's ceiling** (e.g. a crew-leader
    looking at a writer/crew_leader/admin) shows **no** management actions — it is
    read-only for that viewer. The role badge is likewise non-editable there.
  - **Add / Invite form**: admins get today's full Add-person modal (all rungs incl.
    `crew_leader`, optional initial password). A non-admin inviter gets a scoped
    **"Invite reporter"** form: name + handle + email + **initial password**
    (kept — so the invitee can log in), participation fixed to `reporter`, no
    admin/role pickers.
  - The inline role menu and the admin Add/Edit modals gain `crew_leader` as an
    **admin-only** selectable rung (so admins can promote someone to crew leader).

- The redesign is **access-aware but role-agnostic in shape**: the same table
  serves admins, inviters, and (read-only) anyone else who can reach the page —
  the kebab just carries fewer items.

## 4. Slices

- **53a — schema + authz.** ✅ Done. Added the `crew_leader` enum value (migration
  `00006`, goose v6), the `EventInviteReporters` bit (in `EventAllPermissions` for
  the admin bypass), derived it for writer/crew_leader in `participationToEventPerms`,
  and surfaced `inviteReporters` in `AccessForEvent` (+ TS `AuthInfoEventAccess`). No
  behavior change yet (no caller uses the bit). Tests: authz derivation per rung;
  migration apply (`migrate_test` bumped to v6).
- **53b — backend invite.** ✅ Done. Scoped `CreatePerson` + `SetPersonParticipation`
  to `EventInviteReporters` (the old admin-only `eventForFieldCreate` write-gate
  became `eventForInvite`, checking the invite bit — writers still qualify, so the 5e
  field-create path is preserved). Shared `mayAssignParticipation(callerIsAdmin,
  target)` ceiling enforced server-side on both endpoints; `SetPersonParticipation`
  additionally refuses to modify a target already at writer/crew_leader. Seeded a
  crew-leader test user (Erin, 6005). Tests (`TestCrewLeaderInvite`): a crew leader
  and a writer can each create a login-capable reporter (who can log in) and set
  reporter participation; cannot assign writer/crew_leader (403); cannot touch a
  writer target (403); cannot act on an event lacking the bit (403); admin path
  unchanged.
- **53c — People table redesign (admin-only first).** ✅ Done. Replaced the flat
  list-group with a responsive roster table (Name · Handle · Wristband · Role ·
  Actions); every per-row action (Edit / Set password / Admin / Remove from event)
  collapsed into a single `⋯` kebab dropdown. The 52e inline role badge stays in the
  Role cell. Pure layout — no access change (page stays admin-only). Added a scoped
  `#people .table-responsive { overflow: visible }` rule so the per-row dropdowns
  aren't clipped by the wrapper's overflow (the standard Bootstrap-in-responsive-table
  caveat). `people.ts` selectors moved `ul/li` → `tbody/tr`; the kebab gains a
  divider before the destructive Remove action.
- **53d — open People to inviters + access-aware actions.** ✅ Done. The People nav
  tab reveals to admins **and** per-event inviters (`event_access[event].inviteReporters`).
  `people.ts` now branches on two capability flags — `isAdmin`
  (GlobalAdministratePersonnel) and `canInvite` (the URL event's `inviteReporters`):
  a non-admin inviter reaches only the event doorway, sees a roster table whose kebab
  drops Edit / Set-password / Admin (admin-only) and shows "Remove from event" only on
  a reporter-or-below target; the inline role badge is editable only up to `reporter`
  on reporter-or-below targets (static badge otherwise); the empty kebab is dropped.
  The top button becomes a scoped **"Invite reporter"** form (identity + initial
  password, role fixed to `reporter`, wristband/role pickers hidden). `crew_leader`
  is an admin-only selectable rung in the inline menu + Add/Edit selects. **Backend:**
  the `GET /personnel?all=true&event=` *event roster* opens to inviters (the
  global/no-event + "show all" listings stay admin-only) and withholds email + admin
  flag from non-admin viewers. Tests: `TestInviterRosterRead`.

Order: 53a → 53b → 53c → 53d. Each its own PR. (53c can land in parallel with
53a/53b since it's pure layout.)

## 5. Risks / notes

- **Privilege-escalation surface is the whole point of review.** The ceiling
  (`mayAssignParticipation`) is enforced **server-side** on every write; the UI
  restriction is convenience only. Tests must assert the 403s directly.
- A crew leader creating logins means more people can mint accounts. Acceptable
  per the decision; accounts are still scoped to a `reporter` rung and the
  inviter's event.
- Existing dev seed / tests grant access via `PERSON__EVENT`; add a seeded
  crew-leader user for the 53b integration test (parallel-isolation, like Dave for
  52f).
- No change to the `event_access` response shape beyond the additive
  `inviteReporters` flag; no change to incident/report/visit handlers.
