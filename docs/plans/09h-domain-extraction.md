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
reference implementations to copy. **Each domain package exposes a `Service` struct**
holding the deps its RPCs share (`internal/event/event.go` `event.Service`;
`internal/incident/connect.go` `incident.Service`), the RPCs are **methods** on it, and
`api.ImsService` **composes** one `Service` per domain — built once in `AddConnectToMux`
— with each RPC method a one-line delegate (`s.Incident.UpdateIncident(ctx, req.Msg)`).
This is the codebase's own struct-with-fields handler idiom (`NewIncident{…}`), and it is
where the shared mutable cross-surface state (`EventSourcerer`, `MetricsCache`) is threaded
in. So a new resource = add a method to its domain `Service` (or a new `Service` for a new
domain + a field on `ImsService`), delete the REST route (`api/mux.go`), and move the
`api/integration` cases onto the Connect client. See the §7 "1c" findings.

The incident **reads** are done: **`GetIncident`** (branch `feat/1c-incident-getincident`,
merged #210) and **`GetIncidents`/`ListIncidents`** (branch `feat/1c-incident-listincidents`,
merged #211). Both reuse the shared `incidentToJSON`→`incidentJSONToProto` bridge.

The **writes** are done: **`UpdateIncident`** (merged #212, branch `feat/1c-incident-writes`)
and **`CreateIncident`** (branch `feat/1c-incident-create`). UpdateIncident introduced the
presence-tracked
**`IncidentUpdate`** proto message (rpc/v1/incident.proto), shared by Create and Update: a
plain `repeated` field can't distinguish "leave this list unchanged" from "clear it" (absent
== empty on the wire), which the incident PATCH-by-presence write depends on, so the three
reconciled lists are wrapped in optional `Int32List`/`IncidentRefList` and journal entries
use a write-shaped `NewJournalEntry`. Rather than rewrite the intricate 470-line
`updateIncident` helper to consume proto, the domain function converts `IncidentUpdate`→
`imsjson.Incident` at the boundary (`incidentUpdateToJSON`) and reuses `updateIncident`
**unchanged** — the same reuse-the-proven-assembler philosophy as the reads, and lossless
because imsjson's pointer fields already encode the exact presence semantics. Wiring: the
mutable dashboard cache (`MetricsCache`) and the SSE subscriber state (`EventSourcerer`) are
now created once in `serve.go` and threaded into **both** muxes (`AddToMux` +
`AddConnectToMux`) so a write on either surface invalidates/fans-out the other's state; the
stateless `Pusher` is rebuilt per-mux from the shared send backend. One consequence of the
contract excluding visits (09e): the incident write no longer carries visits, so the
incident↔visit link is set from the visit side (`updateVisit`, still REST) — `visit_test.go`
was rerouted accordingly.

This **decoupled** the read-mapper retirement from the writes. Because `updateIncident`
still speaks json, the write PR does **not** kill `incidentToJSON`/`incidentJSONToProto`/
`incidentViewToJSON` — the direct DB→proto mapper that retires them is now its own **later
follow-up**, cleanly separable and no longer blocking on the write extraction (this corrects
the earlier "they die together with the writes" pointer). **`CreateIncident`** then landed as
the first payoff of the per-domain `Service` pattern — one new method on `incident.Service`,
no new wiring — reusing the `IncidentUpdate` converter and `updateIncident` helper (REST
create already *was* "make a bare row, then run the edit path"); it deletes REST `POST
.../incidents` and reroutes the `newIncident`/`newIncidentSuccess` test helpers onto the
Connect client (synthesizing the `IMS-Incident-Number` header so their call sites are
unchanged). A gotcha it surfaced: `TestPushFanoutDelivery` runs its own `httptest` server, so
that server had to mount `AddConnectToMux` with the same push spy once create went
Connect-only.

**All incident writes are now on Connect.** The **report reads** are next-done: **`GetReport`
+ `ListReports`** (branch `feat/1c-report-reads`), the first non-incident resource and the
first PR to land two RPCs at once (both reads — the pattern is proven enough that reads no
longer need a PR each). They are methods on the *same* `incident.Service` (reports live in the
incident package, 1a grouping), reuse the shared `reportToJSON` assembly bridged onto the wire
(`reportJSONToProto` + a `reportViewFromJSON` wrapper carrying the `may_edit_summary` /
`may_add_journal_entry` flags — a viewer-relative-flag resource that confirms the 0e wrapper
split), and delete the REST GET routes. Two reusable lessons: report scoping denies with **403,
not 404** (unlike a private incident, the REST reader was never shown a hidden existence — don't
over-generalize the privacy 404); and retiring a REST *read* still relocates its `permissions_test`
sweep slice — a focused `TestReportReadAuthorization` (unauth→401, no-perms→403) was added
through the Connect client. `ListReports` gained `bool exclude_system_entries` (the recurring
"list RPC grows a field per REST query param" shape, same as `ListIncidents`).

Still outstanding on the incident core: the direct DB→proto read-mapper follow-up (retires
`incidentToJSON`/`incidentJSONToProto`/`incidentViewToJSON` and the test-side
`incidentViewToJSON`/`incidentUpdateFromJSON` bridges) — deferrable and best done once the
report reads/writes are also proto-shaped so the whole json read layer retires in one sweep.
Next: the **report writes** (`CreateReport`/`UpdateReport`, and the report journal-entry edit
`UpdateReportJournalEntry`) — note the report contract takes the plain `Report` resource on
write, not a presence-tracked update message like incidents. Then people/auth → taxonomies →
events(EditEvent)/areas/crews → metrics/action log. For each: move handler logic into a
proto-shaped domain method on its domain `Service` returning Connect errors, add the RPC
method to `ImsService`, **delete the REST route + handler and move its `api/integration`
cases onto the Connect client** (NOT a shim — the aggressive path, plan 09 §6), then verify.
**Defer `funlen`:** the path-scoped rule can only be enabled once the files it scopes are
actually thin, so it lands near the END of 1c — turning it on now would fail lint on every
not-yet-extracted handler.
