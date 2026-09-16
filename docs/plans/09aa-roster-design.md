<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09aa — The 3c.4 round: the roster on a wide window

> **Status:** Brief written 2026-09-14; the round surface built and walked in a browser
> 2026-09-15 (§ What was built); **Ladder picked 2026-09-16** (§ The pick: a drag and a hovercard
> in the second cut); the 3c.4 acceptance criteria next.
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, §6 **D2** and the 3c.4 row)
> under [09-proto-connect-platform.md](09-proto-connect-platform.md)
> **Follows:** [09x](09x-dispatch-design.md) (the shell, the table, the drawer, the page —
> 3c.1). Independent of 3c.2 / 3c.3 ([09y](09y-incident-editor-design.md),
> [09z](09z-reports-design.md)); the three rounds may run in any order.
> **Owner:** Design (the round, run by the maintainer) → Architect (this brief, the rules,
> the criteria after the pick) → Builder (3c.4).
> **The skills:** Emil Kowalski's skills govern all UI work — `prototype` for the round,
> `animate-expo` for anything that moves, `review-animations` before the PR is called done.
> **Last updated:** 2026-09-14

## Objective

The roster is the event's people: who is here, in what standing, on which crew, and who
may be asked for a report or attached to an incident. templ's People page (plans 53c /
53d) is a table — Name · Role · Crew · Actions — in two groups (people who can sign in,
name-only people), each sorted by role, with an inline role menu per row capped by the
viewer's own standing, a search-first Add person (enrol an existing person, or create one
— name-only, or with a login), a profile card, and a "My crews" panel for crew leaders.
Admins see everything; a writer or crew leader (an *inviter*, `invite_reporters`) sees the
event's roster and may add reporters. The phone client has none of this (E15 puts People
nowhere on the phone; `PersonPicker` is the only client code that lists people).

