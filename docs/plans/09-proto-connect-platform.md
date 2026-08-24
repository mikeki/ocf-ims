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
| V1 | Web UI served by the same binary at `/ims/app` | client is a separate package | **Accepted.** templ is the web interface; the mobile client is its peer over the same contract. One binary, one deploy, no bundler |
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
| V14 | **No bundler, by design.** tsgo compiles `web/typescript` file-by-file to ES modules; third-party JS vendored as `.min.js` into `web/static/ext/`. No npm at runtime | — | **Accepted, and satisfiable.** See M12 |

V2 and V6 are permanent. V11 is the multi-month effort.

## 4. Decisions

| # | Decision | Call | Rationale |
|---|---|---|---|
| M1 | Repo shape | One module at **`go/`**, `cmd/ocf-ims/main.go` delegating to `run(ctx, cfg) error`, and **`internal/<domain>/` packages — by feature, not by technical layer**. `internal/server/` holds only what is genuinely cross-cutting: mux, interceptors, context helpers | Current Go guidance is to package by feature. A `server/` + `store/` split scatters one feature across three packages and makes the import graph a star. Supersedes plan 06's `go/ims/`. |
| M2 | Database | **Stay on MariaDB.** Postgres is a separate decision, not part of this plan | Conflating a wire-protocol migration with a storage-engine migration on live fair data doubles the risk and halves the attributability of anything that breaks. Known cost: sqlc's MySQL support is second-tier (no MariaDB `UUID` type; we don't use one). Revisit triggers in §8 Q4. |
| M3 | Proto layout | `proto/ocfims/{common,resources,service}/v1`; a **single `ImsService`** in `ocfims.service.v1` | One service per backend is what makes the generated handler interface an exhaustiveness check. `resources/v1` holds messages with no RPCs; `common/v1` stays small and gains a type only on its second consumer. |
| M4 | Codegen | **Go plugins via hermetic `go tool`**; TypeScript via pnpm `protoc-gen-es`; **`protoc-gen-connect-openapi`** for docs. buf itself as `go tool buf` | Our CI runs under a hardened-runner egress allow-list, so `remote:` BSR plugins are a liability; the local-plugin form is already proven here (PR #8). OpenAPI output costs one block and makes the API browsable by people who never learn protobuf. |
| M5 | **Validation lives in the contract** | **protovalidate** (v1.0) constraints written into the protos as messages are modelled, enforced by one `connectrpc.com/validate` interceptor | Presence, range, length, enum-membership and format become CEL in the proto with **no generated validation code** and identical semantics in every language. Targets **114 hand-written validation sites** in `api/` (24 in `person.go` alone). Authorization and business rules stay in Go. Decided here because it changes how the protos are written. |
| M6 | pnpm arrives in **Phase 0** | with the contract | The TS target serves both the existing web UI (M12) and the Expo client (M7). Deferring it means building Phase 0 twice. Also gives the deferred Vitest harness a home. |
| M7 | **Clients: templ for web, Expo for mobile** | The web UI stays server-rendered templ with a typed TS client over Connect. Mobile is **one deliberately small Expo app** — iOS and Android — scoped to the field subset | See §5. |
| M8 | Non-RPC surfaces | Attachment blob I/O and `sw.js` **stay plain HTTP**. The **SSE stream is a candidate for Connect server-streaming** | Streaming binary through proto is a bad fit, so blobs stay out. Streaming is available to us: `expo/fetch` has supported it since SDK 52, so the "unary-only" constraint often quoted for React Native no longer holds. A live-updating incident feed is exactly what a field client wants. |
| M9 | Cross-cutting behaviour | **Interceptors, declared once, defaulting on** — request ID, slog, panic recovery, auth, action log | CLAUDE.md already documents the current design's failure mode: the per-route `LogRequest` flag "is easy to omit and fails closed (unlogged)". Default-on removes the footgun instead of documenting it. |
| M10 | Extraction discipline | **Extract by need, not by rule.** ≤20-line handlers; real logic goes to its domain package; a handler that reads a row and returns it calls the sqlc `Querier` directly | A repository layer wrapping an already-generated data layer is the shape current Go practice criticises as boilerplate. But 11.6k LOC of logic inline in transport handlers is the opposite failure. The handler size rule is what keeps the discipline without the ceremony. |
| M11 | Module path | Keep `github.com/mikeki/ocf-ims` | Unchanged by the move to `go/` — Go module paths are directory-independent. So `go_package` lines written in Phase 0 need no edit in Phase 1a: `gen/` at the module root resolves to `github.com/mikeki/ocf-ims/gen/…` both before and after. Only buf's `out:` path changes. |
| M12 | The web client is **types-only, zero-runtime** | Generate with `protoc-gen-es` `json_types`, import with `import type` (erased by tsgo, no runtime import), and speak Connect with a ~150-line `fetch` wrapper | The Connect protocol is POST + JSON over HTTP/1.1 — a browser needs no runtime library. This satisfies V14 exactly: a fully typed client with **no npm at runtime and no bundler**. The archived branch already wrote the transport (`web/typescript/connectrpc.ts`, 146 lines). |
| M13 | Transport rollout | **Strangler.** Connect alongside REST; REST retired when nothing calls it | There is exactly one consumer today, which makes the strangler cheap and the cutover verifiable. |
| M14 | Verification | **Continuous** — a findings log appended per slice (§7), contributed upstream | A report written at the end is written from memory. |

## 5. Clients: templ for web, Expo for mobile

**The web stays templ.** It works, it is dense-table-friendly, and the dispatch
tent runs on laptops. Phase 2 ports it onto the generated contract (M12) without
touching its rendering model. Replacing it would be months of work for parity
with something that already works.

**Mobile is Expo** — one React Native codebase to iOS and Android, talking to the
same contract through a generated Connect client. Why Expo over the alternatives:

- **We already write TypeScript.** Dart costs an experienced developer roughly two
  to three weeks of ramp-up; that is a real price for a team this size, paid
  against a performance difference that does not decide anything for a
  forms-and-tables ops app (Flutter holds ~58–60 fps to React Native's ~51 on
  complex UIs and uses less memory; React Native starts ~200 ms faster and drains
  ~12% less battery).
- **Flutter web is canvas-rendered** with no real DOM text, so it could never
  absorb the dispatch UI. Expo web could, eventually — an option worth keeping
  even though this plan does not exercise it (§8 Q5).
- **The React Native transport caveat is gone.** `expo/fetch` has supported
  streaming since SDK 52 and is the global `fetch` on iOS and Android, so the
  client is not restricted to unary calls (M8).
- Kotlin Multiplatform is the least proven of the three here and `connect-kotlin`
  is still beta. Separate native Swift + Kotlin apps are twice the work for a
  two-person team.

**Scope it deliberately small.** Field volunteers need: my incidents, file and
append a report, attach a photo, receive notifications. Dispatch, admin,
taxonomies and metrics stay on the web. A small mobile client is what makes two
clients affordable.

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
- **1b — Interceptor spine.** Request ID, slog, panic recovery, auth (populating
  identity into the context), **protovalidate**, and the action log — declared
  once at handler construction, on by default (M9, M5). Register the Connect
  handler on the existing mux. Prove with one RPC end-to-end.
- **1c — Domain-logic extraction.** Resource by resource, business logic moves out
  of the ex-`api/` handlers into its domain package, accepting and returning proto
  messages and speaking Connect error codes directly. Extract by need (M10). Also
  lands a MySQL-flavoured `RunInTx` retrying error **1213** (deadlock) and **1205**
  (lock wait timeout), matched via `errors.As` into `*mysql.MySQLError` — never by
  string — which should retire the known `TestCreateAndGetIncident` flake.
  **This is the bulk of the work**: ~11.6k LOC of handler code has to find its
  real home.
- **1d — Handlers.** One thin method per RPC. Order: incidents → reports →
  people/auth → taxonomies → events/areas/crews → metrics/action log. REST stays
  live throughout (M13).
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
identical data over REST and Connect.

### Phase 2 — The web UI onto the generated client (retires REST)

- **2a — Prove the types-only path** (M12), an afternoon. Generate with
  `json_types`, import with `import type` only, confirm tsgo resolves types from
  the workspace package and keeps the generated `_pb.ts` runtime half out of its
  output. Port the `connectUnary` transport from the archived
  `web/typescript/connectrpc.ts`. Prove on one module end to end.
- **2b — Port module by module** from `fetch('/ims/api/…')` to the typed client.
  Order by risk, incidents last.
- **2c — Delete `json/` and the REST mux** once nothing calls them.

**Gate:** playwright suite green; `json/` gone; the HTTP surface is Connect plus
the M8 exceptions plus static assets; **zero npm at runtime**.

### Phase 3 — The Expo mobile client

- **3a — Skeleton.** `packages/interface`, Expo Router, React Query, the singleton
  Connect transport with a Bearer interceptor and a synchronous token cache, and
  one real screen (my incidents) against live data.
- **3b — The field subset.** My incidents, file and append a report, attach a
  photo, notifications. Dispatch, admin, taxonomies and metrics stay on the web.
- **3c — Ship.** EAS builds for iOS and Android; native push replacing the iOS PWA
  home-screen-install requirement. **Field numbers freeze here** (Phase 0).

Auth needs a decision at 3a: the web UI keeps the **refresh token in an HttpOnly
cookie** and sends the **access token as a Bearer header**. The Bearer half
carries over unchanged; the cookie half has no native equivalent, so mobile needs
a body-carried refresh into `expo-secure-store`.

### Phase 4 — Cleanup

- **4a** — Tidy the HTTP boundary: static assets behind Caddy if that proves
  better (§8 Q1), blob and stream endpoints documented as the deliberate
  exceptions they are.
- **4b** — Revisit the accepted divergences on their own merits: Postgres (M2),
  lower_snake schema (V6), anything the findings log has escalated.

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
7. **The bundler-free typed client** (M12) — `json_types` plus a `fetch` wrapper.
   Both of the stack's client blueprints assume a bundled SPA; a server-rendered
   UI serving unbundled ES modules has no documented story.
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

## 8. Open questions

1. **Does the Go binary keep serving static assets in production**, or does Caddy?
   Changes the compose file and the deploy runbook. Decide in Phase 4a.
2. **Offline capture on mobile.** `web/typescript/sw.ts` is push-only — its own
   comment says it is "not an offline worker" — so offline has never been solved
   here and has never blocked a fair. If the Expo client is expected to work
   through a connectivity outage, that is a local-store-and-sync design, and it
   belongs in its own plan rather than being smuggled into Phase 3.
3. **What happens to the Playwright suite.** It drives the running server over
   HTTP and is location-independent, but Phase 2 changes every call it observes.
4. **Postgres — what would actually trigger it?** Named so the question stops
   recurring: a feature needing Postgres-only capabilities, sqlc dropping MySQL
   from its Go path, or MariaDB's operational cost exceeding the migration cost.
   None are true today.
5. **Does the web UI ever converge onto Expo web?** Expo preserves the option;
   this plan does not exercise it. Revisit only if maintaining two clients proves
   more expensive than the migration.
6. **Vitest and the frontend test harness.** M6 gives it a home in Phase 0;
   whether it targets `web/typescript` during Phase 2 or waits for the Expo client
   is a Phase 2 call.

## 9. Exit criteria

- [ ] **Phase 0:** `proto/ocfims/**` models the full current API surface with
      protovalidate constraints; buf lint and breaking clean; Go, TypeScript and
      OpenAPI generate hermetically in CI; every one of the 65 REST routes is
      mapped to an RPC or a named M8 exception.
- [ ] **Phase 1:** the module lives at `go/` in domain packages; every RPC has a
      handler with no `Unimplemented` embedding; cross-cutting behaviour is
      interceptors, on by default; integration tests run through the generated
      client; the `TestCreateAndGetIncident` deadlock flake is gone.
- [ ] **Phase 2:** `json/` deleted; no REST route remains; the web UI runs on the
      generated TypeScript client with **zero npm at runtime**.
- [ ] **Phase 3:** the Expo client ships to both app stores against the same
      contract the web UI uses; field numbers frozen.
- [ ] **Phase 4:** the deviation ledger has no open rows except the accepted ones
      (V1, V2, V6, V10, V14), each documented upstream.
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
  *field* modelling is a useful starting point; its structure is superseded by M3
  (flat package, per-resource service, no `resources`/`service` split).
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
