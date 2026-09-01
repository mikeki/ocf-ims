# 09h — Domain-logic extraction (slice 1c)

> **Status:** Plan — in progress on `feat/1c-domain-extraction`
> **Parent:** [09-proto-connect-platform.md](09-proto-connect-platform.md) (Phase 1)
> **Follows:** [09g-interceptor-spine.md](09g-interceptor-spine.md) (slice 1b, merged #208)
> **Last updated:** 2026-08-31

## Objective

**This is the bulk of Phase 1** (M10): move *every* piece of business logic out of
the ex-`api/` handlers into its `internal/<domain>` package, resource by resource,
so each domain function **accepts and returns proto messages** and **speaks Connect
error codes** directly. Nothing is left inline because it "looked simple" — that is
how `updateIncident` reached 470 lines. ~11.6k LOC of handler code has to find its
real home.

1b gave us the spine (interceptors + one proven RPC). 1c gives every RPC a real
domain function to call, and — under the aggressive migration decision (plan 09 §6,
2026-08-31) — **retires the REST route it replaces in the same change** rather than
leaving a shim. So 1c and 1d collapse into one per-resource pass: extract the logic
into a proto-shaped domain function → add the thin RPC method → **delete the REST
route + handler** → move that resource's `api/integration` cases onto the generated
Connect client. When the last REST route is gone, `json/` is deleted with it. (The
old M13 "two transports, one implementation via a shim" framing no longer applies —
there is one transport, Connect, the moment a resource lands.)

## The three things that land in this slice

1. **`RunInTx` — ALREADY EXISTS (`go/store/tx.go`), no work needed.** Discovered
   at the start of 1c: `(*DBQ).RunInTx` already retries **1213** (deadlock) and
   **1205** (lock-wait timeout) via `errors.As` into `*mysql.MySQLError` (never by
   string), with backoff and `maxTxAttempts`, and is already used (e.g.
   `store/areas.go`); `store/tx_test.go` covers `retryableTxErr`. It landed earlier
   for the parallel attach/detach de-flake. So 1c does **not** build it — it just
   **applies** it to the multi-statement writes being extracted that don't yet use
   it. (If `TestCreateAndGetIncident` still flakes, check whether the incident
   create/attach path actually wraps its writes in `RunInTx`.)
2. **Path-scoped `funlen`** on the handler files, enabled in `.golangci.yml` in the
   *same* slice so the rule is enforced from the moment it exists rather than argued
   about later. It is what forces "extract everything" to actually happen.
3. **The extraction itself**, resource by resource.

## Extraction pattern (per resource)

> **Aggressive REST retirement (decided 2026-08-31, see [09 §6 Migration strategy](09-proto-connect-platform.md)):**
> the REST endpoint is **deleted** as the resource is extracted — NOT kept as a
> shim. No proto→json converters, no Connect-error→herr mapping (the `ListEvents`
> tracer briefly had both, then deleted them). The templ UI goes dark; the
> `api/integration` cases move onto the generated Connect client.

For each resource, in the ex-`api/`-now-`internal/<domain>` handler:

- Identify the business logic (validation beyond protovalidate, authz checks,
  DB orchestration, notification/metric side effects).
- Move it into a domain function with a **proto-shaped signature**:
  `func DoThing(ctx, deps…, *rpcv1.DoThingRequest) (*rpcv1.DoThingResponse, error)`,
  returning `connect.NewError(connect.Code…, err)` for failures. Authorize from
  `server.ClaimsFromContext(ctx)`.
- **Authorization stays in Go** (M5 puts only *validation* in the contract) — keep
  the `authz` checks, the `mayViewIncident` privacy gate, the private-incident 404,
  the last-admin guard, etc. exactly as they are; just relocate them and re-express
  the failures as Connect codes (404 → `CodeNotFound`, 403 → `CodePermissionDenied`, …).
- Add the RPC method to `ImsService` (a one-line delegate) and give `ImsService`
  whatever dep it needs (threaded via `AddConnectToMux` + `serve.go`). Mark reads
  `NO_SIDE_EFFECTS` in the proto.
- Wrap multi-statement writes in `RunInTx`.
- **Delete the REST route + handler** for that endpoint (in `api/mux.go` and the
  domain file). **Move its `api/integration` cases onto the Connect client**
  (`servicev1connect.NewImsServiceClient`, Bearer JWT) — the shared test server now
  also mounts `AddConnectToMux`. Prune the deleted route from
  `TestAnyUnauthenticatedUserEndpoints`-style REST enumerations.

## Resource order (from 09 §6)

incidents → reports → people/auth → taxonomies (incident types, outcomes) →
events/areas/crews → metrics/action log. Incidents first because they are the
hardest and everything else is lighter once the pattern is proven. The
incident-management cluster (`internal/incident` = incident+report+visit+journal+
attachment) is one package by design (1a finding: mutually recursive), so its
resources are extracted together.

## Guardrails (do not regress these — CLAUDE.md)

- **Privacy:** any endpoint surfacing incident content must honor
  `mayViewIncident`; an unauthorized single read returns **404**, not 403.
- **Action logging:** the Connect tier is now default-on via the interceptor
  (1b) keyed off `idempotency_level = NO_SIDE_EFFECTS`; as each **read** RPC's
  domain function lands, annotate that RPC in the proto (fails safe otherwise —
  it over-logs, never misses a mutation). REST still uses `LogRequest(true,…)`.
- **Admin escalation:** only `claims.PersonAdmin()` may mint admins; last-admin
  clear returns 409.
- **Domain behaviour is preserved (transport is not):** the RPC must do exactly
  what the REST handler did — same authz, same data, same edge cases — even as the
  REST route disappears. The **`api/integration` suite on the Connect client** is
  the net (raw-SQL seeds, catches schema/query drift); run
  `go test ./api/integration ./store/integration` after each resource. **Playwright
  is no longer a Phase-1 net** — it drives the templ UI, which goes dark as routes
  retire; the replacement client gets its own tests in Phase 3.

## Verification gate (per resource, and slice-wide)

- [ ] `go build ./...`, `go vet`, `gofmt`, `go test ./...` green.
- [ ] golangci-lint 0 issues (path-scoped `funlen` deferred to the end of 1c —
      it can't be enabled until the handlers it scopes are thin).
- [ ] `go run bin/build/build.go` regenerates + compiles; `buf lint` clean.
- [ ] both integration suites green; Playwright smoke unaffected.
- [ ] `RunInTx` has a test proving it retries 1213/1205 and gives up on others.

## Workflow (from memory — do not deviate)

- Branch `feat/1c-domain-extraction` off master. **Never auto-merge**; open the PR
  and leave it for the user, or merge only after they say so.
- Land in **reviewable chunks** — this slice is large, so a PR per resource (or a
  small group) is better than one 11.6k-line PR. Target master directly; if a
  prior chunk merges first, rebase `--onto master`.
- All Go commands run from `go/`. macOS BSD `sed` has no `\b` — use perl/python for
  identifier renames.

## Resume pointer (for an autonomous continuation)

State lives in git + memory, not here. To continue: `git log --oneline -5` on the
current 1c branch (or master, if a chunk merged), read the newest §7 finding and the
memory file `maybloom-stack-go-adoption.md`, then take the next resource in the order
above. `RunInTx` already exists (item 1), and the pattern is proven end-to-end on
**`ListEvents`** (a flat list) and **`GetIncident`** (a rich nested read) — the two
reference implementations to copy: the domain function (`internal/event/event.go`
`ListEvents`; `internal/incident/connect.go` `GetIncident`), its one-line RPC method
(`api/connect.go`), the deleted REST route (`api/mux.go`), and the Connect-client test
move (`api/integration/{main,helpers,event,proto_convert}_test.go`); see the §7 "1c"
findings.

**GetIncident is the branch `feat/1c-incident-getincident`** (off master, ListEvents
already merged). Next incident RPCs, still on the aggressive path: **`GetIncidents`
(plural)** — extracting it lets `incidentToJSON` be replaced by a direct DB→proto
mapping and retires the `incidentJSONToProto`/`incidentViewToJSON` throwaway bridge —
then **`CreateIncident`/`UpdateIncident`** (which flips the test read↔write round-trips
fully onto proto and lets the `getIncident` test helper stop synthesizing an
`*http.Response`). Then reports → people/auth → taxonomies → events(EditEvent)/areas/
crews → metrics/action log. For each: move handler logic into a proto-shaped domain
function returning Connect errors, add the RPC method to `ImsService`, **delete the
REST route + handler and move its `api/integration` cases onto the Connect client**
(NOT a shim — the aggressive path, plan 09 §6), then verify. **Defer `funlen`:** the
path-scoped rule can only be enabled once the files it scopes are actually thin, so
it lands near the END of 1c — turning it on now would fail lint on every
not-yet-extracted handler.