**What is fixed:** who sees the page, what each viewer may do (the server's ceiling), what
the profile card shows per role, the add flow's steps. **What is open is the roster's
shape** on a wide window: a table grouped by standing, the standing as a place, or a
directory that starts from a name.

## What is already true on the wire (verified 2026-09-14)

- `ListPersonnel(event_id, query, all, person_ids, show_all)` → `Person[]`. Modes by
  precedence: `query` = the event-scoped typeahead (any viewer); `person_ids` = exactly
  those people (any viewer: identity + picture; email / phone only for a personnel admin
  or on the caller's own row; with `event_id` the wristband, participation and crews);
  `all=true` = the listing with email / phone / `has_password` / `is_admin` populated —
  **the event roster (`event_id` set, `show_all` false) opens to an inviter holding
  `EventInviteReporters` on that event; the global listing and `show_all` stay
  admin-only**; none set = the login directory. `Person` = handle, name, email?, phone?,
  `has_password`, `is_admin` (admin viewers only), `person_id`, `profile_picture_url?`,
  `wristband?`, `participation_type`, `crews[]` (`crew_name`, `crew_slug`, `is_leader`).
- `ParticipationType`: WRITER · CREW_LEADER · REPORTER · VOLUNTEER · PUBLIC · NOT_PRESENT
  · EJECTED. templ's labels: FC/BUM (writer), Reporter, Volunteer, Public; crew leader is
  **derived** from leading a crew (10c) and is never hand-assigned; not_present / ejected
  are set through "Remove from event".
- `SetPersonParticipation(person_id, event_id, wristband, participation_type)` — the
  ceiling (`mayAssignParticipation`, 53b): an admin any rung; an inviter only reporter or
  a no-access rung, never writer / crew_leader, and a target already above the ceiling is
  refused. `RemovePersonFromEvent(person_id, event_id)`. `CreatePerson(handle, name,
  email, phone, password | use_default_password, event_id?, wristband, participation_type)`
  — an inviter's create with `event_id` lands as a reporter. `SetPersonPassword`,
  `SetPersonAdmin`, `UpdatePerson`, `DeletePersonProfilePicture` are **3d.1's**.
- `ListMyCrews(event_id)` → the crews the caller leads, with members;
  `SetMyCrewMembership(event_id, crew_slug, person_id, remove, is_leader)` — a leader adds
  / removes plain members; leaders are admin-managed (`ListCrews` / `SetCrewMembership`
  are 3d.2's).
- `AccessForEvent.invite_reporters` and `GetAuthStatus.admin` are on the client already
  (`src/lib/permissions.ts`, security-tier, read-only for a builder).
- **No proto change is needed.** The roster's grouping, counts and sorting are client-side
  over one `ListPersonnel(event_id, all=true)`.

## What the client is today

Nothing roster-shaped. `features/compose/PersonPicker.tsx` (+ `hooks.ts`) is the typeahead
over `ListPersonnel(query, event_id)`; `PeopleEditor` (3c.2) shows attached people on an
incident; the shell has Incidents, Alerts and (after 3c.3) Reports. There is no profile
card and no route under `/events/[eventId]/people`.

## What is fixed (the round shows it, does not vary it)

- **The People item** in the shell, shown when `isAdmin(auth)` or
  `access.inviteReporters`; the route `/events/[eventId]/people` (wide only in this
  slice; the phone gets nothing — decision 1).
- **The profile card** (in the drawer from the roster; also what `PeopleEditor`'s person
  rows open later): picture, name, handle, this event's role, crews (led ones marked),
  wristband; email / phone only when the server sent them; the admin shield only when
  `is_admin` came. Nothing implies a withheld field exists.
- **Role change** is the roster's one edit: the rungs a viewer may set are the server's
  ceiling (admin: all four; inviter: Reporter · Volunteer · Public, and nothing on a
  writer or a crew leader), a name-only person (`has_password` false) only the no-access
  rungs; one `SetPersonParticipation` per change, the row updates on the refetch.
  **Remove from event** behind a confirm, with Not present / Ejected as its two forms.
- **Add person**, search-first: a field over `ListPersonnel(query)`; a hit enrols (one
  `SetPersonParticipation`), no hit offers Create: name-only (fair name, legal name,
  email / phone optional) or with a login (email + handle required; the shared default
  password or an explicit one); an inviter's create is a reporter and says so.
- **My crews**, for a crew leader: their crews with members, add a member from the
  search, remove a plain member; leaders read-only.
- **Keyboard:** 09x's map — `j` `k`, Enter opens the card, Esc, `/` search, `n` add
  person, `?` help.

## The prototype round (the maintainer's to run)

Dispatch is chosen; the pane is chosen. **What is open is how forty to two hundred
people read on a wide window**, and the three shapes below are the honest answers.
Each is judged at 1024 and 1440 with the same fixture roster.

| Variant | Axis | The claim it makes | What it costs |
|---|---|---|---|
| **Table** | *Grouped by standing* — templ's 53c done in the 3c.1 table | Name (picture, handle as caption, the admin shield) · Role · Crews · Wristband, in sections with a header row and a count per rung (FC/BUM 6 · Crew leaders 4 · Reporters 31 · Volunteers 12 · Public 3), name-only people in a second block. Role is a menu on the cell; a row opens the card in the drawer; the search filters every section. | Two hundred rows is one long scroll; the sections' counts are the only overview. The role menu on a cell is the one new control on a 3c.1 row. |
| **Ladder** | *Standing as a place* — a column per rung | Five columns (writers · crew leaders · reporters · volunteers · public), each a stack of person cards (picture, name, crews as chips), the count in the column header, name-only people dimmed in place. Changing a role is moving a card: drag on web, a "Move to…" menu on the card everywhere; the ceiling greys the columns the viewer may not fill. The card opens the profile in the drawer. | Reporters are most of the fair, so one column holds most of the cards and the rest are short; at 1024 five columns are ~190 px each, so a card is a name and little else. Drag is a gesture with no home in the motion budget yet and must degrade to the menu. |
| **Directory** | *A name first* — search, then facets | One column, alphabetical by fair name with a letter index at the right, a large search field at the top, and facets on the left (Role with counts, Crew with counts, "Can sign in"). Each row: picture, name, handle, role as a tinted chip, crews as chips. The role chip is the menu; the card opens beside the list as the drawer. | The overview is the facet counts, not the list; a dispatcher wanting "the writers on shift" filters first. The letter index and the facet rail are two new pieces of chrome; at 1024 the rail is 200 px. |

Every variant shows, with fixture data: a roster of **~60 people** — 6 writers (one the
viewer, one an admin with the shield), 4 crew leaders across 3 crews (one leads two),
31 reporters (several on crews), 12 volunteers, 3 public, 8 name-only people without a
login, pictures on about a third; **the admin's view** (email / phone in the card, every
rung in the menu); **the inviter's view** (a crew leader: no contact fields, the menu
capped at Reporter, writers' and crew leaders' rows without a menu, the My crews panel
with their two crews); **a role change that fails** (the server refuses: the row keeps the
old role, the error at the control); **Add person** with a hit (enrol) and with no hit
(Create, both forms, the inviter's reporter note); **Remove from event**; the empty
roster; reduced motion on. At **1024 and 1440**, both schemes.

**How to run it:**

```
/prototype 3c.4 — the roster for plan 09i (docs/plans/09aa-roster-design.md).
Three variants on the axes in that file's prototype-round table: Table, Ladder, Directory.
Dispatch is chosen and the pane is chosen — diverge on HOW THE ROSTER READS, not on
colour, the shell or the drawer; read tokens through useTheme() and reuse the existing
primitives, Badge, Chip, PersonPicker, ScreenHeader, the 3c.1 Table and Drawer chrome.
Do not modify src/design/* or the existing src/features/*. Dev-only Expo Router route
outside the session gates inside the real Shell chrome at 1024 and 1440; fixtures plus
createFakeIms(), no server. Writes are fake and per field (the fake answers after 300 ms,
one role change configured to fail). Motion: only PressFeedback and StateFade from
src/design/motion.tsx; a drag, if a variant has one, is a hard cut on drop and always has
a menu twin.
```

The surface lives at `app/(dev)/people.tsx` + `src/prototypes/people/` and is deleted
in the 3c.4 PR. The 09z surface (`src/prototypes/reports/`) is the current harness
pattern: its `Picker.tsx`, `Harness.tsx` band, `Shell.tsx` copy and runtime are the
starting point; `createFakeIms()` gains `listPersonnel` modes, `setPersonParticipation`,
`removePersonFromEvent`, `createPerson`, `listMyCrews`, `setMyCrewMembership` in the
surface's `fake.ts` wrapper (the stock fake has only the typeahead).

### What was built — the surface (2026-09-15)

`app/(dev)/people.tsx` + `src/prototypes/people/` (throwaway, outside the session gates,
no server, deleted in the 3c.4 PR). Run it with `pnpm -F @ocf-ims/interface start` (never
`CI=1`) and open `http://localhost:8081/people?v=1` (`1`/`2`/`3` or `←`/`→` flip the
picker). The band takes the width (1024 / 1440 / fit), the scheme, the viewer (admin;
inviter — a crew leader leading two crews; writer-inviter) and "Fail the next role
change". A 64-person roster over three crews; the shell copy carries People, My crews
(for a leader) and Add person; the profile card opens in the drawer (`open=`).

The fake (`fake.ts`) implements every `ListPersonnel` mode with the wire's field gating,
`SetPersonParticipation` with the ceiling, `RemovePersonFromEvent`, `CreatePerson` (an
inviter's create is a reporter), `ListMyCrews` / `SetMyCrewMembership`, and a
`GetAuthStatus` carrying `invite_reporters`. `useRoster.ts` is § One field, one request as
code and is what the winner promotes.

Built by a builder Agent (the harness, fixtures, fake, card and Table: 138 calls / 306K),
a second that died on a usage limit with Ladder / Directory / Add person / My crews
written but unwired (finished and fixed by the architect), and a fix pass (122 calls /
172K). **Walked in Chrome** at 1440 and 1024, light and dark, as the admin and the
inviter: the capped menus, a role change that lands and one that fails, Add person by
`n`, My crews, Esc, the Ladder's move menu — the console clean.

**Found by running it, not by reading it** (each one passed typecheck, Jest, the export
and the smoke e2e):

1. **A surface must not import `@/test/harness`** — it loads
   `@testing-library/react-native` and the router dies with `expect is not defined` (the
   same finding as 09z). The surface has its own `runtime.ts`.
2. **RN Web renders `accessibilityRole="button"` as a real `<button>`.** A roster row that
   opens the card and also holds the role menu nested a `<button>` in a `<button>`
   (invalid HTML; a screen reader flattens the menu into the row). **3c.4 criterion:** the
   row's press target and the role menu are siblings — never a menu inside a
   button-role row.
3. **An absolutely positioned menu inside a FlatList cell paints under the next cell**, so
   no option could be pressed. The open cell raises its `zIndex` through a
   `CellRendererComponent` — which must be a **stable** component reading the open row from
   context: an inline one changes identity, remounts every cell and closes the menu it
   just opened. **3c.4 criterion:** the menu renders in a portal / `Modal` anchored to the
   trigger, or the stable raised cell; either way, a test presses an option of the last
   visible row.
4. **A fire-and-forget write must not rethrow.** The hook recorded the error on the row
   and rethrew, and the menu's `void roster.setRole(…)` became an uncaught rejection (the
   red box) instead of the message at the control. The promoted hook returns; the error
   lives in `errorFor`.
5. **A key that opens something with an autofocused field must `preventDefault`**, or the
   key types into it (`n` left an "n" in Add person's search). **The shipped dispatch map
   has the same shape:** `n` opens the new-incident form, whose summary autofocuses, with
   no `preventDefault` (`src/features/dispatch/useKeyboardMap.ts`). Whether the letter
   lands depends on navigation timing — a staging check for the maintainer, and a one-line
   fix if it does.
6. **Esc on a side panel** needed a capture-phase listener above the variant's own map.
   The real slice's keyboard map owns an overlay stack (panel, then drawer).
7. **RN Web's `View` types carry no drag props**, so the Ladder has no drag; "Move to…" on
   every card is the only move. If the Ladder wins, a drag is a later Gesture Handler
   choice, never the only path.
8. **The Ladder scrolls sideways at 1024** (five columns ≥ 180 px): its stated cost,
   measured.
9. **`RemovePersonFromEvent` carries no rung.** Remove's two forms (Not present, Ejected)
   are `SetPersonParticipation` writes; `RemovePersonFromEvent` drops the row. **3c.4
   criterion:** the client sets the rung and does not call `RemovePersonFromEvent`.
10. **The stock fake has only the typeahead** — no `all` / `person_ids` / `show_all`
    modes, none of the writes, no `invite_reporters` on `FakeUser`. Promotion moves the
    surface's handlers into `src/test/fakeIms.ts`.
11. Fixture only: RN Web percent-encodes a `utf8` SVG data URI itself, so a pre-encoded
    one fails to load and the avatar falls back to its initial.

Verified with the surface in the tree: typecheck, biome, Jest (50 suites, 365 tests),
`export:web` and the smoke e2e green; the route walked in Chrome with a clean console.

### The pick — Ladder (2026-09-16)

The maintainer picked **Ladder**, with two asks:

1. **Drag people between the columns.** The round's Ladder had only the "Move to…" menu
   (finding 7). The second cut adds the drag: a card is picked up from its grip, follows
   the pointer as a ghost (transform only, a shared value), the column under the pointer
   lights as the target — or reads as not a target where the ceiling forbids it — and the
   drop is a hard cut (the card is in its new column, the write is the same
   `SetPersonParticipation`); a drop outside any column springs the ghost home
   (`{ duration: 400, dampingRatio: 0.8 }`, a hard cut under reduced motion). The menu
   stays as the twin for the keyboard and for touch. **This is the first drag in the
   client and needs a DESIGN.md amendment** (the motion budget says "nothing here is
   dragged"): one line for the drag, its spring on snap-back only, and the menu twin.
   Web first through pointer events in the surface; the slice uses Gesture Handler.
2. **A hovercard instead of the drawer.** The 66 % drawer is mostly empty for six lines.
   A card's details open in a **hovercard** anchored to the card — on hover (web, after a
   short delay) and on press (touch) — with the profile card's content: the picture,
   name, handle, role, crews, wristband, email / phone when sent, the admin shield, and
   Remove from event. Esc or a press outside closes it. The drawer stays only for Add
   person and My crews.

The decisions, as they stand: (1) wide only; (2) the role changes by drag or by the
card's menu; (3) the hovercard, not the drawer; (4) the search filters every column;
(5) pictures at 32 px on the card, larger in the hovercard, an initial when absent;
(6) the wristband in the hovercard only. Table and Directory stay in the surface until the
3c.4 PR deletes it.

### Decisions the round must also take (shape-independent, but only visible when run)

1. **The phone.** E15 has no People tab; templ's page is used from the tent, not the
   field. Recommendation: **wide only** in 3c.4; a phone roster is a 3c.6 line item if
   anyone asks.
2. **Where the role changes.** On the row (Table / Directory) or by moving (Ladder). In
   every case a confirm is NOT shown for a change within the ceiling (templ writes on
   pick), and IS shown for Remove from event.
3. **The card.** In the drawer (66 %) as 3c.1 opens an incident, or narrower — a person
   has six lines, not forty; the round judges whether the 3c.1 drawer width reads empty.
4. **Search across rungs vs within.** Table filters every section; Ladder filters every
   column; Directory is search-first. The round decides what `/` means.
5. **Pictures.** The `profile_picture_url` served through the blob helper (3b.4); shown
   at 32 px on a row, larger on the card. Whether rows without one get an initial or
   nothing.
6. **Wristband.** A column (Table), on the card only (Ladder / Directory), or both.

## The rules the winner inherits (shape-independent)

### Gating and the ceiling

The page is reachable by `isAdmin(auth) || access.inviteReporters`, else the item is
absent and the route answers the Not found state. The client hides what the server
refuses: an inviter sees no menu on a writer's or a crew leader's row, no writer /
crew-leader rung anywhere, no contact fields, no admin shield, no `show_all`. The server
is the boundary; the client never sends a rung it did not offer.

### Privacy

Email and phone render only when present on the wire; their labels never appear
otherwise. `is_admin` likewise. A name-only person is shown as such ("No login"), never
as "no email".

### One field, one request

`useRoster`: `setRole(personId, rung)`, `remove(personId, rung)`, `enrol(personId)`,
`create(form)`; optimistic on the row, the error at the control, invalidate
`ListPersonnel` (every mode) and `ListMyCrews` on settle.

### Keyboard, motion, the phone

09x's map; press feedback only, a drop is a hard cut; the phone is untouched.

## 3c.4 acceptance criteria (the builder's list, after the pick)

_Written after the pick._

## Out of scope

- Editing a person's identity or contact, set password, the admin toggle, the picture —
  3d.1. Crews administration (leaders, create / delete) — 3d.2.
- A phone roster (decision 1). Any proto change.

## Verification (for the round)

`pnpm -F @ocf-ims/interface typecheck`, `pnpm lint`, `pnpm -F @ocf-ims/interface test`
unchanged and green with the surface in the tree; `export:web` builds; the smoke e2e
passes. Hand: the three variants at 1024 and 1440 in both schemes, the admin's and the
inviter's views, the failing role change, Add person both ways, Remove from event, the
empty roster, reduced motion. Nothing goes to staging.

## Checklist

- [x] Brief written; the contract verified (2026-09-14)
- [x] The surface built, walked in a browser and verified (2026-09-15; § What was built)
- [x] The round run; Ladder picked, the reasons and the six decisions recorded (2026-09-16; § The pick)
- [ ] The 3c.4 acceptance criteria written
- [ ] The winner promoted, reviewed, the surface deleted — the 3c.4 PR

## Open questions

1. **Does the roster need a phone form?** Recommendation: no (decision 1).
2. **Search across events** (templ's people page has an event picker for admins) — the
   client's roster is per event; the global listing is 3d.1's.
3. **Wristband editing** rides `SetPersonParticipation` with the rung; whether the
   roster edits it inline or the card does is the round's (decision 6).
