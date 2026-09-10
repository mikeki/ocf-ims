# 09o — Design system v0: D0, then applied to the tracer screens (slice 3a.4)

> **Status:** Brief — D0 waits on one decision from Miguel (§ *How D0 gets made*); nothing
> is built yet.
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

## 3a.4 acceptance criteria (the builder's list, after D0)

- [ ] `tokens.ts` values replaced for both schemes; new groups (`elevation`, `motion`, any
      new role) typed and consumed through `useTheme()`; **still the only file with a
      colour, spacing, font-size or duration literal** (grep-verified in the PR).
- [ ] The six primitives restyled; `Button` and `ListRow` carry the press feedback above;
      `Field` has a visible focus state on web (keyboard); `Badge` speaks the colour
      language; `ScreenHeader` is the toolbar design.
- [ ] The seven screens re-skinned with **no behavioural change**: every Jest test passes
      unchanged (no snapshot tests exist; none are added), the smoke passes, and the tracer
      passes on staging (hosted mode) after the merge.
- [ ] Dark mode: every screen checked in both schemes; the scheme follows the OS.
- [ ] Screenshots in the PR: iOS simulator, Android emulator, Chrome — light and dark —
      for Login, Events, Incidents, Incident (09i 3a.4 row).
- [ ] Accessibility: a contrast table in the PR (every text/background pair, AA); 44 pt
      targets; the `accessibilityLabel`s / roles / `testID`s the tests use are unchanged.
- [ ] `packages/interface/DESIGN.md` written; `app.json` icon / adaptive icon / splash /
      favicon replaced with the D0 assets, `adaptiveIcon.backgroundColor` from the tokens.
- [ ] `review-animations` pass over the press feedback and the state fades, recorded in
      § *Build notes*.
- [ ] 09i §9 protocol green locally and in CI.

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

1. **Miguel:** pick the route (A → `/design-login`; B → `/prototype` with this file's brief
   as the description). Nothing else starts before this.
2. **D0** produced and reviewed by Miguel (the canvas, or the picker on a phone).
3. **Architect:** the token diff, `DESIGN.md`, the acceptance criteria above finalised
   against what D0 chose; `npx expo install` the two motion packages and verify the CSS
   transition on web before handing over.
4. **Builder (Sonnet, one run under ~500 lines of change, the `emil-design-eng` and
   `animate-expo` skills loaded):** tokens, primitives, screens, screenshots; then the
   architect review with `review-animations`; PR → master; Miguel merges.
5. Hosted tracer on staging; 09i 3a.4 row → merged; the 3a gate reviewed row by row
   (what still needs a device: the iOS / Android runs with 09l's hand checks).

## Verification

The 09i §9 protocol from the repo root (install, generate, typecheck, lint, test,
export, e2e), the hosted tracer against staging, the screenshots (three platforms, two
schemes), the contrast table, and the `review-animations` table — all recorded here.

## Checklist

- [x] Brief (this file) before any design or builder work; Emil Kowalski's skills installed
- [ ] Route chosen (Miguel); `/design-login` run if A
- [ ] D0 produced and reviewed
- [ ] Token diff + `DESIGN.md` (architect)
- [ ] Builder run; architect review incl. `review-animations`; screenshots; PR; CI green; Miguel merges
- [ ] Hosted tracer green on staging; 09i 3a.4 row + README row → Merged
- [ ] Plan 09 §7 finding ("what a design system costs on Expo": tokens on three platforms, elevation, the motion budget)

## Build notes

(none yet)

## Findings

(none yet — plan 09 §7 gets the 3a.4 entry when it lands)
