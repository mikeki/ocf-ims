# `@ocf-ims/interface` — the OCF IMS Expo client

One Expo codebase for iOS, Android and web, built on the Connect contract the Go
server speaks (`ImsService`, `ocf.ims.service.v1`). The master plan is
[docs/plans/09i-expo-client.md](../../docs/plans/09i-expo-client.md); this scaffold
is slice 3a.1, [09k](../../docs/plans/09k-interface-scaffold.md). Expo SDK 57
(React Native 0.86, React 19.2), Expo Router, TypeScript 6 strict. The generated
proto types come from the workspace package `@ocf-ims/protocol-buffers`
(`import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb"`).

## Run everything from the repo root

The client lives in the repo-root pnpm workspace, and the TypeScript it imports from
`@ocf-ims/protocol-buffers` is **generated, not committed** — generate before anything
compiles. This is the verification protocol (09i §9); the `Interface` CI job runs the
same list:

```bash
pnpm install --frozen-lockfile
pnpm generate                          # buf web template → packages/protocol-buffers/src (needs Go)
pnpm -F @ocf-ims/interface typecheck   # tsc --noEmit
pnpm lint                              # biome, the whole workspace (client included)
pnpm -F @ocf-ims/interface test        # jest-expo + React Native Testing Library
pnpm -F @ocf-ims/interface export:web  # expo export -p web → packages/interface/dist
pnpm -F @ocf-ims/interface e2e         # Playwright (Chromium) against the export, served by `expo serve`
```

First time only: `pnpm -F @ocf-ims/interface exec playwright install chromium`.

## Development

```bash
pnpm -F @ocf-ims/interface start       # Metro dev server on :8081 — then i / a / w for iOS / Android / web
pnpm -F @ocf-ims/interface web         # straight to the browser
```

Against the docker dev stack (server on `http://localhost:8090`) the Expo dev server
is a different origin, so start the stack with the CORS allow-list from 3a.0:

```bash
IMS_CORS_ALLOWED_ORIGINS=http://localhost:8081 docker compose -f docker-compose.dev.yml up
```

Against the **staging instance** — the deployed testing server, plan
[09m](../../docs/plans/09m-staging-instance.md), whose `.env` lists the laptop's
`http://localhost:8081` and `:8082` in `IMS_CORS_ALLOWED_ORIGINS`:

```bash
EXPO_PUBLIC_API_URL=https://ims-staging.example.org pnpm -F @ocf-ims/interface start
```

Sign in as a seeded demo user (`miguel@example.com` / `Miguel`). The iOS / Android
build proves the whole session there (body-carried refresh token). A browser on
`localhost` is cross-site to staging and the refresh cookie is `SameSite=Strict`, so
web from Metro proves sign-in and reads only — refresh and reload-resume are checked
on the hosted web build at `https://<staging host>/` (same origin, 09m step 2).

Where the server is comes from `EXPO_PUBLIC_API_URL` (see `.env.example`); when it
is unset, web uses the page's own origin and a native dev build derives
`http://<the machine running Metro>:8090` from the Expo dev server, so the simulator
against the docker stack needs nothing configured. A production native build must
set it. The wire format is JSON in development (readable in devtools and the server
log) and binary in production.

## How the client talks to the server (slice 3a.2, [09l](../../docs/plans/09l-client-foundations.md))

- **Transport** (`src/api/transport.ts`): connect-web with one interceptor that adds
  `Authorization: Bearer` from an in-memory token cache, refreshes the access token
  60 s before it expires, and on an `Unauthenticated` answer refreshes once
  (single-flight) and retries the call once. `RefreshToken` itself goes through a
  bare transport. **Only an `Unauthenticated` from `RefreshToken` ends the session**
  — a server that cannot be reached keeps it (the templ client's #189 lesson).
- **Session** (`src/session/`): `unknown → unreachable | signedOut | signedIn`,
  read with `useSession()`. Web keeps the refresh token in the HttpOnly cookie the
  server sets; native asks `Login` for it in the body and keeps only that token in
  `expo-secure-store` (`store.native.ts`; `store.ts` is the web no-op). Sign-out is
  local-first and never fails; `Logout` is told best-effort.
- **Data** (`src/api/query.ts`, `persist.ts`, `providers.tsx`): TanStack Query v5 +
  connect-query hooks (`useQuery(ImsService.method.x, input)`), the read cache
  persisted to AsyncStorage with a serializer that survives protobuf `bigint` and
  `bytes` values; sign-out clears both caches.
- **Errors** (`src/api/errors.ts`): every failure a screen sees is a `toAppError`
  result — `kind`, title, message, `retryable`, protovalidate `violations` per
  field, the `Retry-After` seconds, the request id.
- **Design** (`src/design/`): `tokens.ts` is the contract with the design system
  (D0 replaces its values); `useTheme()`; six primitives (`Box`, `Text`, `Button`,
  `Field`, `ListRow`, `Badge`) styled with `StyleSheet` only.
- **Tests** (`src/test/`): `createTestRuntime()` builds the real runtime over
  `createRouterTransport` and a programmable fake `ImsService`
  (`createFakeIms()`), so hooks and the session are tested with no server;
  `renderWithProviders()` mounts the same providers the root layout does.
  React Native Testing Library 14 is async: `await render(...)` **and**
  `await fireEvent.*(...)` — an unawaited event leaves an act scope open and
  breaks the next render.

## Layout and rules (09i §5)

- `app/` holds routes only (Expo Router); logic lives in `src/`. Security-sensitive
  code — `src/api/transport.ts`, `refresh.ts`, `src/session/*`, `src/lib/permissions.ts`
  — is architect-tier (09i §7 rule 3).
- Imports: `@/x` is `src/x` (tsconfig `paths`, mirrored in `jest.config.js`);
  generated protos are deep-imported
  (`@ocf-ims/protocol-buffers/ocf/ims/…/x_pb`); no barrel files.
- `ios/` and `android/` are generated by prebuild (continuous native generation) and
  never committed — same for `.expo/`, `dist/` and `expo-env.d.ts`.
- Every `.ts` / `.tsx` file starts with `// SPDX-License-Identifier: Apache-2.0`
  (the repo's `prepend-license` hook stamps and enforces it).
- No hand-written fetch: the proto contract is the only API the client knows.
