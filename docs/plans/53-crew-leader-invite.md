# Plan 53 — Crew leaders & inviting reporters

Status: **Plan — for review**

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

### 3.4 Frontend (slice 53c)

- **Nav reveal** (`ims.ts`): reveal the People tab when
  `event_access[event].inviteReporters` (covers writer + crew_leader) **or**
  `admin`. (Mirrors the existing dashboard/People reveal pattern, OR-ing in the
  new flag.)
- **People page** (`people.ts` / `people.templ`): when the viewer is a non-admin
  inviter (`inviteReporters && !admin`):
  - Show the roster and the **Add person** flow, but constrain it to **invite a
    reporter**: the create/add form sets participation to `reporter` (no writer/
    crew_leader options), no admin toggle, no password-reset button on existing
    rows. The "initial password" field on create stays (so the invitee can log
    in).
  - The inline role menu (52e) offers only the rungs a non-admin may assign
    (`reporter`/`participant`/`public`; destructive `not_present`/`ejected` stay
    in the Remove modal) — never `writer`/`crew_leader`.
  - Admins keep the full UI (all rungs incl. `crew_leader`, password, admin
    toggle).
- The inline role menu and Add/Edit modals gain `crew_leader` as an **admin-only**
  selectable rung (so admins can promote someone to crew leader).

## 4. Slices

- **53a — schema + authz.** Add the `crew_leader` enum value, the
  `EventInviteReporters` bit, derive it for writer/crew_leader, surface
  `inviteReporters` in `AccessForEvent`. No behavior change yet (no caller uses the
  bit). Tests: authz derivation per rung; migration apply.
- **53b — backend invite.** Scope `CreatePerson` + `SetPersonParticipation` to
  `EventInviteReporters` with the non-admin reporter-ceiling + anti-escalation.
  Tests: a writer/crew-leader can create a login-capable reporter and set reporter
  participation on their event; cannot set writer/crew_leader (403); cannot act on
  an event they lack the bit on (403); admin path unchanged.
- **53c — frontend.** People tab reveal to inviters; restricted People UI for
  non-admin inviters; `crew_leader` as an admin-only rung in the role menu/modals.

Order: 53a → 53b → 53c. Each its own PR.

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
