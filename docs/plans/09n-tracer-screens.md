# 09n — Tracer screens: login, events, incidents, incident, sign out (slice 3a.3)

> **Status:** ✅ Merged (#246, 2026-09-10). Run against staging the same day (§ *Verification*): the hosted flow is green through the reload-resume; the two things it caught — back after a deep link, the interim mode's export cache — are fixed in the follow-up PR, with a second tracer test.
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, slice 3a.3) under
> [09-proto-connect-platform.md](09-proto-connect-platform.md) (Phase 3)
> **Follows:** [09l](09l-client-foundations.md) (3a.2, merged as #242) and
> [09m](09m-staging-instance.md) (the staging instance, merged as #244) — master is the
> base, no stacking (09i E16)
> **Owner:** Architect writes this brief and the one security-adjacent helper (the login
> return-path guard, T3); a **Sonnet builder** implements the rest from this file in two
> runs (§ *Build plan*); the architect reviews (`/code-review`), then Miguel (09i §7 rule 4).
> **Last updated:** 2026-09-09

## Objective

The first screens a person can use: sign in, see the events they can read, land on the
current fair's incidents, open one incident and read its journal, sign out. **Read-only on
purpose** — the slice proves that the foundations (transport, session, query cache, error
model, primitives) carry a real product flow end to end on iOS, Android and web, and it
leaves behind the hooks and components 3b builds on. Nothing here is the final design
(3a.4 restyles it from D0) or the final navigation (3b.1 redoes the flows from D1).

What "done" looks like: a fresh device → sign in → the current fair's incidents → switch
event → open an incident → its journal → sign out; on the hosted web build a reload
resumes the session; a wrong password, a throttled login, a default password, an
unreadable event, a missing (or private) incident and a server that is down each show
the right state — and every one of those states is a Jest test that runs with no server.

## Decisions (T1–T12)

| # | Decision | Why |
|---|---|---|
| T1 | **Two route groups, gated by their layouts.** `app/(auth)/` holds `login`; `app/(app)/` holds everything signed-in. Each group's `_layout.tsx` switches on `useSession().state`: `unknown` → `Splash`; `unreachable` → `Unreachable` (Retry → `retry()`); `(app)` + `signedOut` → `<Redirect href={loginHref(...)}>`; `(auth)` + `signedIn` → `<Redirect href={safeReturnPath(o) ?? "/"}>`. **The login screen never navigates**: the state flip re-renders the layout. | 09l F5 / 09i §5: four states, the router decides layouts from them. A layout-level gate cannot be bypassed by a URL, and one place holds the rule. |
| T2 | **The forced password change is a gate, not a route.** While `state.auth.usingDefaultPassword` is true the `(app)` layout renders `ChangePasswordScreen` *instead of* its `<Stack>`. Success → `ChangeOwnPassword` then `await refreshAuthStatus()`; the flag flips and the stack mounts at whatever URL was requested. The screen also offers Sign out. | Mirrors the templ's non-dismissable modal (`ims.ts`, `showChangeDefaultPasswordModal`) without a route that could be navigated around. |
| T3 | **The login return path (`?o=`) is web-only and in-app-only.** `safeReturnPath(o)` accepts only a string that starts with `/events` and matches `^[A-Za-z0-9_\-/]+$` (no scheme, no `//`, no query, no dot); anything else → `undefined` → `/`. The `(app)` layout writes it from `usePathname()` only when `Platform.OS === "web"`; the `(auth)` layout reads it with `useGlobalSearchParams()`. Native never writes it (a cold-start deep link is not resumed in this slice). **Architect-written** (`src/lib/returnPath.ts` + its test) — an open-redirect guard is security code (09i §7 rule 3). | The templ rule ported (`web/typescript/login.ts`: `internalDest` + `looksSafe`, code-scanning #4/#6), narrowed to the client's own routes. |
| T4 | **The default event = the remembered one, else the newest.** `app/(app)/index.tsx` loads `ListEvents` and redirects to `/events/<id>/incidents` for the remembered event id (AsyncStorage key `ocf-ims/selectedEventId`) when it is in the list, else the newest event; with no events it goes to `/events` (the list shows its empty state). `newestEvent()` = the highest *numeric* name, else the highest id. Opening an event from the list remembers it. The remembered id is **not** cleared on sign-out. | "What people rely on": login lands on the current fair (templ `activeEventDestination`, #80). Ids do not track years — a later-seeded older year has a higher id — hence name-first (`ims.ts` `newestEvent`). A device at the fair keeps its event across sign-outs; nothing sensitive is stored. |
| T5 | **Headers are ours; the events list is the stack's anchor.** The `(app)` group's `<Stack>` runs with `headerShown: false` and every screen renders `ScreenHeader({ title, back? })` — a themed row with an optional back button labelled with the parent screen's name ("Events" on the incidents screen, "Incidents" on the detail). Back = `router.dismissTo(<parent href>)`: it pops to the parent when the parent is in the stack and replaces the current screen with it when it is not. (The first cut was `router.back()` when `router.canGoBack()`, else `replace` — which after a deep link or a reload pops to whatever is beneath, and that is the anchor, not the parent; the hosted tracer caught it, § *Build notes*.) `(app)/_layout.tsx` exports `unstable_settings = { anchor: "events/index" }` so a screen reached by redirect or deep link has the events list beneath it. | One header on all three platforms, fully covered by Jest and reachable by the tracer (`getByRole("button", { name: "Events" })`); no react-navigation header quirks on web. The anchor keeps the native back gesture sane. 3b.1 replaces all of it with tabs/sidebar from D1. |
| T6 | **Hooks per domain, screens as components, routes thin.** `src/features/events/hooks.ts`, `src/features/incidents/hooks.ts`; every screen is a component under `src/features/<domain>/` that takes its ids and navigation callbacks as props (`onOpenEvent`, `onOpenIncident`, `onBack`); the `app/` route file reads params (`useLocalSearchParams`), parses them, and wires `router`. | 09i §5. Screens test under `renderWithProviders` with `jest.fn()` callbacks — no router in Jest. The layouts and route files stay thin and untested; the tracer covers them. |
| T7 | **Reads are plain connect-query `useQuery` calls** with the 09l defaults, plus: the incidents list polls (`refetchInterval: 30_000`) and pulls to refresh (`RefreshControl`); the detail pulls to refresh. `ListIncidentTypes` and `ListAreas` are lookups that **never block a screen** — a failed or absent lookup falls back (type → `Type #<id>`, area → the slug). `ListAreas` is asked only when `useEventAccess(eventId).readAreas` — a `GetAuthStatus{ event_id }` query with a 5-minute `staleTime`. | E6 (poll until the stream, 3b.6). The 09i permissions rule: `event_access` gates affordances; asking once per event is cheaper than catching a `PermissionDenied` per screen, and 3b needs the same hook for `writeIncidents`. |
| T8 | **Errors render through `toAppError`, one component.** `ErrorState({ error, onRetry? })` shows `title` + `message` and a Retry button when `error.retryable && onRetry`; on the detail, `notFound` is the **empty state** ("There's no incident #N here.", never "private"); on the list, `forbidden` is a plain message with no Retry. | 09i §5 privacy rule: the client never distinguishes "private" from "missing". |
| T9 | **Login behaviour.** Email + password fields, one Show/Hide toggle, submit on Enter (`onSubmitEditing`); the button is disabled while either field is empty and `loading` while the sign-in runs; the email is trimmed. `unauthenticated` → "Wrong email or password." under the password; `throttled` → "Too many attempts. Try again in N s." counting down from `retryAfterSeconds`, the button disabled until 0; anything else → the AppError's message, the button enabled. | 09l F7: the screen renders the error, it does not classify it. The fake's throttled `Login` carries `Retry-After: 7`. |
| T10 | **Labels come from `src/lib/format.ts`.** State: OPEN → "Open" (`info`), CLOSED → "Closed" (`neutral`). Priority: HIGH → "High" (`danger`), LOW → "Low" (`neutral`), NORMAL and UNSPECIFIED → **no badge**. Timestamps: `timestampDate()` + `toLocaleString()`. People: handle, else name, else `Person #<id>`. | The demo seed stores priorities 2 and 4, which the server maps to `UNSPECIFIED` (`incidentPriorityToProto`); a row must not crash or print "undefined" on them. The state/priority colour language proper is D0's. |
| T11 | **The Playwright tracer is environment-gated** (09m S7). `e2e/tracer.spec.ts` skips unless `E2E_EMAIL` and `E2E_PASSWORD` are set. `E2E_BASE_URL`, when set, is the page origin (the hosted build on staging, 09m step 2) and the config starts no local server; unset, the local export is served on :8082 as today. The existing smoke skips when `E2E_EMAIL` is set (its "nothing answers the RPCs" premise is false against a server). The reload-resume assertions run only with `E2E_BASE_URL` (same origin — the `SameSite=Strict` cookie, 09m S5). CI sets none of them and keeps the smoke. | CI never depends on the home server. One spec serves the interim mode — a local export built with `EXPO_PUBLIC_API_URL=https://<staging>`, sign-in and reads only — and the real one against the hosted build. |
| T12 | **The fake `ImsService` grows the five RPCs** the screens call — `ListIncidents`, `GetIncident`, `ListAreas`, `ListIncidentTypes`, `ChangeOwnPassword` — with programmable data (`fake.events`, `fake.incidents`, `fake.areas`, `fake.incidentTypes`) and failure modes, plus `usingDefaultPassword` on the fake user (flipped false by a successful `ChangeOwnPassword`). `src/test/fixtures.ts` builds messages with `create(...)`. | 09l's harness stays the only way screens are tested: the real runtime, no server, no mocks of our own modules. |

## Screens

### Login — `/login` (`app/(auth)/login.tsx` → `LoginScreen`)

- Title "OCF IMS" (`APP_NAME`), a caption "Sign in with your email and password".
- `Field` "Email" — `autoCapitalize="none"`, `autoCorrect={false}`, `keyboardType="email-address"`,
  `textContentType="username"`, `autoComplete="email"`, `autoFocus` on web only.
- `PasswordField` "Password" — a `Field` with `secureTextEntry` unless shown, `textContentType="password"`,
  `onSubmitEditing` submits, plus a text-button "Show password" / "Hide password"
  (`accessibilityRole="button"`; the same component serves the change-password screen).
- `Button` "Sign in" — `disabled` while email or password is empty or a countdown is running,
  `loading` while `signIn()` is in flight. Errors per T9. The countdown is
  `useCountdown(seconds)` (`src/lib/useCountdown.ts`: 1 s `setInterval`, cleared at 0 and on unmount).
- After a successful `signIn()` the component does nothing; the `(auth)` layout redirects (T1/T3).

### Forced password change (the gate, T2) — `ChangePasswordScreen`

- Heading "Set your own password"; body "You're signed in with the shared default password.
  Choose a new one before continuing."
- `PasswordField` "New password" and `PasswordField` "Confirm password" (one shared show/hide state).
- Client checks before the RPC: at least `MIN_PASSWORD_LENGTH = 8` characters (mirrors
  `go/internal/person/password.go`) → "Use at least 8 characters."; mismatch → "The passwords don't match."
- `Button` "Save password" → `useMutation(ImsService.method.changeOwnPassword)` with `{ password }`;
  success → `await refreshAuthStatus()` (the gate lifts by itself); `invalid` → the first violation's
  message (or the AppError message) under "New password"; anything else → an `ErrorState` under the form.
- A secondary `Button` "Sign out".

### Index — `/` (`app/(app)/index.tsx`)

- T4. `useEvents()` + `useSelectedEvent()`; loading → `LoadingState`; error → `ErrorState`
  with Retry (`refetch`); loaded → `<Redirect href={…}>`.

### Events — `/events` (`app/(app)/events/index.tsx` → `EventsScreen`)

- `ScreenHeader` "Events" (no back).
- Rows (`ListRow`, `testID="event-row-<id>"`): title = the event name (fallback `Event <id>`),
  ordered newest first (`sortEventsNewestFirst`: numeric names descending, then the rest by id
  descending). The newest carries `Badge "Current"` (`info`); the remembered one, when different,
  `Badge "Last opened"` (`neutral`). Press → `select(id)` then `onOpenEvent(id)`.
- Footer: `Text` "Signed in as <handle>" and a secondary `Button` "Sign out" → `signOut()`.
- Empty: `EmptyState` "No events yet" / "You don't have access to any event. Ask a crew leader or an admin."
- Error: `ErrorState` with Retry. Loading: `LoadingState`.

### Incidents — `/events/[eventId]/incidents` (`…/incidents/index.tsx` → `IncidentsScreen`)

- `ScreenHeader` titled with the event name (from the `useEvents()` cache; fallback `Event <id>`),
  back "Events".
- `FlatList` of `IncidentRow` (`ListRow`, `testID="incident-row-<number>"`): title
  `#<number> <summary>` (summary fallback "(no summary)"); subtitle
  `<area name | area slug | location description | "No location"> · <last modified>`; `right` =
  the state badge, the priority badge (T10, none for NORMAL/UNSPECIFIED), `Badge "Private"`
  (`warning`) when `private`. Sorted by number descending. Press → `onOpenIncident(number)`.
- Pull to refresh (`RefreshControl`, `refreshing = isRefetching && !isLoading`); polling (T7).
- Empty: `EmptyState` "No incidents yet" / "Nothing has been reported in this event."
  `forbidden`: `EmptyState` "No access" / "You don't have access to this event's incidents."
  (no Retry). Other errors: `ErrorState` with Retry. Loading: `LoadingState`.
- Area names: `useAreas(eventId, access.readAreas)`; `areaName(areas, slug)` → the name, else the slug.

### Incident — `/events/[eventId]/incidents/[number]` (`…/[number].tsx` → `IncidentScreen`)

- `ScreenHeader` `#<number>`, back "Incidents". `ScrollView` with pull to refresh.
- Header block: `#N` (title variant), the badges (state, priority, Private), the summary
  (heading variant; "(no summary)" when empty); captions "Started <ts>", "Created <ts> by <person>",
  "Last modified <ts>", and "Closed <ts>" when set.
- **Location**: area (name when readable, else slug), description, booth — "No location" when all empty.
- **Types**: `useIncidentTypes()` → names (`typeName(types, id)`, fallback `Type #<id>`), joined by ", "; "None".
- **People**: one line each — `personLabel(person)` + involvement (muted); "No one attached".
- **Linked incidents**: `#n` rows, press → `onOpenIncident(n)` (same event); **Reports**: "Report #n"
  plain text (the report screens are 3b) — each section omitted when empty.
- **Journal**: `JournalEntryRow` per entry, `created` ascending. Author + timestamp (caption); text
  (body); `systemEntry` → muted; `stricken` → `textDecorationLine: "line-through"` + muted;
  `attachment` → a caption "Attachment <id>" (listed, not previewed, not downloadable — E7 is 3b.4);
  `onBehalfOf` → "on behalf of <person>". A `Switch` "Show system entries" (default off,
  `accessibilityLabel="Show system entries"`). Empty journal: "No entries yet."
- `notFound` → `EmptyState` "Not found" / "There's no incident #N here." with a "Back to incidents"
  action (`onBack`). Other errors → `ErrorState` with Retry. Loading: `LoadingState`.

### Shell (`src/features/shell/`)

`Splash` ("Connecting…"), `Unreachable({ error, onRetry })` (title, message, Retry),
`LoadingState` (`ActivityIndicator`, `accessibilityLabel="Loading"`), `EmptyState({ title, message?,
action?: { label, onPress } })`, `ErrorState({ error, onRetry? })`, `ScreenHeader({ title, back?: { label,
onPress }, right?: ReactNode })`. All built from the six primitives; no new primitives.

## Hooks and helpers

```ts
// src/features/events/hooks.ts
useEvents()                        // useQuery(ImsService.method.listEvents, {})
useEventAccess(eventId)            // useQuery(ImsService.method.getAuthStatus, { eventId }, { staleTime: 5 * 60_000 })
                                   //   → eventAccess(data, eventId)  (from @/lib/permissions; all-false while loading)
useSelectedEvent()                 // { eventId?: number; loaded: boolean; select(id: number): Promise<void> }
// src/features/events/selected.ts   — AsyncStorage key "ocf-ims/selectedEventId"; load/save take an AsyncStorageLike
// src/features/events/newest.ts
newestEvent(events: Event[]): Event | undefined
sortEventsNewestFirst(events: Event[]): Event[]
defaultEvent(events: Event[], rememberedId: number | undefined): Event | undefined

// src/features/incidents/hooks.ts
useIncidents(eventId)              // listIncidents { eventId, excludeSystemEntries: true }, refetchInterval: 30_000
useIncident(eventId, number)       // getIncident { eventId, incidentNumber: number }
useAreas(eventId, enabled)         // listAreas { eventId }, enabled
useIncidentTypes()                 // listIncidentTypes {}
// src/features/incidents/lookups.ts
areaName(areas: Area[] | undefined, slug: string | undefined): string | undefined
typeName(types: IncidentType[] | undefined, id: number): string
sortIncidentsNewestFirst(views: IncidentView[]): IncidentView[]

// src/lib/format.ts
formatTimestamp(ts: Timestamp | undefined): string          // "" when unset
stateLabel(state: IncidentState): { label: string; tone: BadgeTone } | undefined
priorityLabel(priority: IncidentPriority): { label: string; tone: BadgeTone } | undefined
personLabel(ref: PersonRef | undefined): string
// src/lib/useCountdown.ts
useCountdown(seconds: number | undefined): number             // 0 when undefined
// src/lib/returnPath.ts  (architect — already in the tree)
safeReturnPath(o: unknown): string | undefined
loginHref(pathname: string | undefined, platform: string): string
```

Facts the builder needs (verified against the installed packages):

- **protobuf-es v2**: messages are plain objects; build them with `create(XSchema, init)`
  (`import { create } from "@bufbuild/protobuf"`); `Timestamp` → `timestampDate(ts)` from
  `@bufbuild/protobuf/wkt`; `optional` proto fields are `T | undefined`; enums are numeric
  (`IncidentState.OPEN`, `IncidentPriority.HIGH`); `GetAuthStatusResponse.eventAccess` is a
  `Record<number, AccessForEvent>`. Deep imports only:
  `@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb`, `…/journal_entry_pb`,
  `…/event_pb`, `…/area_pb`, `…/incident_type_pb`, `…/common/v1/person_ref_pb`,
  `…/service/rpc/v1/{auth,event,incident,area,incident_type,profile}_pb`,
  `…/service/v1/service_pb` (`ImsService`).
- **connect-query 2.3**: `useQuery(ImsService.method.listEvents, input, { enabled, refetchInterval,
  staleTime })`; `useMutation(ImsService.method.changeOwnPassword)` → `mutateAsync({ password })`;
  `skipToken` disables a query; a result's `error` is a `ConnectError` → `toAppError(error)`;
  `refetch()` for Retry and pull-to-refresh. The transport comes from `ApiProvider`.
- **Session**: `useSession()` → `{ state, signIn, signOut, retry, refreshAuthStatus }`; `state.auth`
  is the `GetAuthStatusResponse` (`user` = handle, `admin`, `usingDefaultPassword`, `eventAccess` —
  **empty at bootstrap**, hence `useEventAccess`).
- **Expo Router 57**: `Redirect`, `Stack`, `useRouter`, `useLocalSearchParams`, `useGlobalSearchParams`,
  `usePathname` from `expo-router`; `unstable_settings.anchor` is honoured; params are strings —
  parse with `Number.parseInt` and treat NaN / ≤ 0 as not found. `<Stack screenOptions={{ headerShown:
  false }}>` in `(app)/_layout.tsx`; the root layout's `<Stack>` stays as it is.
- **RNTL 14 is async**: `await render(...)`, `await fireEvent.*(...)`, `await screen.findBy…`.
  `jest.useFakeTimers()` for the countdown test (advance with `act`).
- **AsyncStorage in Jest**: add `jest.setup.ts` with
  `jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"))`
  and register it in `jest.config.js` `setupFiles`.
- **Web `testID`** becomes `data-testid` under react-native-web; Playwright's `getByTestId` reads it.
- Every new `.ts`/`.tsx` file starts with `// SPDX-License-Identifier: Apache-2.0`. `@/` is `src/`.
  No barrel files. No colour, spacing or font-size literal outside `src/design/` (line-through is a
  text decoration, not a token — fine). biome formats (2-space) and lints the workspace.

## Files

Create:

```
app/(auth)/_layout.tsx                   app/(app)/_layout.tsx
app/(auth)/login.tsx                     app/(app)/index.tsx
                                         app/(app)/events/index.tsx
                                         app/(app)/events/[eventId]/incidents/index.tsx
                                         app/(app)/events/[eventId]/incidents/[number].tsx
src/features/shell/{Splash,Unreachable,LoadingState,EmptyState,ErrorState,ScreenHeader}.tsx
src/features/auth/{LoginScreen,ChangePasswordScreen,PasswordField}.tsx
src/features/events/{hooks.ts,newest.ts,selected.ts,EventsScreen.tsx}
src/features/incidents/{hooks.ts,lookups.ts,IncidentRow.tsx,IncidentsScreen.tsx,IncidentScreen.tsx,JournalEntryRow.tsx}
src/lib/{format.ts,useCountdown.ts}      (returnPath.ts exists — architect)
src/test/fixtures.ts                     jest.setup.ts                e2e/tracer.spec.ts
__tests__/features/auth/{LoginScreen,ChangePasswordScreen}.test.tsx
__tests__/features/events/{newest.test.ts,EventsScreen.test.tsx}
__tests__/features/incidents/{IncidentsScreen,IncidentScreen}.test.tsx
__tests__/lib/{format,useCountdown}.test.ts   (returnPath.test.ts exists — architect)
```

Modify: `src/test/fakeIms.ts` (T12 — keep every existing test green); `jest.config.js`
(`setupFiles`); `playwright.config.ts` and `e2e/smoke.spec.ts` (T11); `app/_layout.tsx` (comment
only — the providers and the root `<Stack>` stay); `packages/interface/README.md` (the screens,
the tracer's variables and the two modes); `CLAUDE.md` Expo section (one sentence: the tracer
variables); `docs/plans/09i-expo-client.md` (3a.3 row → this file); `docs/plans/README.md` (a
09n row; 09m → "✅ Merged (#244); host bring-up + step 2 pending"); `docs/plans/09m` checklist
("PR opened; CI green; Miguel merges" → ticked).

Delete: `app/index.tsx`, `__tests__/index.test.tsx` (the stand-in panel and its test — the
login screen and the layouts replace them).

**Do not touch:** `src/api/*`, `src/session/*`, `src/lib/permissions.ts`,
`src/lib/returnPath.ts`, `src/design/tokens.ts`, `.github/workflows/*`. The six primitives may
gain a *prop* only if a screen cannot be built without it — say so in *Build notes*. No new
dependencies.

## Acceptance criteria

- [ ] Cold start signed out → `/login`; sign in → `/` → the default event's incidents (T4); "Events"
      → the list; pick another event → its incidents (and it is remembered); open a row → the
      detail; "Incidents" → the list; "Events" → the list; "Sign out" → `/login`.
- [ ] Web: `/events/1/incidents/3` while signed out → `/login?o=/events/1/incidents/3` → sign in →
      back at the incident. `?o=https://evil.example`, `?o=//evil`, `?o=/events/../x`,
      `?o=/login` → `/`.
- [ ] Wrong password → "Wrong email or password."; throttled → the countdown from `Retry-After`,
      the button disabled until 0, then enabled again; server down → the message and the button
      still enabled.
- [ ] `usingDefaultPassword` → the change screen replaces the app until `ChangeOwnPassword`
      succeeds and `refreshAuthStatus()` clears the flag; too short / mismatch are caught before the
      RPC; a server `invalid` shows under the field.
- [ ] Events: newest first; "Current" on the newest; "Last opened" on the remembered one; the empty
      state for a person with no events; sign out from the footer.
- [ ] Incidents: rows show number, summary, area name (slug when areas are not readable), last
      modified, the state / priority / Private badges; number-descending; empty, forbidden and error
      states; pull to refresh refetches; the query polls every 30 s (assert the option, not the clock).
- [ ] Detail: every section; system entries hidden by default and shown by the switch; stricken
      entries struck through; attachments listed; linked incidents navigate; `notFound` → the empty
      state with "Back to incidents".
- [ ] `newestEvent`: `[2025, 2026, TestBRC]` → 2026; a higher id never beats a numeric name; all
      non-numeric → the highest id; empty → `undefined`. `defaultEvent` prefers a remembered id that
      is in the list and ignores one that is not.
- [ ] `stateLabel`/`priorityLabel` per T10, including `UNSPECIFIED` → `undefined`.
- [ ] Jest: every screen state above runs through `renderWithProviders` against the fake;
      `pnpm -F @ocf-ims/interface test` green, no `act` warnings.
- [ ] 09i §9 green locally (the smoke still passes with no server behind the export: the `(app)`
      layout shows `Unreachable` with Retry and no "Sign in"); the CI `Interface` job green.
- [ ] `e2e/tracer.spec.ts` exists, skips without `E2E_EMAIL`/`E2E_PASSWORD`, and is recorded here
      as **not yet run** until the staging host exists.

## The tracer (`e2e/tracer.spec.ts`)

```ts
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const hosted = Boolean(process.env.E2E_BASE_URL); // same origin: the cookie survives a reload
test.skip(!email || !password, "set E2E_EMAIL and E2E_PASSWORD (and E2E_BASE_URL for the hosted build) to run the tracer against a server");

test("login → events → incidents → incident → sign out", async ({ page }) => {
  await page.goto("/");                                   // signed out → /login
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/events\/\d+\/incidents$/);       // T4
  await page.getByRole("button", { name: "Events" }).click();      // ScreenHeader back
  const events = page.getByTestId(/^event-row-/);
  await expect(events.first()).toBeVisible();
  await events.first().click();                                     // the newest ("Current")
  await expect(page).toHaveURL(/\/events\/\d+\/incidents$/);
  const incident = page.getByTestId(/^incident-row-/).first();
  await expect(incident).toBeVisible();
  await incident.click();
  await expect(page).toHaveURL(/\/incidents\/\d+$/);
  await expect(page.getByText(/^#\d+$/).first()).toBeVisible();
  if (hosted) {                                                     // the web session resumes
    await page.reload();
    await expect(page.getByText(/^#\d+$/).first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Incidents" }).click();
  await page.getByRole("button", { name: "Events" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  if (hosted) {
    await page.reload();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  }
});
```

Never `page.goto` mid-flow: in the interim mode (local export, cross-site to staging) a full
page load re-bootstraps without a cookie and lands on the login screen. `playwright.config.ts`:
`baseURL = process.env.E2E_BASE_URL ?? "http://localhost:8082"`, `webServer` only when
`E2E_BASE_URL` is unset — and that server is `e2e/serve.mjs` (Node, no dependency), not
`expo serve`: it has the single-page fallback the hosted Caddy has, so a deep link loads the
app locally too (`expo serve` answers 404 to any path that is not a file), and answers 404 to
everything else so the smoke's "nothing behind the RPCs" premise holds.

A **second test** (added after the staging run) starts from a signed-out deep link: it
discovers an incident's URL by walking the flow, drops the session (`clearCookies`), loads
the incident directly → `/login?o=…` → signs in → lands on the incident (T3) → "Incidents"
must reach the list (`dismissTo`, T5) → "Events" → sign out. It runs in both modes, since it
needs no cookie, and is the regression test for the back-after-deep-link bug.

The two modes, for the README:

```bash
# Interim: the local export talks to staging (cross-site: no reload-resume). --clear matters:
# Metro caches the inlined EXPO_PUBLIC_* values, so a changed value needs the cache dropped.
EXPO_PUBLIC_API_URL=https://<staging host> pnpm -F @ocf-ims/interface export:web --clear
E2E_EMAIL=miguel@example.com E2E_PASSWORD=Miguel pnpm -F @ocf-ims/interface e2e
# Hosted: the whole flow on the build staging serves, including the cookie resume
E2E_BASE_URL=https://<staging host> E2E_EMAIL=… E2E_PASSWORD=… pnpm -F @ocf-ims/interface e2e
```

## Out of scope (3a.4 and 3b)

Writes of any kind (new incident, edit, journal append — 3b.2/3b.3); reports; people / roster;
dashboard; notifications; the stream (3b.6); push; attachment download or preview (E7, 3b.4);
outcomes; native deep-link resume; tabs / sidebar (3b.1 / 3c); D0 token values and the restyle
(3a.4); typed routes; an offline queue; refresh-token rotation (09i §12 Q1).

## Build plan (two Sonnet builder runs, sequential)

- **Part A — shell, auth, events.** `src/features/shell/*`, both `_layout.tsx`, `login.tsx`,
  `LoginScreen`, `PasswordField`, `ChangePasswordScreen`, the events hooks / `newest.ts` /
  `selected.ts` / `EventsScreen`, `(app)/index.tsx`, `(app)/events/index.tsx`, `format.ts`,
  `useCountdown.ts`, `jest.setup.ts`, the fake's `usingDefaultPassword` + `ChangeOwnPassword`
  + programmable `events`, the Part-A tests; delete the stand-in. Ends with `typecheck`, `lint`,
  `test` green.
- **Part B — incidents, tracer, docs.** The incidents hooks / lookups / rows / screens, the two
  incident routes, the fake's `ListIncidents` / `GetIncident` / `ListAreas` / `ListIncidentTypes`,
  `fixtures.ts`, the Part-B tests, `playwright.config.ts` + `tracer.spec.ts` + the smoke's skip,
  README / CLAUDE.md / plan rows. Ends with the full §9 list green (`export:web` + `e2e`).

A builder that finds this brief wrong stops and reports (09i §7 rule 1); a contract gap goes
into *Build notes* and the builder continues with what exists (rule 2).

## Verification

From the repo root (09i §9), 2026-09-10, after the review fixes:

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ok (no lockfile change — no new dependency) |
| `pnpm generate` | ok |
| `pnpm -F @ocf-ims/interface typecheck` | ok, 0 errors |
| `pnpm lint` | ok, 90 files, 0 diagnostics |
| `pnpm -F @ocf-ims/interface test` | 18 suites, **147 tests passed**; a second run: no act warning, no worker-exit warning |
| `pnpm -F @ocf-ims/interface export:web` | ok |
| `pnpm -F @ocf-ims/interface e2e` (smoke; the tracer skips) | 1 passed, 1 skipped (the tracer, no `E2E_EMAIL`) |
| Tracer against staging (interim / hosted) | run 2026-09-10 once the host answered — the table below |

**Against staging (2026-09-10, `ims-staging.maybloom.tech`, after #246 merged; the host
runs the `latest` images and pulls every 10 min):**

| Run | Result |
|---|---|
| Hosted, first attempt | failed right after sign-in — CI had pushed the 3a.3 web image one minute earlier and the cron had not pulled it yet, so the page was the 3a.2 build (the 09l home screen). Not a bug; the follow lag is now written down |
| Hosted, on the 3a.3 image | sign-in ✓, `/` → the newest event's incidents ✓, Events ✓, incident rows ✓, detail ✓, **reload-resume ✓ (the cookie)**; then "Incidents" landed on *Events* ✗ — the back-after-deep-link bug, fixed in the follow-up PR (`dismissTo`) |
| Interim, as documented | the login form never appeared: the export had ignored `EXPO_PUBLIC_API_URL` (Metro's transform cache kept the config module transformed for the unset value) and the app talked to the static server — "Something went wrong" |
| Interim, `--clear` + `e2e/serve.mjs` | **both tests pass** (the flow 1.3 s; the deep link 1.5 s) with the fix |
| Hosted, with the fix | **both tests pass** — 2026-09-10 on 180ba55 (the checklist row below) |

The follow-up PR reran the §9 steps (typecheck 0, lint 91 files 0, 18 suites / 147 tests,
export, smoke behind `serve.mjs` green).

## Checklist

- [x] Brief written (this file) before any builder work
- [x] `src/lib/returnPath.ts` + test (architect, T3)
- [x] Part A built (Sonnet); typecheck / lint / test green; architect review + fixes (§ *Build notes*)
- [x] Part B built (Sonnet); §9 green; architect review + fixes
- [x] 09i 3a.3 row → this file; README rows (09n, 09m); 09m checklist tick
- [x] Plan 09 §7 finding (*3a.3 — The first screens*)
- [x] PR opened; CI green; Miguel merges (#246, 2026-09-10)
- [x] Tracer run against staging — recorded under *Verification*: interim green (both tests); hosted green through the reload, the back fix awaits the merged image (follow-up PR)
- [x] Hosted tracer green on the fixed image (after the follow-up merges + the 10-min pull) — **2026-09-10, both tests pass** against `https://ims-staging.maybloom.tech` (2 passed, the smoke skipped), so #249's `dismissTo` fix is confirmed live on the hosted build
- [ ] 3a gate items that need a device: the flow on iOS / Android against staging (with 09l's hand checks)

## Build notes

**Part A (Sonnet builder, 2026-09-09; 37 new tests, 123 total) + the architect review:**

- **`PasswordField` is controlled** (`shown` / `onToggleShown` come from the caller) rather than
  owning its toggle, so the change-password screen's two fields share one show/hide state (T2)
  and the login screen passes its own. The brief read as if the field owned it.
- **The countdown had to be keyed on the error, not just the seconds** (review finding): a second
  throttled answer carries the same `Retry-After`, and an effect keyed on the number alone never
  restarted — the button re-enabled at 0 and stayed enabled. `useCountdown(seconds, restartKey)`
  takes the `AppError` as the key; biome's `useExhaustiveDependencies` needs an explained ignore
  for a dependency the effect does not read. At 0 the message is now "You can try again now."
  instead of "Try again in 0 s.".
- **Remembering the event is best-effort** (review finding): the row press no longer awaits the
  AsyncStorage write before navigating, and a storage that cannot be read still lets the screen
  load (`loaded` flips either way).
- **A settled mutation kept a Jest worker alive.** The harness's test `QueryClient` set an infinite
  `gcTime` for queries only; the first `useMutation` (`ChangeOwnPassword`) left TanStack's default
  5-minute mutation GC timer pending, and the full parallel run ended with "A worker process has
  failed to exit gracefully" (never in-band, never per-suite — bisected by exclusion). Mutations
  now get the same infinite `gcTime` in `createTestQueryClient`.
- `personLabel(undefined)` answers "Unknown" (the brief did not say). No primitive needed a new
  prop. `app/_layout.tsx` needed no change.

**Part B (Sonnet builder, 2026-09-10; 24 new tests, 147 total) + the architect review:**

- **`GetAuthStatus` tolerates an anonymous caller** — it answers `authenticated: false` instead
  of `Unauthenticated` — so the transport's refresh-and-retry never engages for it, and a
  `useEventAccess` query fired before the session is signed in would have cached "no access"
  for the hook's five-minute `staleTime`. The real app cannot hit it (an `(app)` screen mounts
  only once the layout is `signedIn`), but a Jest test that mounts a screen directly can:
  the incident suites bootstrap the runtime *before* rendering. The review also made the hook
  safe by construction: `staleTime` is a function that trusts an answer for five minutes only
  when it is `authenticated`, and marks an anonymous one stale at once.
- **TanStack's `notifyManager` defers update notifications by a real `setTimeout(fn, 0)`.**
  With two chained queries (`useEventAccess` gating `useAreas`) a notification could land after
  a test's last `await`, outside any act scope — an intermittent "not wrapped in act" warning.
  TanStack's own remedy, `notifyManager.setScheduler((cb) => cb())`, now lives in
  `jest.setup.ts` for every suite (the builder had put it in the two incident test files).
- **`RefreshControl` is a prop-less stub under the React Native Jest preset**, so
  `fireEvent(…, "refresh")` cannot reach it; the stub records the latest mounted instance on
  `RefreshControl.latestRef`, and the pull-to-refresh tests call its `onRefresh` inside `act`.
  The `testID`s on the two `RefreshControl`s are kept for the real platforms.
- The brief's tracer snippet did not typecheck as written (`test.skip` does not narrow the
  module-level `string | undefined`); the spec fills `email ?? ""`.
- `#N` appears twice on the detail (the `ScreenHeader` title and the heading), so the tests
  anchor on the summary text.
- **CI's runner is slow enough to trip Jest's 5 s per-test default on a first render.** The
  first CI run of PR #246 failed one test — the IncidentScreen suite's first case — at
  5 000 ms while the whole file took 9.8 s (the cold transform of jest-expo, react-native and
  the generated protos lands on the first test); locally the suite runs in about a second.
  `jest.config.js` now sets `testTimeout: 20_000`.

**On staging (2026-09-10, the follow-up PR after #246 merged and the host came up):**

- **Back after a deep link went to the wrong screen.** The `(app)` stack's anchor is
  `events/index`, so a detail reached by a reload or a deep link (or the `?o=` return path)
  has the *events list* beneath it, not the incidents list. `router.canGoBack()` was true
  and `router.back()` popped to the anchor. The routes now call `router.dismissTo(parent)`
  — pop to the parent when it is in the stack, replace the current screen with it when it
  is not — which is the semantics "back" meant all along. Not reachable in Jest (routes are
  untested, T6); the hosted tracer's reload found it, and the new second tracer test
  reproduces it with no cookie via the return path.
- **Metro caches inlined `EXPO_PUBLIC_*` values.** The interim mode's export, run after a
  plain export, shipped the config module transformed with `EXPO_PUBLIC_API_URL` unset, so
  the app talked to the static server and showed "Something went wrong". Pass `--clear` to
  `export:web` (and to `start`) after changing such a value. README, 09m and `CLAUDE.md`
  now say so.
- **`expo serve` has no single-page fallback**: `/login` or `/events/1/incidents/202`
  answer 404, so a deep link cannot load the app locally. `e2e/serve.mjs` (Node's `http`,
  no dependency) mirrors the Caddy `try_files {path} /index.html` and keeps 404 for
  everything else, so the CI smoke's premise is unchanged. Metro's dev server never had the
  problem.
- **Staging follows master about ten minutes behind CI.** The first hosted run hit the
  previous image; a run right after a merge must wait for `staging-pull.sh`.
- A curl gotcha, not a bug: rs/cors 1.11 refuses a preflight whose
  `Access-Control-Request-Headers` is not lowercase, sorted and unique (`cors.go` says so);
  a hand probe listing `content-type,connect-protocol-version` reads as a CORS failure a
  browser never sees.

## Findings

See plan 09 §7, *3a.3 — The first screens: gates in layouts, lookups that never block, a
tracer gated by environment*. In one line each: a route-group layout is the session gate
and can render a gate instead of the stack; a read that tolerates anonymity must not be
cached as an answer; three Jest-harness facts (mutation GC timer, `notifyManager`
scheduler, the `RefreshControl` stub) and the countdown key; the tracer is gated by
environment, and code that has not run is recorded as such. And *3a.3 on staging — what
the hosted tracer caught*: back after a deep link is `dismissTo`, not `back()`; Metro
caches inlined env values; `expo serve` cannot serve a deep link.
