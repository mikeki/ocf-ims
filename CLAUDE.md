# CLAUDE.md

Guidance for Claude Code in this repository: the commands, and the rules a change
must honour. The reference material (layers, data model, config, auth, audit log)
is in `docs/architecture.md`; the platform plan is `docs/plans/09-proto-connect-platform.md`
and the client plan `docs/plans/09i-expo-client.md`.

## Project Overview

OCF IMS is an Incident Management System for the Oregon Country Fair, tracking
incidents at the Fair. A Go codebase forked from the Black Rock Rangers' Ranger IMS.
The proto/Connect contract (`proto/`) is the API; the Expo client
(`packages/interface`) is replacing the templ web UI, which runs frozen alongside it.

## Where things live

- **The Go module is `go/`** — run every Go command from there (`go build`, `go test`,
  `go run bin/…`, `make`, `go tool …`, `golangci-lint`).
- The proto contract, the buf configs and the pnpm/TypeScript tier are at the
  **repo root**; buf runs from `go/` pointed at `../proto`. Playwright and
  `docker compose` also run from the repo root.
- **Generated code is not committed.** sqlc → `go/store/imsdb/`, templ →
  `go/web/template/*_templ.go`, tsgo → `go/web/static/*.js`, buf Go + OpenAPI →
  `go/gen/`, buf TypeScript → `packages/protocol-buffers/src/`. After a fresh clone
  nothing compiles until `go run bin/build/build.go -generate-only` (from `go/`).

## Commands

From `go/`:

```bash
go run bin/fetchbuilddeps/fetchbuilddeps.go   # first-time build deps
go run bin/build/build.go                     # generate + compile → ./ocf-ims  (make build)
go run bin/build/build.go -generate-only      # generators only
./ocf-ims serve                               # needs a .env (copy .env.example)
make run/live                                 # air, live reload
go test ./...                                 # make test; make cover for HTML coverage
go test ./store/integration ./api/integration # real MariaDB via testcontainers (Docker)
go test ./path/to/package -run TestName
go get -t -u ./... && go mod tidy             # make upgrade-deps
```

Individual generators (from `go/`): `go tool sqlc generate`, `go tool templ generate`,
`go tool tsgo`, `go tool buf generate --template ../buf.gen.yaml ../proto`.

From the repo root: `docker compose -f docker-compose.dev.yml up` (dev stack, seeded),
`cd playwright && npx playwright test` (templ UI browser tests).

### Expo client (`packages/interface`)

Expo SDK 57 + Expo Router, TypeScript strict, a package in the repo-root pnpm
workspace. **Run from the repo root, generate first** (it imports the git-ignored
proto TypeScript from `@ocf-ims/protocol-buffers`):

```bash
pnpm install --frozen-lockfile
pnpm generate                          # buf web template (needs Go)
pnpm -F @ocf-ims/interface typecheck
pnpm lint                              # biome, whole workspace
pnpm -F @ocf-ims/interface test        # jest-expo
pnpm -F @ocf-ims/interface export:web  # → packages/interface/dist
pnpm -F @ocf-ims/interface e2e         # Playwright smoke against the export
pnpm -F @ocf-ims/interface start       # Metro on :8081
```

The `Interface` CI job runs that list; it includes only the environment-free smoke.
The tracer (`e2e/tracer.spec.ts`) walks sign-in → events → incidents → incident →
report → photo → live → alerts → sign-out against the staging instance and runs only
with `E2E_EMAIL`/`E2E_PASSWORD` set (plus `E2E_BASE_URL` for the hosted, same-origin
mode, the only one where the `SameSite=Strict` refresh cookie works). **Hand checks
run against the staging instance** (`docs/deployment.md`, "Staging instance";
`EXPO_PUBLIC_API_URL=https://<staging host>`), never a local stack. Staging follows
master about ten minutes behind CI. After changing an `EXPO_PUBLIC_*` value pass
`--clear` to `start` / `export:web` (Metro caches it). `ios/`, `android/`, `.expo/`,
`dist/` and `expo-env.d.ts` are generated and never committed. See
`packages/interface/README.md`.

