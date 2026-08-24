# Platform Track — Go workspace restructure (`go/ims` + `go.work`)

> ## 📌 Superseded by [09-proto-connect-platform.md](09-proto-connect-platform.md) (2026-08-24)
>
> The restructure is now **slice 1a of plan 09**, and the target changed: the Go
> module moves to **`go/`** with `cmd/ocf-ims/` and everything under `internal/`
> — the maybloom stack's documented shape — rather than `go/ims/` with a
> `go.work` (09 M1). Slice 1a also splits `store/queries.sql` into
> `go/db/queries/` and moves migrations to `go/db/migrations/`.
>
> **The "Known gotchas" and "Verification gate" sections below remain accurate
> and load-bearing** — read them before executing 09-1a.

> **Status:** Deferred — execute *after* the OCF beta/event (decision 2026-06-05).
> &nbsp;·&nbsp; **Parent:** [05-platform-stack.md](05-platform-stack.md)
> &nbsp;·&nbsp; **Last updated:** 2026-06-05

## Objective

Move the entire Go application from the repo root into **`go/ims/`** and add a
root **`go.work`**, turning this repo into a polyglot monorepo with Go as a
first-class, multi-module-ready tier. This is the kickoff of the platform track
([05-platform-stack.md](05-platform-stack.md), decision **D1**).

**This is a mechanical, behavior-preserving change.** No application logic
changes. Success = identical build/test/run behavior, just from the new location.

## Scope

- ✅ Move the Go tree → `go/ims/`; add root `go.work`; fix every build/config/CI/
  Docker/doc reference to the new paths until everything is green again.
- ❌ Not here: adding `proto/`, `pnpm`, the generated packages, or the Expo
  interface — that's platform-stack phases **P0–P4**. This plan only relocates
  what exists and stands up the workspace.

## What moves vs. what stays

**Moves into `go/ims/`** (use `git mv` to preserve history):
`go.mod`, `go.sum`, `main.go`, and the Go source dirs — `api/`, `store/`,
`web/`, `lib/`, `cmd/`, `json/`, `directory/`, `bin/`, `conf/` — plus the
Go-build-specific config that references them: `sqlc.yaml`, `.air.toml`,
`tsconfig.json` (the legacy `templ`/`tsgo` web UI build), `.golangci.yml`,
`Makefile`, `Dockerfile`, `dev.Dockerfile`.

**Stays at repo root** (repo-level meta + future monorepo files):
`docs/`, `.github/`, `LICENSE`, `COPYRIGHT`, `README.md`, `CLAUDE.md`,
`SECURITY.md`, `CHANGELOG.md`, `.gitignore` (root), `.pre-commit-config.yaml`
(repo-level), `playwright/` (drives the running server over HTTP — location
independent), and the soon-to-arrive `pnpm`/`proto` files.

**New at root:** `go.work`:
```
go <match go/ims/go.mod's go directive>

use ./go/ims
// ./go/gen added in platform P1 when generated Go appears
```

## Known gotchas (read before executing)

1. **`go.work` makes `go env GOMOD` ambiguous.** `bin/build/build.go` computes the
   repo root via `go env GOMOD` (`build.go:117-127`). In workspace mode, run from
   the workspace root, `GOMOD` is empty/`os.DevNull`, which breaks `repoRoot()`.
   **Mitigation:** run all Go build tooling (`build.go`, `go tool sqlc/templ/tsgo`,
   `go tool air`) **from within `go/ims/`**, or invoke with `GOWORK=off`. Verify
   `repoRoot()` returns `…/go/ims` after the move; adjust if needed.
2. **`go:embed` paths are package-relative** (`store/schema/*`, `web/static`, …) —
   they move *with* their packages, so **embeds keep working unchanged**. ✔
3. **Module path is unchanged.** Keep `module github.com/burningmantech/ranger-ims-go`
   in `go/ims/go.mod` even though the directory is now `go/ims/`. Go import paths
   are module-relative, **so no `import` statements change.** (Rename deferred to
   the OCF rebrand.)
4. **`go tool` directives move with `go.mod`** (sqlc, templ, tsgo, air are tool
   deps) — they keep working when invoked from `go/ims/`.
