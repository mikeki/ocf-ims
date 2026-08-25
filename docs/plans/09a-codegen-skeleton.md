# 09a — Codegen skeleton (Phase 0, slice 0a)

> **Status:** Built — for review
> **Parent:** [09-proto-connect-platform.md](09-proto-connect-platform.md) (Phase 0)
> **Last updated:** 2026-08-24

## Objective

Stand up the whole protobuf codegen toolchain and prove **every target emits**
from one throwaway proto, with **no behaviour change** to the running server and
the system still deployable. This is the plan's explicit first step — *"Ship this
before modelling anything — it de-risks the rest."* No API is modelled here; that
begins in 0b.

## What landed

**buf + generators (4 targets, all proven):**
- `buf.yaml` — v2 module, lint `STANDARD`, breaking `FILE`.
- `buf.gen.yaml` — the **hermetic, Go-tool-only** targets: `protoc-gen-go` +
  `protoc-gen-connect-go` → `gen/`, `protoc-gen-connect-openapi` → `gen/openapi/`.
- `buf.gen.web.yaml` — the **pnpm** target: `protoc-gen-es`
  (`target=ts, json_types=true`) → `packages/protocol-buffers/src/`.
- `proto/ocf/ims/example/v1/example.proto` — throwaway proto (a message + a
  one-RPC service, so all four generators emit). **Deleted when 0b lands real
  resources.**

**Go tools** (pinned in `go.mod`, via `go get -tool`): `protoc-gen-go` v1.36.11,
`protoc-gen-connect-go` v1.20.0, `buf` v1.70.0, `protoc-gen-connect-openapi`
v0.25.7. `connectrpc.com/connect` and `google.golang.org/protobuf` are now direct
requires (the generated Go imports them).

**pnpm / biome workspace** (M6): `package.json` (root, `pnpm@9.9.0`),
`pnpm-workspace.yaml`, `packages/protocol-buffers/package.json`
(`@bufbuild/protobuf`), `pnpm-lock.yaml`, `.npmrc`, `.nvmrc` (24), `biome.json`
(scoped to `packages/**` + root configs; the legacy `web/typescript` stays
tsgo/eslint's domain).

**Wiring:**
- `bin/build/build.go` — a buf goroutine that always runs the hermetic Go targets
  and runs the pnpm TS target only when `pnpm` is on PATH (`pnpmAvailable()`).
- `.github/workflows/cicd.yml` — `lint` job: `pnpm/action-setup`,
  `registry.npmjs.org` added to the harden-runner allow-list, and a
  `go tool buf lint` gate. The `build` job is unchanged (no pnpm → build.go
  generates the Go proto targets and skips the TS one).
- `.gitignore` — `/gen/` and `/packages/protocol-buffers/src/`.

## Key decisions

1. **`gen/` at the repo root** (`github.com/mikeki/ocf-ims/gen/…`, M11) — resolves
   the same before and after the Phase-1a move to `go/`. Gitignored,
   `paths=source_relative`.
2. **Two buf templates so the Docker builder never needs a JS toolchain.** The Go
   binary's compile inputs are all hermetic Go-tool codegen; the TypeScript is a
   client artifact generated only where a JS toolchain exists (dev + CI lint job),
   never in the `golang:alpine` build stage. This — rather than adding node/pnpm to
   the Docker builder — is why `bin/build/build.go` gates the pnpm step and no
   `Dockerfile` edit was needed.
3. **License header lives in the `.proto`.** protoc-gen-{go,connect-go,es} all copy
   the proto's leading comments to the top of their output, so the Apache header
   flows into every generated artifact automatically and `prependlicense` skips
   them all — no `prependlicense` change needed. golangci-lint still detects the
   files as generated (the `// Code generated … DO NOT EDIT.` marker sits before
   the package clause) and reports **0 issues** on `gen/`.
4. **protovalidate is deferred to 0b.** The throwaway proto uses no `buf/validate`
   import, so 0a is free of any BSR module dependency and fully hermetic. The
   vendor-vs-BSR+allow-list decision for `buf/validate/validate.proto` is made when
   the first constraint is modelled in 0b.

## Verification

- `go run bin/build/build.go -generate-only` emits all four: `gen/…/*.pb.go`,
  `gen/…/*.connect.go`, `gen/openapi/…/*.openapi.yaml`, and
  `packages/protocol-buffers/src/…/*_pb.ts` (with `…Json` types for M12).
- `go tool buf lint` clean; `go build ./...`, `go vet ./...` green; golangci-lint 0
  issues on `gen/` and `bin/build/`; `biome check .` clean.
- Docker path: full `docker build` **green**. The `golang:alpine` builder ran
  `go tool buf generate` hermetically (no network for the throwaway proto) and
  logged `pnpm not on PATH; skipping TypeScript proto codegen` — the gate works as
  designed. Cost: `go tool buf` compiles buf from source (~4 min, one-time per
  build), so the `docker-build` CI job's `timeout-minutes` was raised 10 → 15. A
  Go-build-cache mount wouldn't help CI (plain `docker build` on a fresh runner
  keeps no cache between runs), so the timeout bump is the fix, not an
  optimization.

## Gate (plan 09 §6, Phase 0)

`buf lint` clean ✅; Go, TypeScript and OpenAPI generate from a clean tree ✅; the
`docker build` is green ✅; `go build`/`go vet` and the unit tests (all non-`integration`
packages) are green ✅ — the testcontainer integration suite wasn't re-run, and is
unaffected because 0a changes no runtime Go (only `build.go` and the new,
still-unimported `gen/`). CI reproduces the generate step ✅. (`buf breaking` and the
route→RPC mapping table are later-slice gates.)

## Next

- **0b — Core domain** `resources/v1`: incident, report, journal entry, person
  involvement, linked incident, area, event — **with protovalidate constraints
  written as each message is modelled**, and the protovalidate proto-dependency
  strategy decided (deferred from here).
