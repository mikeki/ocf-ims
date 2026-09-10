# 09i — The Expo client: master plan (plan 09, Phase 3)

> **Status:** Plan — for review
> **Parent:** [09-proto-connect-platform.md](09-proto-connect-platform.md) §5 (one Expo client) and §6 Phase 3 ("Build the replacement")
> **Follows:** [09h-domain-extraction.md](09h-domain-extraction.md) — Phase 1 is complete: all 60 `ImsService` RPCs are implemented on Connect, REST is reduced to the M8 plain-HTTP exceptions, and the stack review round (#233–#237) is merged or merging.
> **Last updated:** 2026-09-08

## 1. Objective

Build the **replacement client** plan 09 promised — one Expo codebase for iOS,
Android and web — on top of the Connect contract the server now speaks, and do it
in an order that **proves the platform first and grows the product second**:

1. **MVP (slice 3a):** the thinnest end-to-end client that exercises everything
   a real client will depend on — login, token refresh on both cookie and
   body-carried paths, a unary read, a rich nested read, Connect error mapping,
   the generated TypeScript from the workspace package, CI, and the three
   platforms. Its purpose is to **validate Expo against Connect**, not to be
   useful yet.
2. **Field app (3b):** the mobile surface with no incumbent — my incidents, file
   and append, attach a photo, notifications, live updates, native push — shipped
   to TestFlight / Play internal testing. Field numbers freeze here.
3. **Dispatch on web (3c):** the incident and report surfaces the dispatch tent
   lives in, redesigned rather than ported.
4. **Admin and the long tail (3d):** everything the templ UI still does that
   people rely on, so Phase 4 can delete it.

The plan also fixes **who builds what**: design work goes to Claude Design,
foundations and anything security-sensitive go to the architect-tier models,
screen work goes to the builder tier, mechanical work goes to the cheapest model
that can do it (§7). Every slice gets a written brief before a builder touches
it, and every PR is reviewed by a model a tier above the one that wrote it and
then by Miguel.

## 2. Where we stand — what the client can build on

**The contract is done and generated.** `ImsService` (`ocf.ims.service.v1`) has
60 unary RPCs mounted at `/ocf.ims.service.v1.ImsService/<Method>` on the mux
root. protoc-gen-es 2.14 already emits `packages/protocol-buffers/src/**` from
`buf.gen.web.yaml` (gitignored, generated when `pnpm` is on PATH), including
`service_pb.ts` with the `ImsService` descriptor — so `createClient(ImsService,
transport)` from `@connectrpc/connect` v2 works with **no extra codegen**.

| Resource | RPCs |
|---|---|
| Auth & session | `Login`, `RefreshToken` (NSE), `GetAuthStatus` (NSE), `Logout` (3a.0) |
| Own profile | `ChangeOwnPassword`, `UpdateOwnProfile`, `DeleteOwnProfilePicture` |
| Incidents | `ListIncidents` (NSE), `GetIncident` (NSE), `CreateIncident`, `UpdateIncident`, `AttachPersonToIncident`, `DetachPersonFromIncident`, `UpdateIncidentJournalEntry` |
| Reports | `ListReports` (NSE), `GetReport` (NSE), `CreateReport`, `UpdateReport`, `UpdateReportJournalEntry` |
| Events | `ListEvents` (NSE), `CreateEvent`, `UpdateEvent` |
| Areas | `ListAreas` (NSE), `CreateArea`, `UpdateArea`, `ApproveArea`, `MarkAreaDuplicate` |
| Crews | `ListCrews` (NSE), `CreateCrew`, `UpdateCrew`, `DeleteCrew`, `SetCrewMembership`, `ListMyCrews` (NSE), `SetMyCrewMembership` |
| Personnel | `ListPersonnel` (NSE), `CreatePerson`, `UpdatePerson`, `SetPersonPassword`, `SetPersonAdmin`, `SetPersonParticipation`, `RemovePersonFromEvent`, `DeletePersonProfilePicture` |
| Incident types | `ListIncidentTypes` (NSE), `CreateIncidentType`, `UpdateIncidentType`, `ApproveIncidentType`, `SetIncidentTypeHidden`, `ProposeIncidentType` |
| Outcomes | `ListOutcomes` (NSE), `CreateOutcome`, `UpdateOutcome`, `ApproveOutcome`, `SetOutcomeHidden`, `ProposeOutcome` |
| Notifications | `ListNotifications` (NSE), `MarkAllNotificationsRead`, `MarkNotificationRead` |
| Metrics & audit | `GetMetrics` (NSE), `ListActionLogs` (NSE) |
| Web push | `SubscribePush`, `UnsubscribePush` |

(NSE = `idempotency_level = NO_SIDE_EFFECTS`: skipped by the audit log and
GET-able. `ListReports`/`GetReport` were reads that lacked the marker and so
over-logged — marked in 3a.0, [09j](09j-session-contract-cors.md).)

**The plain-HTTP surfaces the client must also speak** (M8, all Bearer-authenticated
except where noted):

| Surface | Route | Client consequence |
|---|---|---|
| Attachment upload | `POST /ims/api/events/{eventName}/incidents/{n}/attachments`, same for reports | multipart with `Authorization: Bearer`; `NewJournalEntry` has no attachment field, so "append with photo" is two calls |
| Attachment download | `GET …/attachments/{attachmentNumber}` | native: image component with headers; web: `fetch` + blob URL (as the templ UI does) |
| Profile picture upload / serve | `POST /ims/api/auth/picture`; `POST` and `GET /ims/api/personnel/{personId}/picture` | same as attachments |
| SSE poke stream | `GET /ims/api/eventsource` — **refresh-cookie auth only** | unusable from native (no `EventSource`, no cookie); replaced by a Connect server-streaming RPC in 3b.0 |
| Readiness / ping | `GET /ims/api/readyz`, `GET /ims/api/ping` (unauthenticated) | connectivity probe |
| Visits | `/ims/api/events/{eventName}/visits…` | **excluded** — subsystem is being retired, never modelled |

**What the server still lacked for a native client** when this plan was written
(each is a server slice in §8, architect-tier; 1–3 landed in 3a.0,
[09j](09j-session-contract-cors.md)):

1. A **body-carried refresh token** — `LoginResponse` sets the refresh token only
   as an HttpOnly cookie and `RefreshTokenRequest` is empty (the auth.proto comment
   already reserves this as the "planned Phase-3a addition"). *Done in 3a.0.*
2. A **`Logout` RPC** — only the server can clear the HttpOnly cookie, and the
   templ `GET /ims/auth/logout` dies in Phase 4. *Done in 3a.0.*
3. **CORS for development** — the Expo dev server runs on a different origin; the
   server sets no `Access-Control-*` headers today. *Done in 3a.0
   (`IMS_CORS_ALLOWED_ORIGINS`).*
4. A **per-subscriber live-update stream** — the SSE stream is cookie-gated and
   broadcast-redacted; native needs a Connect server-streaming RPC (plan 09 M8, the
   1e finding's "deferred to Phase 3").
5. **Native push** — `lib/push` speaks web push (VAPID) only; Expo devices need an
   Expo Push Service sender and a token-registration RPC.

**Toolchain already in the repo:** pnpm 9.9 (`packageManager`), Node 24 (`.nvmrc`),
biome 2.5 for TS lint/format, the pnpm workspace (`packages/*`, "future packages
(the Expo client in Phase 3) join here"), Playwright at the repo root, Docker
compose dev stack with a seeded database, Caddy in front of the prod stack.

**The incumbent, for reference only.** The templ UI is 14.1k lines of TypeScript
across 23 page modules (`ims.ts` alone is 4.4k) plus 4.5k lines of templ. Every
page is a public HTML shell that gates itself client-side after fetching auth
status — so its permission rules are a *reading* of the server's, not the source.
Its single Playwright spec (`playwright/tests/ims.spec.ts`, 7 scenarios) is the
best written description of the behaviours people have come to expect, and the
new E2E suite should cover the analogous flows before the old one retires with
templ in Phase 4. The per-slice "behaviours worth carrying" lists in §8 come
from reading that code; they are acceptance-criteria seeds, never porting
instructions (G3).

## 3. Goals and non-goals

**Goals**

- **G1 — Prove the platform before investing in product.** 3a ends with the same
  screen running on iOS, Android and web against the local docker stack, with
  login, refresh, logout and error mapping proven on each, and CI building the web
  export. Nothing else in the plan starts before that gate.
- **G2 — Mobile-first value early.** 3b ships a usable field app to real testers
  before any dispatch work begins (plan 09 §5 "sequence the replacement
  mobile-first").
- **G3 — A redesign, not a port.** The screens are designed in Claude Design from
  the workflows, not traced from the templ pages. Where a templ behaviour is worth
  keeping it is listed as an acceptance criterion, not copied.
- **G4 — One codebase, three surfaces, one contract.** Expo Router routes are
  shared; platform-specific code is confined to the session store, push, and file
  pickers. The proto contract is the only API the client knows.
- **G5 — Contract feedback flows back.** Every gap the client finds is fixed in
  the proto, never worked around in the client (the 1c rule, now from the other
  side). Findings go to plan 09 §7 — the Expo path is the second half of the
  maybloom "Go path" deliverable.
- **G6 — Enable Phase 4.** 3c writes the "what people rely on" list (plan 09 Q4);
  3d satisfies it; then plan 09 Phase 4 deletes the templ UI.

**Non-goals (explicit, so nobody smuggles them in)**

- **Offline writes.** Plan 09 Q2/Q6: never solved, never blocked a fair. The data
  layer persists its *read* cache so a cold start renders instantly, and that is
  all. A local-store-and-sync design gets its own plan if ever wanted.
- **Visits.** Excluded from the contract; not built.
- **Screen parity with templ.** The retirement threshold is the Q4 list, not
  parity.
- **Porting any `web/typescript` code.** Read it for behaviour; never copy it.
- **Third-party services** (crash reporting, analytics, a hosted auth provider).
  Anything that sends data off-host needs an explicit decision (§12).

## 4. Decisions

| # | Decision | Call | Rationale |
|---|---|---|---|
| E1 | Package | **`packages/interface`** in the pnpm workspace (the name plan 09 3a chose), depending on `@ocf-ims/protocol-buffers` via `workspace:*`. `pnpm generate` (root script) runs the buf web template so a fresh clone can typecheck. | Generated TS is gitignored, so the client's typecheck must run the generator first — the same rule the Go tree lives under. |
| E2 | Runtime | **Expo SDK 57** (released 2026-06-30: React Native 0.86, React 19.2), pinned; New Architecture; **CNG** — `ios/`/`android/` are generated by prebuild and **never committed** (SDK 57 makes prebuild regenerate them by default). Expo Router for navigation. TypeScript strict. One SDK-bump slice per Expo major, never mid-slice. | The current stable; three SDKs a year means the client must budget for upgrades as slices, not surprises. |
| E3 | Transport | `@connectrpc/connect` + `@connectrpc/connect-web` v2 with `createConnectTransport`. Binary format in production, JSON in dev (readable in devtools). One interceptor adds `Authorization: Bearer` from a **synchronous in-memory token cache**; on `Unauthenticated` it runs a **single-flight refresh** and retries the unary call once. Proactive refresh when the access token is within 60 s of `expires_at`. **Sign out only on a definitive `Unauthenticated` from `RefreshToken` itself** — a network failure, `Unavailable` or a 5xx keeps the session (the lesson of #189: a redeploy must not log the fair out). Metro resolves package `exports` by default since SDK 53, so `@bufbuild/protobuf` v2 and connect-es need **no metro config**. | The connect-es React Native example uses exactly this stack; the "unary-only / polyfill" caveats predate SDK 53 (ReadableStream & friends are globals now). |
| E4 | Session | **Bearer everywhere. Refresh: web keeps the HttpOnly cookie; native carries the refresh token in the body and stores it in `expo-secure-store`.** Contract (3a.0): `LoginRequest.return_refresh_token` — when true the response carries `refresh_token` + `refresh_expires_at` and sets **no** cookie; `RefreshTokenRequest.refresh_token` (optional) — body wins, cookie is the fallback; new `Logout` RPC clears the cookie (native just wipes SecureStore). Store **only the refresh token** in SecureStore (2 KB value limit; the HS256 refresh JWT is a few hundred bytes — a test asserts it). No server-side revocation exists today; that stays an accepted residual (plan 90). | The plan-09 3a decision, made explicit. An HttpOnly cookie is strictly safer on web than localStorage; native has no cookie jar worth trusting across `Secure`/`SameSite` and plain-http dev hosts. |
| E5 | Data layer | **TanStack Query v5 + `@connectrpc/connect-query` v2** — typed hooks straight from `service_pb.ts`, keys via `createConnectQueryKey`, invalidation per mutation listed in the slice brief. Read cache persisted (`@tanstack/query-persist-client` over AsyncStorage) for instant cold start. **No write queue** (§3). | The typed-hook layer is generated, so screens never hand-write fetch code; persistence is one provider. |
| E6 | Live updates | **MVP polls** (`refetchInterval` while a list screen is focused; refetch on foreground). **3b.0 adds a Connect server-streaming RPC** (`WatchEvent`, working name) that emits *pokes* (incident/report number changed, or "reload" when the subscriber may not see the incident) filtered **per subscriber** by `mayViewIncident`; the client only invalidates queries on a poke. Consumed via `expo/fetch` streaming on native and fetch streaming on web. The SSE route stays for templ until Phase 4. | Same poke semantics as today, but authenticated by Bearer, usable from native, and finally per-subscriber (closes the 1e residual). Client streaming is not needed anywhere. |
| E7 | Blobs | Attachments and profile pictures stay REST multipart (M8). Upload via `expo-file-system` `uploadAsync` / `FormData` with the Bearer header; download on native via image components with headers, on web via `fetch` → blob URL. The client resolves `eventName` from the `Event` it already holds. | No proto change; the REST routes are Bearer-authenticated already. |
| E8 | Push | **Native: Expo Push Service** (`expo-notifications`). 3b.0 adds `RegisterPushDevice` / `UnregisterPushDevice` (`platform`, `expo_push_token`) beside the web-push pair, stores them in the existing push-subscription table with a `KIND` column (one migration), and an `ExpoPushSender` in `lib/push` posting to `exp.host` (outbound egress from the prod host; no API key required). **Expo web gets no web push in Phase 3** — the bell + live stream is the web channel; revisited only if the Q4 list demands it. | Reuses the notification fan-out; Expo's service hides APNs/FCM plumbing. |
| E9 | Serving on web | **The Expo web export owns `/` on the production host from day one**, served by a small static container (`packages/interface/Dockerfile`: node build stage → `caddy` file server). The front Caddy routes `/ocf.ims.service.v1.ImsService/*` and `/ims/*` to the Go binary and everything else to the static container. **Same origin**, so the refresh cookie flows with `credentials: "include"` and no CORS is needed in production. templ keeps `/ims/app` until Phase 4. **Dev:** Expo dev server (`:8081`) against the docker stack (`:80`) is cross-origin, so 3a.0 adds `IMS_CORS_ALLOWED_ORIGINS` (empty = off) using `connectrpc.com/cors` header lists + `rs/cors` with credentials, applied to the Connect prefix and the blob routes. | Keeps the Go image JS-free (the 0a finding), gives the client its own deploy cadence, and avoids a base-path build of the SPA. |
| E10 | Design | **Claude Design** produces the design system (tokens, type scale, colour, spacing, component set) and the screen prototypes per slice, mobile-first; the handoff bundle lands in `packages/interface/design/` and the component reference is kept in sync with the Claude Design project via `/design-sync`. Implementation maps tokens into `src/design/tokens.ts`; components are **hand-built React Native primitives** styled with `StyleSheet` — no NativeWind/Tamagui. | A small, upgrade-proof styling surface that renders identically on web and native; the tokens file is the contract between design and code. Revisit only if the component count explodes. |
| E11 | Testing | **Jest via `jest-expo` + React Native Testing Library** for hooks/components (the Expo-supported harness — Vitest cannot run RN component tests, which supersedes plan 09 Q5's Vitest assumption), **Playwright** for web E2E against the real server (docker dev stack, seeded users — the repo-root suite is repurposed, not the templ specs), **Maestro** for native E2E from 3b.7 (optional until store submission). | The E2E net must hit the real Go server: the contract is what we are validating. |
| E12 | CI | New `Interface` job in `cicd.yml`: Node 24 + pnpm + Go (for `go tool buf`) → `pnpm generate` → typecheck → biome → jest → `expo export -p web` → Playwright smoke against the compose stack. Hardened-runner allow-list gains `registry.npmjs.org` for that job (already there for Linters). **EAS builds run from a dev machine, never CI** (free plan: 15 iOS + 15 Android builds/month, low priority; `--local` as the fallback). | Every PR proves the client still builds; store builds are rare and manual. |
| E13 | Lint/format | biome (root config) for the whole client; root `biome.json` narrows its `!**/src` exclusion to `!packages/protocol-buffers/src` so the client's `src/` is linted. No eslint/prettier. | One TS linter in the repo. |
| E14 | Field-number freeze | Freezes at the **first build a non-developer installs** (3b.7). From then: `reserved` on every removal, the date recorded in plan 09 Phase 0, `buf breaking --against master` added to CI. | Plan 09: "shipping the Expo app to app stores is that day." |
| E15 | Information architecture | Route groups `(auth)/login`, `(app)/events/[eventId]/{incidents,reports,people,dashboard,…}`, `(app)/admin/*`, `(app)/settings`. **Phone: bottom tabs** (Incidents · Reports · Alerts · Me); **≥ 1024 px: sidebar + split list/detail** (dispatch). Last-used event persisted; first login lands on the newest event (the templ behaviour people expect). Deep links `ocfims://` from notifications. | One route tree, two layouts, decided at the layout component — not per screen. |
| E16 | Delivery | **One PR per slice, targeting `master`, no stacking** (the 1c stacking exception is over); the user merges after CI is green. Server-touching slices run the full Go verification protocol; client slices run §9. Each slice appends a plan-09 §7 finding. | The durable workflow rule. |

## 5. Architecture of `packages/interface`

```
packages/interface/
  app/                      # Expo Router — routes only, no logic
    _layout.tsx             # providers: QueryClient, Transport, Session, Theme
    (auth)/login.tsx
    (app)/_layout.tsx       # tabs (phone) / sidebar (wide) — picks by width
    (app)/events/index.tsx
    (app)/events/[eventId]/incidents/index.tsx
    (app)/events/[eventId]/incidents/[number].tsx
    (app)/events/[eventId]/reports/…
    (app)/events/[eventId]/people/…       # 3c
    (app)/events/[eventId]/dashboard.tsx  # 3c
    (app)/admin/…                         # 3d
    (app)/settings.tsx
  src/
    api/
      transport.ts          # createConnectTransport + auth interceptor (E3)
      client.ts             # createClient(ImsService, transport)
      errors.ts             # ConnectError → { title, message, retryable }
      stream.ts             # WatchEvent consumer → query invalidation (3b)
      blobs.ts              # upload/download helpers for the REST blob routes (E7)
    session/
      store.native.ts       # expo-secure-store
      store.web.ts          # no-op (cookie lives in the browser)
      session.ts            # state machine: unknown → signedOut → signedIn(claims)
    features/<domain>/      # incidents, reports, events, people, notifications, …
      hooks.ts              # connect-query hooks + invalidation rules
      components/           # domain components (IncidentRow, JournalEntry, …)
    design/
      tokens.ts             # generated from the Claude Design handoff (E10)
      primitives/           # Box, Text, Button, Field, Sheet, ListRow, Badge, …
    lib/                    # formatting, permissions helpers (AccessForEvent → booleans)
  design/                   # Claude Design handoff bundles (per slice)
  e2e/                      # Playwright specs (web) — run from repo root
  app.json / eas.json / metro.config.js / jest.config.js / tsconfig.json
```

**Rules that hold across every slice**

- Routes are thin: a route file renders one feature component and reads its
  params. Business logic lives in `src/features/<domain>`.
- No hand-written fetch. Every server call is a connect-query hook or one of the
  three blob helpers.
- Permissions come from `GetAuthStatus` (`admin`, `can_manage_personnel`,
  `event_access[eventId]`) and gate **UI affordances only**; the server stays
  authoritative. Never derive a permission from a role name in the client.
- Privacy: the client never assumes an incident number it cannot read exists
  (NotFound is the normal answer, not an error to surface loudly).
- Errors surface through one mapping (`src/api/errors.ts`): `Unauthenticated` →
  refresh/sign-out (never shown), `PermissionDenied` → "you can't do that here",
  `NotFound` → empty state, `InvalidArgument` → field-level message from the
  protovalidate violation, `ResourceExhausted` → the `Retry-After` countdown
  (login throttle), `Unavailable`/network → retry banner, everything else →
  generic with request id.
- Platform splits use Expo's `.native.ts` / `.web.ts` file suffixes, confined to
  `session/`, push, and file pickers.
- Imports (decided 2026-09-09, 3a.1): `@/…` is the alias for `src/…` (tsconfig
  `paths`, mirrored in `jest.config.js`); generated protos are always deep-imported
  (`@ocf-ims/protocol-buffers/ocf/ims/…/x_pb`); **no barrel files** (`index.ts`
  re-exports) — Metro does not tree-shake, and a barrel over the generated tree
  would drag every message into every bundle.
- Every screen ships its loading, empty and error states from the design handoff.

## 6. Design track (Claude Design)

Design runs **one slice ahead** of implementation and is the first task of each
product slice. Claude Design is a visual workspace that turns prompts and context
into prototypes, inherits the organisation's design system, and packages a handoff
bundle for Claude Code.

| Step | Owner | Output |
|---|---|---|
| D0 — Design system v0 (during 3a) → [09o](09o-design-v0.md) — **done 2026-09-10: "Dispatch", via the in-code picker (route B)** |  An in-code prototype run (09o), reviewed by Miguel | Tokens (colour incl. dark mode, type scale, spacing, radii, elevation), primitives (button, field, list row, badge, sheet, tab bar, toolbar), the state/priority colour language (plan 93 states), brand (icon, splash). A `DESIGN.md` recording the direction in words. |
| D1 — Field flows (for 3b) | Claude Design | Mobile prototypes: sign in, pick event, my incidents, incident detail, new incident, append entry (+ mention, + photo), reports, notifications, settings. Every empty/error/loading state. |
| D2 — Dispatch (for 3c) | Claude Design | Wide-screen prototypes: split list/detail, dense incident table with filters, the full incident editor, report review, roster, dashboard. Keyboard flow noted per screen. |
| D3 — Admin (for 3d) | Claude Design | The shared admin-page pattern (plan 97) redone once and applied to events, people, taxonomies, crews, action logs. |

**Handoff mechanics.** Each design slice ends with (1) the bundle exported into
`packages/interface/design/<slice>/`, (2) the component reference synced with
`/design-sync` so the Claude Design project and the repo agree on the token and
component set, and (3) an architect-tier pass that turns the bundle into the
slice brief's acceptance criteria and the token diff for `src/design/tokens.ts`.
Builders implement from the brief and the bundle, never from the templ UI.
Screenshots from all three platforms go in the PR for Miguel to compare against
the prototype.

## 7. Model roster and assignment rules

| Tier | Model | Owns |
|---|---|---|
| **Design** | Claude Design (claude.ai/design) | Design system, screen prototypes, flows, states, brand assets; the handoff bundle. Iterated in the canvas with Miguel, not in code. |
| **Architect** | Opus 5 (Fable 5.1 for auth/session/privacy review and the slice briefs where available) | Plan and slice briefs; the foundations (transport, session, data layer, stream client, error model); **every server slice** (contract changes, CORS, stream, push); anything touching authn/authz/privacy; code review of every builder PR (`/code-review`); the plan-09 §7 findings; the Q4 "what people rely on" list with Miguel. |
| **Builder** | Sonnet 5 | Screen and feature slices implemented against a fixed brief (acceptance criteria, hooks to use, invalidation rules, design bundle, files to touch); their Jest and Playwright specs; Storybook-free component previews (a `/dev` route in dev builds). |
| **Mechanic** | Haiku 4.5 | CI/Docker/compose/Caddy wiring, `app.json`/`eas.json`, biome/tsconfig, dependency bumps, lint fixes, rename sweeps, inventories and searches, changelog and README chores. |

**Rules**

1. **A brief precedes a builder.** The architect writes the slice brief (in the
   slice's plan file) before a builder starts: goal, acceptance criteria, screens
   with design refs, the hooks and invalidations, the files to create/modify,
   out-of-scope, and the verification steps. A builder that finds the brief
   wrong stops and reports rather than improvising.
2. **Contract gaps stop the builder.** If a screen needs a field or RPC the
   contract lacks, the builder files it in the slice notes and continues with
   what exists; the architect fixes the proto in a server slice. Clients never
   work around the contract.
3. **Security-sensitive code is architect-only.** Transport auth, session
   storage, refresh, logout, permission gating helpers, privacy handling,
   anything in `lib/push` or `internal/auth` on the server.
4. **Review climbs a tier.** Builder PR → architect `/code-review` → Miguel.
   Architect PR → Fable/second Opus review → Miguel. Mechanic PR → architect
   skim → Miguel.
5. **How this runs in Claude Code.** An architect session (this one, or a fresh
   Opus session pointed at the slice file) writes the brief in plan mode and
   lands the foundation code itself. Builder work runs as a fresh Sonnet
   session per slice — or as `Agent` calls with `model: sonnet` from the
   architect session for slices under ~500 lines — with the brief as the whole
   prompt. Mechanic tasks run as `Agent` calls with `model: haiku`. Parallel
   builder slices only where §10 marks them independent; Miguel opts into a
   multi-agent `Workflow` explicitly when a phase has three or more independent
   builder slices ready.

## 8. Phases, slices and tasks

Each slice gets its own plan file as work begins (`09j-…`, `09k-…`, continuing
plan 09's letters) holding the brief, the checklist and the findings. Sizes are
PR sizes, not calendar.

### 3a — MVP: validate Expo against Connect

**Goal.** One tracer path — sign in → pick event → incident list → incident
detail → sign out — on iOS simulator, Android emulator and Chrome, against the
local docker stack, with CI building the web export. Nothing product-shaped.

| Task | Owner | Deliverable | Depends on |
|---|---|---|---|
| **3a.0 Server: session contract + dev CORS** → [09j](09j-session-contract-cors.md) | Architect | `LoginRequest.return_refresh_token`, `LoginResponse.refresh_token/refresh_expires_at` (cookie suppressed when set), `RefreshTokenRequest.refresh_token` (body wins, cookie fallback), `Logout` RPC (clears cookie; audited), `ListReports`/`GetReport` marked NSE, `IMS_CORS_ALLOWED_ORIGINS` (connect cors + rs/cors, credentials, Connect prefix + blob routes), tests for every branch, `.env.example`, `docs/plans/09e` mapping table rows. Full Go verification protocol. | — |
| **3a.1 Scaffold** → [09k](09k-interface-scaffold.md) | Mechanic (Architect signs off the layout) | `packages/interface` from `create-expo-app` (blank TS + Router), workspace wiring, `pnpm generate`, scripts (`typecheck`, `lint`, `test`, `export:web`, `e2e`), biome fix (E13), `.gitignore` (`.expo/`, `dist/`, `ios/`, `android/`), `README.md`, the `Interface` CI job with the egress allow-list, `CLAUDE.md` section (commands, "run from the repo root", "generate first"). | — |
| **3a.2 Foundations** → [09l](09l-client-foundations.md) | Architect | `src/api/transport.ts` (E3 interceptor, single-flight refresh, proactive refresh), `src/session/*` (E4; web cookie / native SecureStore; size assertion), session state machine bootstrapping from `GetAuthStatus`, connect-query provider + persister (E5), `src/api/errors.ts`, env config (`EXPO_PUBLIC_API_URL`, dev JSON vs prod binary), `src/design/tokens.ts` stub + 6 primitives, Jest harness with a fake transport (`createRouterTransport`) so hooks test without a server. | 3a.0, 3a.1 |
| **Staging instance** → [09m](09m-staging-instance.md) | Architect | `docker-compose.staging.yml` (the production image following master, the demo seed, the client knobs), `deploy/.env.staging.example`, `deploy/staging-pull.sh`, the Caddy block, the runbook section; **step 2:** the web export image built in CI, a `web` service, the Caddy path split (E9) — required for web checks, since the refresh cookie is `SameSite=Strict`. | 3a.2 |
| **3a.3 Tracer screens** → [09n](09n-tracer-screens.md) | Builder | Login (email/password, show/hide, throttle countdown on `ResourceExhausted`, **forced password change** when `using_default_password`, web-only `?o=` return path restricted to in-app routes), Events list (pick + persist; default = newest event: highest numeric name, else highest id), Incidents list (read-only rows: number, state, priority, summary, area, last modified; private badge; pull-to-refresh; polling), Incident detail (read-only: header, location, types, people, journal incl. system-entries toggle, attachments listed not previewed), Sign out. Loading/empty/error states. Jest for hooks; the environment-gated Playwright tracer `login → events → incidents → detail → sign out` against the staging instance. | 3a.2, 09m, D0 tokens |
| **3a.4 Design system v0 applied** → [09o](09o-design-v0.md) | D0 picker → Builder | **Built 2026-09-10.** D0 ("Dispatch") + `DESIGN.md` landed as #250; the re-skin followed: `tones` on the tokens, the six primitives (the ledger `ListRow`, tinted-chip `Badge`, press feedback on `Button` / `ListRow` / the header's back, a focus ring on `Field`), the seven screens, dark mode, generated brand assets, a 42-pair contrast table. Motion is `src/design/motion.tsx` on Reanimated CSS transitions. `/review-animations` ran 2026-09-10 → **Block** on the reduced-motion screen transition (promised in 09o, never written) plus two bare pressable `Text`s; fixed by `useScreenAnimation()` and a seventh primitive, `TextButton`. Hosted tracer green on 180ba55. **Open:** the iOS / Android screenshots (no Xcode here — 3a gate device row). | D0, 3a.3 |

**Gate (all must hold):** the tracer runs on all three platforms against the
staging instance ([09m](09m-staging-instance.md); the docker dev stack where a
machine can run it) with the seeded users; refresh proven on web (cookie, on the
hosted web build — same origin) and native (body) by shortening
`IMS_ACCESS_TOKEN_LIFETIME`; logout clears the cookie on web and SecureStore on
native; a private incident the user may not view is absent from the list and 404s
in detail; `Interface` CI job green including Playwright smoke; `expo export -p
web` output served by the static web container on staging (09m step 2); a plan-09
§7 finding written ("what it took to put an Expo client on connect-go").

**Gate status, 2026-09-10.** Everything a laptop can prove is proven; what is left
needs hardware this machine does not have.

| Gate row | State |
|---|---|
| Tracer on **web** against staging | ✅ Green on 180ba55 — 2 passed / 1 skipped, the hosted (same-origin) mode, so the cookie reload-resume is included |
| Tracer on **iOS / Android** | ⛔ **Blocked here.** `xcrun simctl` does not exist on this machine (Command Line Tools only, no Xcode), and the Android emulator is not started by the standing no-local-stacks rule. Needs a device session |
| Refresh — **native** (body) | ✅ `Login{return_refresh_token:true}` answers a body token and sets **no** cookie; `RefreshToken{refresh_token}` returns a fresh access token |
| Refresh — **web** (cookie) | ✅ `Login` with no flag sets `refresh_token` `HttpOnly; Secure; SameSite=Strict` and does **not** leak it into the body; `RefreshToken` with an empty body and the cookie returns a fresh access token |
| The **proactive** refresh watched in devtools | ⛔ Needs `IMS_ACCESS_TOKEN_LIFETIME=90` on the staging host — **Miguel's**, it is an env change on his server. The mechanism is proven above; what is unwatched is the client firing it 60 s early |
| Logout clears the **cookie** (web) | ✅ `Logout` answers `refresh_token=; Max-Age=0; HttpOnly; Secure`, and a refresh with the cleared jar is `401 unauthenticated` |
| Logout clears **SecureStore** (native) | ⛔ Device row |
| **Private incident** absent from the list, 404 in detail | ✅ Proven against staging: an admin created a private incident (#203, event 1); a *writer* on the same event who is neither creator nor grantee sees 202 of 203 in `ListIncidents`, and `GetIncident` **and** `UpdateIncident` both answer `{"code":"not_found","message":"incident not found"}` — existence leaks through neither the read nor the write path. The client renders it "Not found", never "private" |
| `Interface` CI green incl. Playwright smoke | ✅ |
| `expo export -p web` served by the static container | ✅ 09m step 2 |
| Plan-09 §7 finding written | ✅ Two — "what a design system costs on Expo" (3a.4) and "what it took to put an Expo client on connect-go" (this gate) |

So the gate is **held open by one thing: a device session** (the iOS / Android tracer
runs, their screenshots, and native SecureStore sign-out), plus Miguel's one-line
staging env change for the proactive-refresh watch. Nothing in the code is known to
be missing.

### 3b — The field app (mobile-first)

**Goal.** A person at the fair can, from their phone: see their incidents, file an
incident or report, append an entry with a mention and a photo, get notified,
and see changes arrive live. Shipped to TestFlight and Play internal testing.
**Field numbers freeze at 3b.7.**

| Task | Owner | Deliverable | Depends on |
|---|---|---|---|
| **3b.0 Server: live stream + native push** → [09p](09p-stream-and-push.md) | Architect | `WatchEvent(WatchEventRequest{event_id}) returns (stream EventPoke)` — per-subscriber privacy filter (`mayViewIncident`), heartbeat every 25 s, cancellation on client close, `event_access` re-check on each poke, tests through the generated client; `RegisterPushDevice`/`UnregisterPushDevice` + `KIND` migration + `ExpoPushSender` (receipts checked, invalid tokens pruned) wired into the existing notification fan-out; `IMS_EXPO_PUSH_ENABLED`. Findings on connect-go streaming. **Brief written 2026-09-10** — and it found a prerequisite: the interceptor spine is unary-only (`connect.UnaryInterceptorFunc` pass-through), so a streaming RPC would run with no auth, recovery, request id or logging. **3b.0a landed that fix on 2026-09-10** (the five interceptors are real `connect.Interceptor`s now, unary and streaming sharing one body each); it was taken ahead of the 3a gate because it adds no RPC, is provable in Go tests alone, and closes a latent hole in code that already ships. **3b.0b landed the stream on 2026-09-10** — `WatchEvent`, per-subscriber filtering that retires the SSE redaction residual for stream subscribers, proven through the generated client over real HTTP. **3b.0c (native push) remains, and 3b.0b's two-client privacy check on staging is still owed.** | 3a gate (3b.0a/3b.0b excepted — done) |
| **3b.1 My work** | Builder | "Mine" filter over `ListIncidents` (created by me, attached, or mentioned — client-side; a server filter is a noted follow-up) and `ListReports`; incident/report rows with unread-change markers. | D1 |
| **3b.2 File and append** | Builder | New incident (summary, priority, types with "Other" → `ProposeIncidentType`, area picker over `ListAreas`, location description/booth, first entry), append entry with `@mention` picker over `ListPersonnel`, on-behalf-of, `viewer_may_add_journal` gating; optimistic list updates; invalidations per brief. | 3b.1 |
| **3b.3 Reports** | Builder | File a report, append, link to an incident, `may_edit_summary`/`may_add_journal_entry` gating. | 3b.2 |
| **3b.4 Photos** | Builder (Architect reviews) | Camera/library via `expo-image-picker`, upload via `src/api/blobs.ts` with progress and retry, preview via headers on native / blob URL on web, `attach_files` permission gating. | 3b.2 |
| **3b.5 Notifications + push** | Builder (Architect owns the token/permission flow) | Alerts tab: list, unread badge, mark one/all read, tap → deep link; push permission prompt on first alert-worthy action (not on launch), token registration/unregistration on sign in/out, foreground handling. | 3b.0 |
| **3b.6 Live updates** | Architect (client stream) + Builder (wiring) | `src/api/stream.ts` consuming `WatchEvent` via `expo/fetch`; reconnect with backoff and a full refetch after any gap (the templ client's `last_sse_id` check, done with a resume cursor on the stream); pause in background, resume + refetch on foreground; poll fallback when the stream is unavailable. Web: one stream per tab to start; the templ single-tab `navigator.locks` leader + `BroadcastChannel` fan-out is the known optimisation if tab counts hurt. | 3b.0 |
| **3b.7 Store readiness** | Mechanic (Builder for assets) | `app.json` (bundle ids, scheme, icons/splash from D0, permissions strings), `eas.json` (development / preview / production), TestFlight + Play internal testing, privacy manifest, `buf breaking` in CI, plan-09 Phase 0 freeze note with the date, Maestro smoke (optional). | 3b.1–3b.6 |

**Behaviours worth carrying (acceptance-criteria seeds for the D1 brief):**

- **Journal drafts survive** — the templ composer debounces the draft to local
  storage per event/incident, restores it with a note, and migrates a `new`
  draft onto the assigned number. On a phone with fair connectivity this is the
  cheapest real answer to "I lost what I typed"; it is the one concession to
  offline (§3) and belongs in 3b.2.
- **Mentions** are typed as `@` at a word start, scoped to the event's people,
  and only mentions still present in the text at submit are sent.
- **"Other" incident type** is a type-your-own trigger pinned last; unmatched
  text offers "propose it"; an unmatched area offers "create it for this
  event". Hidden outcomes stay selectable when already in use.
- **Attachment upload creates the incident first** when it does not exist yet;
  photos are **downscaled client-side before upload** (the templ profile-picture
  path already does this) — bandwidth at the fair is the constraint, not the
  50 MiB cap.
- **Reports:** a reporter's "on behalf of" choice is sticky across entries and
  clearing it reverts to themselves; the report page offers "create an incident
  from this report"; first-time reporters get the instructions opened for them.
- **Notifications:** unread badge caps at 99+, refetches on open and on every
  live poke with a 120 s poll fallback; tapping marks read *then* navigates.
- **Session:** refresh failures other than a definitive 401 keep the session
  (E3).

**Gate:** ≥ 2 non-developers complete "file → append with photo → get
notified on another device → see the change live" on both platforms from a
store-distributed build; the stream survives airplane mode and a 10-minute
background; push arrives on iOS and Android; field numbers frozen and recorded.

### 3c — Dispatch on web (and tablets)

**Goal.** The dispatch tent can run the fair on the Expo web build. This is the
hardest UI in the system and the reason the client is a redesign.

| Task | Owner | Deliverable | Depends on |
|---|---|---|---|
| **3c.0 Dispatch design (D2)** | Claude Design → Architect brief | Split list/detail, dense table, filters, editor, keyboard flow, state/priority language. | 3b gate |
| **3c.1 Incident table** | Builder | Columns (number, state, priority, types, area, summary, created, last modified, attached people), sort, search, filters (state/priority/type/area/person, "mine"), filter state in the URL, live via stream, keyboard navigation, row → detail in the split pane. | 3c.0 |
| **3c.2 Incident editor** | Builder (Architect reviews) | Every `IncidentUpdate` field: state, priority, types (multi + propose), area, outcome (`ListOutcomes`, propose), summary, location, people (attach/detach, involvement, grant access, `has_event_access`), linked incidents, linked reports (`Int32List` clear-vs-unchanged semantics), private toggle (admin/creator only), entries with on-behalf-of and mentions, strike entry, changes-history/stricken/attached-reports toggles, attachments upload/preview. Concurrent-edit handling: refetch on poke, never overwrite. | 3c.1 |
| **3c.3 Reports** | Builder | Report table + editor, link to incident, crew-leader review reads. | 3c.2 |
| **3c.4 Roster** | Builder | Per-event people (`ListPersonnel` with `event_id`), participation ladder, crews column, profile card gated by role (email/phone admin-only), invite reporters where `invite_reporters`. | 3c.1 |
| **3c.5 Dashboard** | Builder | `GetMetrics` — counts by state/priority/category/type/role/area, by day, open follow-ups, avg time to close; chart library chosen in the brief (must render on web and native). | 3c.1 |
| **3c.6 "What people rely on"** | Architect with Miguel | The plan-09 Q4 list: the templ behaviours that must exist before it can go, written as acceptance criteria against 3c/3d slices. | 3c.1–3c.5 |

**Behaviours worth carrying (seeds for the D2 brief):**

- **Table:** state filter defaults to *open* (user preference overrides, URL
  overrides both), days-back filter, incident-type filter with `(blank)` and
  `(other)` pseudo-entries, rows per page; **all filter and search state lives
  in the URL** so a view is shareable; priority displays as a label but sorts
  numerically; the started column is the default sort, descending.
- **Search:** 250 ms debounce, `/regex/` syntax, Enter on a bare integer jumps
  to that IMS number, a multi-event search that re-runs the query across every
  other event, and search text enriched with the attached reports' journal
  text.
- **Keyboard:** `?` help, `/` focus search, `n` new incident, `m` multi-search;
  on the incident: `a` focus the composer, `h` toggle system entries; Enter vs
  Ctrl/⌘+Enter submit is a persisted preference; shortcuts are suppressed while
  an input has focus. Dispatch works from the keyboard.
- **Live rows:** a poke patches only the affected row without losing the page
  or the selection; a "reload" poke refetches the whole table.
- **Editor:** Mark Closed / Reopen as first-class actions; started time with a
  timezone label; the privacy checkbox's *disabled* state is authoritative
  (admin or creator only); people rows carry an involvement preset list and
  the per-incident **grant access** checkbox; quick-add a person inline; merged
  journal (incident + attached reports) with the three independent toggles
  (attached-report entries, changes history, stricken); system entries are
  rendered enriched (bold values, humanised area slugs, linkified IMS numbers);
  attachments preview in-app for image / PDF / text / video; print produces a
  clean PDF with the incident number as the title.
- **Roster:** grouped by the participation ladder with counts; role rungs a
  viewer may set are capped by the viewer's own (admin vs inviter); add person
  is search-first → enrol existing or create; password is the configured shared
  default or an explicit one; a "My crews" panel for crew leaders.
- **Dashboard:** an auto-refresh interval preference; charts update in place
  and changed cards glow; per-area table and open follow-ups; average time to
  close.
- **Theme:** light / dark / auto, applied before first paint; print forces
  light.

**Gate:** one tabletop exercise run entirely on the Expo web build by dispatch
volunteers; every 3c.6 item is either satisfied or assigned to a 3d slice.

### 3d — Admin and the long tail

**Goal.** Nothing people rely on remains only in templ; Phase 4a can start.

| Task | Owner | Deliverable | Depends on |
|---|---|---|---|
| **3d.0 Admin design (D3)** | Claude Design → Architect brief | The shared admin-page pattern (plan 97) once. | 3c gate |
| **3d.1 Events & people** | Builder | Events (create/update, groups, `include_groups`), People & Passwords (create/update, set password, admin toggle with last-admin refusal message, participation, remove from event, profile picture upload/delete). | 3d.0 |
| **3d.2 Taxonomies & crews** | Builder | Incident types, outcomes, areas (create/update/approve/hide/duplicate/propose queues), crews (create/update/delete/membership, self-membership). | 3d.0 |
| **3d.3 Audit & debug** | Builder | Action logs (bounded `ListActionLogs` with time window), build info / runtime metrics / GC over the REST debug routes. | 3d.0 |
| **3d.4 Settings & profile** | Builder | Change password, update profile, picture, theme, notification/push preferences per device. | 3b.5 |
| **3d.5 Web push on Expo web** | Architect | Only if on the 3c.6 list. | 3c.6 |

**Behaviours worth carrying (seeds for the D3 brief):** the two People
doorways (event-pinned vs global with an event picker incl. "no event") collapse
into one screen with an event selector; event names validated client-side with
the same pattern the server enforces; areas show their parent hierarchy and sort
order with approve / mark-duplicate / add-with-parent flows; action logs default
to the last 24 h at 100 rows with user and path filters; the settings screen
holds the default incident-state and rows-per-page preferences and the per-device
push toggle.

**Gate:** the 3c.6 list is fully satisfied; plan 09 Phase 4a is unblocked and its
plan file is opened.

### 3e — Hardening and handoff

| Task | Owner | Deliverable |
|---|---|---|
| Accessibility pass (labels, contrast, dynamic type, focus order on web) | Builder | Fixes + a checklist in the client README |
| Performance pass (list virtualization, image sizing, bundle size, cold start) | Architect | Numbers recorded in the slice file |
| Docs | Mechanic | `packages/interface/README.md`, `CLAUDE.md` section, deploy runbook update (static container, Caddy routes), findings consolidated in plan 09 §7 |
| Upstream | Architect | The maybloom findings PR for the Expo/Connect path |

## 9. Verification protocol

**Client PRs** (run from the repo root unless noted; CI runs the same):

```bash
pnpm install --frozen-lockfile
pnpm generate                                   # buf web template → packages/protocol-buffers/src
pnpm -F @ocf-ims/interface typecheck            # tsc --noEmit
pnpm lint                                       # biome, whole workspace
pnpm -F @ocf-ims/interface test                 # jest-expo
pnpm -F @ocf-ims/interface export:web           # expo export -p web → dist/
docker compose -f docker-compose.dev.yml up -d  # seeded server for E2E
pnpm -F @ocf-ims/interface e2e                  # playwright, web
```

Foundation slices (3a.2, 3b.6) and any slice touching `session/` also attach
screenshots or a short recording from the iOS simulator and the Android
emulator; the PR checklist says which platforms were exercised by hand.

**Server PRs** keep the Phase-1 protocol unchanged, all from `go/`: generate →
build → vet → `gofmt -l` → golangci-lint v2.12.2 (0 issues) → full `go test ./...`
on real MariaDB → `go tool buf lint ../proto` → `go mod tidy` (no diff); plus
`buf breaking --against` master once E14 is in force.

## 10. Sequencing

```
3a.0 (server) ──┐
3a.1 (scaffold) ─┴─▶ 3a.2 (foundations) ─▶ 3a.3 (tracer) ─▶ 3a.4 (design v0) ══ 3a GATE
        D0 (design system) ────────────────────────────────▲

3b.0 (server: stream + push) ─────────────┬──▶ 3b.5 ─┐
D1 ─▶ 3b.1 ─▶ 3b.2 ─▶ 3b.3 ┬─▶ 3b.4 ──────┤          ├─▶ 3b.7 ══ 3b GATE (freeze)
                            └──────────────┴──▶ 3b.6 ─┘

D2/3c.0 ─▶ 3c.1 ─▶ 3c.2 ─▶ 3c.3
                 ├─▶ 3c.4          ─▶ 3c.6 ══ 3c GATE
                 └─▶ 3c.5

D3/3d.0 ─▶ 3d.1 ∥ 3d.2 ∥ 3d.3 ∥ 3d.4 ─▶ (3d.5) ══ 3d GATE ─▶ plan 09 Phase 4a
```

Independent builder slices (∥) may run in parallel sessions; everything else is
serial on purpose — each product slice inherits the hooks and components the
previous one settled. Design runs one slice ahead throughout.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Streaming on React Native misbehaves (backgrounding, proxies buffering, Android OkHttp) | 3b.0 starts with a spike: a 10-minute stream through Caddy on a real device, foreground/background, before the RPC is finalised. Poll fallback is permanent (E6). |
| Apple review for an internal ops app | Distribute via TestFlight (external testers) for the first fair; evaluate Unlisted App Distribution / Apple Business Manager custom apps in 3b.7. Play: closed testing track. |
| EAS free quota (15 + 15 builds/month) | Builds are manual and batched; `eas build --local` and `npx expo run:*` as fallbacks. |
| SecureStore 2 KB value limit | Only the refresh JWT is stored; a Jest test asserts its size against a fixture token. |
| Design drift between the Claude Design HTML and the RN implementation | Tokens are the contract; three-platform screenshots in every PR; `/design-sync` keeps the reference honest. |
| Expo's three-SDKs-a-year cadence | One upgrade slice per major, mechanic-tier, gated on the full §9 protocol; never mid-slice. |
| Same-origin assumption on web | Production is same-origin by construction (E9); dev uses the CORS allow-list. Any future CDN/subdomain split must revisit E4. |
| Scope creep into offline sync | Non-goal in §3; the read-cache persister is the only concession. |
| The Q4 list grows during 3c | It is written once, with Miguel, and changes go through the plan file. |

## 12. Open questions

1. **Refresh rotation / sliding sessions on native.** Today a refresh mints only an
   access token; the 7-day refresh token expires hard. Fine for one fair week; a
   sliding window (rotate on use) is a small 3a.0 extension if wanted.
2. **Distribution channel.** Public App Store / Play listing, unlisted, or
   TestFlight-only for the first fair (§11).
3. **Chart library** for the dashboard — decided in the 3c.5 brief; must render on
   web and native.
4. **Web push on Expo web** — only if the 3c.6 list demands it (E8).
5. **Error monitoring.** Nothing ships data off-host without a decision; the
   default is the request id shown in the generic error and the server's slog.
6. **Server-side "mine" filter** on `ListIncidents` / `ListReports` if the
   client-side filter proves slow on real data.
7. **templ retirement timing** — plan 09 Phase 4 decides once 3d's gate holds.

## 13. Exit criteria

- [ ] **3a:** tracer on iOS, Android and web; cookie and body refresh proven;
      `Logout`; dev CORS; `Interface` CI job green with Playwright smoke; §7
      finding written.
- [ ] **3b:** store-distributed builds on both platforms; live stream and native
      push in production; field numbers frozen (date recorded in plan 09).
- [ ] **3c:** a tabletop exercise run on the web build; the "what people rely on"
      list written.
- [ ] **3d:** that list satisfied; Phase 4a opened.
- [ ] **Continuous:** every slice has a plan file with its brief and checklist,
      a plan-09 §7 finding, and was built by the tier §7 assigns.
