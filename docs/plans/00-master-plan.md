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
   becomes the typed API contract; the new interface is built on top of it.

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
   [`11-remove-concentric-streets.md`](11-remove-concentric-streets.md)) — small;
   concentric-streets removal directly unblocks OCF locations.
2. **OCF beta domain work on the existing UI** — the deadline deliverable:
   terminology (Phase 2, kept lightweight in `templ`/`web/typescript`), incident
   categories (Phase 3a), locations (Phase 3c), roles (Phase 4). Outcomes (3b) and
   dashboards (5) only if time allows.
3. **Go workspace restructure** ([`06-go-workspace-restructure.md`](06-go-workspace-restructure.md))
   — **deferred to after the event.** Mechanical and behavior-preserving; doing it
   later re-touches a more-diverged tree but is still straightforward.
4. **Platform track P0→P4** (proto + Connect + Expo interface) — **after the
   event**. Replaces the `templ` web UI later, not for this beta.

Rule of thumb for the next 4 weeks: **anything that doesn't make the beta better
or safer waits** — including the restructure and the whole platform track.

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
| 1 | **Preparation & clean-up** | Dead/deprecated code removed; baseline green | Low | `10-cleanup-pass.md` (TODO) |
| 2 | **Terminology** | Burning Man terms → OCF terms across code + UI | Med | `20-terminology.md` (TODO) |
| 3 | **Domain model** | OCF incident categories, outcomes, locations | Med–High | `30-domain-model.md` (TODO) |
| 4 | **Roles & permissions** | OCF role structure in authz | Med | `40-roles-permissions.md` (TODO) |
| 5 | **Dashboards & metrics** | Management reporting OCF will use | Med | `50-dashboards.md` (TODO) |

Phases 1→2 are sequential. Phases 3, 4, 5 can overlap once terminology lands, but
each ships independently.

---

## Phase 1 — Preparation & Clean-up Pass

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
- [ ] **Remove the Concentric Streets feature** (`11-remove-concentric-streets.md`) — the headline clean-up item.
- [ ] Full audit: grep for `deprecated`, `TODO`, `FIXME`, `XXX`, `legacy`,
      commented blocks; produce a confirmed remove/keep/defer list.
- [ ] Remove confirmed dead code; resolve or explicitly defer each TODO.
- [ ] Tighten or remove dev-only auth helpers from production paths.
- [ ] Decide & document migration-consolidation policy.
- [ ] Ensure linters (`golangci`, `eslint`) and `go test ./...` are green; fix
      any pre-existing warnings that add noise.
- [ ] Tag/commit a clean baseline before Phase 2 begins.

**Exit criteria:** No known dead code; all TODOs triaged; build + tests + lint
green; baseline tagged.

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

## Phase 3 — Domain Model: Categories, Outcomes, Locations

**Objective:** Replace Burning Man incident taxonomy and geography with OCF's.

### 3a. Incident categories (`INCIDENT_TYPE` and friends)
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

### 3b. Incident outcomes / disposition
OCF wants explicit outcomes (a concept the current model lacks — today there's
only `State`: new / on_hold / dispatched / on_scene / closed):
- Information Only, Resolved On Scene, Referred to Coordinator,
  Referred to BUM/Management, Referred to Fair Community Support,
  Referred to Mediation, Follow-Up Required, No Action Needed

> Likely a **new field/table** (outcome distinct from state). Schema migration.

### 3c. Locations / geography
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

**Phase 3 tasks (detailed in `30-domain-model.md`):**
- [ ] Confirm category list + whether groups are first-class.
- [ ] Design + migrate outcome field/table.
- [ ] Design location model change; migrate; seed OCF areas.
- [ ] Seed data + admin UI for managing all three.

---

## Phase 4 — Roles & Permissions

**Objective:** Reshape `lib/authz` roles to match OCF's volunteer structure.

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
> bits? The directory/personnel integration (Clubhouse vs OCF directory) is a
> related question — OCF won't use Clubhouse.

**Phase 4 tasks (detailed in `40-roles-permissions.md`):**
- [ ] Map OCF roles onto existing permission primitives; add bits if needed.
- [ ] Address directory source (OCF has no Clubhouse — fake/custom directory?).
- [ ] Update `IMS_ADMINS` / admin onboarding for OCF.

---

## Phase 5 — Dashboards & Metrics (longer-term)

**Objective:** Management-facing reporting OCF will actually use.

Candidate metrics: incident count by day, by area, medical incidents, lost
children, conduct concerns, sound complaints, repeat locations, response times,
open follow-ups.

> Depends on Phases 3 (categories/locations/outcomes) and likely 4. Response
> times and open follow-ups depend on outcome/follow-up modeling from Phase 3b.

**Phase 5 tasks (detailed in `50-dashboards.md`):** TBD after Phase 3.

---

## 4. Cross-cutting / open questions

- **Stakeholder sign-off on terminology** — the mapping table is a first pass;
  OCF must confirm wording (especially the Ranger→role split).
- **Rename depth** — cosmetic (display) vs deep (API + DB). Sets the tone for
  Phase 2 effort and external-client impact.
- **Branding & naming** — repo/module name `ranger-ims-go`, binary, docs,
  copyright. Out of scope for early phases; track for a later cleanup.
- **Directory integration** — OCF has no Clubhouse DB; how are users/personnel
  sourced? Affects Phase 4.
- **Data migration** — is there existing production data to carry over, or do we
  start fresh for OCF? Affects how aggressive schema changes can be.

## 5. Sequencing summary

```
Phase 1 (clean-up)  ──►  Phase 2 (terminology)  ──┬──►  Phase 3 (domain model)
                                                  ├──►  Phase 4 (roles)
                                                  └──►  Phase 5 (dashboards, after 3)
```

Next action: write **`10-cleanup-pass.md`** and execute Phase 1.
