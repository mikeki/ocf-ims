# 09f — Phase 1 opening: transport de-risk + restructure (slice 1a)

> **Status:** Plan — for review
> **Parent:** [09-proto-connect-platform.md](09-proto-connect-platform.md) (Phase 1)
> **Follows:** [09e-service-surface.md](09e-service-surface.md) (closes Phase 0)
> **Supersedes the execution detail of:** [06-go-workspace-restructure.md](06-go-workspace-restructure.md) (its gotcha list is carried and corrected below)
> **Last updated:** 2026-08-26

## Objective

Phase 0 is done: `proto/ocf/ims/**` is the full contract, and 0e's route→RPC
table has zero unclassified routes. **Phase 1 turns the server into a Connect
implementation.** This slice opens it with two **behavior-preserving** moves:

- **Step 0 — de-risk the transport.** Stand up one throwaway Connect RPC on the
  *current* tree to prove connect-go + an interceptor + protovalidate actually
  wire up in **this** server, then delete it. Phase 0 proved only that codegen
  emits; nothing has served a Connect request here yet.
- **Slice 1a — the restructure.** Move the Go tree to `go/`, everything under
  `internal/<domain>/` (package by feature, M1), entry point at
  `go/cmd/ocf-ims/main.go`. Mechanical: no product behavior changes.

