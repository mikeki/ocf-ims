<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09w — slice 3b.7: store readiness

> **Status:** **Built, as far as a repository can be** — 2026-09-12, the last PR in the
> 3b client stack. What remains is the maintainer's: the accounts, the EAS project, the
> first builds, and the device checks the earlier slices owe. The 3b gate stays open until
> those run.
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, the 3b.7 row and E14)
> under [09-proto-connect-platform.md](09-proto-connect-platform.md)
> **Owner:** Mechanic (this slice) → the maintainer (accounts and builds).
> **Last updated:** 2026-09-12

## Objective

Everything a native build needs that lives in the repository, so the first TestFlight /
Play internal build is a command and not a project.

## What 3b.7 puts in the repository

- **`app.json`:** the bundle identifier and Android package (open question 1), the
  `ocfims` scheme (already there), the D0 icons, the splash from `splash-icon.png` on the
  tokens' light and dark backgrounds, `CADisableMinimumFrameDurationOnPhone` (120 Hz on
  ProMotion phones — the motion budget assumes the 8 ms frame), the iOS privacy manifest
  with the required-reason APIs a React Native app touches (user defaults, file
  timestamps, boot time, disk space; no tracking, no collected data), and the permission
  strings from 3b.4 (camera, photos) and 3b.5 (`expo-notifications`). `extra.eas` is an
  empty object waiting for `eas init`.
- **`eas.json`:** `development` (a dev client for a connected Metro), `preview` (internal
  distribution against staging), `production` (the store build, remote version source,
  auto-increment). The API URL for each is an env value with a placeholder host.
- **CI:** `buf breaking --against master` in the `Linters` job (E14). The freeze itself is
  dated by the first non-developer build; plan 09 Phase 3b carries the note.
- **README:** the build and submit commands, and what the maintainer sets up once.

## What the maintainer does (in order)

1. An Expo account; `eas init` in `packages/interface` writes `extra.eas.projectId` —
   this is also what 09u's push needs.
2. Decide the identifiers (open question 1) if the placeholder is wrong; they are free to
   change until the first build is installed.
3. Apple: a team, the app record, TestFlight. Google: the Play console, an internal
   testing track. `eas submit` reads both from `eas.json`'s `submit` profile once the
   credentials exist.
4. `eas build --profile preview` for both platforms, and the device checks the slices
   owe: 3a's SecureStore sign-out and the iOS/Android tracer runs, 3b.4's camera /
   library / denied permission / 4G upload, 3b.5's prompt-at-tap / denial / a push from
   staging with `IMS_EXPO_PUSH_ENABLED` / a lock-screen tap / sign-out unregistration,
   3b.6's ten-minute stream through Caddy, background and back.
5. The first install by a non-developer: record the date in plan 09 (Phase 3b) — the
   field numbers are frozen from then.

## Out of scope

- Maestro smoke (09i lists it as optional): the Playwright tracer covers the web build
  and the flows; a device tracer is worth adding once a device is in the loop.
- `expo-dev-client`: the `development` profile declares it; install the package when the
  first dev build is made.

## Checklist

- [x] `app.json`: identifiers, splash, 120 Hz, privacy manifest, `extra.eas`
- [x] `eas.json` with the three profiles
- [x] `buf breaking` in CI; the freeze note in plan 09
- [x] README build section; the 09i 3b.7 row
- [ ] `eas init` (maintainer) → `extra.eas.projectId`
- [ ] Apple / Google accounts and the first `preview` builds (maintainer)
- [ ] The owed device checks (above)
- [ ] The freeze date in plan 09

## Open questions

1. **The identifiers.** `org.oregoncountryfair.ims` for both platforms is a placeholder
   the maintainer should confirm or replace — a bundle identifier is permanent once an
   app record exists.
2. **The production host.** `eas.json` names `<production host>`; the deployment plan
   decides it.
