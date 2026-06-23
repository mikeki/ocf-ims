# Phase 5 — Person Roles & Access Model (beta simplification)

> **Status:** Plan / for review · **Owner:** Miguel · **Last updated:** 2026-06-23
>
> Decided direction for collapsing the person model down to what the OCF beta
> actually uses. Supersedes the 5b–5d sketch in
> [`50-roles-permissions.md`](50-roles-permissions.md) (crews / role-tiers /
> crew-leaders) — that richer model is deferred; this is the leaner thing we run
> first. Builds on the unified people registry
> ([`51-people-registry.md`](51-people-registry.md)).

## 1. Why

The person model accreted several knobs that *look* like they control "what kind
of person is this / what can they do," but overlap or do nothing:

- `PERSON.STATUS` (active/inactive/…) — only gates login/picker visibility.
- `PERSON.ON_SITE` — only feeds "On-Site" access-rule validity.
- `PERSON__EVENT.PARTICIPATION_TYPE` (crew/participant/public/…) — a **descriptive
  label that grants no access** (authz never reads it).
- `EVENT_ACCESS` rules (`person:`/`position:`/`team:`/`onduty:` × validity ×
  expiry) — the *actual* access engine, but built for the Burning Man org
  (positions, teams, on-duty shifts) that OCF's beta does not have.

The beta flow is small and concrete:

1. Miguel is seeded as an admin.
2. Admins add other admins.
3. Admins give field volunteers the ability to file/see their own reports.
4. People get added to the registry as incidents are created — **no access**.

This plan removes the dead knobs and reshapes access into a single per-event
**role**, derived from one field.

## 2. Decisions (locked 2026-06-23)

**Issue 1 — flags**
- **Remove** `PERSON.STATUS` and `PERSON.ON_SITE`. Fresh system this year; nobody
  is inactive, and on-site only fed access validity.
- Removing `ON_SITE` makes the `EVENT_ACCESS.VALIDITY = 'onsite'` option dead — it
  goes too (moot anyway, see Issue 2: `EVENT_ACCESS` is retired).
- **Keep** `PERSON__EVENT.WRISTBAND` + `PARTICIPATION_TYPE`. Inert today, but the
  "is this person participant / public / ejected" record matters once real people exist.

**Issue 2 — roles**
- A person's per-event standing becomes a **single ladder** (merge role *into*
  participation — see §3). Access is **derived** from it; no second knob.
- **Admin is the only global role** (`PERSON.IS_ADMIN`, as today). Writer and
  Reporter are **per-event**. (May revisit per-event admin later — not now.)
- **Retire `EVENT_ACCESS` entirely.** With positions/teams/onduty/on-site/validity
  all gone, an access rule stores the same thing as a per-event role — keeping
  both *is* the redundancy. The per-event role becomes the source of truth for
  authorization; the Admin → Events access UI is deleted.
