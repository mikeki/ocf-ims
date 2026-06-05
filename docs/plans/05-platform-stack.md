# Platform Stack: proto-first polyglot monorepo

> **Status:** Draft / architecture proposal &nbsp;·&nbsp; **Parent:** [00-master-plan.md](00-master-plan.md)
> &nbsp;·&nbsp; **Last updated:** 2026-06-05

This document is **self-contained**: it assumes no prior knowledge of any other
project. It defines the target architecture ("the platform stack") for OCF IMS
and how we adopt it in this repository.

## 1. What we're building toward

Today this repo is a single **Go** application: a server-rendered incident
management system (HTTP/JSON API in `api/`, data layer in `store/` over MariaDB,
and a web UI built from `templ` templates + hand-written TypeScript compiled by
`tsgo` into `web/static`).

We want to evolve it into a **proto-first, polyglot monorepo** so we can build a
modern cross-platform (iOS / Android / web) interface on top of the IMS without
rewriting the proven Go backend. The architecture has four pillars:

1. **Protocol Buffers as the single source of truth** for the API contract,
   managed with [`buf`](https://buf.build).
2. **Connect-RPC** as the transport. Connect is a gRPC-compatible protocol that
   runs over plain HTTP/1.1 and is **cross-language**: a Connect server written
   in **Go** speaks the identical wire protocol that a Connect client written in
   **TypeScript** consumes. The client cannot tell whether the service behind a
   proto contract is implemented in Go or TypeScript.
3. **A `pnpm` workspace** (monorepo) hosting the generated code and the
   front-end(s) as versioned packages.
4. **An [Expo](https://expo.dev) interface** — one React Native codebase that
   ships to iOS, Android, *and* web — that talks to the IMS purely through the
   generated, type-safe Connect client.

### Why this shape

- **No backend rewrite.** The Go IMS stays. We add Connect-Go handlers that run
  on the same `net/http` server as the existing REST API, so proto endpoints
  appear incrementally alongside what's already there.
- **One typed contract, many consumers.** Change a `.proto`, regenerate, and both
  the Go server stubs and the TypeScript client types update together. No drift
  between client and server.
- **One interface codebase for mobile + web.** Expo replaces the need for a
  separate native app and web app.
- **Polyglot by design.** Go and TypeScript services can coexist as peers behind
  the same proto contract. We start with one Go service (the IMS); the structure
  leaves room for TS services later without re-architecting.

## 2. Target repository structure

**Decided (2026-06-05):** the Go application **moves into `go/ims/`** as a module
under a root `go.work`, rather than staying at the repo root. This makes the repo
a proper polyglot monorepo from the start and leaves room for additional Go
services as peers. It is a mechanical (but broad) path-rewrite — see
[`06-go-workspace-restructure.md`](06-go-workspace-restructure.md) for the
execution plan.

```
/
  go.work                  <- NEW: Go workspace (use ./go/ims, + future services)
  go/
    ims/                   <- the IMS Go module (everything currently at root:
                              go.mod, main.go, api/ store/ web/ lib/ cmd/ json/
                              directory/ bin/ conf/, sqlc.yaml, .air.toml,
                              the templ+tsgo web UI and its tsconfig.json, ...)

  proto/                   <- NEW: protobuf source of truth
    ocf/ims/v1/
      incident.proto
      ...
  buf.yaml                 <- NEW: buf module config + deps
  buf.gen.yaml             <- NEW: codegen plugins (TS + Go)

  go/gen/                  <- NEW: generated Go (Connect-Go), its own module under
    ocf/ims/v1/               go.work, imported by go/ims handlers

  packages/                <- NEW: pnpm workspace packages (TypeScript)
    protocol-buffers/      <- generated TS types + Connect client (@ocf-ims/protocol-buffers)
    interface/             <- Expo app (@ocf-ims/interface): iOS / Android / web

  pnpm-workspace.yaml      <- NEW: workspace + dependency catalog
  package.json             <- NEW: root scripts (proto:gen, dev, build, lint)
  biome.json               <- NEW: lint/format for the JS/TS packages
  .npmrc                   <- NEW: inject-workspace-packages=true (Expo + pnpm)
  .nvmrc                   <- NEW: Node version pin
  docs/                    <- stays at root (these plans)
```

The existing `templ` + `tsgo` web UI pipeline moves *with* the Go app into
`go/ims/` (its `tsconfig.json`, `web/typescript` → `web/static`, embeds). It is
otherwise unchanged in this phase. See §6 for the legacy web UI's fate given the
event deadline.

### Naming conventions (this repo)

- **Proto package namespace:** `ocf.ims.v1` (directory `proto/ocf/ims/v1/`).
- **npm workspace scope:** `@ocf-ims/*` (e.g. `@ocf-ims/protocol-buffers`,
  `@ocf-ims/interface`).
- **Generated Go import path:** in its own module under `go.work`, e.g.
  `github.com/burningmantech/ranger-ims-go-gen/ocf/ims/v1` (module path TBD in the
  restructure plan), imported by `go/ims`.
- **Go module path of the IMS:** keep `github.com/burningmantech/ranger-ims-go`
  for now even though the directory becomes `go/ims/` (Go module path is
  independent of directory). Rename deferred to the OCF rebrand.

## 3. Component breakdown

### 3a. Proto + buf (`proto/`, `buf.yaml`, `buf.gen.yaml`)
- `buf.yaml` declares the proto module and any deps (e.g. `googleapis` for
  well-known types). `buf lint` and `buf breaking` guard quality and
  backward-compatibility.
- `buf.gen.yaml` runs two plugin sets:
  - **TypeScript:** `protoc-gen-es` (`@bufbuild/protobuf`) → `packages/protocol-buffers/src`.
  - **Go:** `protoc-gen-go` + Connect-Go → `gen/`.
- `pnpm proto:gen` (root script) = `buf generate`. Always run after editing protos.

### 3b. Generated TS package (`packages/protocol-buffers/`)
- `@ocf-ims/protocol-buffers` — pure generated output (messages + service
  definitions). Consumed by the interface via `workspace:*`.

### 3c. Generated Go + Connect-Go handlers (`gen/`, `api/`)
- Generated Go service stubs land in `gen/`.
- New Connect handlers live alongside the existing API (in `api/` or a new
  `api/connect/`), registered on the same HTTP server/mux. **Connect coexists
  with REST** — no rip-and-replace.
- Handlers reuse the existing `store/`, `lib/authz`, action log, and JWT auth.
  The Connect layer is a new *transport* over the same domain logic.

### 3d. Expo interface (`packages/interface/`)
- `@ocf-ims/interface` — an Expo Router app. Uses `@connectrpc/connect-web` +
  `@tanstack/react-query` (Connect-Query) against `@ocf-ims/protocol-buffers`.
- One codebase → iOS, Android, and web (`expo export --platform web`).

### 3e. Tooling
- **pnpm** workspace with a **catalog** (single source of pinned versions).
- **Biome** for lint/format of the JS/TS packages (not eslint/prettier). The
  legacy `web/typescript` keeps its current `tsgo`/eslint pipeline for now (§6).
- **Node** pinned via `.nvmrc`; **pnpm** pinned via `packageManager` in
  `package.json`.
- `.npmrc` with `inject-workspace-packages=true` so Expo's Metro bundler resolves
  workspace packages correctly under pnpm.

## 4. Key decisions

Status as of 2026-06-05. **D1 and the web-UI fate (§6) are now decided.**

| # | Decision | Call | Rationale |
|---|----------|------|-----------|
| D1 | Go module location | ✅ **Move to `go/ims/` + root `go.work`** | True polyglot monorepo from the start; room for peer Go services. Mechanical path-rewrite, fully testable. See [`06-go-workspace-restructure.md`](06-go-workspace-restructure.md). |
| D2 | Generated Go location | ✅ **`go/gen/`** as its own module under `go.work` | Imported by `go/ims`; keeps generated code isolated. |
| D3 | DB engine | ✅ **Stay on MariaDB** | We keep the Go backend; no reason to migrate persistence. |
| D4 | Transport rollout | ✅ **Connect alongside existing REST** (strangler) | Lets the interface start incrementally; no rip-and-replace. |
| D5 | Proto domain naming | ◻️ Use **current backend terms** (Incident, FieldReport…) initially | OCF terminology rename is a separate effort ([master plan](00-master-plan.md) Phase 2). Don't pre-bake undecided names into the contract. |
| D6 | Lint/format | ✅ **Biome for new TS packages**, leave legacy web UI as-is | Don't churn the existing pipeline; isolate the new stack. |
| D7 | `go.work` | ✅ **Yes, now** (implied by D1) | Required once the Go app lives in `go/ims/` and generated Go is a second module. |

## 5. Phased rollout

Each phase is independently shippable and keeps `go build`/`go test` green.

- **P0 — Workspace skeleton.** Add `pnpm-workspace.yaml`, root `package.json`,
  `.npmrc`, `.nvmrc`, `biome.json`. Empty `packages/`. Prove `pnpm install` works
  and doesn't disturb the Go build or the `tsgo` web UI build.
- **P1 — Proto pipeline.** Add `buf.yaml`, `buf.gen.yaml`, a minimal
  `proto/ocf/ims/v1/` (start with the core `Incident`/`Location` messages,
  mirroring `json/incident.go`). Wire `proto:gen`. Generate TS into
  `packages/protocol-buffers` and Go into `gen/`. CI runs `buf lint`.
- **P2 — First Connect endpoint.** Define one service method (e.g.
  `ListIncidents`) and implement a Connect-Go handler over the existing `store/`,
  registered next to the REST routes. End-to-end typed call provable from a test
  or `buf curl`.
- **P3 — Expo interface skeleton.** Scaffold `packages/interface` (Expo Router),
  wire a Connect-web client + React Query, render the first real data
  (incidents list) from P2.
- **P4 — Iterate.** Expand the proto surface and Connect handlers feature by
  feature; grow the interface to match. Fold in OCF domain work
  ([master plan](00-master-plan.md) Phases 3–5) as it lands.

## 6. The legacy web UI — decided given the ~4-week event deadline

**Context:** the OCF event is ~4 weeks out (early July 2026). The platform stack
(proto + Expo interface) will **not** be production-ready by then.

**Decision (2026-06-05):** run the **beta on the current server-rendered `templ`
web UI**. Therefore:

- **Do not over-invest** in *improving* the legacy web UI (no redesigns, no new
  features there) — it is on a path to eventual replacement by the Expo web
  build.
- **But do make it OCF-appropriate** for the beta: terminology, categories,
  locations, roles, light branding. The domain-track work
  ([master plan](00-master-plan.md) Phases 2–4) therefore **does** target
  `templ`/`web/typescript` for the beta — kept lightweight.

Net effect on sequencing: the beta is delivered on the existing Go + `templ`
stack; the proto/Expo platform track proceeds in parallel for *after* the event.
The Expo web build becomes the only UI **later**, not for this event.

## 7. Open questions

1. ~~D1 — Go placement~~ → **decided:** `go/ims` + `go.work` (§2, §4).
2. ~~Web UI fate~~ → **decided:** beta on current `templ` UI (§6).
3. **Auth in the interface** — the IMS uses JWT access/refresh tokens; the Expo
   app needs a login + token-refresh flow (`expo-secure-store` for storage).
   Design when we reach P3 (post-beta).
4. **Proto ↔ JSON coexistence** — the existing REST API and the new Connect API
   will both exist during the strangler period; keep their domain mapping in one
   place to avoid divergence.

## 8. Next step

The restructure (D1) is now the kickoff of the platform track:
[`06-go-workspace-restructure.md`](06-go-workspace-restructure.md). Sequencing of
the restructure vs. the deadline-critical OCF beta work is captured in
[00-master-plan.md](00-master-plan.md) → "Sequencing under the event deadline".
