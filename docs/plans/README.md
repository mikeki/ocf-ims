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
  - `00–09` — meta / master / cross-cutting
  - `10–19` — Phase 1: Preparation & clean-up
  - `20–29` — Phase 2: Terminology
  - `30–39` — Phase 3: Domain model (categories, outcomes, locations)
  - `40–49` — Phase 4: Roles & permissions
  - `50–59` — Phase 5: Dashboards & metrics
  - (room to grow)
- Plans are living documents. Mark sections as `Status: TODO / In progress /
  Done` and check off tasks as they land. Reference concrete files and PRs.

## Status

| Plan | Phase | Status |
|------|-------|--------|
| [00-master-plan.md](00-master-plan.md) | Master roadmap | Draft — Phase 1 ✅ done, Phase 2 next |
| [05-platform-stack.md](05-platform-stack.md) | Foundation — proto-first polyglot monorepo | Decisions locked |
| [06-go-workspace-restructure.md](06-go-workspace-restructure.md) | Platform — move Go into `go/ims` + `go.work` | Deferred (after beta) |
| [10-cleanup-pass.md](10-cleanup-pass.md) | Phase 1 — Preparation & clean-up | ✅ Done (PRs #1–#5) |
| [11-remove-concentric-streets.md](11-remove-concentric-streets.md) | Phase 1 — Remove Concentric Streets | ✅ Done (PR #1) |
| [20-terminology.md](20-terminology.md) | Phase 2 — Terminology | Draft — core decisions captured; awaiting OCF wording sign-off |
