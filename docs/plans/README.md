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
| [05-platform-stack.md](05-platform-stack.md) | Foundation — proto-first polyglot monorepo | Decisions locked (incl. D8: defer frontend test harness to pnpm, PR #65) |
| [06-go-workspace-restructure.md](06-go-workspace-restructure.md) | Platform — move Go into `go/ims` + `go.work` | Deferred (after beta) |
| [07-proto-integration.md](07-proto-integration.md) | Platform — proto-first API contract (buf + Connect-Go) | ⏸️ PARKED post-fair — reverted from master; preserved on `archive/proto-integration`. generate-at-build convention kept on master. |
| [08-db-migration-tooling.md](08-db-migration-tooling.md) | Platform — DB migration tooling (goose, single source of truth) | ✅ Done (A #56, B #57, C #58, D #59, E #60) |
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
| [70-dashboards.md](70-dashboards.md) | Phase 7 — Dashboards & metrics | ✅ Built (7a PR #43, 7b PR #44) |
| [80-collaboration-and-notifications.md](80-collaboration-and-notifications.md) | Collaboration & notifications — track overview + sequencing | Backlog (context captured) |
| [81-journal-mentions.md](81-journal-mentions.md) | `@mention` people in journal entries | Idea — design sketch |
| [82-notifications.md](82-notifications.md) | Notifications (in-app first, email later) | Idea — design sketch |
| [83-email-infrastructure.md](83-email-infrastructure.md) | Email infrastructure (enabler) | Blocked on IT prerequisites |
| [84-web-push-notifications.md](84-web-push-notifications.md) | Web push notifications (3rd delivery channel; no IT needed) | In progress — 84a server plumbing (PR #104) + 84b client subscription built; 84c–84d to do |
