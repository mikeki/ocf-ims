# 09l — Client foundations: transport, session, data layer (slice 3a.2)

> **Status:** ✅ Merged (PR #242, 2026-09-09); §9 client protocol green (68 Jest tests, Playwright smoke). The hand checks wait for the staging instance ([09m](09m-staging-instance.md)).
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, slice 3a.2) under
> [09-proto-connect-platform.md](09-proto-connect-platform.md) (Phase 3)
> **Follows:** [09k](09k-interface-scaffold.md) (3a.1, merged as #241) and
> [09j](09j-session-contract-cors.md) (3a.0, merged as #240) — master is the base, no
> stacking (09i E16)
> **Owner:** Architect tier. Everything here is security-sensitive code (09i §7 rule 3:
> transport auth, session storage, refresh, logout, permission helpers), so the architect
> writes the brief *and* the code; no builder or mechanic agent in this slice. Review
> climbs a tier (rule 4): a second architect pass, then Miguel.
> **Last updated:** 2026-09-09

## Objective

Give the tracer screens (3a.3) everything they need to talk to the server without
writing a line of fetch, auth or error code — and make the session behave the way
the templ client learned to behave the hard way (#189: a redeploy must not log the
fair out). After this slice a screen does three things: reads `useSession()` to
know who is signed in, calls a connect-query hook to load data, and renders an
`AppError` through one mapping. Everything else — Bearer headers, refresh, the
cookie-vs-SecureStore split, cold-start cache, the request id in a generic error —
lives below the screens and is tested without a server.

Nothing product-shaped ships here. The one visible change is the index route, which
now shows the session's state (connecting / signed in as … / signed out / can't
reach the server), because the Playwright smoke needs to see the bootstrap run in
the exported bundle.

## Decisions (F1–F14)

| # | Decision | Why |
|---|---|---|
| F1 | **Two transports over one base URL.** The *auth transport* carries the E3 interceptor and serves every RPC a screen calls; a *bare transport* (no interceptors) serves `RefreshToken` only. | A refresh must never recurse through the interceptor that triggered it, and a `RefreshToken` request must never carry a Bearer (the server ignores it, but the client's invariant is simpler: one path in, one path out). |
| F2 | **Bearer from a synchronous in-memory cache** (`AccessTokenCache`: token + `expiresAt` epoch ms). Attached to every RPC except `Login` and `RefreshToken`. `Logout` *does* carry it, so the server logs and audits who signed out. | E3. The cache is sync so the interceptor never awaits storage on the hot path; the access token is never persisted (15-minute lifetime, re-minted from the refresh token on every cold start). |
| F3 | **Proactive refresh 60 s before `expires_at`** (the server's `expires_at` is already 10 s early — `authz.SuggestedEarlyAccessTokenRefresh`); **reactive refresh + one retry** when a non-session unary RPC answers `Unauthenticated`. Streams (3b) get the proactive half only: a stream's request body cannot be replayed. `Login`, `RefreshToken` and `Logout` are *session RPCs* and are never refreshed-and-retried — `Login`'s `Unauthenticated` means bad credentials, not an expired token. | E3, made exact. The exemption set is the whole reason the interceptor can treat `Unauthenticated` as "token expired" everywhere else. |
| F4 | **Single-flight refresh** (`Refresher`): concurrent callers share one in-flight `RefreshToken` promise. Outcomes are three-valued: `refreshed` (new token cached), `signedOut` (**definitive**: `RefreshToken` itself answered `Unauthenticated` — the refresh token is expired, invalid or absent), `failed` (**transient**: anything else — network, `Unavailable`, a 5xx during a redeploy, a 404 from a proxy). Only `signedOut` clears the session; `failed` leaves the cached access token and the stored refresh token untouched and the original error is what the caller sees. | E3 / #189. The classification is the security decision of the slice; it is one function, `classifyRefreshError`, with a table test. |
| F5 | **Session = a small external store** (`createSession`) with four states: `unknown` (booting) → `unreachable` (boot could not reach the server; retry) / `signedOut` / `signedIn { auth: GetAuthStatusResponse }`. React reads it through `useSyncExternalStore` (`useSession()`); the root layout mounts it and calls `bootstrap()` once. | The router decides layouts from four states, not from a bag of booleans; `unreachable` is a distinct state so a server outage shows a retry, never a login form the user cannot use. |
| F6 | **Bootstrap = refresh with what you have, then whoami.** Native: a stored refresh token → `RefreshToken{refresh_token}`; no stored token → `signedOut` without a request. Web: `RefreshToken{}` always (the cookie is invisible to JS; the server says whether it has one). A refreshed access token → `GetAuthStatus` → `signedIn`. Definitive `Unauthenticated` → `signedOut` (native also wipes the store). Anything else → `unreachable`. | E4. The web client cannot know it has a cookie; one cheap unauthenticated call answers it, and a missing cookie is a quiet `Unauthenticated` (no warn log, `RefreshToken` is NSE so no action-log row). |
| F7 | **`signIn(email, password)`** sends `return_refresh_token: Platform.OS !== "web"`. Native stores the returned refresh token (`expo-secure-store`) *before* the whoami so a crash between the two still leaves a resumable session; web stores nothing (the cookie arrived with the response). Failure throws an `AppError` for the login screen: `unauthenticated` → "wrong email or password", `throttled` → the `Retry-After` countdown. | E4; the login screen (3a.3) renders the error, it does not classify it. |
| F8 | **`signOut()` is local-first and cannot fail**: clear the token cache, wipe the stored refresh token, clear the query cache and the persisted cache, flip to `signedOut` — and call `Logout` best-effort with the Bearer still attached (the server clears the web cookie and audits). A `Logout` that cannot reach the server still signs the client out. | E4; a sign-out must never be blocked by the network. The order (Bearer captured before the cache is cleared) is what makes the audit line carry the handle. |
| F9 | **Refresh-token store is an interface** (`RefreshTokenStore`: `load/save/clear`) with two implementations selected by Metro's platform suffix: `store.native.ts` over `expo-secure-store`, `store.ts` the web no-op (the cookie lives in the browser) — and `store.ts` is also the suffix-less file `tsc` and Jest resolve. `save` refuses a value over **2 048 bytes** (the SecureStore limit); a Jest test asserts a realistic HS256 refresh JWT (the server's claims: `iat`, `exp`, `iss`, `tok`, `handle`, `sub`) is well under it. | E4 and 09i §11. 09i §5 sketched `store.web.ts` + `store.native.ts`; with no suffix-less file `tsc` cannot resolve `@/session/store`, so the web file *is* the fallback. Recorded as a build note. |
| F10 | **connect-query v2 over TanStack Query v5**, provided by `ApiProvider` = `TransportProvider` + `PersistQueryClientProvider`. Query defaults: `staleTime` 30 s, `gcTime` 24 h (≥ the persister's `maxAge`), retries only for `AppError.retryable` (at most 2), mutations never retried. Native: `focusManager` wired to `AppState` so a foregrounded app refetches (E6). | E5/E6. Screens never see a transport or a query client. |
| F11 | **Persisted read cache over AsyncStorage** with a **protobuf-safe serializer**: protobuf-es v2 messages carry `bigint` (`Timestamp.seconds`, every int64) which `JSON.stringify` throws on, and `Uint8Array` which it mangles. `serialize`/`deserialize` tag them (`{"$bigint":"…"}`, `{"$bytes":"<base64>"}`) and reverse it on restore. `buster` = the app version from `app.json` so a release never hydrates an older shape; sign-out removes the persisted client. Only successful queries are dehydrated (the default). | E5. Neither connect-query nor TanStack documents the bigint problem; the first persisted `ListIncidents` would have thrown. A round-trip test pins it. |
| F12 | **One error mapping**, `toAppError(unknown): AppError { kind, title, message, retryable, retryAfterSeconds?, violations[], requestId?, code?, cause }`, the table in *Error model* below. `InvalidArgument` decodes the protovalidate `buf.validate.Violations` detail into `{ field, message, ruleId }` with the field path joined by dots (map keys and list indexes rendered inline). The request id comes from the echoed `X-Request-Id`. | 09i §5. `PublicError`/`InternalError` (#234) already keep causes off the wire, so `rawMessage` is safe to show. |
| F13 | **Base URL**: `EXPO_PUBLIC_API_URL` wins; else web = same origin (E9); else a native dev build derives `http://<expo-dev-host>:8090` from `expo-constants` `hostUri` (the docker stack on the machine running Metro); else fail loudly (a production native build must set the variable). **Wire format**: JSON in dev (`__DEV__`), binary in production. **Credentials**: connect-web v2 dropped the `credentials` option, so a `fetch` override sets `credentials: "include"` on every request — the web refresh cookie flows cross-origin in dev (3a.0 CORS) and same-origin in prod; native has no cookie jar in play because `return_refresh_token` suppresses the cookie. | E3/E9. |
| F14 | **Design stub**: `src/design/tokens.ts` (light + dark colour roles, spacing, radii, a five-step type scale) + `useTheme()` (`ThemeProvider` optional override, defaults to `useColorScheme`) + six primitives: `Box`, `Text`, `Button`, `Field`, `ListRow`, `Badge`. `StyleSheet` only; no library. D0 replaces the values, not the shape. | E10. 3a.3 builds on the primitives; the tokens file is the contract D0 will fill. |

## Module map (what the slice leaves behind)

```
packages/interface/
  app/
    _layout.tsx               # composes the runtime once; Theme › Api › Session providers › <Stack/>
    index.tsx                 # APP_NAME + the session state (Connecting… / Signed in as … / Signed out / Can't reach the server + Retry)
  src/
    config/env.ts             # apiBaseUrl(), useBinaryFormat (F13)
    api/
      tokens.ts               # AccessTokenCache (F2)
      refresh.ts              # createRefresher: single-flight + classifyRefreshError (F4)
      transport.ts            # createAuthInterceptor (F3) + createConnectTransportFactory (F13)
      client.ts               # createImsClient(transport)
      errors.ts               # toAppError, isAppError, AppError (F12)
      query.ts                # createAppQueryClient (F10)
      persist.ts              # createAppPersister + the protobuf-safe serializer (F11)
      providers.tsx           # ApiProvider (TransportProvider + PersistQueryClientProvider + AppState focus)
    session/
      types.ts                # RefreshTokenStore, SessionState, Session
      store.ts                # web: no-op store (and the tsc/Jest resolution target) (F9)
      store.native.ts         # expo-secure-store store (F9)
      secureStore.ts          # createSecureRefreshTokenStore(secureStoreLike) — the testable core of store.native.ts
      session.ts              # createSession: bootstrap / signIn / signOut / refreshAuthStatus (F5–F8)
      runtime.ts              # createRuntime({ makeTransport, store, platform }) → { transport, client, tokens, refresher, session }
      provider.tsx            # SessionProvider + useSession()
    lib/
      app.ts                  # APP_NAME (3a.1)
      permissions.ts          # eventAccess(auth, eventId) → AccessForEvent (all-false when absent), isAdmin
    design/
      tokens.ts               # colours (light/dark), spacing, radii, type scale (F14)
      theme.tsx               # ThemeProvider, useTheme
      primitives/{Box,Text,Button,Field,ListRow,Badge}.tsx
    test/
      fakeIms.ts              # createFakeIms(): programmable in-memory ImsService for createRouterTransport
      storage.ts              # in-memory RefreshTokenStore + AsyncStorage
      harness.tsx             # createTestRuntime, renderWithProviders
  __tests__/
    api/transport.test.ts     # Bearer, exemptions, proactive, reactive+retry, single-flight, definitive vs transient
    api/errors.test.ts        # the mapping table, violations, Retry-After, request id
    api/persist.test.ts       # bigint/bytes round-trip through the serializer
    session/session.test.ts   # bootstrap (native/web/unreachable/retry), signIn (both modes, bad creds, throttle), signOut (local-first)
    session/store.test.ts     # size assertion with a fixture JWT; oversized value refused
    lib/permissions.test.ts
    config/env.test.ts
    design/primitives.test.tsx
    index.test.tsx            # the route inside the harness: bootstrap → "Signed in as …"
  .env.example                # EXPO_PUBLIC_API_URL
```

Dependencies added to `packages/interface` (versions verified against the registry
and SDK 57's `bundledNativeModules.json` on 2026-09-09): `@bufbuild/protobuf ^2.14`,
`@connectrpc/connect ^2.2`, `@connectrpc/connect-web ^2.2`,
`@connectrpc/connect-query ^2.3`, `@tanstack/react-query ^5.102`,
`@tanstack/react-query-persist-client ^5.102`,
`@tanstack/query-async-storage-persister ^5.102`,
`@react-native-async-storage/async-storage 2.2.0`, `expo-secure-store ~57.0.3`.

## The interceptor, exactly

```
authInterceptor(next)(req):
  session RPC?  (Login | RefreshToken | Logout by req.method.name)
    Login / RefreshToken: no Bearer.  Logout: Bearer if cached.  No refresh, no retry. → next(req)
  otherwise:
    if tokens.expiringWithin(60 s): await refresher.refresh()      // outcome ignored here (F4)
    attach Bearer if cached
    try   return await next(req)
    catch e: err = ConnectError.from(e)
      if err.code ≠ Unauthenticated or req.stream: throw err
      outcome = await refresher.refresh()                            // single-flight
      if outcome ≠ refreshed: throw err                              // signedOut already handled by the session; failed keeps the session
      re-attach the NEW Bearer; return await next(req)              // exactly once; a second Unauthenticated propagates
```

`refresher.refresh()`:

```
if inflight: return inflight
inflight = (async () => {
  token = await store.load()   (native)  |  undefined (web)
  try   resp = await bare.refreshToken({ refreshToken: token ?? "" })
        tokens.set({ token: resp.token, expiresAt: timestampDate(resp.expiresAt) })
        return { kind: "refreshed" }
  catch e: err = ConnectError.from(e)
        if err.code == Unauthenticated: tokens.clear(); notify signedOut listeners; return { kind: "signedOut", error }
        return { kind: "failed", error }                              // tokens untouched
  finally inflight = undefined
})()
```

## Error model (`toAppError`)

| Connect code | `kind` | Shown as | `retryable` |
|---|---|---|---|
| `Unauthenticated` | `unauthenticated` | never (the session handles it; a login screen maps it to "wrong email or password") | no |
| `PermissionDenied` | `forbidden` | "You can't do that here" | no |
| `NotFound` | `notFound` | an empty state, not an error | no |
| `InvalidArgument` | `invalid` | field-level: `violations[]` from the `buf.validate.Violations` detail; the server message otherwise | no |
| `AlreadyExists` | `conflict` | the server message | no |
| `FailedPrecondition` | `precondition` | the server message (e.g. the last admin) | no |
| `ResourceExhausted` | `throttled` | "Too many attempts — try again in N s" (`retryAfterSeconds` from the `Retry-After` header, default 30) | no — the countdown is the affordance, never an automatic retry |
| `Unavailable`, `DeadlineExceeded`, or a fetch failure (`Unknown`/`Internal` whose cause is a `TypeError`) | `unavailable` | "Can't reach the server" + retry | yes |
| `Canceled` | `canceled` | never (an unmounted query) | no |
| everything else | `unknown` | "Something went wrong" + the request id when the server echoed one | no |

A non-`ConnectError` input (a thrown `Error`, a string) maps to `unknown` with the
`Error` message as the cause.

## Acceptance criteria

- [ ] `useSession()` exposes `{ state, signIn, signOut, retry, refreshAuthStatus }`; the root layout bootstraps once; `app/index.tsx` renders each of the four states.
- [ ] The auth interceptor passes every case in `__tests__/api/transport.test.ts`, run through `createRouterTransport` with **no** server: Bearer attached / not attached per F2; proactive refresh inside 60 s; reactive refresh + exactly one retry; N concurrent `Unauthenticated` calls cause one `RefreshToken`; a definitive `Unauthenticated` from `RefreshToken` flips the session to `signedOut` and wipes the store; a transient failure keeps the token, the store and the session and surfaces the original error.
- [ ] Bootstrap and sign-in/out follow F6–F8 on both platforms (the harness runs the session with `platform: "web"` and `"native"`).
- [ ] The native store refuses a value over 2 048 bytes and a realistic refresh JWT fixture is under it (F9).
- [ ] The persister round-trips a message with a `Timestamp` and a `bytes` field (F11).
- [ ] `toAppError` matches the table above, including violations decoding and `Retry-After`.
- [ ] `eventAccess` returns an all-false `AccessForEvent` for an unknown event (mirrors the server) and the entry otherwise.
- [ ] Six primitives render in light and dark; `tokens.ts` is the only place a colour, spacing or font size literal lives.
- [ ] `EXPO_PUBLIC_API_URL` precedence per F13, with `.env.example` and the README saying so.
- [ ] 09i §9 client protocol green locally and in the `Interface` CI job; the Playwright smoke sees the app name and the "Can't reach the server" state (the export is served with no API behind it, so the bootstrap must fail *transiently*, never sign out).
- [ ] Hand check on the iOS simulator against the docker stack: sign in → kill the app → relaunch → still signed in (the stored refresh token); set `IMS_ACCESS_TOKEN_LIFETIME` short and watch the proactive refresh; sign out wipes the store. Same on Chrome with the cookie. Recorded in *Verification*.

## Out of scope (3a.3 and later)

Screens, routes and redirects (3a.3 adds `(auth)/login`, the events and incidents
routes and the layout that redirects on `signedOut`); connect-query hooks per
domain (`src/features/*` — 3a.3 writes the first ones against the hooks this slice
proves); the stream client (3b.6); blob helpers (E7, 3b.4); push (3b.5); D0 token
values (3a.4); `expo/fetch` on native (needed for streaming, decided with 3b.0's
spike — unary works on the global `fetch`); refresh-token rotation (09i §12 Q1).

## Build notes — what the brief got wrong, and what the code taught

- **`endLocally` had to be single-flight.** A definitive `Unauthenticated` from
  `RefreshToken` reaches the session twice: the refresher notifies its listener
  (synchronously, before answering) *and* bootstrap sees the `signedOut` outcome.
  Two concurrent ends cleared the store twice and notified subscribers three times.
  Now one end runs at a time and bootstrap awaits the one the listener started.
- **`signOut` passes the Bearer explicitly** to `Logout` instead of relying on the
  interceptor reading the cache before the cache is cleared. The interceptor chain
  does start synchronously, so the ordering would have held — but the audit line's
  handle should not depend on a scheduling detail.
- **RNTL 14: `fireEvent` is async too.** Unawaited `fireEvent.press` calls in one test
  left act scopes open and emptied the *next* test's render (see the plan-09 finding).
  Every event in `__tests__` is awaited.
- **A React 19 render error rejects `render`** under RNTL 14 (the orphan-`useTheme`
  test) — but only when no act scope is still open from an earlier unawaited event; the
  first run "resolved to null" for that reason, not because React swallowed the error.
- **`useBinaryFormat` cannot be a function name**: biome's rules-of-hooks treats any
  `use*` as a hook. It is `binaryWireFormat()`.
- **`expo serve` answers a Connect POST with `index.html`**, which connect-web maps to
  `Code.Unknown`, not `Unavailable`. The session lands in `unreachable` either way
  (the transient rule), so the smoke asserts the state — a Retry, no sign-in form, no
  "Connecting…" — rather than the "Can't reach the server" title.
- **The `AsyncStorage` type** the TanStack persister accepts lives in
  `@tanstack/query-persist-client-core`, which is not a direct dependency; a local
  structural `AsyncStorageLike` (`getItem` / `setItem` / `removeItem`) is what
  `createAppPersister` takes and what both the real module and the in-memory test
  storage satisfy.

## Verification

From the repo root (09i §9), 2026-09-09:

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ok (lockfile updated for the nine new packages; the two pre-existing peer warnings — `react-native-worklets`, `@react-native/metro-config` — are unchanged from 3a.1) |
| `pnpm generate` | ok |
| `pnpm -F @ocf-ims/interface typecheck` | ok, 0 errors |
| `pnpm lint` | ok, 50 files, 0 diagnostics |
| `pnpm -F @ocf-ims/interface test` | 9 suites, **68 tests passed** |
| `pnpm -F @ocf-ims/interface export:web` | ok (3 files, 1.7 MB entry) |
| `pnpm -F @ocf-ims/interface e2e` | 1 passed (the bootstrap ends `unreachable`, not signed out) |

Hand checks against the docker stack are recorded under *Findings* as they are done.

## Checklist

- [x] Brief written (this file) before any code
- [x] Dependencies added; lockfile updated
- [x] `src/config`, `src/api`, `src/session`, `src/lib/permissions`, `src/design`, `src/test`
- [x] Root layout + index route
- [x] Tests listed in the module map
- [x] README (`EXPO_PUBLIC_API_URL`, session model), `.env.example`, `CLAUDE.md` client section
- [x] 09k status → Merged (#241) here and in `docs/plans/README.md`; 09i 3a.2 row → this file; README row for 09l
- [x] Plan 09 §7 finding
- [x] §9 protocol green locally
- [ ] PR opened; CI green; Miguel merges
- [ ] Hand check: Chrome against the docker stack (cookie refresh, reload resumes, sign-out clears) —
      **attempted 2026-09-09, blocked by the dev machine, not the client**: (1) the `ocf-ims`
      dev container's first `air` build was OOM-killed compiling the buf plugins
      (`protoc-gen-connect-openapi`: `signal: killed`; the generators run in parallel and
      Docker Desktop had 7.7 GiB); (2) running the server locally against the compose
      MariaDB found the bind-mounted data dir (`.docker/mysql/data-ims/`) corrupt —
      `PERSON` "doesn't exist in engine", `INCIDENT` "marked as crashed" — so the 00024
      migration aborted. Resetting that directory deletes local dev data and is Miguel's
      call. What *was* observed: the Expo web dev server on :8081 with
      `EXPO_PUBLIC_API_URL=http://localhost:8090` and nothing listening rendered the
      `unreachable` state with the "Can't reach the server" title (a real fetch failure
      maps to `unavailable`, unlike the `expo serve` HTML case). Also noted: `.env.example`
      still documents an `IMS_DB_STORE_TYPE="fake"` that the server no longer accepts.
- [ ] Hand check: iOS simulator against the docker stack (SecureStore resume after relaunch, sign-out wipes) — not attempted (same stack)
- **Decision (Miguel, 2026-09-09): the laptop cannot run the full stack; both hand checks
  are deferred to a deployed testing instance.** They stay on this list and on the 3a gate
  (09i §8) rather than blocking the merge; 3a.3's Playwright tracer runs against that
  instance too, once it exists.

## Findings

See plan 09 §7, *3a.2 — Putting a session on connect-es*. In one line each: the refresh
classification is one function and it is the security decision; session RPCs are exempt
from refresh-and-retry; a persisted TanStack cache needs a bigint/bytes-safe serializer
for protobuf-es v2; connect-web v2 lost `credentials` (fetch override); RNTL 14's
`fireEvent` is async; Metro suffixes need a suffix-less file for `tsc`; an HTML answer on
a Connect route is `unknown`, and the session still ends `unreachable`.
