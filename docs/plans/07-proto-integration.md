# Proto Integration: proto-first API contract (buf + Connect-Go)

> **Status:** Pipeline ✅ shipped (PR #8); generate-at-build extended to **all four
> generators** ✅ (branch `feat/generate-at-build`). Next: first Connect handler.
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

## Follow-up ✅ — generate-at-build for *everything* (branch `feat/generate-at-build`)

> **Shipped.** PI3's inconsistency is resolved: **all four generators are now
> generate-at-build**, no generated code in the tree.

**Generators moved out of VCS** (50 files untracked):
- **sqlc** → `store/imsdb/`, `directory/clubhousedb/` ✅
- **templ** → `web/template/*_templ.go` ✅
- **tsgo** → `web/static/*.js` ✅
- **buf** → `gen/` *(already done in PR #8)*

**What changed:**
1. `.gitignore` extended to all four outputs; the 50 previously-committed files
   `git rm --cached`'d (kept on disk, removed from VCS).
2. **One entrypoint**: `bin/build/build.go` gained a `-generate-only` flag that runs
   the existing parallel generator errgroup (sqlc/templ/tsgo/buf + fetchbuilddeps)
   and skips the final `go build`. Every caller uses it:
   - **Docker** — `RUN go run bin/build/build.go -generate-only` before the
     cross-compile `go build`.
   - **CI** — one "Generate code (sqlc, templ, tsgo, buf)" step in both the `build`
     job (before `go test`) and the `lint` job (before pre-commit), replacing the
     prior buf-only + separate fetch-deps steps. `DO_NOT_TRACK=1` set on both.
   - **Local** — `go run bin/build/build.go` (full) or `-generate-only`.
3. **Pre-commit**: per decision, generation is **not** a hook — it's an explicit CI
   step before `pre-commit run --all-files`, matching how buf was handled. The
   compiling hooks (`golangci-lint`, `govulncheck`, `go-vet`) see generated code
   because the generate step precedes them. File-content hooks
   (`prepend-license`/`end-of-file-fixer`/`trailing-whitespace`) never touch the
   generated files — they're untracked, confirmed. Removed the stale `cicd.yml` TODO.
4. `CLAUDE.md` updated: a fresh clone must run generate before anything compiles.

**Verified:** wiped all generated outputs, ran `-generate-only` from scratch, then
`go build ./...` + `go vet ./...` green; all outputs confirmed git-ignored.

**Residual risks to watch (first CI run):**
- **CI build time** — four generators compiled from the module cache each run
  (sqlc dominates, ~24s locally). Measure; consider caching the `go tool` builds.
- **CI egress** — generators run under the hardened-runner allow-list. Go fetches
  use the allowed proxy; local plugins make no remote calls; fetchbuilddeps hits
  jsdelivr/jquery/datatables (already allow-listed in both jobs); buf has
  `DO_NOT_TRACK=1`. Watch for any new host.

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
- [x] Follow-up PR: generate-at-build extended to sqlc/templ/tsgo (one convention).
      (branch `feat/generate-at-build`)
- [ ] TypeScript target added (when interface work starts).