Client rules: `@/x` is `src/x`; generated protos are deep-imported
(`@ocf-ims/protocol-buffers/ocf/ims/…/x_pb`); **no barrel files**. Jest runs the real
runtime over `createRouterTransport` + `createFakeIms()` (`src/test/`); RNTL 14 is
async — `await render(...)` **and** `await fireEvent.*(...)`. The session and transport
files (`src/api/transport.ts`, `src/session/*`, `src/api/blobs.ts`, `src/api/stream.ts`,
`src/push/*`) are architect-tier (09i §7 rule 3): no subagents edit them.

**Design.** `src/design/tokens.ts` is the only file that may hold a colour, spacing,
font-size or duration literal; everything else reads them through `useTheme()`. The
direction, the state/priority colour language and the motion budget (press feedback
only: a 0.97 press-in scale over 120 ms, nothing enters with an animation on a list,
reduced motion honoured) are in `packages/interface/DESIGN.md` — **read it before
changing a token or adding an animation.** The whole motion budget is
`src/design/motion.tsx` (Reanimated CSS transitions, no worklets). Anything pressable
gets press feedback (`TextButton` for a pressable word, never `onPress` on a `Text`).
`border` is decorative and below 3:1; `borderStrong` is the perceivable boundary.
Brand assets come from `node scripts/brand-assets.mjs`; don't hand-edit the PNGs.

**UI skills (one per job, never all at once):** building or changing motion →
`animate-expo`; before a UI PR closes → `review-animations`; a design round with
variants → `prototype`; the taste and philosophy doc `emil-design-eng` only when
writing a design brief or judging a direction.

## Session hygiene (keep the context small)

One session per slice. At the end of a slice update the memory status note, then the
maintainer merges and starts a fresh session (`/clear`); compaction is for mid-slice
overflow only, since it carries every invoked skill and the summary forward. To orient,
grep a plan row (`grep -n '3c.1' docs/plans/09i-expo-client.md`) rather than reading
the section, and list only the branches that matter (`git branch --list 'feat/09*'`).

## Rules a change must honour

- **License header.** Every hand-written `.go`, `.templ`, `.ts`, `.tsx` starts with
  `// SPDX-License-Identifier: Apache-2.0`; the `prepend-license` pre-commit hook
  stamps new files and skips generated ones. Copyright is the repo-root `COPYRIGHT`.
- **Migrations are goose, append-only, one DDL change each, schema-only.** Scaffold with
  `go run github.com/pressly/goose/v3/cmd/goose@v3.27.1 -dir store/schema/migrations -s create <description> sql`
  from `go/`, then `go tool sqlc generate`, then `go test ./store/integration`.
  Details: `docs/architecture.md` § Database Migrations.
- **Private incidents.** Any endpoint that surfaces incident content must go through
  `mayViewIncident` / `requireIncidentVisible` (`internal/incident/`); an unauthorized
  read or write answers **404**, never 403. Event-wide read is not sufficient.
- **Admin status.** Only an actual admin (`claims.PersonAdmin()`) may toggle it; the
  endpoint refuses to clear the last admin. Never gate it on a delegatable global.
- **Action log.** A new mutating REST endpoint registers `LogRequest(true, …)` in
  `api/mux.go`; it fails closed (unlogged) if forgotten. Connect RPCs are logged by
  the interceptor.
- **Dev users** live in `store/fakeimsdb/seed.sql` (argon2id via `./ocf-ims hash_password`);
  `IMS_CORS_ALLOWED_ORIGINS` is the dev-only cross-origin allow-list, unset in prod.
- **JS lint** is `npx eslint` for the templ TypeScript (tsgo is the real gate) and biome
  for the workspace.
