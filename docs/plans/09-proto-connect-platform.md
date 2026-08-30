# Platform: proto-first Connect architecture + an Expo mobile client

> **Status:** Plan — for review
> **Parent:** [00-master-plan.md](00-master-plan.md)
> **Supersedes:** [05-platform-stack.md](05-platform-stack.md), [06-go-workspace-restructure.md](06-go-workspace-restructure.md), [07-proto-integration.md](07-proto-integration.md)
> **Last updated:** 2026-08-24

## 1. Objective

Make Protocol Buffers the typed contract for the OCF IMS API, served over
Connect-RPC, so that:

1. the Go server's transport, validation and client stubs are generated rather
   than hand-written;
2. the existing web UI consumes the same contract with **no npm at runtime**; and
3. **native iOS and Android apps become possible** — a product goal, and one with
   no server-rendering escape hatch. A native client must have a typed API. That
   is the hard requirement this plan exists to satisfy.

There is a second deliverable. OCF IMS is the **first production service on the [maybloom stack](https://stack.maybloom.tech)'s Go path**, which upstream describes as "blueprinted from study, awaiting its first production service."
Walking it here is what moves that path from amber to green, and the findings go back upstream (§7).

**A note on method.** Upstream's `backend-go.md` was written partly by studying
*this repo* — its "patterns left behind" list is a description of `ranger-ims-go`.
It therefore cannot be used to validate our own patterns; that would be circular.
Every pattern in this plan was checked against the Go ecosystem directly, and §4
records where we deliberately diverge from the blueprint as a result.

The fair is over and the next one is roughly ten months out. This is the largest
uninterrupted window the project will get.

## 2. Where we are today

| Area | Size | Notes |
|---|---|---|
| `api/` | 11,650 LOC | 65 REST routes on `http.ServeMux`, business logic inline in handlers |
| `store/` | 6,273 LOC | sqlc (**mysql** engine) over MariaDB; goose migrations are the schema |
| `web/` | 4,462 lines templ (28 files) + 14,121 lines TS (23 files) | server-rendered UI, tsgo → `web/static`, embedded and served by the same binary at `/ims/app` |
| `lib/` | 2,516 LOC | authn/authz, action log, attachments, push, security headers, cache |
| `json/` | 703 LOC | hand-written wire DTOs |
| `cmd/`, `conf/`, `directory/`, `bin/` | 1,750 LOC | CLI, config, people directory, build tooling |

One binary serves all of it: `api.AddToMux` and `web.AddToMux` register onto the
same `http.ServeMux` in `cmd/serve.go:144`.

**What already matches the target.** The gap is narrower than the size of the
tree suggests, and it is concentrated in the contract layer, the transport, and
where business logic lives. Already in place and staying: goose migrations
(embedded, applied on boot, append-only, and **the migrations directory *is* the
schema** sqlc reads); sqlc with `emit_interface` + `emit_methods_with_db_argument`;
generated code never committed; `go tool` pinning for every generator; the
healthcheck subcommand; cgroup-aware `GOMEMLIMIT`; config `Validate()` with a
redacted startup dump; testcontainers integration tests; golangci-lint and
govulncheck in CI.

## 3. The deviation ledger

Every place this repo differs from the target architecture, with a final
disposition. Rows marked **accepted** are divergences we intend to keep and to
document upstream.

| # | Deviation | Target | Disposition |
|---|---|---|---|
| V1 | Web UI served by the same binary at `/ims/app` | client is a separate package | **Resolved in Phase 4.** The templ UI is legacy: it runs frozen until the Expo client replaces it, then it and the REST layer are deleted together |
| V2 | **MariaDB**, sqlc `mysql` engine, `database/sql` | Postgres, pgx/v5, `pgtype` | **Accepted.** See M2 |
| V3 | Flat packages at the repo root, no `internal/` | one module at `go/`, `internal/`, `cmd/<service>/` | Phase 1a |
| V4 | Hand-written JSON DTOs + 65 REST routes | proto contract + Connect | Phase 0 (contract), Phase 1 (handlers), Phase 2 (retire REST) |
| V5 | Per-route middleware adapters; **action logging opt-in per route** (`LogRequest(true\|false)`) | interceptors declared once; cross-cutting on by default | Phase 1b |
| V6 | SCREAMING_CASE tables and columns (`INCIDENT.CREATED_BY`) | lower_snake | **Accepted.** The adapter absorbs it; a full-schema rename buys nothing a user can see |
| V7 | `generated_at_ms` epoch-millis in `json/metrics.go:64` | `google.protobuf.Timestamp` | Phase 0 — the contract gets it right; the REST field dies with REST |
| V8 | ~32 `if v, ok := lookupEnv(…)` blocks in `cmd/serveconfig.go` | struct + env tags + `Validate()` | Phase 1f, optional polish |
| V9 | SSE poke stream at `GET /ims/api/eventsource` | — | Candidate for Connect server-streaming. See M8 |
| V10 | Attachment upload/download over multipart, streamed responses | — | **Accepted with a boundary.** Stays plain HTTP. See M8 |
| V11 | Business logic in `api/` handlers; `store/` is a thin sqlc wrapper | ≤20-line handlers, logic in domain packages | Phase 1c — **the bulk of the work** |
| V12 | Web push + `/ims/sw.js` served by the binary | — | Stays; the Expo client gets native push instead (Phase 3) |
| V13 | One `store/queries.sql`; migrations at `store/schema/migrations` | `db/queries/<resource>.sql`, `db/migrations/` | Phase 1a, mechanical |
| V14 | **No bundler, by design.** tsgo compiles `web/typescript` file-by-file to ES modules; third-party JS vendored as `.min.js` into `web/static/ext/`. No npm at runtime | — | **Accepted, and satisfiable.** The legacy UI moves onto the contract without gaining a bundler. See M12 |

V2 and V6 are permanent. V11 is the multi-month effort.

## 4. Decisions

| # | Decision | Call | Rationale |
|---|---|---|---|
| M1 | Repo shape | One module at **`go/`**, `cmd/ocf-ims/main.go` delegating to `run(ctx, cfg) error`, and **`internal/<domain>/` packages — by feature, not by technical layer**. `internal/server/` holds only what is genuinely cross-cutting: mux, interceptors, context helpers | Current Go guidance is to package by feature. A `server/` + `store/` split scatters one feature across three packages and makes the import graph a star. Supersedes plan 06's `go/ims/`. |
| M2 | Database | **MariaDB. Settled, not deferred.** | It is what we run, it works, and the migration cost is real (134 named queries to review, 8 `:execlastid` inserts to rewrite against `RETURNING`, every `sql.Null*` to `pgtype`, plus the data). No requirement we have points at Postgres; the only argument for it was that the maybloom blueprint assumes it, which is not a reason. The MySQL flavour of the Go path becomes a finding we contribute (§7), not a gap we close. |
| M3 | Proto layout | `proto/ocf/ims/{common,resources,service}/v1` (packages `ocf.ims.common.v1`, `ocf.ims.resources.v1`, `ocf.ims.service.v1`); a **single `ImsService`** in `ocf.ims.service.v1` | One service per backend is what makes the generated handler interface an exhaustiveness check. `resources/v1` holds messages with no RPCs; `common/v1` stays small and gains a type only on its second consumer. The dotted `ocf.ims` package (not `ocfims`) matches the archive's `ocf.ims.v1` and the `proto/ocf/ims/` directory. |
| M4 | Codegen | **Go plugins via hermetic `go tool`**; TypeScript via pnpm `protoc-gen-es`; **`protoc-gen-connect-openapi`** for docs. buf itself as `go tool buf` | Our CI runs under a hardened-runner egress allow-list, so `remote:` BSR plugins are a liability; the local-plugin form is already proven here (PR #8). OpenAPI output costs one block and makes the API browsable by people who never learn protobuf. |
| M5 | **Validation lives in the contract** | **protovalidate** (v1.0) constraints written into the protos as messages are modelled, enforced by one `connectrpc.com/validate` interceptor | Presence, range, length, enum-membership and format become CEL in the proto with **no generated validation code** and identical semantics in every language. Targets **114 hand-written validation sites** in `api/` (24 in `person.go` alone). Authorization and business rules stay in Go. Decided here because it changes how the protos are written. |
| M6 | pnpm arrives in **Phase 0** | with the contract | The TS target serves both the existing web UI (M12) and the Expo client (M7). Deferring it means building Phase 0 twice. Also gives the deferred Vitest harness a home. |
| M7 | **One client: Expo, on web and mobile** | Build a **modern replacement client** — iOS, Android and web — with its own UI and UX rather than a port of the current screens. The templ UI runs **frozen** alongside it until the replacement is ready, then is deleted | See §5. |
| M8 | Non-RPC surfaces | Attachment blob I/O and `sw.js` **stay plain HTTP**. The **SSE stream is a candidate for Connect server-streaming** | Streaming binary through proto is a bad fit, so blobs stay out. Streaming is available to us: `expo/fetch` has supported it since SDK 52, so the "unary-only" constraint often quoted for React Native no longer holds. A live-updating incident feed is exactly what a field client wants. |
| M9 | Cross-cutting behaviour | **Interceptors, declared once, defaulting on** — request ID, slog, panic recovery, auth, action log | CLAUDE.md already documents the current design's failure mode: the per-route `LogRequest` flag "is easy to omit and fails closed (unlogged)". Default-on removes the footgun instead of documenting it. |
| M10 | Extraction discipline | **Extract everything, as part of this migration.** Every handler becomes a thin transport shim; **all** business logic moves into its domain package. Enforced, not aspirational: a path-scoped `funlen` on the handler files | "Extract when it gets complicated" is precisely the policy that produced today's `api/` — `updateIncident` is **470 lines**, `AddToMux` is **799**, and nobody set out to write them. A judgment call is unreviewable and drifts; a line count is a build failure. Note `funlen` is currently disabled repo-wide in `.golangci.yml` (`# meh`) — this is the narrower, path-scoped form, and it is the mechanism that makes the rule real. Extracting uniformly also makes M13 nearly free: REST and Connect handlers become two thin shims over one set of domain functions. |
| M11 | Module path | Keep `github.com/mikeki/ocf-ims` | Unchanged by the move to `go/` — Go module paths are directory-independent. So `go_package` lines written in Phase 0 need no edit in Phase 1a: `gen/` at the module root resolves to `github.com/mikeki/ocf-ims/gen/…` both before and after. Only buf's `out:` path changes. |
| M12 | **Port the legacy web UI onto the contract**, types-only and zero-runtime | Generate with `protoc-gen-es` `json_types`, import with `import type` (erased by tsgo, so no runtime import), and speak Connect through a `fetch` wrapper. No bundler, no npm at runtime | The coupling is far smaller than the file sizes suggest: **95 call sites, all behind one wrapper** (`fetchNoThrow` at `ims.ts:167`). Swapping that for a `connectUnary` equivalent — the archived branch already wrote it, 146 lines — and renaming call sites from URLs to RPCs is mechanical, and the UI's behaviour does not change. **Not porting is the expensive option**: after M10 every domain function returns proto, so each REST handler would need a proto→`imsjson` adapter written and maintained, `json/` would stay alive, and two wire formats would drift as the contract evolves — for the whole length of Phase 3. |
| M13 | Transport rollout | **Strangler.** Connect runs alongside REST until the legacy UI is ported; then **REST and `json/` are deleted in Phase 2**. Separately, **the legacy UI gets no new features** — new functionality lands in the replacement client only | Retiring REST early leaves one wire format for the long Phase 3, instead of two drifting ones. The feature freeze is a different rule from the transport retirement and outlives it: it continues 05 §6's standing rule not to over-invest in the UI we are replacing, and creates pull toward the replacement. |
| M14 | Verification | **Continuous** — a findings log appended per slice (§7), contributed upstream | A report written at the end is written from memory. |

## 5. Clients: one Expo client, replacing the templ UI

**Expo is the client — web, iOS and Android from one codebase.** It is a
**replacement, not a port**: the point is a better interface than the current
screens, so the two will deliberately diverge rather than track each other. Why
Expo over the alternatives:

- **We already write TypeScript.** Dart costs an experienced developer roughly two
  to three weeks of ramp-up; that is a real price for a team this size, paid
  against a performance difference that does not decide anything for a
  forms-and-tables ops app (Flutter holds ~58–60 fps to React Native's ~51 on
  complex UIs and uses less memory; React Native starts ~200 ms faster and drains
  ~12% less battery).
- **Flutter web is canvas-rendered** with no real DOM text, so it could never take
  over the dispatch UI. That rules it out here, because taking over the web is
  the destination.
- **Expo's web target is a first-class one**, not a consolation prize — Expo
  Router runs the same file-based routes on web with static rendering, which is
  what makes one codebase across all three surfaces credible.
- **The React Native transport caveat is gone.** `expo/fetch` has supported
  streaming since SDK 52 and is the global `fetch` on iOS and Android, so the
  client is not restricted to unary calls (M8).
- Kotlin Multiplatform is the least proven of the three here and `connect-kotlin`
  is still beta. Separate native Swift + Kotlin apps are twice the work for a
  two-person team.

**The templ UI keeps serving today's users in the meantime**, moved onto the
contract in Phase 2 (M12) so there is only ever one wire format to maintain. That
port is a transport swap, not a rewrite — 95 call sites behind one wrapper, with
the UI's behaviour unchanged — and it is what lets REST and `json/` be deleted
years before the UI itself is. What the legacy UI does **not** get is new
features (M13): every hour of *product* work spent there is an hour spent on
something being deleted. Phase 4 removes it once the replacement covers what
people actually rely on.

**Sequence the replacement mobile-first.** Start with what has no incumbent —
field use on a phone: my incidents, file and append a report, attach a photo,
notifications. That ships value early, exercises the contract against a real
client, and builds the client's foundations before it has to take on dispatch,
admin, taxonomies and metrics.

**Rejected: hypermedia (HTMX/Datastar) as a client strategy.** It is the most
Go-native option on paper and would delete the most TypeScript, but it is
incompatible with the mobile goal: hypermedia puts UI logic in Go templates and
ships HTML fragments, which a native app cannot consume. Every page moved to
hypermedia is a page that would have to be built a second time for mobile.
Hypermedia and contract-first are substitutes, not complements.

**Noted, not planned:** wrapping the existing web UI in Capacitor or Tauri would
buy app-store presence and native push with 100% UI reuse. It is a webview and
feels like one. Recorded as a bridge if store presence is ever needed long before
the Expo client is ready.

## 6. Phases

Each phase keeps `go build` / `go test` green and the running system deployable.
Slices get their own numbered plan file (`09a-…`, `09b-…`) as work begins, per the
folder convention.

### Phase 0 — Contract and codegen tooling

No behaviour change. This phase defines the protobuf interface and everything
needed to generate from it.

- **0a — Codegen skeleton.** `buf.yaml` (lint STANDARD, breaking FILE),
  `buf.gen.yaml` with the Go plugins as `go tool` locals, `protoc-gen-es` from
  pnpm, and `protoc-gen-connect-openapi`. Root `pnpm-workspace.yaml`,
  `package.json`, `.npmrc`, `.nvmrc`, `biome.json`. `packages/protocol-buffers/`
  with a gitignored `src/`. Wire buf into `bin/build/build.go -generate-only` and
  the CI generate step; add `buf lint` as a gate. One throwaway proto proves every
  target emits. **Ship this before modelling anything** — it de-risks the rest.
- **0b — Core domain.** `resources/v1`: incident, report, journal entry, person
  involvement, linked incident, area, event.
- **0c — People and access.** person, participation, crew, membership; auth
  envelopes (login, refresh, profile).
- **0d — Taxonomies and admin.** incident type, outcome, action log, metrics,
  notifications.
- **0e — Service surface.** `service/v1/<resource>.proto` envelopes plus
  `service.proto` declaring the single `ImsService`. Deliverable: a
  **route → RPC mapping table** covering all 65 current REST routes, where every
  route is either mapped to an RPC or listed as an M8 plain-HTTP exception. Zero
  unclassified routes is the gate.

Contract rules from the first file: **protovalidate constraints written as each
message is modelled** (M5), not bolted on later; `google.protobuf.Timestamp`
only, never epoch numbers; a dedicated `<Verb><Resource>Request`/`Response` per
RPC including empty ones; create and update carry the whole resource; `optional`
means presence matters; enums prefixed and starting at `_UNSPECIFIED = 0`.

Field numbers may be reused freely — nothing has shipped — until the day an
unupgradable client exists, at which point `reserved` becomes permanent and we
write the date down. **Shipping the Expo app to app stores is that day.**

**Gate:** `buf lint` and `buf breaking` clean; Go, TypeScript and OpenAPI all
generate from a clean tree; CI reproduces it; the mapping table has no gaps.

### Phase 1 — The server becomes a Connect implementation

- **1a — Restructure.** Move the Go tree to `go/`, everything under `internal/`,
  entry point at `go/cmd/ocf-ims/main.go`. **Package by domain** (M1):
  `internal/incident/`, `internal/person/`, … each holding its handler, logic and
  data access. Split `store/queries.sql` into `go/db/queries/<resource>.sql`;
  migrations to `go/db/migrations/`. Mechanical and behaviour-preserving. Plan
  06's gotcha list (`go env GOMOD` under a workspace, embed paths, Docker context,
  CI working dirs) still applies verbatim — **read it before executing.**
  **Why the restructure comes before the server work:** the bulk extraction (1c)
  should land in its final `internal/<domain>/` home *once* — extracting into the
  flat root and then relocating would double the churn. The one risk this ordering
  carries is that connect-go, the interceptor chain and protovalidate are unproven
  in *this* server until after the move (Phase 0 proved only that codegen emits).
  Retire it cheaply first: stand up a single throwaway Connect RPC on the current
  tree to confirm the transport wires up, *then* start the move.
- **1b — Interceptor spine.** Request ID, slog, panic recovery, auth (populating
  identity into the context), **protovalidate**, and the action log — declared
  once at handler construction, on by default (M9, M5). Register the Connect
  handler on the existing mux. Prove with one RPC end-to-end.
- **1c — Domain-logic extraction — *all* of it** (M10). Resource by resource,
  **every** piece of business logic moves out of the ex-`api/` handlers into its
  domain package, accepting and returning proto messages and speaking Connect
  error codes directly. Nothing is left inline because it "looked simple"; that is
  how `updateIncident` reached 470 lines. Land the path-scoped `funlen` on the
  handler files in the same slice, so the rule is enforced from the moment it
  exists rather than argued about later. Also lands a MySQL-flavoured `RunInTx`
  retrying error **1213** (deadlock) and **1205** (lock wait timeout), matched via
  `errors.As` into `*mysql.MySQLError` — never by string — which should retire the
  known `TestCreateAndGetIncident` flake. **This is the bulk of the work**:
  ~11.6k LOC of handler code has to find its real home.
- **1d — Handlers.** One thin method per RPC. Order: incidents → reports →
  people/auth → taxonomies → events/areas/crews → metrics/action log. As each
  resource lands, **its REST handler is reduced to a shim over the same domain
  functions**, so the two transports never carry two implementations. REST stays
  live and frozen throughout (M13).
- **1e — The M8 surfaces.** Attachment blob I/O and `sw.js` keep plain-HTTP
  endpoints, documented as deliberate. Decide whether the event stream becomes a
  Connect server-streaming RPC. Either way, fix the known private-incident leak
  CLAUDE.md records as a follow-up: the poke stream currently broadcasts a private
  incident's number and change timing.
- **1f — Config to struct tags** with `Validate()` (V8). Optional; do it if 1a
  makes it cheap.

**Gate:** the generated handler interface is satisfied with no `Unimplemented…`
embedding outside tests — the compiler is the checklist; integration tests talk to
the server through the **generated connect-go client**; a spot-check set returns
identical data over REST and Connect; **no business logic remains in either
transport layer**, enforced by `funlen`; the existing web UI and Playwright suite
are untouched and still green.

### Phase 2 — The legacy UI onto the contract (retires REST)

A transport swap under an unchanged UI, not a rewrite. It leaves exactly one wire
format for the long Phase 3.

- **2a — Prove the types-only path** (M12), an afternoon. Generate with
  `json_types`, import with `import type` only, and confirm two things: tsgo
  resolves types from the workspace package, and the generated `_pb.ts` runtime
  half stays out of the tsgo output. Port the `connectUnary` transport from the
  archived `web/typescript/connectrpc.ts`.
- **2b — Swap the 95 call sites**, module by module, from `fetchNoThrow(url, …)`
  to the typed client. Order by risk; `incident.ts` (18 sites) and `people.ts`
  (15) last. The hand-written `imsjson`-shaped TS interfaces are replaced by the
  generated JSON types as each module lands.
- **2c — Delete `json/` and the REST mux** once nothing calls them (M13). The
  server's HTTP surface becomes Connect plus the M8 exceptions plus static assets.
- **2d — Freeze the legacy UI's feature set.** No new features in
  `web/typescript` or the templ pages; new product work lands in the replacement
  client only. Write the rule where a contributor will hit it (`CLAUDE.md`).

**Gate:** Playwright suite green with no behaviour change; `json/` gone; no REST
route remains; **still zero npm at runtime** — the legacy build pipeline gains a
generated type dependency and nothing else.

### Phase 3 — Build the replacement

Sequenced mobile-first, because that is the surface with no incumbent — value
reaches people immediately, instead of waiting on the surfaces where something
already works.

- **3a — Client foundations.** `packages/interface`: Expo Router, React Query, the
  singleton Connect transport with a Bearer interceptor and a synchronous token
  cache, session storage, and the design direction for the new UI. One real screen
  against live data proves the whole path on web, iOS and Android.
- **3b — The field app.** My incidents, file and append a report, attach a photo,
  notifications. Ship to both app stores; native push replaces the iOS PWA
  home-screen-install requirement. **Field numbers freeze here** (Phase 0).
- **3c — Dispatch on web.** The incident and report surfaces the dispatch tent
  actually lives in — the hardest UI in the system and the reason the replacement
  is a redesign rather than a port.
- **3d — Admin and the long tail.** People, crews, taxonomies, areas, metrics,
  action logs. Coverage here is what unblocks Phase 4.

Auth needs a decision at 3a: the legacy UI keeps the **refresh token in an
HttpOnly cookie** and sends the **access token as a Bearer header**. The Bearer
half carries over unchanged; the cookie half has no native equivalent, so the new
client needs a body-carried refresh into `expo-secure-store`.

### Phase 4 — Cleanup

- **4a — Retire the legacy UI.** Once the replacement covers what people actually
  rely on, delete the templ pages and `web/typescript` (V1). REST and `json/` are
  already gone from Phase 2. The binary then serves Connect, blobs, the event
  stream and the client's static build.
- **4b — Tidy the HTTP boundary:** static assets behind Caddy if that proves
  better (§8 Q1); blob and stream endpoints documented as the deliberate
  exceptions they are.
- **4c — Revisit what is left:** the lower_snake schema question (V6) and anything
  the findings log has escalated. **Not Postgres** — M2 is settled.

## 7. Findings log — the upstream deliverable

Appended to as each slice lands, never written from memory afterwards. Each entry
records: the blueprint's claim, what actually happened here, and whether it is a
stack bug, a documented variant, or a repo-specific quirk. Graduating a finding
means a PR to `MaybloomTech/maybloom-stack` against `docs/backend-go.md` and
`skills/maybloom-stack-shared/references/paths/backend-go/README.md`.

Queued before any code is written:

1. **A MySQL/MariaDB variant of the Go path** (M2). The blueprint is pgx-specific
   in at least four places: `sql_package: pgx/v5`, `pgtype` adapters, `RunInTx`
   retrying SQLSTATE `40001`/`40P01`, and embedded-postgres as the dev DB. The
   MySQL answers are `database/sql`, `sql.Null*`, retry on error `1213`/`1205`,
   and testcontainers.
2. **protovalidate supersedes "handlers validate presence."** The blueprint's
   handler rule predates protovalidate v1.0 and describes hand-written checks the
   contract can now carry.
3. **"Unary-only" is stale.** It exists because connect-es did not support React
   Native; `expo/fetch` has streamed since SDK 52. Stated as a rule for every
   backend, it silently removes server-streaming from projects that could use it.
4. **Layer packages vs domain packages.** `internal/server/` + `internal/store/`
   runs against current Go guidance to package by feature.
5. **Hermetic local codegen plugins** as an alternative to `remote:` plugins, for
   repos with restricted CI egress.
6. **Non-RPC surfaces.** The blueprint is silent on file upload and server-push. A
   real product needs both, and "documented plain-HTTP exceptions beside the
   contract" is an answer the stack does not currently give.
7. **The bundler-free typed client** (M12) — `json_types` plus a `fetch` wrapper,
   no runtime dependency at all. Both of the stack's client blueprints assume a
   bundled SPA; a server-rendered UI serving unbundled ES modules has no
   documented story, and it turns out to need one small file rather than a
   toolchain.
8. **Hypermedia and contract-first are substitutes** (§5). If a Go service's
   primary client is server-rendered HTML it produces itself, the contract has no
   client and its value collapses. Worth stating where the stack discusses client
   choice.
9. **"Never commit generated code" is not a Go norm** — it is a pnpm instinct. The
   Go cost (fresh clone doesn't compile, IDEs show unresolved imports, CI pays
   generator time every job) should be stated where the rule is given. We keep the
   rule; the tradeoff should be explicit.
10. **Adopting from a brownfield.** Every skill assumes a scaffolded start. The
    sequence here — contract first, restructure second, extract third, strangle
    fourth — is the missing migration path.

*(Entries below this line are added as slices land.)*

### 0a — Codegen skeleton (2026-08-24)

- **Finding #5 confirmed (hermetic local codegen plugins).** All four generators
  run as hermetic locals under a restricted-egress CI: `protoc-gen-go`,
  `protoc-gen-connect-go` and **`protoc-gen-connect-openapi`** as `go tool`
  binaries, and `protoc-gen-es` via pnpm. No `remote:` BSR plugin, and — because
  the throwaway proto imports no `buf/validate` — no BSR *module* dependency
  either, so generation needs no `buf.build` egress. The only registry the CI
  lint job gained is `registry.npmjs.org` (for the one pnpm plugin). *Documented
  variant, works as blueprinted.*
- **New: the Go build image needs no JS toolchain.** Splitting codegen into a
  hermetic Go-tool template (`buf.gen.yaml`) and a pnpm template
  (`buf.gen.web.yaml`), and gating the latter on `pnpm` being present, keeps the
  server's `golang:alpine` Docker build free of node/pnpm — the generated
  TypeScript is a client artifact, never a compile input for the binary. The
  stack's blueprints assume one toolchain per repo; a Go server + a TS client in
  one monorepo wants this split. *Candidate addition to the brownfield/adoption
  guidance (finding #10).*
- **Repo quirk worth noting: put the license header in the `.proto`.**
  protoc-gen-{go,connect-go,es} copy the proto's leading comments into their
  output, so the Apache header propagates to every generated artifact and this
  repo's `prependlicense` hook skips them all with no change — while golangci-lint
  still classifies the files as generated. A pgx/Postgres shop wouldn't hit this;
  it's specific to repos that stamp source headers.

### 0b — Core domain (2026-08-24)

- **protovalidate can be vendored, keeping generation fully hermetic.** Exporting
  `buf/validate/validate.proto` into a second, lint-excluded buf module and
  generating with the first-party module as the explicit input (`buf generate
  proto`) resolves the constraints with **no BSR dependency and no `buf.build`
  egress** — in CI or in the Docker build. The blueprint reaches for a BSR
  `deps:` entry; that would pull `buf.build` egress into every build. *Documented
  variant for restricted-egress repos (extends finding #5).*
- **protovalidate constraints distribute by message role.** When create/update
  reuse the whole resource message, resource-level constraints must also hold for
  create input (mostly-unset), so only always-valid invariants (length,
  enum-membership) belong on the resource; presence/required constraints belong on
  the create/update request envelopes. The blueprint's "constraints in the proto"
  is right but silent on *which* message carries which constraint. *Refinement to
  finding #2.*
- **A brownfield contract carries REST-isms to resolve.** The hand-written DTOs
  mix stored state, viewer-dependent read-only decorations, and split
  write-id/read-object pairs in one struct; the proto separates these into resource
  (state) vs response (derived) vs collapsed resolved objects. *Adoption-path
  detail (finding #10).*

### 0c / 0d — People, access, taxonomies, admin (2026-08-25)

- **The resource/envelope split absorbs the auth slice.** The plan put "auth
  envelopes (login, refresh, profile)" in 0c, but once 0b drew the line "every
  request/response envelope lives in the service surface," the auth shapes fall on
  the 0e side: they have no backing resource, and the profile response is *computed*
  per-viewer permissions. Only the person/crew **nouns** are resource state. This is
  the same tension the blueprint leaves implicit whenever it says "model the domain"
  without distinguishing the nouns from the RPC envelopes that carry them.
  *Refinement to findings #2 and #10 — a brownfield's endpoint-shaped DTOs don't map
  one-to-one onto resources; some are pure service surface.*
- **Closed MySQL string-enums become proto enums; a stored tinyint keeps its wire
  values.** `PARTICIPATION_TYPE` and `INCIDENT_TYPE.GROUP` are MySQL string enums,
  so the proto enums are dense ladder-ordered sequences (the string↔number mapping
  is a server concern); `IncidentPriority` mirrors a stored tinyint, so *its* enum
  numbers are the wire values. Same proto construct, two different relationships to
  storage — worth stating where the stack covers enum modelling.
- **A raw audit mirror keeps its own id widths.** `ActionLog` deliberately does *not*
  adopt the contract's `int32` person id: `user_id`/`position_id` are raw ids
  captured at request time in an append-only, high-volume log, not resolved typed
  references. Standardizing id widths across the contract is right, but an audit
  read-model is a documented exception, not a miss. *Adoption-path detail (#10).*
- **"No epoch numbers" is a real migration cost, not a style rule.** `Metrics`
  carried a Unix-millis `generated_at_ms` that became a `Timestamp`. Cheap here
  because nothing consumes the contract yet, but worth flagging as a conversion the
  adoption path pays per numeric-time field.
- **A contract for a brownfield is also a chance to *not* carry dead weight.** The
  White Bird visits subsystem is slated for removal, so it was left out of the
  contract entirely — `visit.proto` dropped and 0b's `Incident.visits` reference
  removed — rather than faithfully modelled and then deleted. Modelling a DTO is not
  free (it invites downstream code to depend on it), so "which DTOs deserve a
  contract" is a real adoption-path decision, not a mechanical port of everything in
  `json/`. *Adoption-path detail (#10).*

### 0e — Service surface (2026-08-25)

- **Body-multiplexing REST endpoints are a *systematic* 1→N map onto RPCs, not a
  one-off.** `POST /crews` was the first spotted (create/rename + delete + membership →
  `SaveCrew`/`DeleteCrew`/`SetCrewMembership`), but the 0e review found the same shape
  across the whole admin-taxonomy write surface: `POST /areas`, `POST /incident_types`
  and `POST /outcomes` each dispatch create / update / approve / (set-hidden |
  mark-duplicate) off body selector fields (`id == 0`, `Approved`, `Hidden`,
  `DuplicateOf`). Contract-first decomposes all four into explicit verbs (58 RPCs vs the
  49 the single-`Save*` first cut showed) — a brownfield's "one POST does everything"
  handlers routinely hide a fistful of verbs, and finding them is a *repeatable* audit
  (grep the handler for its selector `switch`), not luck. *Adoption-path detail (#10).*
- **A derived read-only field's home is decided by *whom it describes*, and a per-member
  flag belongs on the resource, not a parallel response map.** 0b pushed *all* derived
  fields onto response wrappers; the 0e review split that: a **caller**-relative flag
  (`viewer_may_add_journal`) stays on the view, but a flag about a **resource member**
  (`IncidentPerson.has_event_access`) belongs on the resource as **output-only** —
  matching AIP-203 and the echoes (`created_by`, `PersonRef.handle`/`name`) already
  carried there. The rejected alternative — a `map<int32,bool>` on the wrapper keyed by
  member id — needs a client join and doesn't extend. *Refines finding #2; the blueprint
  says "constraints/derived fields in the proto" but not which message owns each.*
- **"Blobs stay plain HTTP" cuts across a resource, not around it.** Picture/attachment
  *upload* and *download* are plain-HTTP (M8), but the picture *delete* — no blob —
  becomes an RPC. So one resource's operations straddle two transports; the M8
  exception is per-operation, not per-resource. Worth stating where the stack draws
  the RPC/plain-HTTP line (extends finding #6).
- **The mapping table needs a third disposition: deliberately-excluded.** The gate
  ("every route is an RPC or a plain-HTTP exception") has no bucket for a route whose
  subsystem is being deleted (visits). Forcing those into "plain-HTTP exception" would
  be a lie (they are not staying). A brownfield adoption needs an explicit "retiring,
  not modelled" disposition, distinct from the M8 exceptions. *Adoption-path detail
  (#10).*
- **The connect dependency flips to direct exactly at the first service.** Through
  0b–0d (messages only) `connectrpc.com/connect` sat indirect; 0e's `ImsService` makes
  `go mod tidy` promote it to a direct require — the predicted, self-documenting
  signal that the first service landed.
- **buf's `RPC_REQUEST_RESPONSE_UNIQUE` forbids a shared `Empty`.** Every empty request
  or response must be its own named type (`MarkAllNotificationsReadRequest{}`, …). More
  verbose than a `google.protobuf.Empty`, but it keeps each RPC's schema independently
  evolvable — a deliberate STANDARD-lint stance worth noting for teams reaching for a
  shared empty message.
- **The contract wants the surrogate key even where the REST URL uses a natural one.**
  This brownfield addresses events by *name* in every URL (`/events/{eventName}/…`), and
  `EVENT.NAME` is even unique — so name "works" as a key. The 0e review still moved every
  request selector to `int32 event_id`: a surrogate id is rename-stable and unambiguous,
  and it is what the typed contract should carry, with the human name kept only as a
  read-only display denormalization on resources. The migration cost is real and worth
  naming: the ported client, which routes by the URL's name, must resolve name → id
  (here, from the events list it already loads). A REST-URL natural key is not
  automatically the contract's key. *Adoption-path detail (#10).*

### 1a — Server restructure: Step 0 spike + relocate to `go/` (2026-08-29)

*(Slice 1a, step 1 — the `go/` relocation. The domain repackage lands next; its
findings will be appended then.)*

- **`go tool <x>` needs module context, which rewrites the diverging-roots plan.**
  09f predicted buf would "run from the repo root" with `out:` changed `gen → go/gen`.
  Reality: `go tool buf` resolves the pinned buf only from inside the module (there is
  no go.mod at the repo root after the move), so **buf runs from the module root `go/`**,
  pointed *up* at `../proto` with `--template ../buf.gen.*.yaml`. buf resolves `out:`
  relative to its CWD, so `out: gen` **already** lands at `go/gen` with no edit; it is
  the *TypeScript* target whose `out` had to reach back *up* to the repo-root pnpm
  workspace (`../packages/...`). So `build.go` grew a `moduleRoot` (dir of `go env GOMOD`)
  vs `repoRootFrom` (nearest ancestor holding `buf.yaml`) split: sqlc/templ/tsgo/go-build
  run from the module root, buf from the module root pointed at the repo root, and
  `pnpm install` from the repo root. Confirms the diverging-roots finding but corrects its
  mechanism. *Adoption-path detail (#10); extends the blueprint's single-root assumption.*
- **Docker context can't shrink to the module dir — confirmed.** The image regenerates
  from proto at build time, so it needs `proto/` + the buf configs *and* `go/`. Kept the
  `Dockerfile` at the repo root with context `.`, preserved the `go/` layout inside the
  image, and ran the go steps from `/app/go` with buf reaching `/app/proto`. The
  `golang:alpine` stage still has no pnpm, so `build.go` skips the TS proto target there
  (a client artifact, never a compile input). *Extends finding #10.*
- **The transport de-risk spike wired up cleanly (Step 0).** connect-go + the
  `connectrpc.com/validate` interceptor coexist on the existing `http.ServeMux` (a plain
  `http.Handler` at prefix `/ocf.ims.service.v1.ImsService/`, no second server, no
  precedence clash with the REST/web muxes). Two corrections to the reference material:
  `validate.NewInterceptor` is single-return in v0.6.0 (no `error`), and the interceptor
  runs *before* the handler — an invalid request to an *unimplemented* RPC returns
  `invalid_argument`, a valid one returns `unimplemented` — so validation is enforced
  independently of whether a method is wired, exactly the affordance 1d needs. *Feeds
  findings #2 and #6.*
- **"Never commit generated code" bites `go tool`-based linters in a nested module.**
  golangci-lint is a hosted pre-commit hook here (not a `go tool` in `go.mod`), and the
  hosted hook can't target a module in a subdirectory; it became a local `go run
  github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2` hook that `cd go` first.
  Every `language: system` Go hook (govulncheck, go-fmt/vet/mod-tidy, fetch-build-deps,
  prependlicense) likewise gained a `cd go`. *Extends finding #9 (the Go cost of the
  no-committed-codegen rule) with a linters-in-a-polyglot-monorepo wrinkle.*

## 8. Open questions

1. **Does the Go binary keep serving static assets in production**, or does Caddy?
   Changes the compose file and the deploy runbook. Decide in Phase 4a.
2. **Offline capture on mobile.** `web/typescript/sw.ts` is push-only — its own
   comment says it is "not an offline worker" — so offline has never been solved
   here and has never blocked a fair. If the Expo client is expected to work
   through a connectivity outage, that is a local-store-and-sync design, and it
   belongs in its own plan rather than being smuggled into Phase 3.
3. **What happens to the Playwright suite.** It is the regression net for the
   Phase 2 transport swap — behaviour must not change, and Playwright is what
   proves it — so it earns its keep for as long as the legacy UI lives, then
   retires with it in Phase 4. The replacement client needs its own tests; that is
   a Phase 3a call.
4. **How much coverage retires the legacy UI?** Phase 4a needs a threshold, and
   "parity" is the wrong one — the replacement is a redesign, so some screens will
   never have a counterpart. Decide it as a list of what people actually rely on,
   written down during Phase 3c rather than argued at the end.
5. **Vitest and the frontend test harness.** M6 gives it a home in Phase 0; it
   targets the new client, not the frozen `web/typescript`.
6. **Offline capture** — see Q2. Worth deciding early enough to shape the client's
   data layer, since retrofitting a sync model is far more expensive than
   designing for one.

## 9. Exit criteria

- [ ] **Phase 0:** `proto/ocf/ims/**` models the full current API surface with
      protovalidate constraints; buf lint and breaking clean; Go, TypeScript and
      OpenAPI generate hermetically in CI; every one of the 65 REST routes is
      mapped to an RPC or a named M8 exception.
- [ ] **Phase 1:** the module lives at `go/` in domain packages; every RPC has a
      handler with no `Unimplemented` embedding; cross-cutting behaviour is
      interceptors, on by default; integration tests run through the generated
      client; the `TestCreateAndGetIncident` deadlock flake is gone.
- [ ] **Phase 2:** `json/` deleted, no REST route remains, the legacy UI runs on
      the generated TypeScript client with **zero npm at runtime** and no
      behaviour change; its feature set is frozen and the rule is written down.
- [ ] **Phase 3:** the replacement ships to both app stores and covers dispatch,
      admin and the long tail on web; field numbers frozen; the list of what must
      exist before the legacy UI can go is written down.
- [ ] **Phase 4:** the templ pages and `web/typescript` are deleted; the deviation
      ledger has no open rows except the accepted ones (V2, V6, V10), each
      documented upstream.
- [ ] **Continuous:** the findings log has been contributed upstream, and the Go
      path is documented as validated rather than blueprinted.

## Appendix A — salvage from `archive/proto-integration`

The branch has diverged badly (339 files, ~38k lines) and is **reference only, not
a merge source**. Worth reading before writing the equivalent:

- `buf.yaml` — the v2 module + STANDARD lint + FILE breaking config, reusable
  nearly verbatim.
- `buf.gen.yaml` — the `local: ["go", "tool", "protoc-gen-go"]` plugin form M4
  keeps. Needs the `protoc-gen-es` and `protoc-gen-connect-openapi` blocks added.
- `proto/ocf/ims/v1/incident.proto` — the first cut at modelling Incident. Its
  *field* modelling is a useful starting point; its **structure** — a flat
  `ocf.ims.v1` package with a per-resource `IncidentService` — is superseded by
  M3, which keeps the same dotted `ocf.ims` root but splits it into
  `common`/`resources`/`service` (`ocf.ims.*.v1`) under a single `ImsService`.
- `web/typescript/connectrpc.ts` (146 lines) — the browser Connect transport M12
  builds on.
- The `bin/build/build.go` and CI wiring for the buf generate step (PR #8).

## Appendix B — references for the non-obvious calls

- protovalidate v1.0 and the Connect interceptor:
  [protovalidate.com](https://protovalidate.com/quickstart-go/),
  [connectrpc/validate-go](https://github.com/connectrpc/validate-go)
- OpenAPI from protos:
  [protoc-gen-connect-openapi](https://github.com/sudorandom/protoc-gen-connect-openapi)
- Types-only TS output: [`protoc-gen-es` `json_types`](https://www.npmjs.com/package/@bufbuild/protoc-gen-es)
- React Native streaming: [`expo/fetch`](https://docs.expo.dev/versions/latest/sdk/expo/) (SDK 52+)
- Connect mobile clients: [connect-swift](https://github.com/connectrpc/connect-swift)
  (stable), [connect-dart](https://github.com/connectrpc/connect-dart) (1.0),
  [connect-kotlin](https://github.com/connectrpc/connect-kotlin) (beta)
- Flutter web rendering: [renderers](https://github.com/flutter/website/blob/main/src/content/platform-integration/web/renderers.md)
- REST transcoding, evaluated and rejected as alpha:
  [connectrpc/vanguard-go](https://github.com/connectrpc/vanguard-go)
- sqlc MySQL/MariaDB limits: [datatypes](https://docs.sqlc.dev/en/stable/reference/datatypes.html),
  [MariaDB UUID unsupported](https://github.com/sqlc-dev/sqlc/issues/3401)
