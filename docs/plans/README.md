# Plans

This folder holds the design and implementation plans for the ongoing work to
convert Ranger IMS into an **OCF (Oregon Country Fair)**–specific incident
management system.

## How this folder works

- **`00-master-plan.md`** is the top-level roadmap. Start there. It describes the
  overall direction, the phases, and links out to the detailed per-phase plans.
- Each phase (or significant sub-effort) gets its own numbered plan file as work
  begins, e.g. `01-cleanup-pass.md`, `10-terminology.md`, etc.
- Numbering convention:
  - `00–09` — meta / master / cross-cutting / platform track
  - `10–19` — Phase 1: Preparation & clean-up
  - `20–29` — Phase 2: Terminology
  - `30–39` — Phase 3: Remove Clubhouse & local People
  - `40–49` — Phase 4: Domain model (categories, outcomes, locations)
  - `50–59` — Phase 5: Roles & permissions + people registry
  - `60–69` — Phase 6: Feedback round 1 (beta usage feedback)
  - `70–79` — Phase 7: Dashboards & metrics
  - `80–89` — Collaboration & notifications (mentions, notifications, email)
  - (room to grow)
- Plans are living documents. Mark sections as `Status: TODO / In progress /
  Done` and check off tasks as they land. Reference concrete files and PRs.

## Status