5. **Docker context shrinks.** The server image only needs `go/ims/`. Either move
   `Dockerfile`/`dev.Dockerfile` into `go/ims/` with build context `go/ims`, or
   keep them at root and rewrite `COPY go.mod go.sum ./` / `COPY ./ ./` to the
   `go/ims/` subpath. Recommended: **Dockerfiles in `go/ims/`, context `go/ims`**
   (simplest, smallest image context). Update `docker-compose.dev.yml`
   (`context: .` → `context: ./go/ims`) and `docker-compose.cicd.yml`.
6. **CI needs working dirs.** `.github/workflows/cicd.yml` and `deploy.yml` run
   `go …`, `go run bin/fetchbuilddeps/…`, `go test …`, and `docker build .` from
   root. Add `working-directory: go/ims` to the Go steps (or a top-level
   `defaults.run.working-directory`) and fix the `docker build` context. Check
   `codeql.yml` (Go analysis path) and `automerge.yml` too.
7. **pre-commit / golangci paths.** `.pre-commit-config.yaml` hooks that run Go
   tools need the new path; `.golangci.yml` moves with the module (or set its
   path in the hook).
8. **Docs reference root-relative commands.** `CLAUDE.md` and `README.md` list
   dev commands (`go run bin/build/build.go`, `./ranger-ims-go serve`, etc.) — all
   now run from `go/ims/`. Update them (CLAUDE.md is loaded into agent context, so
   stale paths actively mislead).

## Execution steps

Do this on a branch, in one focused pass, verifying green at the end.

1. **Branch.** `git checkout -b platform/go-workspace-restructure`.
2. **Move the tree.** `git mv` each item from the "Moves" list into `go/ims/`
   (e.g. `mkdir -p go/ims && git mv go.mod go.sum main.go api store web lib cmd json directory bin conf sqlc.yaml .air.toml tsconfig.json .golangci.yml Makefile Dockerfile dev.Dockerfile go/ims/`).
3. **Add `go.work`** at root (`use ./go/ims`, matching go directive). Run
   `go work sync`.
4. **Build tooling from `go/ims`.** Verify `repoRoot()` (gotcha #1): from
   `go/ims/`, run `go run bin/build/build.go`. Fix invocation/`GOWORK` if it
   misresolves. Confirm sqlc/templ/tsgo regenerate in place with no diff.
5. **Docker.** Move/repoint Dockerfiles (gotcha #5); `docker build` the server
   image from the new context.
6. **CI.** Update `.github/workflows/*` working dirs + docker context (gotcha #6).
7. **Meta config.** Fix `.pre-commit-config.yaml`, the root `.gitignore` (paths
   like `/compose.ranger-ims-go`, `coverage.out`, `air_tmp` now under `go/ims/`),
   and any `Makefile` delegation.
8. **Docs.** Update `CLAUDE.md` + `README.md` dev commands to run from `go/ims/`
   (note the `go.work`/cwd requirement). Update the Development Commands section
   of `CLAUDE.md` in particular.
9. **Verify** (the gate below).
10. **Commit** as a single mechanical move commit (use `git mv` so history/blame
    follow the files), then merge to master per the repo's flow.

## Verification gate

From `go/ims/` unless noted:
- [ ] `go build ./...` — compiles.
- [ ] `go test ./...` — unit tests pass.
- [ ] `go run bin/build/build.go` — generators run; produces the binary; **no
      unexpected diff** in generated files (`store/imsdb`, `*_templ.go`,
      `web/static/*.js`).
- [ ] `go tool air` — live reload smoke-test starts.
- [ ] `./<binary> serve` (or `healthcheck`) — server boots.
- [ ] `docker build` (new context) succeeds; container runs.
- [ ] `go test ./store/integration ./api/integration` — green where Docker is
      available.
- [ ] (root) `go work sync` clean; `go vet ./...` from workspace OK.
- [ ] CI passes on the branch (push and watch, since path bugs surface there).
- [ ] `playwright` smoke (optional) still hits the server.

## Rollback

Everything is `git mv` on a branch — if the gate fails and can't be quickly
resolved, abandon the branch. No data, schema, or logic touched.

## Sequencing under the event deadline

See [00-master-plan.md](00-master-plan.md) → "Sequencing under the event
deadline". **Decision (2026-06-05): deferred to after the event.** We keep the
build/deploy pipeline frozen through the beta and spend pre-event time on OCF
beta value rather than this plumbing. Doing the restructure later re-touches a
more-diverged tree, but it remains mechanical and behavior-preserving. It then
becomes the kickoff of the platform track (P0 onward).
