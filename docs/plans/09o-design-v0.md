# 09o — Design system v0: D0, then applied to the tracer screens (slice 3a.4)

> **Status:** **D0 is done** (route B, **Dispatch**, 2026-09-10) **and the re-skin is
> built** — primitives, screens, motion packages, brand assets, the contrast table and the
> web screenshots are in the builder PR. What is left is Miguel's: the
> `/review-animations` pass (that skill only runs when he invokes it), the iOS / Android
> screenshots (this laptop has no Xcode, and the Android emulator is deliberately not
> started on it), and the hosted tracer after the merge.
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, §6 D0 and the 3a.4 row) under
> [09-proto-connect-platform.md](09-proto-connect-platform.md) (Phase 3)
> **Follows:** [09n](09n-tracer-screens.md) (3a.3, merged as #246; its staging follow-up #249)
> — master is the base, no stacking (09i E16)
> **Owner:** Design (Claude Design or an in-code prototype run, iterated with Miguel) →
> Architect (the token contract, this brief, review) → Builder (Sonnet, the re-skin).
> **The skills:** Emil Kowalski's design-engineering skills are installed for the UI work
> (Miguel, 2026-09-10) — `emil-design-eng`, `animate-expo`, `apple-design`, `prototype`,
> `review-animations`, `find-animation-opportunities`, `improve-animations`,
> `animation-vocabulary`, `animate`. § *Motion and feel* is their rules applied to this app;
> every builder and reviewer on 3a.4 works under them.
> **Last updated:** 2026-09-10

## Objective

3a.4 closes the 3a gate's last row: **the design system v0 applied**. D0 produces the
tokens (both colour schemes), the type scale, the primitive designs, the state / priority
colour language, and the brand assets, and records the direction in words. 3a.4 then
replaces the *values* in `src/design/tokens.ts`, restyles the six primitives, re-skins the
seven 3a.3 screens, ships dark mode, and puts screenshots from all three platforms in the
PR. Nothing functional changes: every Jest test passes unchanged and the staging tracer
stays green.

The point, for the maybloom Expo path (09i G3): the screens are *designed*, not traced
from the templ pages; the tokens file is the contract between design and code (E10); and
the motion budget is decided before anyone animates anything.

## What D0 must produce (the contract with the code)

`src/design/tokens.ts` fixes the **shape**; D0 fixes the **values**. D0 may add roles and
steps; it may not remove one without the architect mapping every use first.

| Group | Today (the 09l stub) | D0 delivers |
|---|---|---|
| Colour roles | `background, surface, surfaceRaised, border, text, textMuted, primary, onPrimary, danger, onDanger, success, warning, info, onTone` — light and dark | Values for every role in both schemes, AA contrast for every text/background pair that occurs; any new role (likely: a `focus` ring, an `overlay` scrim, a `surfaceSunken`) named and used |
| Spacing | `xs 4, sm 8, md 12, lg 16, xl 24, xxl 32` | Keep or re-tune; one scale, no one-off values |
| Radii | `sm 4, md 8, lg 12, pill` | One radius language with hierarchy (a control, a container, a badge are not all the same radius) |
| Type | `title 24/30/600, heading 18/24/600, body 16/22/400, label 14/18/500, caption 12/16/400` | Weight + size + line height **and tracking** per step (tight on large, ~0 on body); one family — the platform system font unless D0 argues for a face; scales with the user's text size |
| Elevation | none | A small scale (e.g. `0, 1, 2`) expressed for all three platforms: iOS shadow props, Android `elevation`, web `box-shadow` — one token, three renderings |
| Motion | none | The constants in § *Motion and feel* become `tokens.motion` (durations, the two curves) |
| Touch target | `44` | Keep |

**Primitives.** The six that exist — `Box`, `Text`, `Button` (primary / secondary /
danger, loading, disabled), `Field` (label, error line, focus), `ListRow` (title,
subtitle, accessory, pressable), `Badge` (five tones) — plus the designs (not yet the code)
for `Sheet`, `TabBar` and `Toolbar`, which 3b.1 implements. `ScreenHeader` is the toolbar
as it exists today: title, optional back button labelled with the parent's name, optional
right slot.

**The state / priority colour language** (plan 93 states; the proto enums):

| Thing | Values | Rule |
|---|---|---|
| State | Open, Closed | The one that needs attention (Open) carries the colour; Closed is quiet |
| Priority | High, Normal (no badge, 09n T10), Low | High is the loudest thing on a row; Low is muted; state and priority never share a hue |
| Private | a badge on the row and the detail | Distinct from both; reads as "restricted", not "danger" |
| Meaning | — | Never colour alone: the label text is always present, and a reader with no colour vision must still sort a list by glance |

**Brand.** App icon, adaptive icon (foreground / background / monochrome), splash, favicon.
Today's are Expo's template placeholders (`app.json` `adaptiveIcon.backgroundColor
#E6F4FE`). Wordmark: "OCF IMS".

**`packages/interface/DESIGN.md`** — the direction in words, one page: the personality,
the one memorable thing, the palette and why, the type choice, the colour language, the
motion budget, the accessibility floor, and what is deliberately *not* done.

## The brief (the words the design gets)

**Product.** OCF IMS is the Oregon Country Fair's incident management system: the people
running the Fair record and follow what happens on the grounds — a lost child, a medical
call, a fence down, a vendor dispute — from first report to closed.

**People and context.** Field volunteers on phones, outdoors, in daylight glare and dust,
glancing between the screen and a crowd — big targets, high contrast, one-handed.
Dispatchers on laptops for hours at a time — dense, scannable, keyboard-friendly (3c
builds that; D0 sets the tone it inherits). Admins occasionally. Everyone is a volunteer.

**The job.** See what is happening and record it, fast and without error. An incident's
number, state and priority must be readable at arm's length; a journal must read like a
log, oldest first, with system entries quiet and stricken ones visibly struck.

**Tone.** Calm, competent, unhurried even when the content is urgent. The Fair is a
community event in the woods, not an emergency room: the app should feel like a
well-organised field notebook, not a police console. Warm, not corporate; clear, not
decorated.

**Where distinctiveness comes from** (the `frontend-design` skill's rule: ground it in the
subject). The Fair's world — canvas and wood, painted signs, lanterns, paths under trees,
the Long Tom. Take a palette and a warmth from it, not textures. Spend the boldness in
**one** place — the incident number and its state / priority marks are the candidates —
and keep everything else quiet.

**Not this** (the tells the skills list): a cream page with a serif display and a
terracotta accent; near-black with one acid accent; the SaaS card kit (everything a
rounded card with the same soft shadow); tracked-out all-caps eyebrow labels; middle-dot
meta strings; a numbered "01 / 02 / 03" for things that are not a sequence.

**Screens to design in D0** — the seven 3a.3 screens, mobile-first, plus one
desktop-width look of the incidents list to set the direction 3c inherits: Login; Change
password (the forced gate); Events; Incidents (the rows); Incident detail (header, location,
types, people, linked incidents, reports, the journal with its system-entries switch); and
the shared states (splash, unreachable, loading, empty, error, forbidden). Every screen in
light **and** dark.

**Constraints that are not negotiable.** 44 pt touch targets (`hitSlop` before growing a
visual); WCAG AA contrast in both schemes; dynamic type respected (no measured heights);
no colour-only meaning; reduced motion honoured; React Native `StyleSheet` only — no
NativeWind / Tamagui (09i E10); the same look on web and native; the accessibility labels
the Jest tests and the tracer rely on stay exactly as they are.

## Motion and feel (Emil Kowalski's skills, applied to this app)

The decisions, in the order `animate-expo` makes them, so no builder has to re-derive
them:

- **The frequency gate first.** Rows, buttons and the back button are touched dozens of
  times a session → **near-imperceptible feedback only**: `scale 0.97` on press-in,
  **120 ms**, `cubic-bezier(0.23, 1, 0.32, 1)`, as a Reanimated CSS transition on
  `transform` (the `animate-expo` press recipe: no shared value, no worklet). Feedback on
  press-in, commit on press-out; `pressRetentionOffset` so a drifting finger does not
  cancel. That is the whole motion budget of the list screens.
- **Nothing enters with an animation on a list.** No `entering` on virtualized rows (they
  recycle and flicker), no stagger on a list people scroll all day. An empty or error state
  may fade in (opacity, ≤ 200 ms, ease-out) — that is content the person is waiting for.
- **Screen transitions are the platform's.** The native stack's default push; `animation:
  'fade'` under reduced motion; never rebuilt in JS. When 3b.1 adds tabs: `animation:
  'none'` between them — tabs are peers, they never slide.
- **Sheets, when they come (3b), are `presentation: 'formSheet'`** — the real system sheet,
  three detents at most (Android's cap). Not built here.
- **Springs only when a finger carried momentum** (`{ duration: 400, dampingRatio: 1 }`
  the default; `0.8` after a flick). No finger in 3a.4 → no springs in 3a.4.
- **Haptics: none in 3a.4** (nothing snaps, nothing commits). Later: `selectionAsync` on
  a picker detent, `notificationAsync` on a save or a failure — one per action, never the
  only feedback.
- **Reduced motion ships with the animation**, not after: `useReducedMotion()` drops the
  scale, keeps opacity.
- **Judged on a device, release build.** The simulator and Expo Go hide exactly the jank
  the rules exist to prevent.
- **Dependencies:** `npx expo install react-native-reanimated react-native-worklets`
  (versions matched to SDK 57; `babel-preset-expo` wires the worklets plugin). Not
  gesture-handler, not haptics — they arrive with the first gesture (3b). Verify the CSS
  transition renders on the web export; if it does not, the press scale ships without
  the transition on web (still instant), and that is a finding.

The `review-animations` skill is the bar for the 3a.4 review: it checks the press
feedback and the state fades against these rules and reports as a Before / After table.
`find-animation-opportunities` is **not** run on 3a.4 — the answer for these screens is
already "nothing else animates", and an audit would only be tempted to disagree.

## How D0 gets made — two routes; Miguel picks

**Route A — Claude Design** (09i E10 / §6 as planned). Needs Miguel to run `/design-login`
once (the `DesignSync` tool refuses until then). Then: the architect pushes the current
component reference — the tokens and the six primitives as HTML previews — with
`/design-sync`, so the Claude Design project starts from the code's set; Miguel iterates
in the canvas with the brief above; the handoff bundle lands in
`packages/interface/design/D0/`; the architect turns it into the token diff and this
file's acceptance criteria; the builder applies it. Best when the visual iteration is the
point and whole flows are being drawn — which is D1 and D2.

**Route B — in-code variants** (Emil's `prototype` skill; it runs only when Miguel invokes
`/prototype`, never on its own). Three *named* directions — e.g. "Field notebook",
"Signage", "Dispatch" — each a full set of token values and restyled primitives applied to
the incidents list and the incident detail, behind the skill's picker at a dev-only route.
Miguel flips through them on the web export and on a phone (Metro against staging),
picks one (or asks for a riff around it); the winner's values are promoted into
`tokens.ts`, the picker route is deleted, and 3a.4 proceeds. Fastest path to a decision;
the output is code, not a canvas; the screens already exist to judge on.

**Recommendation: B for v0.** The token contract is small, the screens exist, and the
judgement D0 needs — "which of these feels right on a phone in the sun" — is what a
picker answers in an afternoon. A is the right tool once flows need prototyping (3b's
D1, 3c's D2), and the component reference can be synced then from the v0 tokens.

### What happened — route B, 2026-09-10

Miguel invoked `/prototype`. Three directions were built on a throwaway surface
(`src/prototypes/d0/` + a dev-only `app/(dev)/prototypes.tsx`), each a complete token set
for both schemes plus its own copies of the six primitives, applied to the incidents list
with seed-shaped content from `src/test/fixtures.ts` and no server:

| Variant | Axis | Outcome |
|---|---|---|
| Field notebook | Warm paper and ink; a ruled ledger; outlined stamps | Closest to the brief's stated tone; quietest at arm's length in glare |
| Signage | High-contrast painted sign; a framed board per incident; solid blocks | Loudest and most legible; ~half the incidents per screen |
| **Dispatch** | **Dense, cool, tabular; fixed number and time columns; tinted chips** | **Chosen.** Scans fastest, and 3c's console inherits it most directly |

The winner's values were promoted into `src/design/tokens.ts` and the prototype surface
was deleted, per the skill's cleanup rule. The reasoning — including why the cool palette
beat the warm one the brief leaned toward — is recorded in `packages/interface/DESIGN.md`,
which is the artefact to argue with if the direction is ever revisited.

## 3a.4 acceptance criteria (the builder's list, after D0)

- [x] `tokens.ts` values replaced for both schemes; new groups (`elevation`, `motion`, any
      new role) typed and consumed through `useTheme()`; **still the only file with a
      colour, spacing, font-size or duration literal** (grep-verified in the PR).
      *(D0, this PR. The new roles — `surfaceSunken`, `borderStrong`, `restricted` /
      `onRestricted`, `focus`, `overlay` — and the `figure` type step are defined and
      typed; `borderStrong` and `figure` get their first uses in the builder run below,
      and `overlay` / `surfaceSunken` wait for 3b/3c, as `DESIGN.md` records.)*
- [x] The six primitives restyled; `Button` and `ListRow` carry the press feedback above;
      `Field` has a visible focus state on web (keyboard); `Badge` speaks the colour
      language; `ScreenHeader` is the toolbar design. *(`ListRow` gained `lead` / `meta`
      slots — the ledger row; the press feedback is `src/design/motion.tsx`, shared by
      `Button`, `ListRow` and the header's back control.)*
- [x] The seven screens re-skinned with **no behavioural change**: the 147 existing Jest
      tests pass and the smoke passes (three were added for the new `formatShortTime`, so
      150 in total; no snapshot tests exist and none are added). **One assertion changed**,
      deliberately: `IncidentsScreen.test.tsx` asserted `"#1 First"` as a single string, and
      the number is now its own column — it asserts `"#1"` and `"First"`. The tracer's
      `getByText(/^#\d+$/)` had the same problem for real (every row now renders a bare
      `#123`, and the list stays mounted under the detail), so the detail's number carries
      `testID="incident-number"` and the tracer asks for that instead.
      [ ] The **hosted** tracer on staging waits for the merge — staging serves master's
      build.
- [x] Dark mode: every screen checked in both schemes (Chrome, `colorScheme` emulation);
      the scheme follows the OS.
- [ ] Screenshots: **Chrome done** — light and dark, at phone width and at 1280 px, for
      Login, Events, Incidents and Incident (ten shots, handed to Miguel in the session).
      **iOS and Android are not done here**: this laptop has Command Line Tools but no
      Xcode (no `simctl`), and the Android emulator is not started on it by standing
      decision. Both move to the 3a gate's device row.
- [x] Accessibility: the contrast table in § *Build notes* — 42 pairs generated from
      `tokens.ts`, every one passing (worst text 4.60:1, worst non-text 3.75:1); 44 pt
      targets kept (`minHeight`, never a measured height); the `accessibilityLabel`s, roles
      and `testID`s the tests use are unchanged, and the header's back control pins its
      accessible name with `accessibilityLabel` so the decorative chevron cannot leak into
      it.
- [x] `packages/interface/DESIGN.md` written *(D0)*; [x] the icon, the three Android
      adaptive layers and the favicon replaced, `adaptiveIcon.backgroundColor` = `primary`
      `#2457A6`. They are **generated** — `node scripts/brand-assets.mjs` draws the mark
      from the tokens — so nobody has to open a binary to change them. No splash screen is
      configured: `expo-splash-screen` is not installed, an inherited gap this run did not
      widen the PR to close.
- [x] `review-animations` pass over the press feedback and the state fades — **Miguel ran
      it 2026-09-10** (the skill is `disable-model-invocation`). Verdict **Block**, on one
      real defect: this section promised `animation: 'fade'` under reduced motion and the
      builder run never wrote it, so an Android or web user who asked the OS for less
      movement still got every full slide (iOS cross-fades on its own). Two cohesion
      findings came with it — `PasswordField`'s toggle and the linked-incident number were
      bare pressable `Text`, announcing themselves as buttons and then answering a press
      with nothing while the `Button` and `ListRow` beside them scaled. All three are
      fixed in the motion follow-up (§ *Build notes — the motion follow-up*).
- [x] 09i §9 protocol green locally; CI on the PR.

## Files

```
packages/interface/DESIGN.md                      # new: the direction in words
packages/interface/design/D0/                     # route A only: the handoff bundle
packages/interface/app/(dev)/prototypes.tsx       # route B only: the picker; deleted at promotion
packages/interface/assets/*                       # the brand assets replace the placeholders
packages/interface/app.json                       # icon / splash / favicon; adaptiveIcon colour
packages/interface/src/design/tokens.ts           # the values; elevation + motion groups
packages/interface/src/design/theme.tsx           # the new groups on Theme
packages/interface/src/design/primitives/*.tsx    # restyled; press feedback on Button / ListRow
packages/interface/src/features/**                # style changes only
packages/interface/package.json                   # + react-native-reanimated, react-native-worklets
packages/interface/README.md                      # Design section → DESIGN.md
CLAUDE.md                                         # one line: DESIGN.md and the motion rules exist
docs/plans/09i-expo-client.md                     # D0 row + 3a.4 row → this file
docs/plans/README.md                              # row for 09o
```

## Out of scope

Tabs / sidebar and the `Sheet` / `TabBar` implementations (3b.1); any new screen or
behaviour; typed routes; motion beyond the press feedback and the state fades; a custom
typeface unless D0 argues for one and ships the font files; the dispatch table's design
proper (D2); a user-facing scheme preference (OS only for now).

## Build plan

1. ~~**Miguel:** pick the route.~~ **Done** — route B, 2026-09-10.
2. ~~**D0** produced and reviewed by Miguel.~~ **Done** — three directions behind the
   picker; **Dispatch** chosen (§ *What happened*).
3. **Architect:** ~~the token diff, `DESIGN.md`, the acceptance criteria above finalised
   against what D0 chose~~ **done in this PR**; `npx expo install` the two motion packages
   and verify the CSS transition on web — **still to do, and it belongs with the builder
   run** rather than here: nothing imports Reanimated until the press feedback is written,
   and landing an unused native dependency ahead of it only widens this PR's blast radius.
4. ~~**Builder:** tokens, primitives, screens, screenshots.~~ **Done** — one run under the
   `emil-design-eng` and `animate-expo` skills (§ *Build notes — the re-skin*).
   `review-animations` is Miguel's to invoke; then PR → master, Miguel merges.
5. Hosted tracer on staging; 09i 3a.4 row → merged; the 3a gate reviewed row by row
   (what still needs a device: the iOS / Android runs with 09l's hand checks).

## Verification

The 09i §9 protocol from the repo root (install, generate, typecheck, lint, test,
export, e2e), the hosted tracer against staging, the screenshots (three platforms, two
schemes), the contrast table, and the `review-animations` table — all recorded here.

## Checklist

- [x] Brief (this file) before any design or builder work; Emil Kowalski's skills installed
- [x] Route chosen (Miguel): **B**, the in-code picker
- [x] D0 produced and reviewed — **Dispatch** chosen 2026-09-10
- [x] Token diff + `DESIGN.md` (architect)
- [x] Builder run; Chrome screenshots; PR — [x] `review-animations` (Miguel, 2026-09-10:
      **Block**, three findings fixed in the motion follow-up), CI green, Miguel merges
- [x] Hosted tracer green on staging — **2026-09-10 against 180ba55**, 2 passed / 1 skipped
- [ ] 09i 3a.4 row + README row → Merged
- [x] Plan 09 §7 finding ("what a design system costs on Expo": tokens on three platforms, elevation, the motion budget) — **written 2026-09-10**, with the 3a gate's companion finding

## Build notes

**D0, route B (2026-09-10).** The picker ran on the Metro web build at
`/prototypes`, three directions switchable with `1`–`3` / `←` `→` and a `?v=` param, plus
a harness strip for the scene (list / empty / error / a primitives kit), the colour scheme
and a phone-width frame. Notes worth keeping:

- **The picker port.** `PICKER.md` is written for the DOM; on React Native it became an
  `Animated` highlight (250 ms, `Easing.bezier(0.23, 1, 0.32, 1)`, enabled only after the
  second frame so load does not animate, and skipped entirely under
  `AccessibilityInfo.isReduceMotionEnabled()`), with the keyboard wiring guarded by
  `Platform.OS === "web"`. Same values, same behaviour, works on a phone through Metro.
- **`CI=1` disables Metro's file watcher.** The first harness run served a stale bundle
  for several edits before this was spotted — the symptom is edits that typecheck but
  never reach the browser. Start the dev server without `CI=1`, and `--clear` on top of
  the repo's existing `EXPO_PUBLIC_*` caching rule.
- **Contrast was checked by script, not by eye**, over every text pair each variant
  actually paints, in both schemes. It caught six failures across the three directions
  (two inks and four `borderStrong` values) which were darkened before the pick, so the
  choice was made between three directions that all already cleared AA.
- **`border` is deliberately below 3:1** in the chosen direction. It is a decorative row
  rule; `borderStrong` (4.26:1 light, 3.75:1 dark) is the role for any boundary that
  carries meaning. `DESIGN.md` records the split so a later audit does not "fix" it.
- **What the tokens alone do not carry.** With the values promoted and no primitive
  touched, the app is already Dispatch in palette, type, spacing and radii — but the row is
  still the 09l `ListRow` (number as a title prefix, badges right, a middle-dot meta
  string). The number-as-a-column and the tinted chips that made the direction win are
  primitive work, and they are the heart of the builder run.

**Verified on this PR (D0 only).** The 09i §9 protocol from the repo root, all green:
typecheck, `pnpm lint`, `pnpm -F @ocf-ims/interface test` (18 suites, 147 tests, unchanged
and unmodified), `export:web --clear` and the Playwright run (smoke passed, the two tracer
tests skipped without credentials). `grep` confirms no colour literal outside
`src/design/`, and the export carries no baked-in staging URL. The new tokens were also
rendered against the live staging instance in Chrome via
`EXPO_PUBLIC_API_URL=https://ims-staging.maybloom.tech pnpm -F @ocf-ims/interface start
--clear` (sign-in → the incidents list on real data). The **hosted** tracer belongs to the
builder PR, which is the one that changes what the screens render.


**The re-skin (3a.4, 2026-09-10).** One run under `emil-design-eng` + `animate-expo`. What
it changed, and the decisions worth keeping:

- **The row is the whole design.** `ListRow` grew two slots — `lead` (the fixed left
  column) and `meta` (second-line accessories) — and `IncidentRow` fills them: the number
  in `figure` (tabular) on the left, the summary on the first line, the area and the marks
  on the second, the last-modified time in the fixed right column. `caption` became tabular
  too, since nearly every caption in this app is a timestamp. The events list is the same
  primitive with `lead` and `meta` left empty, so nothing forked.
- **Badges are tinted chips.** `tokens.tones` holds an `ink` and a **pre-blended, opaque**
  `tint` per tone (14% of the ink over the surface in light, 22% in dark). Opaque rather
  than an alpha for two reasons: the chip then reads identically on a row (`surface`) and
  on the detail (`background`), and the ink/tint contrast can actually be measured — an
  alpha over an unknown ground cannot.
- **Private is `restricted`, not `warning`.** Both the row and the detail had been passing
  `tone="warning"`, which says "danger" about something that only means "restricted".
- **The press feedback is two components, not a pattern to copy.** `src/design/motion.tsx`:
  `PressFeedback` (scale 0.97 plus a 0.92 opacity dip, 120 ms, `cubic-bezier(0.23, 1, 0.32,
  1)`) and `StateFade` (200 ms opacity — the empty / error / unreachable bodies). Both are
  **Reanimated CSS transitions**: a state flips a style value and the transition
  interpolates it on the UI runtime. No shared value, no worklet, no `scheduleOnRN`,
  nothing re-rendering per frame. Reduced motion drops the scale and keeps the opacity, and
  ships with the animation rather than after it.
- **Verified in the built bundle, not asserted.** Pressing a row in the web export computes
  `matrix(0.97, 0, 0, 0.97, 0, 0)`, `opacity 0.92`, and
  `transition: opacity, transform 0.12s cubic-bezier(0.23, 1, 0.32, 1)`. The CSS transition
  renders on web, so step 3's open question is answered and no finding is needed.
- **Reanimated under Jest needs exactly one line.** jest-expo resolves
  `react-native-worklets`' `.native` entry, which then reaches for a TurboModule Node does
  not have. The package ships its own resolver that drops the `.native` extension;
  `jest.config.js` now points at it. That beats mocking the library away — and
  `react-native-reanimated/mock` is broken in 4.5.1 anyway (it requires a `./src/mock` the
  package no longer ships). Cost: the suite went from about 4 s to about 9 s cold.
- **`Field` rests on `borderStrong`, and focus is a shadow.** A control's boundary has to
  clear 3:1 and `border` deliberately does not. The ring is
  `boxShadow: 0 0 0 3px focusRing` plus `outlineWidth: 0` — it cannot shift the layout, and
  the browser's own outline no longer doubles it. (`outlineStyle: "none"` does not typecheck
  in RN 0.86: the union is `solid | dotted | dashed`.)
- **Two middle-dot meta strings went.** The detail's location renders one line per part,
  and a journal byline is the author with its time pushed right — both were on the brief's
  list of tells. A journal entry also hangs off a gutter rule now (`borderStrong` for a
  person's entry, `border` for a system or stricken one), which is what makes it read as a
  log.
- **`elevation[1]` is spent on the toolbar** and nowhere else, exactly as `DESIGN.md` said
  it would be. Rows separate with a rule and tone.
- **The brand mark is code.** `scripts/brand-assets.mjs` — pure Node, zlib plus a
  supersampled rounded-rect rasteriser, no image dependency to install or audit — draws a
  rail and three ragged ledger lines from `primary` / `onPrimary`, and writes the icon, the
  three Android layers and the favicon. Regenerate it; don't edit the PNGs.

**What is deliberately NOT done.** iOS screenshots are impossible on this machine (Command
Line Tools, no Xcode, so no `simctl`); the Android emulator exists but the laptop is under
a standing "no heavy local stacks" rule, so it was not started — both join the 3a gate's
device row, which already exists for 09l's hand checks. `review-animations` is
`disable-model-invocation` and waits for Miguel. The hosted tracer waits for the merge,
since staging serves master's build; the **interim** tracer (this build against staging's
API) passed both of its tests.

**Contrast table.** Generated by script from `tokens.ts`, over every pair the screens
actually paint, in both schemes. Worst text pair **4.60:1**; worst non-text **3.75:1**.

| Scheme | What | Pair | Ratio | Needs | |
| --- | --- | --- | --- | --- | --- |
| light | Body / heading / title text | `text on background` | 15.89:1 | 4.5:1 | ✅ |
| light | Body text on a row or card | `text on surface` | 17.51:1 | 4.5:1 | ✅ |
| light | Supporting meta | `textMuted on background` | 5.64:1 | 4.5:1 | ✅ |
| light | Supporting meta on a row | `textMuted on surface` | 6.22:1 | 4.5:1 | ✅ |
| light | A link, the back control | `primary on surface` | 7.03:1 | 4.5:1 | ✅ |
| light | A link on the page | `primary on background` | 6.38:1 | 4.5:1 | ✅ |
| light | Primary button label | `onPrimary on primary` | 7.03:1 | 4.5:1 | ✅ |
| light | Danger button label | `onDanger on danger` | 6.57:1 | 4.5:1 | ✅ |
| light | Secondary button label | `text on surface` | 17.51:1 | 4.5:1 | ✅ |
| light | An error title / field error | `danger on background` | 5.97:1 | 4.5:1 | ✅ |
| light | Field text | `text on surface` | 17.51:1 | 4.5:1 | ✅ |
| light | Field / control boundary | `borderStrong on surface` | 4.26:1 | 3:1 | ✅ |
| light | Focus ring | `focus on surface` | 7.03:1 | 3:1 | ✅ |
| light | Journal gutter (a person's entry) | `borderStrong on background` | 3.86:1 | 3:1 | ✅ |
| light | Row rule — decorative, by design | `border on surface` | 1.42:1 | — | n/a |
| light | Badge — neutral | `neutral ink on tint` | 4.60:1 | 4.5:1 | ✅ |
| light | Badge — info | `info ink on tint` | 5.30:1 | 4.5:1 | ✅ |
| light | Badge — success | `success ink on tint` | 5.10:1 | 4.5:1 | ✅ |
| light | Badge — warning | `warning ink on tint` | 4.98:1 | 4.5:1 | ✅ |
| light | Badge — danger | `danger ink on tint` | 5.20:1 | 4.5:1 | ✅ |
| light | Badge — restricted | `restricted ink on tint` | 5.64:1 | 4.5:1 | ✅ |
| dark | Body / heading / title text | `text on background` | 16.02:1 | 4.5:1 | ✅ |
| dark | Body text on a row or card | `text on surface` | 14.64:1 | 4.5:1 | ✅ |
| dark | Supporting meta | `textMuted on background` | 7.48:1 | 4.5:1 | ✅ |
| dark | Supporting meta on a row | `textMuted on surface` | 6.83:1 | 4.5:1 | ✅ |
| dark | A link, the back control | `primary on surface` | 7.76:1 | 4.5:1 | ✅ |
| dark | A link on the page | `primary on background` | 8.49:1 | 4.5:1 | ✅ |
| dark | Primary button label | `onPrimary on primary` | 7.26:1 | 4.5:1 | ✅ |
| dark | Danger button label | `onDanger on danger` | 7.43:1 | 4.5:1 | ✅ |
| dark | Secondary button label | `text on surface` | 14.64:1 | 4.5:1 | ✅ |
| dark | An error title / field error | `danger on background` | 8.36:1 | 4.5:1 | ✅ |
| dark | Field text | `text on surface` | 14.64:1 | 4.5:1 | ✅ |
| dark | Field / control boundary | `borderStrong on surface` | 3.75:1 | 3:1 | ✅ |
| dark | Focus ring | `focus on surface` | 7.76:1 | 3:1 | ✅ |
| dark | Journal gutter (a person's entry) | `borderStrong on background` | 4.10:1 | 3:1 | ✅ |
| dark | Row rule — decorative, by design | `border on surface` | 1.33:1 | — | n/a |
| dark | Badge — neutral | `neutral ink on tint` | 4.60:1 | 4.5:1 | ✅ |
| dark | Badge — info | `info ink on tint` | 5.99:1 | 4.5:1 | ✅ |
| dark | Badge — success | `success ink on tint` | 5.83:1 | 4.5:1 | ✅ |
| dark | Badge — warning | `warning ink on tint` | 5.92:1 | 4.5:1 | ✅ |
| dark | Badge — danger | `danger ink on tint` | 5.07:1 | 4.5:1 | ✅ |
| dark | Badge — restricted | `restricted ink on tint` | 5.34:1 | 4.5:1 | ✅ |

`border` on `surface` is 1.42:1 and is listed as "n/a" on purpose: it is a decorative row
rule, and `borderStrong` is the role for any boundary that carries meaning. `DESIGN.md`
records the split so a later audit does not "fix" it.

**Verified on this PR.** The 09i §9 protocol from the repo root — `pnpm install`,
`pnpm generate`, typecheck, `pnpm lint`, `pnpm -F @ocf-ims/interface test` (18 suites, 150
tests), `export:web --clear`, Playwright: the smoke green against a server-free export and
both tracer tests green in interim mode against `https://ims-staging.maybloom.tech`. `grep`
still finds no colour, spacing, font-size or duration literal outside `src/design/`.

### The motion follow-up (2026-09-10, after `/review-animations`)

The review's verdict was **Block**, and it was right about one thing that mattered.
§ *Motion and feel* above says "`animation: 'fade'` under reduced motion", and the
builder run shipped `useReducedMotion()` inside `PressFeedback` and nowhere else — so
`app/_layout.tsx` and both group layouts still handed the native stack its default
push. On iOS that is invisible (UIKit cross-fades under Reduce Motion by itself); on
Android and on the hosted web build, someone who asked the OS for less movement got
every full slide anyway. A screen push is the largest movement in the app, so this was
the one place the setting mattered most and the one place it was not read.

`useScreenAnimation()` joins the motion budget in `src/design/motion.tsx` — the whole
of it is still that one file — and the three `<Stack>`s pass its result as `animation`.
The hook is called before each layout's session `switch`, since the early returns would
otherwise make it conditional.

The other two findings were one cohesion problem seen twice: `PasswordField`'s
show/hide toggle and the linked-incident number on the detail were bare `<Text
accessibilityRole="button" onPress>`. Both announced themselves as buttons and then
answered a press with nothing, directly beside a `Button` and a `ListRow` that both
scale — the app had two classes of pressable split by implementation history rather
than by intent. Rather than wrap each site, a seventh primitive fixes it at the root:

`src/design/primitives/TextButton.tsx` — a pressable word. `Pressable` +
`PressFeedback`, `alignSelf: "flex-start"` so the press scale applies to the word and
not to a full-width invisible block, and `hitSlop` off the spacing scale to buy the
44 pt target back without growing the visual. Its `accessibilityLabel` is the label, so
the accessible name is pinned the same way `ScreenHeader`'s back control pins its own.

**Deliberately not done, and why.** Two more findings were raised and left open on
purpose. `StateFade` fires on *every* mount, including a navigation back to a
cached-empty list where nothing was waited for — gating it needs a `waited` prop
threaded from each screen's `isLoading`, which is a wider change than a motion fix and
is better made when 3b touches those screens anyway. And `Button`'s disabled/loading
swap is a hard cut where a 200 ms opacity transition (and a 2 px blur across the
label → spinner swap) would read better; sign-in is occasional-tier so standard
animation is permitted there, but it is polish, not a defect.

Two escalation triggers were considered and consciously **not** flagged. The press is
symmetric at 120 ms in and out: standard 9 targets *hold* interactions, where the
deliberate phase should be slow and the release should snap, and a tap has no
deliberate phase. And `StateFade` is a pure fade with no initial transform, which is on
the trigger list — but that rule guards against an element arriving from nowhere, and
this is one full-bleed body crossfading into another; a transform would add movement
that reduced motion would then have to strip.

150 tests still pass, and the two that press the newly-wrapped controls
(`getByText("Show password")`, `getByText("#4")`) needed no change: RNTL walks up to
the `Pressable` ancestor for the handler.

## Findings

(none yet — plan 09 §7 gets the 3a.4 entry when it lands)
