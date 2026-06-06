# Proto Integration: proto-first API contract (buf + Connect-Go)

> **Status:** Pipeline ✅ shipped (PR #8, branch `feat/proto-pipeline`); the
> generate-at-build-for-everything follow-up is **TODO** (next PR off this branch).
> &nbsp;·&nbsp; **Parent:** [05-platform-stack.md](05-platform-stack.md)
> &nbsp;·&nbsp; **Last updated:** 2026-06-05

This doc tracks the **protobuf integration** — bringing Protocol Buffers in as the
source of truth for the OCF IMS API. It is the concrete execution of platform-stack
**P0–P2** ([05-platform-stack.md §5](05-platform-stack.md)), done **in the current
repo layout** (no monorepo restructure — that's [06](06-go-workspace-restructure.md),
deferred). A retroactive note: this plan was written *after* the first pipeline PR
landed; it should have existed first. It is now the living home for the effort.

## Objective

Make `.proto` the typed contract for the IMS API so that **new and renamed surface
is proto-native instead of hand-written JSON** — generated Go (Connect-Go) now,
TypeScript when the interface work starts. Connect runs **alongside** the existing
REST API (strangler), reusing the same `store/`, `lib/authz`, action log, and JWT
auth underneath.

## Why now (not "after the event")

The platform plan originally deferred the whole platform track past the ~4-week
event. Two things that changed pulled the *contract* part forward (the **interface**
part still waits):

1. **Terminology is being decided** ([20-terminology.md](20-terminology.md)), and
   the deep rename **breaks the JSON/HTTP contract anyway**. Platform decision **D5**
   ("don't pre-bake undecided names into the contract") was the blocker — now lifted.
   Renaming hand-written JSON now *and* re-expressing it in proto later is double
   work on the same surface.
2. **The API is web-UI-only** (no external consumers — confirmed in 20-terminology).
   The biggest risk of adopting proto — breaking third-party clients — doesn't exist
   here. We already accepted a hard contract break.

So: define the renamed/new contract once, in proto. The **Expo interface** and the
**workspace restructure** remain post-event.

## What shipped (PR #8) — the pipeline ✅

| Area | What |
|---|---|
| **Schema** | `proto/ocf/ims/v1/incident.proto` — first entity. `Incident` (a *kept* term) + nested types (`Location`, `ReportEntry`, `PersonInvolvement`, `LinkedIncident`), `IncidentState`/`IncidentPriority` enums, and a read-only `IncidentService` (`ListIncidents`/`GetIncident`). |
| **buf config** | `buf.yaml` (module + lint STANDARD + breaking) and `buf.gen.yaml` (codegen). |
| **Codegen** | Local `go tool` plugins — `protoc-gen-go` + `protoc-gen-connect-go` — output to `gen/ocf/ims/v1/`. Hermetic: no remote plugin calls, no system installs. |
| **Tooling** | `buf`, `protoc-gen-go`, `protoc-gen-connect-go` added to the `go.mod` `tool` block — managed exactly like `sqlc`/`templ`/`tsgo`. |
| **Build wiring** | `bin/build/build.go` runs `go tool buf generate` alongside the other generators. |
| **Not committed** | `gen/` is git-ignored and generated at build time — see below. |

### Generated code is NOT committed (the convention this effort establishes)
Unlike the existing sqlc/templ/tsgo output (which *is* checked in), proto output
under `gen/` is **git-ignored** and produced wherever it's needed:
- **Docker** (`Dockerfile`) — `go tool buf generate` before `go build`.
- **CI** (`.github/workflows/cicd.yml`) — a generate step in the `build` job (before
  `go test ./...`) and the `lint` job (before pre-commit, whose
  golangci-lint/govulncheck compile `./...`). `DO_NOT_TRACK=1` suppresses buf
  telemetry under the hardened-runner egress block.
- **Local** — `go run bin/build/build.go` or `go tool buf generate`; documented in
  `CLAUDE.md`.

Nothing imports `gen/` yet, so a checkout without it still builds — the generate
steps are in place for the first handler that does.

## Key decisions

| # | Decision | Call | Rationale |
|---|----------|------|-----------|
| PI1 | Codegen toolchain | ✅ **`go tool` (hermetic)** | Matches how every generator here works; reproducible; no remote BSR calls. |
| PI2 | Codegen targets | ✅ **Go only for now** | Backend-first; TS target added when the interface work starts. |
| PI3 | Generated code in VCS | ✅ **Not committed** (`gen/` ignored) | Keep the tree free of generated artifacts; produce at build/deploy. *Diverges from sqlc/templ/tsgo — see follow-up to reconcile.* |
| PI4 | Naming in proto | ✅ **Proto leads the rename** — decided OCF terms | `reports` (was `field_reports`), `people_involved`/`person_id`/`nickname`/`involvement` (was `rangers`/`handle`/`role`). Proto is the lasting contract; handlers name-map to current `store/` types until the [20-terminology](20-terminology.md) slices land. Supersedes platform **D5**. |
| PI5 | Transport rollout | ✅ **Connect alongside REST** (strangler) | No rip-and-replace; the interface can adopt endpoints incrementally. |
| PI6 | Repo layout | ✅ **Current layout, single module** | Proto added without the [06](06-go-workspace-restructure.md) restructure; `gen/` later moves to `go/gen/` per platform §2. |

## Follow-up (TODO) — generate-at-build for *everything*

> **Scope of the next PR off this branch. Not started — plan only.**

PI3 currently creates an inconsistency: **proto output is generated-at-build, but
sqlc/templ/tsgo output is still committed.** The goal is one convention — *no
generated code in the tree* — applied to all four generators.

**Generators to move out of VCS:**
- **sqlc** → `store/imsdb/`, `directory/clubhousedb/`
- **templ** → `web/**/*_templ.go`
- **tsgo** → `web/static/*.js`
- **buf** → `gen/` *(already done)*

**Work involved:**
1. Git-ignore + untrack the three remaining generated outputs.
2. Ensure each is produced before compile in **all** paths: Docker build, CI
   (`build` + `lint`/pre-commit jobs), local (`build.go` already runs all four).
3. Resolve pre-commit interactions: hooks that compile (`golangci-lint`,
   `govulncheck`) need generated code present; file-content hooks
   (`prepend-license`, `end-of-file-fixer`, `trailing-whitespace`) must not touch
   generated files — they're untracked, so this should fall out for free, but
   verify. Remove the stale `cicd.yml` TODO ("maybe install sqlc, templ, and tsc
   code generation here") once these run in CI.
4. Confirm `go tool air` live-reload still regenerates appropriately.
5. Confirm IDE/editor experience: a fresh clone needs one generate run before
   packages resolve — document prominently in `CLAUDE.md`/`README`.

**Why it's a separate PR:** it changes the build/CI contract for the *whole*
codebase (not just proto), adds build time to CI (building sqlc/templ/tsgo from
source there), and touches the developer onboarding flow. Worth isolating so it can
be reviewed and reverted independently of the proto pipeline.

**Risks / open questions:**
- **CI build time** — compiling four generators from the module cache on every CI
  run. Measure; consider caching the `go tool` builds.
- **CI egress** — `buf generate` under the hardened-runner allow-list is unverified
  locally (Go fetches use the allowed proxy; local plugins make no remote calls). If
  it trips, add the needed host or pre-build the tool. Same caution applies if other
  tools phone home.
- **Pre-commit `--all-files`** runs in the `lint` job; make sure generate precedes
  the compiling hooks there too.

## Roadmap (after this branch)

- **First Connect handler** — implement `ListIncidents` over `store/`, registered on
  the existing mux next to the REST routes (platform **P2**). Proves the end-to-end
  typed path and makes the CI generate step load-bearing.
- **Grow the surface** — model **roles & permissions**
  ([40-roles-permissions.md](00-master-plan.md), when written) directly in proto;
  define mutations for Incident; add Report/Person once their renames land.
- **TypeScript target** — add `protoc-gen-es` to `buf.gen.yaml` when the Expo
  interface work begins (platform **P3**).
- **Restructure alignment** — when [06](06-go-workspace-restructure.md) happens,
  `gen/` → `go/gen/`, proto stays at `proto/`, TS output → `packages/`.

## Exit criteria

- [x] Proto pipeline: schema + buf config + hermetic go-tool codegen, wired into
      `build.go`. (PR #8)
- [x] `gen/` git-ignored; generated in Docker + CI + locally; documented.
- [ ] First Connect handler (`ListIncidents`) proves the end-to-end path.
- [ ] Follow-up PR: generate-at-build extended to sqlc/templ/tsgo (one convention).
- [ ] TypeScript target added (when interface work starts).
