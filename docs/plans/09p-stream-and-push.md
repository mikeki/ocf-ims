<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09p — Slice 3b.0: the live stream and native push

The first slice of Phase 3b, and the first **server** slice since Phase 1 closed.
Master plan [09i](09i-expo-client.md) § *3b*; the platform findings go to plan
[09](09-proto-connect-platform.md) §7.

> **Status, 2026-09-10:** **3b.0a and 3b.0b are done** (the streaming-safe
> interceptor spine, and `WatchEvent`). 3b.0c has **not started**. The device
> half of the verification is still owed: the 3a gate is held
> open by a device session (see 09i § *Gate status*), and a live stream is only
> observable on a real client — the iOS/Android runs are exactly what would catch
> a stream that works in Chromium and not on a phone.
>
> 3b.0a was taken ahead of that gate deliberately: it adds no RPC and nothing a
> device could observe. 3b.0b is built and proven in Go — unit tests, and
> end-to-end through the generated client over real HTTP — but the two checks
> that need a device or two browsers (**the two-client privacy check** and a
> long-lived stream through Caddy on a phone) remain open in the checklist below.
> Building it and proving it on a device are different things, and only the first
> is done.

## The goal

Two capabilities the field app needs and the client has no way to get today:

1. **Changes arrive live.** An incident someone else edits updates on your screen
   without a pull-to-refresh and without the 30 s poll the tracer screens use now.
2. **A notification reaches a phone that is not open.** Web push already works for
   browsers (plan 84); a native Expo build needs a different sender and a different
   device identity.

## What already exists, and what is wrong with it

**The SSE poke** (`internal/server/eventsource.go`, `GET /ims/api/eventsource`).
A single broadcast hub. It requires the refresh-token cookie, which a native client
does not have, so it is web-only by construction. More importantly it is
**broadcast**, so it cannot tell one subscriber from another — and that forces its
privacy stance: an `IncidentPrivacyOracle` is consulted before every incident poke,
and a private incident's number is **redacted** to a number-less `update_all`
"reload everything" poke. It fails safe (a lookup error also redacts).

The accepted residual, written down in `CLAUDE.md`, is that *some* activity in an
event is observable to any authenticated subscriber: you cannot see **which**
incident changed, but you can see **that** something did. That residual exists
only because the transport cannot address a subscriber.

