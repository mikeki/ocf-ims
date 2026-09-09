# 09j — Session contract for a native client + dev CORS (slice 3a.0)

> **Status:** Built — for review on `feat/3a0-session-contract`
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, slice 3a.0) under
> [09-proto-connect-platform.md](09-proto-connect-platform.md) (Phase 3)
> **Follows:** the Phase-1 closeout (#237, #239) — master is the base, no stacking (09i E16)
> **Owner:** Architect tier (server slice, touches `internal/auth` — architect-only per 09i §7)
> **Last updated:** 2026-09-09

## Objective

Give the Expo client the three things the server still lacked for a native session
(09i §2, items 1–3), and fold in the one contract nit 09i flagged. After this slice:

1. A native client can **log in and hold its own refresh token** (body-carried, stored
   in `expo-secure-store`) — the web client keeps the HttpOnly cookie, unchanged.
2. A native client can **refresh from the body**; the cookie stays the fallback for web.
3. Any client can **log out** through the contract; the server clears the cookie and
   the action log records the session's end as it records its start.
4. **Dev CORS**: the Expo dev server (`:8081`) can call the docker stack (`:8090`)
   cross-origin, with credentials, on the Connect prefix and the blob routes — off by
   default, and never needed in production (same-origin by construction, 09i E9).
5. `ListReports` / `GetReport` carry `NO_SIDE_EFFECTS` like every other read.

This is the server half of the 3a gate ("refresh proven on web (cookie) and native
(body)… logout clears the cookie on web and SecureStore on native"). 3a.2 builds the
client transport and session store against exactly this contract.

## The contract (09i E4, made concrete)

`proto/ocf/ims/service/rpc/v1/auth.proto` and `service/v1/service.proto`:

| Change | Shape | Semantics |
|---|---|---|
| `LoginRequest.return_refresh_token` | `bool = 3` | `true` ⇒ the response carries the refresh token and **no cookie is set**. Default `false` keeps today's web behaviour byte-for-byte. |
| `LoginResponse.refresh_token` / `refresh_expires_at` | `string = 3`, `Timestamp = 4` | Set only when asked for. The client stores **only** `refresh_token` (a few hundred bytes; SecureStore caps a value at 2 KB — the integration test asserts `< 1 KB`). `refresh_expires_at` is the hard end of the session (no rotation; 09i §12 Q1). |
| `RefreshTokenRequest.refresh_token` | `string = 1` | **Body wins, cookie is the fallback.** A body token that fails verification is `Unauthenticated` even if a valid cookie is also present — the two are never merged, so a client is always in exactly one session mode. Empty body + no cookie ⇒ `Unauthenticated`. |
| `rpc Logout(LogoutRequest) returns (LogoutResponse)` | empty envelopes | Clears the refresh cookie (`Max-Age=0`, same attributes as the set), answers `Cache-Control: no-store`. **Tolerates an anonymous caller** (the access token may already have expired — a logout must never fail). Un-annotated ⇒ **audited** by the action-log interceptor (procedure + caller, never a body). No server-side revocation exists; the plan-90 residual stands and is restated on the RPC. |
| `ListReports` / `GetReport` | `idempotency_level = NO_SIDE_EFFECTS` | Reads no longer over-log; GET-able like the other reads. |

Field numbers are free until 3b.7 (09i E14), so these are plain additions; `buf
breaking` is clean regardless because nothing is removed or renumbered.

**What the web client sees:** nothing new. `Login` without the flag sets the cookie as
before; `RefreshToken` with an empty body reads the cookie as before; the templ
`GET /ims/auth/logout` route is untouched (it dies in Phase 4 with the rest of templ).

## Server design

- **Domain (`internal/auth/connect.go`).** `Login` decides the token's home from the
  request flag: body ⇒ fills the two response fields and returns a nil cookie;
  otherwise the cookie as today. `RefreshToken` takes the cookie value from the
  transport as before and applies "body wins" itself, so the rule lives in one
  place and is unit-testable without HTTP. New `Logout` returns the clearing cookie
  (`clearedRefreshCookie`, the exact inverse of `newRefreshCookie`) and logs the
  handle when the caller is known. No DB access on logout.
- **Transport (`api/connect.go`).** `Login` sets `Set-Cookie` only when the domain
  handed back a cookie. `RefreshToken` still passes the cookie value in. `Logout` is a
  thin delegate that sets the clearing cookie and `no-store`.
- **CORS (`internal/server/cors.go`, `server.CORS(origins) Adapter`).** Built on
  `rs/cors` (already an indirect dependency, now direct) with the Connect-specific
  header lists from `connectrpc.com/cors` (new, tiny). Policy: exact origin
  allow-list, `AllowCredentials`, methods `GET`/`POST`, allowed headers = Connect's +
  `Authorization` + `X-Request-Id`, exposed headers = Connect's + `X-Request-Id` +
  `Retry-After` (login throttle) + `Content-Disposition` (attachment downloads),
  preflight cache 10 min. **Empty allow-list ⇒ the identity adapter and no
  `OPTIONS` route is registered**, so a production server emits no
  `Access-Control-*` header and behaves exactly as before.
  - Applied **outermost** on the Connect handler (`AddConnectToMux`) and on the six
    blob routes (`AddToMux`: incident/report attachment upload + download, own-picture
    upload, person-picture upload + serve) so the headers land even on a `401`.
  - Blob routes are registered with method-specific patterns, so a preflight
    (`OPTIONS`) would 405 at the mux before any adapter ran; when CORS is on, one
    `OPTIONS /ims/api/` catch-all answers preflights and lets a non-preflight
    `OPTIONS` fall through to 405 as today.
  - **Not** applied to the SSE stream, visits, debug or readiness routes — the plan's
    scope is the Connect prefix and the blob routes, and the Expo client polls in 3a.
- **Config.** `conf.ConfigCore.CORSAllowedOrigins []string`, env
  `IMS_CORS_ALLOWED_ORIGINS` (comma-separated, trimmed, empty = off). `Validate`
  rejects anything that is not exactly `scheme://host[:port]` — a trailing slash, a
  path, a wildcard, a bare host — because `rs/cors` matches origins exactly and a
  near-miss would fail silently in the browser. Documented in `.env.example`; the dev
  compose file forwards it from the host like `IMS_JWT_SECRET`.

## Checklist

- [x] `auth.proto`: `return_refresh_token`, `refresh_token` + `refresh_expires_at`,
      `RefreshTokenRequest.refresh_token`, `LogoutRequest`/`LogoutResponse`
- [x] `service.proto`: `Logout` (audited), `ListReports`/`GetReport` NSE
- [x] Domain: `Login` body/cookie split, `RefreshToken` body-wins, `Logout`
- [x] Transport delegates; `Logout` compiles because the handler interface grew
      (the "no `Unimplemented` embed" gate from #230 makes the compiler the check)
- [x] `server.CORS` + wiring on the Connect handler and the six blob routes +
      the `OPTIONS /ims/api/` preflight route (CORS-on only)
- [x] `conf` field + `Validate` + env parsing; `.env.example`; `docker-compose.dev.yml`
- [x] Tests — every branch: body login (no cookie, valid token, expiry, size),
      refresh from body / cookie fallback / body-wins-over-cookie / neither, logout
      clears + is audited, report reads not audited, CORS preflight + actual +
      disallowed origin + blob route + off-by-default + SSE not covered,
      config validation + env parsing
- [x] Docs: 09e mapping rows + Q2 update, 09i pointers, plan 09 §7 finding, README
- [x] Full Go verification protocol (below)

## Verification (from `go/`)

```
go run bin/build/build.go            # generators + build
go vet ./... && gofmt -l .
go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2 run   # 0 issues
go test ./...                        # incl. api/integration + store/integration on real MariaDB
go tool buf lint ../proto
go tool buf breaking ../proto --against '../.git#ref=origin/master,subdir=proto'
go mod tidy && git diff --exit-code go.mod go.sum
```

Result (2026-09-09): build, vet, gofmt, golangci-lint (0 issues), the full suite
including `api/integration` and `store/integration` on MariaDB, and buf lint all
clean; `go mod tidy` only records the two intended dependency changes
(`connectrpc.com/cors` added, `github.com/rs/cors` promoted from indirect to direct).
`buf breaking` reports exactly two lines — `ListReports` / `GetReport` changed
`idempotency_level` from `IDEMPOTENCY_UNKNOWN` to `NO_SIDE_EFFECTS` — which the FILE
rule set (`RPC_SAME_IDEMPOTENCY_LEVEL`) flags and every 1c read marker tripped the
same way; wire-compatible, and accepted before the 3b.7 freeze (09i E14). Note the
`ref=origin/master` form: a stale local `master` reports every change since it was
last fast-forwarded.

## Findings

Recorded in plan 09 §7 ("3a.0 — session contract for a native client + dev CORS");
the short form:

- **The cookie/body split belongs to the domain method, not the transport.** Letting
  `Login` return a nil cookie when the body carries the token keeps the delegate a
  one-liner and makes "no cookie when asked for the body" a domain fact a unit test
  can state. The alternative — the transport deciding from the request — would have
  re-grown logic in `api/` that the funlen gate exists to prevent.
- **"Body wins" has to be strict to be useful.** Falling back to the cookie when the
  body token is *invalid* would let a stale native token silently ride a web session
  in the same browser profile (Expo web in dev does exactly that). Rejecting is the
  only reading under which a client is ever in one session mode.
- **Method-specific mux patterns and CORS preflights don't mix.** Go 1.22's
  `"POST /path"` patterns answer `OPTIONS` with 405 before any handler adapter runs,
  so wrapping the blob handlers alone was not enough — the preflight never reached
  them. A single `OPTIONS /ims/api/` route, registered only when CORS is on, is the
  smallest fix and keeps the off state byte-identical.
- **`rs/cors` ≥ 1.11 is strict about the browser form of a preflight.** It validates
  `Access-Control-Request-Headers` exactly as the Fetch spec has browsers send it —
  names lowercase, sorted, unique — and denies the whole preflight otherwise. The
  first unit test sent `Authorization, Connect-Protocol-Version` and was refused;
  browsers never do that, but a curl or a test must model them.
- **`connectrpc.com/cors` is just three string lists** (methods, allowed and exposed
  headers for Connect/gRPC-web). Worth the dependency so the lists track the
  protocol rather than our memory of it, but it is not a middleware — `rs/cors` still
  does the work.
- **A logout that cannot fail.** Requiring a Bearer on `Logout` would have made
  "sign out after the access token expired" an error the client must special-case.
  Tolerating an anonymous caller (like `GetAuthStatus`) and auditing whatever
  identity is present is the behaviour the templ route already had.