- Role semantics:

  | Role | Can do / see | Notes |
  |---|---|---|
  | **Admin** (global) | everything, all events | `IS_ADMIN`; bypasses event checks |
  | **Writer** (per-event) | all incidents + all reports + **the dashboard** | dashboard opens to writers (was admin-only) |
  | **Reporter** (per-event) | file reports and see **only their own reports**; **no incident visibility at all** (not even ones they're on) | == today's `EventReporter`; no new "involved" filter needed |
  | _(none)_ | registry entry only | step-4 people; no login/access |

- **Defaults:** a volunteer promoted on the People page defaults to **Reporter**;
  a person created from the incident person-picker defaults to **public / none**.

## 3. The merged per-event ladder

One `PERSON__EVENT` field carries both "who is this person at the fair" and "what
can they do," top (most access) to bottom:

```
writer       → participant, full incident + report access + dashboard
reporter     → participant, own-reports only (default for promoted volunteers)
participant  → at the fair (crew / volunteer / booth), no IMS access
public       → attendee / person on an incident (default for picker-created people)
not_present  → known person, not here this year
ejected      → removed from the event, kept for the record
```

- **`crew` is folded into `participant`** (decided 2026-06-23) — for the beta the
  distinction is meaningless, so there is one "at the fair, working it" tier.
  Existing `crew` rows migrate to `participant`.
- **Admin is not in this list** — it's the global `IS_ADMIN` flag. An admin needs
  no per-event row to act.
- **Access derives from the top two rungs only.** `writer`/`reporter` grant the
  masks below; everything from `participant` down is `EventNoPermissions`.
- **Trade-off accepted:** you can't independently record "participant *and* writer" —
  `writer` already implies participant-level trust. The participant/public
  distinction only matters for people *without* access, which the lower rungs
  still capture.
- **Naming:** keep the column `PARTICIPATION_TYPE` (least churn) but it now also
  encodes the access tier; the enum gains `writer` and `reporter`. (Open: rename to
  `ROLE`? Lean keep.)

## 4. What changes (grounding)

**Schema** (`store/schema/migrations/`, new migrations):
- Drop `PERSON.STATUS`, `PERSON.ON_SITE`.
- Reshape `PERSON__EVENT.PARTICIPATION_TYPE`: add `writer`, `reporter`; **drop
  `crew`** (fold into `participant`), migrating any existing `crew` rows to
  `participant` in the same migration. Final enum:
  `('writer','reporter','participant','public','not_present','ejected')`.
- Retire `EVENT_ACCESS` (drop table) and its `VALIDITY`/`EXPIRES` machinery.
  (POSITION/TEAM/PERSON__POSITION/PERSON__TEAM tables **stay** — descriptive, no
  longer drive access.)

**Authz** (`lib/authz/permission.go`):
- `ManyEventPermissions` stops iterating `EVENT_ACCESS` rows. Instead, for the
  authenticated person + event, read the `PERSON__EVENT` row and map
  `participation_type → Role → RolesToEventPerms` (`writer→EventWriter`,
  `reporter→EventReporter`, else `EventNoPermissions`).
- Delete `PersonMatches`, `modeToRole`, the validity logic, and the `ons`/on-site
  claim. Positions/teams/onduty drop out of permission computation.
- Per-event role is looked up at request time (as `EVENT_ACCESS` was), so a role
  change takes effect immediately — it need not ride in the JWT.
- Parent-event/group access inheritance (`EventAndParentAccess`) is dropped for the
  beta (no group-access use case).

**Dashboard** (`api/metrics.go:102`): gate changes from `PersonAdmin()` to
**admin OR per-event writer**; nav reveal (`dashboard.ts` / nav) widens to writers.

**API + UI removals:** `api/eventaccess.go` + the `/ims/api/.../access` routes,
`web/template/adminevents.templ`, `web/typescript/admin_events.ts`, the access
"Explain" feature.

**People page** (`web/template/people.templ`, `web/typescript/people.ts`): drop the
Status dropdown + On-Site checkbox; the per-event editor presents the single role
ladder (replacing the separate participation picker), and is where an admin
promotes a volunteer to Reporter/Writer. `CreatePerson` from the incident picker
defaults to `public`.

**Cleanup of removed flags:** `json/personnel.go` (`Status`, `Onsite`),
`directory/*` (`Status`/`Onsite` on `User`), JWT `ons` claim
(`lib/authz/claim.go` / `accesstoken.go`), `settings.templ` Visit-status filter
note, and the `validPersonStatuses` map (`api/person.go`).

## 5. Suggested slices

- **52a — Remove dead flags.** Drop `PERSON.STATUS` + `ON_SITE` and all their reads
  (migration + JSON + directory + JWT claim + People-page fields). Self-contained,
  pure removal. Does **not** touch access yet.
- **52b — Role ladder + derive access from `PERSON__EVENT`.** Extend the enum;
  switch `ManyEventPermissions` to read `PERSON__EVENT`; keep `EVENT_ACCESS` rows
  present-but-ignored for one step to de-risk the cutover. People-page role editor.
- **52c — Retire `EVENT_ACCESS`.** Delete the table, the access API, and the
  Admin → Events access UI once 52b is proven.
- **52d — Dashboard to writers.** Widen the metrics gate + nav reveal.

(Order matters: 52a is independent; 52b before 52c; 52d any time after 52b.)

## 6. Risks / open items

- **Authz is the blast radius.** Rewiring `ManyEventPermissions` touches every
  permission check. The integration permission tests (`api/integration/
  permissions_test.go`, `lib/authz/permission_test.go`) are the safety net and must
  be reworked alongside.
- **Seed + existing dev data.** The dev seed grants access via `EVENT_ACCESS`
  today; it must move to seeding `PERSON__EVENT` roles instead, or the dev users
  lose access after 52c.
- **Bootstrap.** With no `EVENT_ACCESS`, a brand-new event has no writers until an
  admin assigns roles — confirm that's fine (admins can always act).
- **Column name** `PARTICIPATION_TYPE` vs `ROLE` (§3) — cosmetic, decide before 52b.
- **Field volunteers logging in** still need a handle + password (set by an admin on
  the People page); the role only governs what they see once in.