Neither move adds an RPC handler or touches business logic — that is 1c/1d. This
slice makes the *ground* ready and retires the *transport* risk cheaply first, in
the order [09 §6 Phase 1](09-proto-connect-platform.md) prescribes ("Retire it
cheaply first … *then* start the move").

## Phase 1 at a glance (the sequence this slice opens)

| Slice | File | What |
|---|---|---|
| **1a** | **09f (this)** | Step-0 transport spike, then relocate to `go/` + `internal/<domain>/` |
| 1b | 09g | Interceptor spine — request id, slog, panic recovery, auth, **protovalidate**, action log; declared once, on by default (M9/M5) |
| 1c | 09h | **Extract everything** (M10) — all business logic out of the ex-`api/` handlers into its domain package; land the path-scoped `funlen`; MySQL `RunInTx` retrying 1213/1205 |
| 1d | 09i | One thin handler method per RPC; each REST handler reduced to a shim over the same domain functions |
| 1e | 09j | The M8 surfaces (blob I/O, `sw.js`, the SSE stream decision) + the private-incident poke-stream leak fix |
| 1f | 09k | Config → struct tags + `Validate()` (V8), optional |

*(File-letter convention: Phase 0 used 09a–09e for 0a–0e; Phase 1 continues the
letters, so 09f = slice 1a, 09g = 1b, and so on. The letter is a filename ordinal,
not the slice id — the title carries the real slice id.)*

## Step 0 — de-risk the transport (before the move)

**Why first.** 1a is a large mechanical move; 1b–1d then build the real server on
top of connect-go, the interceptor chain and protovalidate — **all three unproven
in this codebase**. If any of them fights this server (mux coexistence, the
validate interceptor, the generated `servicev1connect` handler interface), we want
to learn it in an afternoon on the tree we already understand, not tangled up in
the restructure diff.

**What.** On the **current** tree (no move yet):

1. Add a tiny hand-written implementation of **one** `ImsService` method — pick a
   pure read with a trivial response, e.g. `GetAuthStatus` or a stub `ListEvents`
   returning a canned value — embedding
   `servicev1connect.UnimplementedImsServiceHandler` so the other 48 stay
   unimplemented. *(This is the only place `Unimplemented…` embedding is allowed;
   the Phase 1 gate forbids it outside the spike/tests.)*
2. Construct the handler with **one** interceptor — the
   `connectrpc.com/validate` protovalidate interceptor (vendored buf module is
   already in the tree from 0b) — to prove the interceptor option plumbs through.
3. Register it on the **existing** mux next to the REST/web muxes at
   `cmd/serve.go:144-145` (`api.AddToMux` / `web.AddToMux`): connect-go handlers
   are plain `http.Handler`s at a path prefix, so they coexist with
   `http.ServeMux` without a second server.
4. **Prove it**, three ways: a `buf curl` / `connect` call returns the canned
   response; a request that violates a protovalidate constraint returns
   `invalid_argument`; `go test` exercises it through the **generated connect-go
   client** (the Phase 1 gate's client path, rehearsed once).
5. **Delete the spike.** It is scaffolding, not 1d. Its findings (below) are the
   keeper.

**Gate for Step 0:** one RPC answers over Connect locally, one bad request is
rejected by the interceptor, one test hits it through the generated client — then
the diff is reverted, leaving only a findings note. This is a spike, not a slice
deliverable.

## Slice 1a — the restructure

**Mechanical and behavior-preserving.** Success = identical build/test/run
behavior from the new location. Everything is `git mv` on a branch; if the gate
won't go green, abandon the branch (nothing but paths changed).

### Target layout

```
/                      repo root — proto/buf/pnpm tier + repo meta stay here
  proto/               the contract (shared by Go + TS) — STAYS at root
  buf.yaml buf.gen.yaml buf.gen.web.yaml            — STAY (buf runs against proto/)
  packages/ pnpm-workspace.yaml package.json …      — STAY (TS tier)
  docs/ .github/ playwright/ LICENSE …              — STAY (repo meta)
  go/                  the Go module (module path unchanged: github.com/mikeki/ocf-ims)
    go.mod go.sum
    cmd/ocf-ims/main.go        run(ctx, cfg) error
    gen/                       generated Go (buf out: gen → go/gen)
    internal/
      server/                  cross-cutting only: mux, interceptors, ctx helpers
      incident/ report/ person/ event/ area/ crew/ … one package per domain (M1)
      imsdb/                   sqlc output (one generated package, was store/imsdb)
    db/
      queries/<resource>.sql   split of store/queries.sql (V13)
      migrations/*.sql         moved from store/schema/migrations (V13)
```

**Corrections to plan 06** (written for `go/ims/` + a `go.work`, and pre-proto):

- Target is **`go/`, a single module — no `go.work`** (09 M1). So `go env GOMOD`
  is unambiguous again (it resolves to `go/go.mod`); plan-06 gotcha #1's
  workspace-mode hazard **does not apply**. A different `build.go` issue takes its
  place — see *Diverging roots* below.
- Module path is **`github.com/mikeki/ocf-ims`** and the binary is **`ocf-ims`**
  (the OCF rebrand already happened; plan 06 still says `ranger-ims-go`). Import
  paths are module-relative, so **no `import` line changes** (M11) — including
  `…/gen/…`, which resolves to `github.com/mikeki/ocf-ims/gen/…` before and after.
- The **proto/gen/pnpm tier did not exist** when plan 06 was written; it stays at
  root, which is what forces the two items below.

### The load-bearing new gotcha — diverging roots

The Go module root becomes `go/`, but **the proto/buf root stays at the repo
root** (proto is shared with the TS tier and must not move under `go/`). So:

- **`buf` out path changes `gen` → `go/gen`** (M11: "only buf's `out:` path
  changes"), and buf still runs **from the repo root** (that is where `proto/` and
  the buf configs live). `buf.gen.yaml` currently has `out: gen` and
  `out: gen/openapi` → `go/gen`, `go/gen/openapi`.
- **`bin/build/build.go` assumes one root.** It computes `repoRoot()` from
  `go env GOMOD` (`build.go:162-172`) and drives every generator relative to it.
  After the move `GOMOD` points at `go/go.mod`, so `repoRoot()` returns `…/go` —
  but buf must run against `…/proto` (the *repo* root) and templ/tsgo/sqlc against
  `…/go`. `build.go` needs an explicit notion of **repo root vs module root**
  (walk up one from the module dir, or find the dir holding `buf.yaml`). This is
  the one piece of build tooling that is *not* a pure path find-replace.

### What moves vs. what stays

**Moves into `go/`** (use `git mv` to keep history): `go.mod`, `go.sum`,
`main.go` → `go/cmd/ocf-ims/main.go`, the Go source dirs (`api/`, `store/`,
`web/`, `lib/`, `cmd/`, `json/`, `directory/`, `bin/`, `conf/`), `gen/` → `go/gen`,
and the Go-build config that references them: `sqlc.yaml`, `.air.toml`,
`tsconfig.json` (legacy templ/tsgo web build), `.golangci.yml`, `Makefile`.

**Stays at repo root:** `proto/`, `buf.yaml`, `buf.gen.yaml`, `buf.gen.web.yaml`,
`packages/`, `pnpm-workspace.yaml`, `package.json`, `pnpm-lock.yaml`, `biome.json`,
`.npmrc`, `.nvmrc`, `node_modules/`, `docs/`, `.github/`, `playwright/`,
`.pre-commit-config.yaml`, `.gitignore`, `LICENSE`/`COPYRIGHT`/`NOTICE`, the
`docker-compose.*.yml` files, and the `README`/`CLAUDE.md`/`SECURITY` meta.

**Embeds move with their packages and keep working** (plan-06 #2 ✔):
`web/static.go` (`static`), `store/seed.go` (`fakeimsdb/seed.sql`). The **one
exception** is `store/store.go`'s `//go:embed schema/migrations/*.sql` — if
migrations relocate to `go/db/migrations/` (V13), that embed path must change (or
the sqlc `migrations` path in `sqlc.yaml`, which also reads them). See the open
decision on the `db/` split.

### Gotcha table (carried from plan 06, corrected for this tree)

| # | Gotcha | Status here |
|---|---|---|
| 1 | `go.work` makes `go env GOMOD` ambiguous | **N/A** — single module, no `go.work` (M1). Replaced by *Diverging roots* |
| 2 | `go:embed` paths are package-relative → move with packages | ✔ unchanged, **except** the migrations embed if `db/` split lands |
| 3 | Module path unchanged → no `import` edits | ✔ (`github.com/mikeki/ocf-ims`, incl. `…/gen`) |
| 4 | `go tool` directives move with `go.mod` | ✔ (sqlc/templ/tsgo/air/buf all `go tool`) |
| 5 | Docker context shrinks to the Go dir | **Wrong now** — see Docker decision; the server image needs `proto/` + buf to run `build.go -generate-only` |
| 6 | CI needs working dirs | `cicd.yml` (build+lint jobs run `build.go`, `go test`), `codeql.yml` (Go path), `deploy.yml`; add `working-directory: go` to Go steps but **keep buf steps at root** |
| 7 | pre-commit / golangci paths | `.pre-commit-config.yaml` Go hooks, `.golangci.yml` path; `.dockerignore` |
| 8 | Docs reference root-relative commands | `CLAUDE.md` + `README.md` dev commands now run from `go/` (CLAUDE.md is loaded into agent context — stale paths actively mislead) |

### Open decisions (resolve during 1a, flagged so the reviewer sees them)

1. **Domain repackage in 1a, or a two-step?** M1/M10 want the
   `internal/<domain>/` homes to exist before 1c extracts into them "once." But a
   full handler-file repackage *plus* the `go/` relocation in one commit is a large
   diff to call "mechanical." **Recommendation:** 1a relocates and creates the
   `internal/<domain>/` skeleton by moving **whole handler files** (`api/incident.go`
   → `internal/incident/…`) with their package renamed — no logic moved, no
   functions split. Fat handlers stay fat until 1c. This keeps 1a a pure move while
   giving 1c its final homes.
2. **`db/` split now or later.** V13 moves migrations to `go/db/migrations/` and
   splits `store/queries.sql` into `go/db/queries/<resource>.sql`. The migrations
   move touches the `store.go` embed + the `sqlc.yaml` migrations path + the goose
   runtime path; the query split is pure `sqlc.yaml` input reorganization (still
   one generated `imsdb` package). **Recommendation:** do the query-file split in
   1a (cheap, no runtime path change) but **defer the migrations relocation** to
   its own tiny commit so the embed/goose/sqlc path change is isolated and easy to
   revert — history is append-only and the migrations dir is load-bearing.
3. **Docker context.** The server image runs `build.go -generate-only`, which runs
   `buf generate proto` → it needs `proto/` + `buf.yaml` + `buf.gen.yaml` **and**
   `go/`. It does **not** need pnpm/`packages/` (build.go skips the TS target when
   pnpm is absent — the 0a finding). **Recommendation:** keep the `Dockerfile` at
   root with **context `.`**, and narrow via `.dockerignore` (exclude
   `packages/`, `node_modules/`, `playwright/`, `web/typescript` sources not needed
   at runtime) rather than moving the Dockerfile under `go/`. Update the `COPY`
   lines and `docker-compose.cicd.yml` / `docker-compose.dev.yml` (`dev.Dockerfile`)
   accordingly. This is the plan-06 #5 correction.

### Verification gate (1a)

From `go/` unless noted:

- [ ] `go build ./...` compiles; `go test ./...` passes.
- [ ] `go run bin/build/build.go` (from the right cwd per *Diverging roots*) runs
      every generator and produces `ocf-ims`, with **no unexpected diff** in
      generated output (`internal/imsdb`, `web/**/*_templ.go`, `web/static/*.js`,
      `go/gen/**`).
- [ ] `go tool air` live-reload smoke-starts; `./ocf-ims serve` (or `healthcheck`)
      boots.
- [ ] `docker build` (new context/`.dockerignore`) succeeds; container runs.
- [ ] `go test ./store/integration ./api/integration` green where Docker is up.
- [ ] `go tool buf lint` + `buf generate` still clean **from repo root**.
- [ ] CI green on the branch — path bugs surface there, so push and watch.
- [ ] Playwright smoke still reaches the server (optional).

### Rollback

Pure `git mv` on a branch. If the gate resists, abandon it — no data, schema, or
logic touched.

## Findings queued for the §7 upstream log (Phase 1)

Appended to [09 §7](09-proto-connect-platform.md) as the slice lands, per M14 —
not written from memory afterward:

- **Diverging roots in a polyglot monorepo.** The stack's blueprints assume the
  module root and the repo root coincide. Here the Go module lives at `go/` while
  the proto contract stays at the repo root (shared with the TS tier), so a
  single-generator driver (`build.go`) needs an explicit repo-root-vs-module-root
  distinction, and buf's `out:` reaches *up and over* into `go/gen`. A concrete
  adoption-path detail the "package by feature" guidance (finding #4) is silent on.
- **Docker context can't shrink to the module dir** when the image regenerates
  from proto at build time — it needs `proto/` + buf too (extends finding #10).
- **The transport de-risk spike** (connect-go + validate interceptor coexisting on
  an existing `http.ServeMux`) — whether it wired up cleanly, and any mux/precedence
  surprises. Feeds finding #6 (non-RPC surfaces beside the contract).
