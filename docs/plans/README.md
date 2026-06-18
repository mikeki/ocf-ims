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
  - (room to grow)
- Plans are living documents. Mark sections as `Status: TODO / In progress /
  Done` and check off tasks as they land. Reference concrete files and PRs.

## Status

| Plan | Phase | Status |
|------|-------|--------|
| [00-master-plan.md](00-master-plan.md) | Master roadmap | Draft — Phase 1 ✅ done, Phase 2 next |
| [05-platform-stack.md](05-platform-stack.md) | Foundation — proto-first polyglot monorepo | Decisions locked |
| [06-go-workspace-restructure.md](06-go-workspace-restructure.md) | Platform — move Go into `go/ims` + `go.work` | Deferred (after beta) |
| [07-proto-integration.md](07-proto-integration.md) | Platform — proto-first API contract (buf + Connect-Go) | ⏸️ PARKED post-fair — reverted from master; preserved on `archive/proto-integration`. generate-at-build convention kept on master. |
| [10-cleanup-pass.md](10-cleanup-pass.md) | Phase 1 — Preparation & clean-up | ✅ Done (PRs #1–#5) |
| [11-remove-concentric-streets.md](11-remove-concentric-streets.md) | Phase 1 — Remove Concentric Streets | ✅ Done (PR #1) |
| [20-terminology.md](20-terminology.md) | Phase 2 — Terminology | 2a ✅ (PR #13), 2c ✅ (PR #14); 2b → Phase 3; 2d awaiting OCF wording |
| [30-remove-clubhouse.md](30-remove-clubhouse.md) | Phase 3 — Remove Clubhouse & local People (umbrella) | ✅ Done (PRs #16–#19) |
| [31-local-people-directory.md](31-local-people-directory.md) | Phase 3 — Local people directory | ✅ Done (PR #16) |
| [32-retire-clubhouse.md](32-retire-clubhouse.md) | Phase 3 — Retire Clubhouse | ✅ Done (PR #17) |
| [33-people-rename.md](33-people-rename.md) | Phase 3 — Ranger→People rename | ✅ Done (PR #18) |
| [34-post-clubhouse-login.md](34-post-clubhouse-login.md) | Phase 3 — Post-Clubhouse login + admin password reset | ✅ Done (PR #19); emailed reset deferred (appendix) |
| [40-domain-model.md](40-domain-model.md) | Phase 4 — Domain model (categories, outcomes, locations) | ✅ Done (PRs #20–#24) |
| [50-roles-permissions.md](50-roles-permissions.md) | Phase 5 — Roles & permissions | 5a ✅ (PR #27), 5a.1 ✅ (PR #28); 5b–5e planned |
| [51-people-registry.md](51-people-registry.md) | Phase 5e — Unified people registry | Plan — for review |
| [60-feedback-round-1.md](60-feedback-round-1.md) | Phase 6 — Feedback round 1 (beta usage feedback) | Plan — for review |
| [61-feedback-round-2.md](61-feedback-round-2.md) | Phase 6 — Feedback round 2 (structured stakeholder review) | Plan — for review |
| [62-people-event-nav.md](62-people-event-nav.md) | Phase 6 — People page → event nav (slice 6e) | ✅ Built (PR #42) |
| [63-feedback-round-3.md](63-feedback-round-3.md) | Phase 6 — Feedback round 3 (post-Phase-7 review fixes: 6f–6h) | ✅ Built (6f PR #47, 6h PR #48, 6g PR #49) |
| [70-dashboards.md](70-dashboards.md) | Phase 7 — Dashboards & metrics | ✅ Built (7a PR #43, 7b PR #44) |
