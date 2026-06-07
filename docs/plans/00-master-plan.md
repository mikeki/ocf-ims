# Master Plan: Convert Ranger IMS → OCF IMS

> **Status:** Draft / skeleton — phases and scope defined, detailed per-phase
> plans to be written as each phase begins.
>
> **Owner:** TBD &nbsp;·&nbsp; **Last updated:** 2026-06-04

## 1. Goal

Take the existing **Ranger IMS** (Black Rock Rangers / Burning Man incident
management system, Go implementation) and turn it into an **OCF IMS** tailored to
the **Oregon Country Fair**: its terminology, incident categories, roles,
outcomes, geography, and reporting needs.

This is a fork-and-adapt effort, not a rewrite. We keep the solid foundations —
the layered Go architecture, sqlc/templ/tsgo code generation, event-scoped
authorization, action logging, JWT auth — and reshape the domain on top of them.

### Two parallel tracks

This effort has two tracks that proceed together:

1. **Domain track (this document)** — convert the IMS *domain* to OCF:
   terminology, incident categories, outcomes, locations, roles, dashboards
   (Phases 1–5 below).
2. **Platform track** ([`05-platform-stack.md`](05-platform-stack.md)) — evolve
   the *architecture* into a proto-first, Connect-RPC, `pnpm` polyglot monorepo
   with an Expo (iOS/Android/web) interface, **keeping the Go backend**. Proto
   becomes the typed API contract; the new interface is built on top of it. The
   **proto contract** part has begun ahead of the rest —
   [`07-proto-integration.md`](07-proto-integration.md); the interface and
   workspace restructure remain post-event (see sequencing below).

They interact: notably, the Expo interface may eventually **replace the
server-rendered `templ` web UI**, which affects how much domain-track UI work we
invest in `templ`/`web/typescript` vs. the new interface. See
[`05-platform-stack.md` §6](05-platform-stack.md).

## Sequencing under the event deadline

> **Hard constraint:** the OCF event is **~4 weeks out (early July 2026)**. The
> beta runs on the **existing Go + `templ` web UI** — the proto/Expo platform
> interface will not be production-ready in time.

**Decision (2026-06-05): OCF beta first, on the existing service. Restructure
later.** We keep the build/deploy pipeline frozen through the event and spend the
scarce pre-event time on beta value, not plumbing.

Order of work:

1. **Phase 1 clean-up** ([`10-cleanup-pass.md`](10-cleanup-pass.md), incl.
   [`11-remove-concentric-streets.md`](11-remove-concentric-streets.md)) —
   ✅ **done 2026-06-05** (PRs #1–#5 merged); concentric-streets removal directly
   unblocked OCF locations.
2. **OCF beta domain work on the existing UI** — the deadline deliverable:
   terminology (Phase 2, kept lightweight in `templ`/`web/typescript`), incident
   categories (Phase 3a), locations (Phase 3c), roles (Phase 4). Outcomes (3b) and
   dashboards (5) only if time allows.
3. **Go workspace restructure** ([`06-go-workspace-restructure.md`](06-go-workspace-restructure.md))
   — **deferred to after the event.** Mechanical and behavior-preserving; doing it
   later re-touches a more-diverged tree but is still straightforward.
4. **Proto-first API contract** ([`07-proto-integration.md`](07-proto-integration.md),
   platform P0–P2) — **⏸️ PARKED to post-fair (reverted from `master`).** It was
   briefly pulled forward, but a *typed* Connect client needs a JS/TS proto-codegen
   (`protoc-gen-es`) + browser bundler toolchain the repo deliberately avoids — too
   much new tooling for beta. So the proto pipeline and the first `IncidentService`
   handler were reverted from `master`; **for beta we stay on the existing REST +
   static-site approach.** All proto work (pipeline + handler + hand-typed TS client)
   is preserved on branch **`archive/proto-integration`**; we resume there after the
   fair. One thing from that effort *stayed* on `master`: the convention that **no
   generated code is committed** — sqlc/templ/tsgo output is produced at build time
   (`build.go -generate-only`).
5. **Platform track P3→P4** (Expo interface + the rest) — **after the event.** The
   cross-platform interface replaces the `templ` web UI later, not for this beta.
   The **workspace restructure** (item 3) also stays post-event.

Rule of thumb for the next 4 weeks: **anything that doesn't make the beta better
or safer waits** — with one deliberate exception: the **proto *contract*** (item 4),
which is pulled forward precisely because it makes the unavoidable terminology
contract-break cheaper. The **interface** and **restructure** still wait.

## 2. Guiding principles

1. **Stable slate first.** Before changing behavior, remove deprecated and dead
   code so we work from a clean, low-noise baseline (Phase 1).
2. **Terminology before structure.** Renaming is the highest-leverage, lowest-risk
   change and the most visible to users — do it early and thoroughly (Phase 2).
3. **Data-driven over hard-coded.** Where OCF specifics (categories, outcomes,
   locations) can be configuration/seed data instead of code, prefer that — it
   keeps the system adaptable year to year.
4. **Migrations are append-only.** Schema changes follow the project's migration
   convention (`store/schema/XX-from-YY.sql` + `current.sql`); never rewrite
   history. See `CLAUDE.md` → "Database Migrations".
5. **Green at every step.** `go test ./...`, the generators, and the build stay
   passing between phases. Each phase is independently shippable.

## 3. Phase overview

| # | Phase | Outcome | Risk | Plan |
|---|-------|---------|------|------|
| 1 | **Preparation & clean-up** | ✅ **Done** — dead/deprecated code removed; baseline green | Low | `10-cleanup-pass.md` ✅ |
| 2 | **Terminology** | Burning Man terms → OCF terms across code + UI | Med | `20-terminology.md` (2a ✅, 2c ✅; 2b → Phase 3; 2d open) |
| 3 | **Remove Clubhouse & local People** | Local `Person` identity replaces the external Clubhouse directory; Ranger→Person rename keyed on `person_id` | High | `30-remove-clubhouse.md` (design) |
| 4 | **Domain model** | OCF incident categories, outcomes, locations | Med–High | [`40-domain-model.md`](40-domain-model.md) (plan — for review) |
| 5 | **Roles & permissions** | OCF crews/titles/roles in authz, built on Phase 3's local People | Med | `50-roles-permissions.md` (TODO) |
| 6 | **Dashboards & metrics** | Management reporting OCF will use | Med | `60-dashboards.md` (TODO) |

Phases 1→2 are sequential. **Phase 3 (remove Clubhouse) is the identity foundation
Phase 5 (roles & permissions) builds on**, so 3 precedes 5. Phases 4, 5, 6 can
otherwise overlap once terminology lands, and each ships independently.

> **Re-scope note (2026-06-06).** The old Phase 2 slice **2b (Ranger →
> Person/People)** was promoted to its own **Phase 3** once it became clear the
> rename and the Clubhouse removal are the same change (you can't key on `person_id`
> without a local Person table, and login/authz still read Clubhouse). The former
> Phases 3/4/5 (Domain model / Roles / Dashboards) shifted to **4/5/6**. See
> [`30-remove-clubhouse.md`](30-remove-clubhouse.md).

---

## Phase 1 — Preparation & Clean-up Pass

> ✅ **Done 2026-06-05** — shipped as PRs #1–#5 (merged to `master` @ `5eb3c57`).
> See [`10-cleanup-pass.md`](10-cleanup-pass.md) for the per-task outcome. The
> task list below is retained for historical context.

**Objective:** Start from a stable, low-noise slate. Remove deprecated and dead
code so subsequent OCF work isn't fighting cruft. No behavioral changes intended.

The codebase is already fairly clean (it was a from-scratch Go rewrite of the old
Python system, so there are *no* Python compat shims). Clean-up candidates are
mostly small — **with one big exception**:

- **Concentric Streets** — a fully deprecated, Burning Man-specific geography
  feature (radial-clock addresses + concentric ring streets). The admin UI itself
  says *"no longer used as of late 2025"*. It spans every layer (schema, queries,
  sqlc, JSON, API, authz, templates, TypeScript, seed, tests) and needs a schema
  migration to fully remove. Its data was already folded into the free-form
  `LOCATION_ADDRESS` column by migration 24, so removal loses nothing — and it's a
  head start on Phase 3's location rework. Detailed plan:
  [`11-remove-concentric-streets.md`](11-remove-concentric-streets.md).

The smaller candidates a first sweep surfaced:

- **Dev-only helpers** that may not belong in the shipping surface, e.g.
  `lib/authn/password.go` `NewSaltedArgon2idDevOnly()` and
  `lib/argon2id/argon2id.go` `DevelopmentParams` — audit usage, gate or remove.
- **Commented-out code blocks** — e.g. `conf/imsconfig.go` (relaxed S3
  validation), `cmd/serve.go` (pretty-logging block), and stale CDN URLs in
  `bin/fetchbuilddeps/fetchbuilddeps.go`.
- **Stub / placeholder tests** — `TestEventAccessTODO`, `TestPersonnelTODO` in
  `api/integration/` — either implement or remove.
- **Outstanding TODO/FIXME** that represent decided-against or finished
  directions — e.g. the "action framework" removal TODO in `api/fieldreport.go`,
  the RESTful-endpoint TODO in `api/event.go`, deprecated metric ref in
  `api/debug.go`.
- **Old migrations** — versions 1–31 exist; evaluate whether very old ones can be
  consolidated (carefully — migrations are history; likely leave as-is, document
  decision).

> ⚠️ These are *candidates* surfaced by a quick scan, not a confirmed work list.
> The Phase 1 detailed plan must verify each is genuinely dead before removal
> (grep for references, check tests). "Looks unused" ≠ "is unused".

**Phase 1 tasks (detailed in `10-cleanup-pass.md`):**
- [x] **Remove the Concentric Streets feature** (`11-remove-concentric-streets.md`) — the headline clean-up item. (PR #1)
- [x] Full audit: grep for `deprecated`, `TODO`, `FIXME`, `XXX`, `legacy`,
      commented blocks; produce a confirmed remove/keep/defer list.
- [x] Remove confirmed dead code; resolve or explicitly defer each TODO. (PRs #2–#5; B1/B2 deferred.)
- [x] Tighten or remove dev-only auth helpers from production paths. *(Triaged and
      kept by design — `NewSaltedArgon2idDevOnly` is an intentional test helper.)*
- [x] Decide & document migration-consolidation policy. *(Append-only; documented in `CLAUDE.md`.)*
- [x] Ensure `go test ./...` is green. *(`eslint` is non-functional repo-wide —
      no config; `tsgo` validates TS. Tracked separately.)*
- [x] Commit a clean baseline before Phase 2 begins. *(Merged PRs #1–#5; `master` @ `5eb3c57`.)*

**Exit criteria:** ✅ Met — no known dead code; all TODOs triaged; build + tests
green; baseline merged to `master`.

---

## Phase 2 — Terminology (Burning Man → OCF)

**Objective:** Rename domain terms throughout code, schema, API, and UI. Highest
user-facing impact, so do it carefully and completely.

**Surface area (from initial scan):** ~75–100 files. Key concentrations:
- JSON API types — `json/` (`fieldreport.go`, `incident.go`, `personnel.go`, …)
- DB schema — `store/schema/current.sql` + migrations; sqlc-generated
  `store/imsdb/` follows automatically
- API handlers — `api/` (`fieldreport.go`, `incident.go`, `visit.go`, …)
- Web UI — `web/**/*.templ` (~14) and `web/typescript/*.ts` (~11)

**Term mapping (initial — confirm with OCF stakeholders):**

| Ranger / Burning Man term | OCF term |
|---|---|
| Field Report | Incident Report |
| Ranger | Staff / Coordinator / Volunteer / Crew Member *(role-dependent — see Phase 4)* |
| Patrol | Path Rove / Gate / Radio Handle |
| Ranger HQ | Fair Central / QM / crew location |
| Participant | Fair Family / Participant / Public Attendee |
| Event | Fair / OCF Event |
| Black Rock City | Oregon Country Fair |
| Camp | Booth / Crew / Camping Area |
| Citizen Contact | Fair Family Contact / Participant Contact |
| Intervention | Response / Incident Response / Resolution |

> **Decisions needed before this phase:** (a) Is the rename cosmetic (display/UI
> layer only) or deep (API field names, DB columns, types)? A display-layer-first
> approach is lower risk and keeps the API stable; a deep rename is cleaner
> long-term but touches generated code and external clients. (b) Confirm exact
> OCF wording with stakeholders, especially the "Ranger" → role split.

**Big open question:** "Field Report" → "Incident Report" collides conceptually
with the existing **Incident** entity. Need to clarify OCF's mental model of
report-vs-incident before renaming, or risk confusing two distinct objects.

**Phase 2 tasks (detailed in `20-terminology.md`):**
- [ ] Finalize the term-mapping table with OCF stakeholders.
- [ ] Decide cosmetic-vs-deep rename strategy (likely: UI/display first).
- [ ] Apply renames; regenerate sqlc/templ/tsgo; fix fallout.
- [ ] Update user-facing docs (`docs/`, `README.md`, `CLAUDE.md`).

**Exit criteria:** No Burning Man-specific terminology remains in user-facing
surfaces; tests/build green.

---

## Phase 3 — Remove Clubhouse & Establish Local People

**Objective:** Replace the external Clubhouse directory with a first-class local
`Person` entity owned by OCF IMS, and complete the Ranger→Person/People +
`role`→`involvement` rename keyed on a stable `person_id`. Minimum-viable local
identity (roster + credentials + the existing authz expression engine, sourced
locally); the rich crew/title/role model is **Phase 5**.

This was the old Phase 2 slice **2b**, promoted to its own phase because the rename
and the Clubhouse removal are inseparable (you can't key on `person_id` without a
local Person table, and login/authz still read Clubhouse). It is the identity
**foundation Phase 5 builds on**.

**Decided (2026-06-06):** demo mode seeds local People by copying the existing fake
Clubhouse data; the Fair launches on a clean DB seeded with a few admins. Interim
authz keeps today's `person:`/`position:`/`team:`/`onduty:` expressions, just
sourced locally. Full design, sub-PR breakdown, migration/cutover, and open
sub-decisions: [`30-remove-clubhouse.md`](30-remove-clubhouse.md).

---

## Phase 4 — Domain Model: Categories, Outcomes, Locations

**Objective:** Replace Burning Man incident taxonomy and geography with OCF's.

### 4a. Incident categories (`INCIDENT_TYPE` and friends)
OCF categories (draft, grouped):
- **Safety:** Medical, Fire, Traffic/Vehicle, Child Welfare, Missing Person,
  Lost Child, Environmental Hazard
- **Conduct:** Personal Violation, Harassment, Threatening Behavior,
  Intoxication, Participant Conflict, Volunteer Conflict
- **Operations:** Construction Issue, Water Issue, Electrical Issue, Sound
  Complaint, Booth Issue, Camping Issue, Site Damage
- **Compliance:** Guideline Violation, Permit Violation, Amplified Sound
  Violation, Unauthorized Vehicle, Wristband/Credential Issue

> Decide: are top-level **groups** (Safety/Conduct/Operations/Compliance) a new
> first-class concept, or just naming convention on flat incident types? Affects
> schema. Today `INCIDENT_TYPE` is a flat list.

### 4b. Incident outcomes / disposition
OCF wants explicit outcomes (a concept the current model lacks — today there's
only `State`: new / on_hold / dispatched / on_scene / closed):
- Information Only, Resolved On Scene, Referred to Coordinator,
  Referred to BUM/Management, Referred to Fair Community Support,
  Referred to Mediation, Follow-Up Required, No Action Needed

> Likely a **new field/table** (outcome distinct from state). Schema migration.

### 4c. Locations / geography
Current model is Burning Man-specific: concentric streets + radial hour/minute
(clock geography) on the `INCIDENT` table, plus `Place`/`CONCENTRIC_STREET`.
OCF geography is named areas, not a clock:
- Main Camp, Dragon Plaza, Chela Mela, Xavanadu, Main Stage Area, White Bird
  (Big Bird / Little Wing), Craft Loop, Food Booth Area, Community Village,
  Energy Park, Far Side, Ritz, camping areas (Miss Piggy, SCOF, South Woods, …)

> Significant model change. Options: (a) repurpose `Place`/named-location as the
> primary location concept and retire radial/concentric fields; (b) keep schema,
> change seed data + UI. Map integration is a possible long-term add. Needs its
> own design doc.

**Phase 4 tasks (detailed in `40-domain-model.md`):**
- [ ] Confirm category list + whether groups are first-class.
- [ ] Design + migrate outcome field/table.
- [ ] Design location model change; migrate; seed OCF areas.
- [ ] Seed data + admin UI for managing all three.

---

## Phase 5 — Roles & Permissions

**Objective:** Reshape `lib/authz` roles to match OCF's volunteer structure. Builds
on **Phase 3**'s local `Person` foundation (which removed Clubhouse and made
positions/teams/person-matches local).

Current roles (`lib/authz/permission.go`): `AnyAuthenticatedUser`,
`EventReporter`, `EventReader`, `EventWriter`, `EventVisitWriter`,
`Administrator`, plus event-scoped and global permission sets.

OCF target roles (draft):
- **Basic Reporter** — any authorized volunteer; create incident reports only
  (maps roughly to `EventReporter`)
- **Crew Lead / Coordinator** — review reports, add follow-up
- **Management** — full admin (maps to `Administrator`)

> Decide: do the existing permission primitives compose into these three roles
> (likely yes — mostly a relabeling + grouping), or do we need new permission
> bits? This is also where OCF's **crews / titles / crew-leaders / invites** model
> lands (the four open design questions in `20-terminology.md` §"Fair org
> structure"). The directory-source question is **resolved by Phase 3** (local
> People, no Clubhouse).

**Phase 5 tasks (detailed in `50-roles-permissions.md`):**
- [ ] Map OCF roles onto existing permission primitives; add bits if needed.
- [ ] Design crews (nestable) / titles / role tiers / crew-leader powers / invites.
- [ ] Update admin onboarding for OCF (on top of Phase 3's `is_admin` bootstrap).

---

## Phase 6 — Dashboards & Metrics (longer-term)

**Objective:** Management-facing reporting OCF will actually use.

Candidate metrics: incident count by day, by area, medical incidents, lost
children, conduct concerns, sound complaints, repeat locations, response times,
open follow-ups.

> Depends on Phase 4 (categories/locations/outcomes) and likely 5. Response
> times and open follow-ups depend on outcome/follow-up modeling from Phase 4b.

**Phase 6 tasks (detailed in `60-dashboards.md`):** TBD after Phase 4.

---

## 4. Cross-cutting / open questions

- **Stakeholder sign-off on terminology** — mostly resolved in `20-terminology.md`;
  the small-term wording (Patrol/HQ/Participant/Camp, slice 2d) is the last open bit.
- **Rename depth** — ✅ resolved: **deep** (API + DB + UI), API is web-UI-only so the
  contract break is contained. See `20-terminology.md`.
- **Branding & naming** — ✅ done (Phase 2c, PR #14): module `github.com/mikeki/ocf-ims`,
  binary `ocf-ims`, product "Oregon Country Fair IMS". *Open follow-up:* `COPYRIGHT` /
  license headers / footer "© Burning Man Project" left as-is — needs OCF counsel.
- **Directory integration** — ✅ owned by **Phase 3** (remove Clubhouse; local
  People). Demo seeds from the old fake data; the Fair seeds a clean DB with admins.
- **Data migration** — start **fresh** for the Fair (clean DB); demo data is the
  seeded fake roster. Lets schema changes be aggressive (no prod carry-over).

## 5. Sequencing summary

```
Phase 1 (clean-up) ─► Phase 2 (terminology) ─► Phase 3 (remove Clubhouse / local People) ─┬─► Phase 5 (roles, needs 3)
                                                                                          ├─► Phase 4 (domain model)
                                                                                          └─► Phase 6 (dashboards, after 4)
```

**Status (2026-06-06):**
- **Phase 1** ✅ complete (PRs #1–#5).
- **Phase 2** (terminology): **2a** Field Report→Report ✅ (PR #13), **2c** OCF
  branding ✅ (PR #14). **2b** (Ranger→Person) promoted to **Phase 3**. **2d**
  (small terms: Patrol/HQ/Participant/Camp) still open — blocked on OCF wording.
- **Phase 3** (remove Clubhouse / local People): design written
  (`30-remove-clubhouse.md`); **next to implement**.
- **Phases 4–6**: not yet started; design docs TODO.

Next action: review `30-remove-clubhouse.md`, then slice Phase 3 into PRs
(local Person table + login → local authz → re-key attached-people/author →
retire Clubhouse → UI rename).