| Plan | Phase | Status |
|------|-------|--------|
| [00-master-plan.md](00-master-plan.md) | Master roadmap | Draft — Phase 1 ✅ done, Phase 2 next |
| [05-platform-stack.md](05-platform-stack.md) | Foundation — proto-first polyglot monorepo | Superseded by [09](09-proto-connect-platform.md); kept as the record of D1–D8 |
| [06-go-workspace-restructure.md](06-go-workspace-restructure.md) | Platform — move Go into `go/ims` + `go.work` | Superseded by [09](09-proto-connect-platform.md) M1 (target is `go/`, not `go/ims/`); gotcha list carried & corrected in [09f](09f-server-restructure.md) (slice 1a) |
| [07-proto-integration.md](07-proto-integration.md) | Platform — proto-first API contract (buf + Connect-Go) | ⏸️ Park lifted (fair is over) — resumed under [09](09-proto-connect-platform.md). `archive/proto-integration` is reference only. |
| [08-db-migration-tooling.md](08-db-migration-tooling.md) | Platform — DB migration tooling (goose, single source of truth) | ✅ Done (A #56, B #57, C #58, D #59, E #60) |
| [09-proto-connect-platform.md](09-proto-connect-platform.md) | Platform — proto-first Connect architecture + an Expo mobile client (supersedes 05/06/07) | Plan — for review; Phase 0 in progress |
| [09a-codegen-skeleton.md](09a-codegen-skeleton.md) | Phase 0, slice 0a — buf + 4 generators + pnpm/biome scaffolding, one throwaway proto | Built — for review (PR #202) |
| [09b-core-domain.md](09b-core-domain.md) | Phase 0, slice 0b — resources/v1 messages (incident, report, journal entry, involvement, linked incident, area, event) + vendored protovalidate | In progress — for review (PR #203) |
| [09c-people-access.md](09c-people-access.md) | Phase 0, slice 0c — resources/v1 people & access (person, participation, crew, membership); auth envelopes deferred to 0e | In progress — for review (PR #203) |
| [09d-taxonomies-admin.md](09d-taxonomies-admin.md) | Phase 0, slice 0d — resources/v1 taxonomies & admin (incident type, outcome, action log, notification, metrics); White Bird visits deliberately excluded | In progress — for review (PR #203) |
| [09e-service-surface.md](09e-service-surface.md) | Phase 0, slice 0e — single `ImsService` (49 RPCs) + service/v1 request/response envelopes + the route→RPC mapping table (70 routes, zero unclassified) | In progress — for review (stacked on #203) |
| [09f-server-restructure.md](09f-server-restructure.md) | Phase 1, slice 1a — transport de-risk spike, then relocate the Go tree to `go/` + `internal/<domain>/` (opens Phase 1) | Plan — for review |
| [09i-expo-client.md](09i-expo-client.md) | Phase 3 — the Expo client master plan: MVP that validates Expo against Connect (3a), field app (3b), dispatch on web (3c), admin & long tail (3d); slice tasks with model assignment (Claude Design / Opus / Sonnet / Haiku) | Plan — merged (#238); 3a in progress |
| [09j-session-contract-cors.md](09j-session-contract-cors.md) | Phase 3, slice 3a.0 — the session contract for a native client (body-carried refresh token, body-wins refresh, `Logout` RPC), report reads marked NSE, dev CORS allow-list (`IMS_CORS_ALLOWED_ORIGINS`) | ✅ Merged (#240) |
| [09k-interface-scaffold.md](09k-interface-scaffold.md) | Phase 3, slice 3a.1 — `packages/interface` scaffold: Expo SDK 57 + Router in the pnpm workspace, generated-TS wiring, `pnpm generate`, jest-expo, Playwright smoke on the web export, the `Interface` CI job | ✅ Merged (#241) |
| [09l-client-foundations.md](09l-client-foundations.md) | Phase 3, slice 3a.2 — the client foundations: the Bearer/refresh transport (single-flight, sign out only on a definitive `Unauthenticated`), the session state machine over the web cookie / native SecureStore, connect-query + a protobuf-safe persisted cache, the error model, env config, the design tokens stub and six primitives, the Jest harness with a fake `ImsService` | ✅ Merged (#242) |
| [09m-staging-instance.md](09m-staging-instance.md) | Phase 3 — the staging instance: the production image following master, seeded with the demo data, at its own hostname behind Caddy; what the Phase-3 hand checks and the Playwright tracer run against (step 2: the Expo web export hosted at `/`, E9) | ✅ Merged (#244, #245, #247); staging live 2026-09-10 |
| [09n-tracer-screens.md](09n-tracer-screens.md) | Phase 3, slice 3a.3 — the tracer screens: login (throttle countdown, forced password change, web return path), events (remembered, else newest), read-only incidents list + incident detail with the journal, sign out; the environment-gated Playwright tracer against staging | ✅ Merged (#246); staging follow-up merged (#249) |
| [09o-design-v0.md](09o-design-v0.md) | Phase 3, D0 + slice 3a.4 — the design system v0 brief: the token contract (colour roles in both schemes, type with tracking, elevation, motion), the primitives and the state / priority colour language, the design brief itself, "motion and feel" from Emil Kowalski's skills, the two routes to make D0 (Claude Design vs in-code variants), the 3a.4 acceptance criteria | Brief — waits on Miguel's route choice |
| [10-cleanup-pass.md](10-cleanup-pass.md) | Phase 1 — Preparation & clean-up | ✅ Done (PRs #1–#5) |
| [11-remove-concentric-streets.md](11-remove-concentric-streets.md) | Phase 1 — Remove Concentric Streets | ✅ Done (PR #1) |
| [20-terminology.md](20-terminology.md) | Phase 2 — Terminology | 2a ✅ (PR #13), 2c ✅ (PR #14); 2b → Phase 3; 2d awaiting OCF wording |
| [30-remove-clubhouse.md](30-remove-clubhouse.md) | Phase 3 — Remove Clubhouse & local People (umbrella) | ✅ Done (PRs #16–#19) |
| [31-local-people-directory.md](31-local-people-directory.md) | Phase 3 — Local people directory | ✅ Done (PR #16) |
| [32-retire-clubhouse.md](32-retire-clubhouse.md) | Phase 3 — Retire Clubhouse | ✅ Done (PR #17) |
| [33-people-rename.md](33-people-rename.md) | Phase 3 — Ranger→People rename | ✅ Done (PR #18) |
| [34-post-clubhouse-login.md](34-post-clubhouse-login.md) | Phase 3 — Post-Clubhouse login + admin password reset | ✅ Done (PR #19); emailed reset deferred (appendix) |
| [40-domain-model.md](40-domain-model.md) | Phase 4 — Domain model (categories, outcomes, locations) | ✅ Done (PRs #20–#24) |
| [50-roles-permissions.md](50-roles-permissions.md) | Phase 5 — Roles & permissions | 5a ✅ (PR #27), 5a.1 ✅ (PR #28), 5e ✅ (PRs #34–#37); 5b–5d superseded by 52 |
| [51-people-registry.md](51-people-registry.md) | Phase 5e — Unified people registry | ✅ Built (PRs #34–#37) |
| [52-roles-and-access-model.md](52-roles-and-access-model.md) | Phase 5 — Person roles & access model (beta simplification) | Plan — for review (PR #68) |
| [53-crew-leader-invite.md](53-crew-leader-invite.md) | Crew leaders & inviting reporters | ✅ Built (53a #85, 53b #86, 53c #87, 53d) |
| [60-feedback-round-1.md](60-feedback-round-1.md) | Phase 6 — Feedback round 1 (beta usage feedback) | ✅ Built (6a types/action-log #38, 6c #39, 6b/6d #40); 6a **areas seed pending** (PR #45) |
| [61-feedback-round-2.md](61-feedback-round-2.md) | Phase 6 — Feedback round 2 (structured stakeholder review) | ✅ Built (6d in PR #40) |
| [62-people-event-nav.md](62-people-event-nav.md) | Phase 6 — People page → event nav (slice 6e) | ✅ Built (PR #42) |
| [63-feedback-round-3.md](63-feedback-round-3.md) | Phase 6 — Feedback round 3 (post-Phase-7 review fixes: 6f–6h) | ✅ Built (PR #46) |
| [64-feedback-round-4.md](64-feedback-round-4.md) | Phase 6 — Feedback round 4 (dashboard polish 6i + people roster 6j) | ✅ Built (PR #53) |
| [65-report-entry-submit.md](65-report-entry-submit.md) | Phase 6 — Feedback round 5, 6k (entry submit: Enter on incidents, button-only on reports) | Plan — for review |
| [66-new-report-incident-link.md](66-new-report-incident-link.md) | Phase 6 — Feedback round 5, 6l (show IMS# on a new report + attach-on-create) | Plan — for review |
| [67-report-reporter-submitter.md](67-report-reporter-submitter.md) | Phase 6 — Feedback round 5, 6m (submitter + per-entry "on behalf of" reporter) | ✅ Built (PR #113); 6l (#112) abandoned, superseded by #114 |
| [68-feedback-round-6.md](68-feedback-round-6.md) | Phase 6 — Feedback round 6 (6n People role=admin, 6o Areas→event + approval, 6p home page, 6q sessions) | Plan — for review |
| [70-dashboards.md](70-dashboards.md) | Phase 7 — Dashboards & metrics | ✅ Built (7a PR #43, 7b PR #44) |
| [80-collaboration-and-notifications.md](80-collaboration-and-notifications.md) | Collaboration & notifications — track overview + sequencing | Backlog (context captured) |
| [81-journal-mentions.md](81-journal-mentions.md) | `@mention` people in journal entries | Idea — design sketch |
| [82-notifications.md](82-notifications.md) | Notifications (in-app first, email later) | Idea — design sketch |
| [83-email-infrastructure.md](83-email-infrastructure.md) | Email infrastructure (enabler) | Blocked on IT prerequisites |
| [84-web-push-notifications.md](84-web-push-notifications.md) | Web push notifications (3rd delivery channel; no IT needed) | In progress — 84a server plumbing (PR #104) + 84b client subscription (PR #105) + 84c send fan-out built; 84d to do |
| [93-feedback-round-10.md](93-feedback-round-10.md) | Phase 6 — Feedback round 10 (umbrella: 10a–10g; fully specs 10b states, 10e reporter IMS#, 10f label, 10g remove button) | Plan — for review |
| [94-outcomes-registry.md](94-outcomes-registry.md) | Round 10, slice 10a — Outcomes → DB-backed registry with propose/approve (like Incident Types) | Plan — for review |
| [95-crews.md](95-crews.md) | Round 10, slice 10c — Crews (rename TEAM→CREW, per-event crew field, redefine crew_leader to read-only, crew report review) | Plan — for review |
| [96-person-profile-picture.md](96-person-profile-picture.md) | Round 10, slice 10d — Person profile picture on the profile card | Plan — for review |
| [97-admin-enum-pages.md](97-admin-enum-pages.md) | Round 10 — shared admin-page design for the admin-managed taxonomies (Types, Areas, Outcomes, Crews) | Plan — for review |