**Web push** (`lib/push`, `internal/server/pushfanout.go`, plan 84c). A `push.Sender`
seam with a `NoopSender` default, a `Pusher` that fans out *after the DB commit* from
its own goroutine with a 30 s budget, and deliberately minimal content ("You were
mentioned in incident #12" plus a deep link, never the incident's text) because the
notification can surface on a lock screen. `PUSH_SUBSCRIPTION` stores the browser's
subscription: `ENDPOINT` (unique — a device's identity), `P256DH`, `AUTH`, all
`not null`.

The fan-out design is right and this slice keeps it. What it cannot do is deliver to
an Expo build, whose device identity is an `ExponentPushToken[…]` and which has no
`P256DH`/`AUTH` at all.

## Constraints this slice must respect

| | Constraint | Why, and what it costs |
|---|---|---|
| **S1** ✅ | **The interceptor spine is unary-only.** *(Fixed in 3b.0a.)* All five hand-written interceptors (`NewRecoveryInterceptor`, `NewRequestIDInterceptor`, `NewAuthInterceptor`, `NewSlogInterceptor`, `NewActionLogInterceptor`) are `connect.UnaryInterceptorFunc`. | This is the single biggest thing to get right, and connect-go makes it **silent**: `UnaryInterceptorFunc`'s `WrapStreamingHandler` is a pass-through, so a streaming handler compiles, serves, and runs with **no auth claims in its context, no panic recovery, no request id and no log line**. A `WatchEvent` that reads `ClaimsFromContext(ctx)` would find nothing and — depending on how it is written — either fail closed or serve an anonymous caller. **Do not add a streaming RPC before this is fixed.** The fix is to promote the spine to real `connect.Interceptor` implementations with a `WrapStreamingHandler` that mirrors the unary one; that is a slice of its own (3b.0a below), it is security code, and it is architect-tier. |
| **S2** ✅ | **The stream is per-subscriber, so it must filter rather than redact.** *(Done in 3b.0b.)* | This is the whole point of replacing SSE. `mayViewIncident` (`internal/incident/incident.go`) already encodes the rule; the stream applies it per connected subscriber and simply **omits** a poke the subscriber may not see. That retires the "some activity is observable" residual — update `CLAUDE.md` when it lands, and not before. |
| **S3** ✅ | **Access is re-checked on every poke, not once at subscribe.** *(Done in 3b.0b.)* | A stream can outlive a permission change: someone's event access is revoked, or an incident is *marked* private while they are watching it. Checking only at subscribe time turns a long-lived connection into a permission cache with no invalidation. The re-check is a `mayViewIncident` call per poke per subscriber — cheap, and it must not be optimised away. |
| **S4** | **A native device identity is not a web subscription.** | `PUSH_SUBSCRIPTION.P256DH` and `AUTH` are `not null` and meaningless for Expo. Add a `KIND` column (`web` / `expo`) and make the two key columns nullable, with the existing rows backfilled to `web`. `ENDPOINT` carries the `ExponentPushToken[…]` for an Expo row and stays the device's unique identity, so the upsert-on-endpoint behaviour and the `PUSH_SUBSCRIPTION_BY_PERSON` fan-out index both survive unchanged. |
| **S5** | **Expo push is asynchronous in two steps.** | The send call returns a *ticket*, not a delivery. Errors that matter (`DeviceNotRegistered`) only appear later in a **receipt**, fetched by ticket id. A sender that ignores receipts never prunes a dead token and will fan out to it forever. `ExpoPushSender` has to check receipts and prune on `DeviceNotRegistered`, which is the Expo analogue of the web path's 404/410 pruning. |
| **S6** | **Push stays off unless configured.** | `IMS_EXPO_PUSH_ENABLED`, defaulting off, following the `Enabled()` pattern `NoopSender` already establishes — a disabled backend short-circuits the fan-out *before* it touches the database. |
| **S7** ✅ | **SSE does not get deleted here.** *(Held in 3b.0b: the hub hangs off `EventSourcerer`'s four `Notify*` methods, which were already the single point all ~22 publish sites funnel through — so both publishers run off one set of triggers and **no call site changed**.)* | The templ web UI is still the production client and still consumes `GET /ims/api/eventsource`. Both live side by side until the Expo client replaces it (Phase 4). Two publishers off one set of triggers, not a migration. |
| **S8** | **Content stays minimal.** | The lock-screen rule from 84c is unchanged and applies to Expo identically: a body like "You were mentioned in incident #12" and a deep link, never incident text. A native notification is *more* exposed than a browser one, not less. |

## The contract

```proto
// service.proto
rpc WatchEvent(rpc.v1.WatchEventRequest) returns (stream rpc.v1.EventPoke);
rpc RegisterPushDevice(rpc.v1.RegisterPushDeviceRequest) returns (rpc.v1.RegisterPushDeviceResponse);
rpc UnregisterPushDevice(rpc.v1.UnregisterPushDeviceRequest) returns (rpc.v1.UnregisterPushDeviceResponse);
```

`EventPoke` is a *poke*, not a payload: it says what changed so the client can
refetch through the existing access-gated read. It must **not** carry incident
content — that would put authorization on the publish path and duplicate the read
path's privacy logic in a second place. The client already has `GetIncident`.

A heartbeat every **25 s** keeps intermediaries from reaping an idle connection
(Caddy and most proxies sit at 30–60 s). Model it as a poke kind rather than a
transport-level ping, so the client can observe liveness in one place.

## Slices

Each is one PR to `master`. **3b.0a is a prerequisite, not an optional first step.**

| | Slice | Deliverable |
|---|---|---|
| **3b.0a** ✅ | **Streaming-safe interceptors** | **Done 2026-09-10.** The five unary interceptor funcs are now named types implementing `connect.Interceptor`, each with `WrapUnary` and `WrapStreamingHandler` calling one shared body so the two halves cannot drift. Tests cover a streaming handler seeing claims, an anonymous stream carrying none, a panic mid-stream becoming `Internal`, the request id being echoed *before* the handler can send, the whole `Interceptors()` chain applied to a streaming handler, and a pin on connect-go's pass-through so the hazard is executable. Action log: answered by the contract (below). No new RPC. |
| **3b.0b** ✅ | **`WatchEvent`** | **Done 2026-09-10.** `stream.proto` (the first `stream` in the contract), `WatchHub` + `Stream` in `internal/server`, and `WatchPolicy` implemented in `internal/incident` from the *same* primitives the read path uses (`mayViewIncident`, the 52f grant query, `EventPermissions`). Per-subscriber filter (S2), re-checked per poke (S3), 25 s heartbeat **plus an establishing beat**, expiry ends the stream, clean teardown. Tested both as units and end-to-end through the **generated client** over real HTTP. |
| **3b.0c** | **Native push** | `KIND` migration + nullable `P256DH`/`AUTH` with a `web` backfill (S4); `RegisterPushDevice` / `UnregisterPushDevice`; `ExpoPushSender` implementing `push.Sender` with receipt checking and `DeviceNotRegistered` pruning (S5); `IMS_EXPO_PUSH_ENABLED` (S6); wired into the existing `Pusher` fan-out so one notification reaches web and native devices alike. |

## Verification

The full Go protocol from `go/` for every slice — `go build ./...`, `go vet ./...`,
`gofmt -l`, `go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2 run`,
`go test ./...`, `go tool buf lint` + `breaking`, `go mod tidy` clean — plus
`go test ./store/integration` for 3b.0c (a migration is only proven against a real
MariaDB, which is what that suite is for).

3b.0a is verified: `go build`, `go vet`, `gofmt -l`, golangci@v2.12.2 and `go test
./...` all clean (the testcontainer suites run in CI, not on the laptop), `buf lint`
clean, `go mod tidy` a no-op.

The stream needs one thing the unit tests cannot give: **two clients at once**, with
different access, watching the same event while a third mutates it. That is a
staging check with two browser sessions, and it is the acceptance test for S2/S3.

## Checklist

- [ ] 3a gate closed (device session) — **this slice does not start before it**
- [x] 3b.0a: streaming-safe interceptor spine, with tests, merged
- [x] 3b.0b: `WatchEvent` — per-subscriber filter, per-poke re-check, heartbeat, cancellation
- [ ] 3b.0c: `KIND` migration, device RPCs, `ExpoPushSender` with receipts, `IMS_EXPO_PUSH_ENABLED`
- [ ] Two-client privacy check on staging (a writer must never observe a private incident's pokes)
- [ ] `CLAUDE.md` § *Private incidents* updated — the SSE residual is retired **only** for stream subscribers
- [x] Plan 09 §7 finding written (connect-go streaming) — *3b.0a — A unary interceptor spine cannot be extended to streaming*

## Open questions

1. ~~**Does the action log belong on a stream at all?**~~ **Answered in 3b.0a.**
   The contract already decides it: the read/write split is driven by
   `idempotency_level = NO_SIDE_EFFECTS`, so `WatchEvent` — which mutates nothing —
   is skipped exactly as `GetIncident` is. There is no row per poke because there is
   no row. A *mutating* stream, if one is ever added, gets two rows (open, close)
   rather than the unary shape of one on completion: a subscription can live for
   hours, so the audit log records the connection when it opens rather than only when
   it ends, and still has the open row if the process dies mid-stream.
2. **Does `expo/fetch` carry a Connect server stream on both native platforms?**
   Finding #3 says streaming has worked since SDK 52 and the client half of it is
   3b.2's problem, but if it does not hold on one platform the whole shape changes,
   so it is worth a spike **before** 3b.0b rather than after.
3. ~~**One stream per event, or one per session?**~~ **Answered in 3b.0b:**
   `WatchEventRequest` carries `repeated int32 event_ids` (min 1, max 64). One
   stream can watch several events, so the dispatch console (3c) needs no second
   RPC, and `int32` → `repeated int32` would have been a breaking change in JSON
   even though the binary wire format tolerates it — so it had to be decided now,
   as the brief suspected.

   What was rejected: *empty means every event you can read*. It is more
   convenient and it is not less safe (the per-poke filter re-checks regardless),
   but this is an authorization surface, and an enumerated list is auditable where
   an implicit one is not. The console already lists its events; it can name them.
4. ~~**What happens to a stream when the access token expires?**~~ **Answered in
   3b.0b — and it is not a hypothetical.** `cmd/serve.go` sets
   `WriteTimeout: 30 * time.Minute` (deliberately long, for SSE) and the default
   access-token lifetime is 15 minutes (`conf/imsconfig.go`). 3b.0a established
   that a stream authenticates **once**, from the headers it opened with. So a
   stream that runs its full life spends **half of it holding an expired token**.

   The second option, as the brief leaned: the per-poke access re-check (S3) is
   also where expiry is noticed, and an expired token ends the stream with
   `Unauthenticated` so the client reconnects with a fresh one. It costs nothing
   extra — the re-check was already mandatory — and it means the S3 re-check is
   load-bearing for two separate reasons rather than one.

## What 3b.0b cost that the brief did not predict

- **A Connect server stream does not exist until it sends something.** The
  response headers are not written until the first message, so connect-go's
  *client* call blocks until the server sends. Without an establishing heartbeat,
  `WatchEvent` blocked a client for up to 25 s on a quiet event, and the client
  could not tell "connecting" from "connected and idle". The end-to-end tests
  found it by each taking exactly 25.0 s. The SSE hub had already solved this and
  it was missed: `EventSourcerer` sets `ReplayAll` and hands every new subscriber
  an `InitialEvent` the moment it attaches.
- **Caddy will buffer a Connect stream.** It flushes immediately for
  `text/event-stream` — which is why the templ UI's SSE poke has always worked —
  but a Connect stream is `application/connect+json` and gets no such special
  case. `deploy/Caddyfile.example` now sets `flush_interval -1` on the RPC route.
  This is the failure that passes every Go test and dies on staging.
- **Putting *both* authorization questions behind one seam is what made the
  stream testable.** `WatchPolicy` (the subscribe gate + the per-poke filter) left
  the handler as pure mechanics with no database, so the whole stream — filter,
  heartbeat, expiry, teardown — runs through the generated client against
  `httptest` with no MariaDB. The first cut put the gate inline against the DB and
  would have been provable only in the testcontainer suite.
- **`buf` refuses `returns (stream EventPoke)`.** Its response-naming rule wants
  `WatchEventResponse`; the envelope that satisfies it turned out better than the
  original, because it can grow a resume cursor later without touching the poke —
  and it matches the shape the rest of the contract already uses.
- **A server stream needs nothing from HTTP/2.** Over the Connect protocol it is
  one request and a chunked response. Worth knowing, because the server listens in
  plaintext behind Caddy with no h2c — a *bidi* stream would need HTTP/2 and does
  not have it.

## Findings queued for plan 09 §7

- ~~**The interceptor spine is unary-only, and connect-go does not say so.**~~
  **Written 2026-09-10** as plan 09 §7 *"3b.0a — A unary interceptor spine cannot be
  extended to streaming"*, with four things this brief had not yet found: the
  header-ordering asymmetry a stream forces, the fact that `recover()` does not reach
  a handler's own goroutines, that a stream authenticates once from the headers it
  opened with, and the contract-driven answer to the action-log question. Original
  note: a
  `connect.UnaryInterceptorFunc` satisfies `connect.Interceptor` with a pass-through
  `WrapStreamingHandler`, so adding the first streaming RPC to a mature unary service
  silently drops authentication, panic recovery, request ids and logging on that one
  method. Nothing fails to compile and nothing warns. Any blueprint that says "add
  interceptors" and later says "add streaming" owes this sentence — and it is a
  second, sharper argument that finding #3's "unary-only" rule caused real damage:
  it let a whole spine be written in a shape that cannot be extended.
- **Broadcast transports force redaction; addressed transports allow filtering.**
  The SSE hub's privacy compromise was never a policy decision, it was a transport
  consequence. Worth stating wherever server-push is discussed, because the fix is
  not "redact more carefully", it is "change the transport".
