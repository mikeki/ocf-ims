<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09p — Slice 3b.0: the live stream and native push

The first slice of Phase 3b, and the first **server** slice since Phase 1 closed.
Master plan [09i](09i-expo-client.md) § *3b*; the platform findings go to plan
[09](09-proto-connect-platform.md) §7.

> **Status:** brief written 2026-09-10, **not started**. Its gate — the 3a gate —
> is held open by a device session (see 09i § *Gate status*). Nothing here should
> be built until that closes: a live stream is only observable on a real client,
> and the iOS/Android runs are exactly what would catch a stream that works in
> Chromium and not on a phone.

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
| **S1** | **The interceptor spine is unary-only.** All five hand-written interceptors (`NewRecoveryInterceptor`, `NewRequestIDInterceptor`, `NewAuthInterceptor`, `NewSlogInterceptor`, `NewActionLogInterceptor`) are `connect.UnaryInterceptorFunc`. | This is the single biggest thing to get right, and connect-go makes it **silent**: `UnaryInterceptorFunc`'s `WrapStreamingHandler` is a pass-through, so a streaming handler compiles, serves, and runs with **no auth claims in its context, no panic recovery, no request id and no log line**. A `WatchEvent` that reads `ClaimsFromContext(ctx)` would find nothing and — depending on how it is written — either fail closed or serve an anonymous caller. **Do not add a streaming RPC before this is fixed.** The fix is to promote the spine to real `connect.Interceptor` implementations with a `WrapStreamingHandler` that mirrors the unary one; that is a slice of its own (3b.0a below), it is security code, and it is architect-tier. |
| **S2** | **The stream is per-subscriber, so it must filter rather than redact.** | This is the whole point of replacing SSE. `mayViewIncident` (`internal/incident/incident.go`) already encodes the rule; the stream applies it per connected subscriber and simply **omits** a poke the subscriber may not see. That retires the "some activity is observable" residual — update `CLAUDE.md` when it lands, and not before. |
| **S3** | **Access is re-checked on every poke, not once at subscribe.** | A stream can outlive a permission change: someone's event access is revoked, or an incident is *marked* private while they are watching it. Checking only at subscribe time turns a long-lived connection into a permission cache with no invalidation. The re-check is a `mayViewIncident` call per poke per subscriber — cheap, and it must not be optimised away. |
| **S4** | **A native device identity is not a web subscription.** | `PUSH_SUBSCRIPTION.P256DH` and `AUTH` are `not null` and meaningless for Expo. Add a `KIND` column (`web` / `expo`) and make the two key columns nullable, with the existing rows backfilled to `web`. `ENDPOINT` carries the `ExponentPushToken[…]` for an Expo row and stays the device's unique identity, so the upsert-on-endpoint behaviour and the `PUSH_SUBSCRIPTION_BY_PERSON` fan-out index both survive unchanged. |
| **S5** | **Expo push is asynchronous in two steps.** | The send call returns a *ticket*, not a delivery. Errors that matter (`DeviceNotRegistered`) only appear later in a **receipt**, fetched by ticket id. A sender that ignores receipts never prunes a dead token and will fan out to it forever. `ExpoPushSender` has to check receipts and prune on `DeviceNotRegistered`, which is the Expo analogue of the web path's 404/410 pruning. |
| **S6** | **Push stays off unless configured.** | `IMS_EXPO_PUSH_ENABLED`, defaulting off, following the `Enabled()` pattern `NoopSender` already establishes — a disabled backend short-circuits the fan-out *before* it touches the database. |
| **S7** | **SSE does not get deleted here.** | The templ web UI is still the production client and still consumes `GET /ims/api/eventsource`. Both live side by side until the Expo client replaces it (Phase 4). Two publishers off one set of triggers, not a migration. |
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
| **3b.0a** | **Streaming-safe interceptors** | Promote the five unary interceptor funcs to real `connect.Interceptor`s with `WrapStreamingHandler`. Auth, recovery, request id and slog behave identically on both. The action log needs a decision (below) — a long-lived stream is not a "mutating request", and logging one line per poke is not audit data. Tests: a streaming handler sees claims; a panic mid-stream becomes `Internal`; an anonymous streaming call has no claims. **Security code, architect-tier.** No new RPC in this PR. |
| **3b.0b** | **`WatchEvent`** | The proto, the handler, and a per-subscriber hub beside `EventSourcerer` fed by the same notify triggers. Per-subscriber `mayViewIncident` filter (S2), re-checked per poke (S3), 25 s heartbeat, clean cancellation when the client goes away. Tests through the **generated client** against an `httptest` server, including: a private incident pokes its creator and not a writer; revoking access mid-stream stops the pokes; a cancelled context tears the subscriber down and leaks no goroutine. |
| **3b.0c** | **Native push** | `KIND` migration + nullable `P256DH`/`AUTH` with a `web` backfill (S4); `RegisterPushDevice` / `UnregisterPushDevice`; `ExpoPushSender` implementing `push.Sender` with receipt checking and `DeviceNotRegistered` pruning (S5); `IMS_EXPO_PUSH_ENABLED` (S6); wired into the existing `Pusher` fan-out so one notification reaches web and native devices alike. |

## Verification

The full Go protocol from `go/` for every slice — `go build ./...`, `go vet ./...`,
`gofmt -l`, `go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2 run`,
`go test ./...`, `go tool buf lint` + `breaking`, `go mod tidy` clean — plus
`go test ./store/integration` for 3b.0c (a migration is only proven against a real
MariaDB, which is what that suite is for).

The stream needs one thing the unit tests cannot give: **two clients at once**, with
different access, watching the same event while a third mutates it. That is a
staging check with two browser sessions, and it is the acceptance test for S2/S3.

## Checklist

- [ ] 3a gate closed (device session) — **this slice does not start before it**
- [ ] 3b.0a: streaming-safe interceptor spine, with tests, merged
- [ ] 3b.0b: `WatchEvent` — per-subscriber filter, per-poke re-check, heartbeat, cancellation
- [ ] 3b.0c: `KIND` migration, device RPCs, `ExpoPushSender` with receipts, `IMS_EXPO_PUSH_ENABLED`
- [ ] Two-client privacy check on staging (a writer must never observe a private incident's pokes)
- [ ] `CLAUDE.md` § *Private incidents* updated — the SSE residual is retired **only** for stream subscribers
- [ ] Plan 09 §7 finding written (connect-go streaming)

## Open questions

1. **Does the action log belong on a stream at all?** It exists to audit *mutating*
   requests. A subscription mutates nothing, and one row per poke would swamp it.
   Leaning: log the **subscribe** and the **teardown**, nothing in between — but it
   is a decision to make in 3b.0a rather than to discover in 3b.0b.
2. **Does `expo/fetch` carry a Connect server stream on both native platforms?**
   Finding #3 says streaming has worked since SDK 52 and the client half of it is
   3b.2's problem, but if it does not hold on one platform the whole shape changes,
   so it is worth a spike **before** 3b.0b rather than after.
3. **One stream per event, or one per session?** Per-event is simpler and matches
   the current screen. A person watching several events opens several streams. If
   the dispatch console (3c) wants all events at once this gets revisited — better
   to know now whether the request should carry a repeated `event_id`.
4. **What happens to a stream when the access token expires?** The client refreshes
   on its own schedule, but a stream established with an old token is not
   re-authenticated by anything. Either the stream carries its own expiry and the
   client reconnects, or the per-poke access re-check (S3) is also the point where
   an expired token ends the stream. The second is tidier and costs nothing extra.

## Findings queued for plan 09 §7

- **The interceptor spine is unary-only, and connect-go does not say so.** A
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
