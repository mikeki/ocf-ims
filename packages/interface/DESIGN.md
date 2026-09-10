<!-- SPDX-License-Identifier: Apache-2.0 -->

# OCF IMS — design system v0

The direction behind `src/design/tokens.ts`. D0 was run as three in-code
directions behind a picker (plan [09o](../../docs/plans/09o-design-v0.md), route B);
Miguel chose **Dispatch** on 2026-09-10 over "Field notebook" (warm paper and ink)
and "Signage" (high-contrast painted sign). This file is the *why*, so a later
change can argue with the reasoning rather than guess at it.

## Personality

Dense, cool and tabular. A list built to be **scanned, not read** — every row
answers "what is it, where, how urgent, when" in one glance, and nothing on the
screen competes with that. Calm and unhurried even when the content is not. The
app looks like an instrument, not a document.

## The one memorable thing

**The incident number is a column, not a prefix.** It sits in its own fixed
left-hand column in a tabular figure, so a screenful of incidents reads as an
ordered ledger you can scan down, and "#47" is something you can call out over a
radio. Everything else on the row is deliberately quieter than it.

The row that follows from it has four slots, and the list is nothing but these:

```
#47  Lost child near the main stage                      14:32
     Center Camp   Open  High  Private
```

the number (fixed left column, tabular), the summary (up to two lines), the
area and the marks sharing the second line, and the last-modified time in the
fixed right column. `ListRow` owns that shape, so the events list — which has
neither a number nor a time — is the same primitive with two slots empty.

## Palette

A cool blue-grey ground with a single blue primary. The greys carry a slight
blue cast rather than being neutral, so the coloured state marks sit on them
without vibrating.

| Role | Light | Dark | Used for |
| --- | --- | --- | --- |
| `background` / `surface` | `#F2F4F7` / `#FFFFFF` | `#0D1117` / `#161B22` | The page, and the rows on it |
| `surfaceRaised` / `surfaceSunken` | `#E9EDF2` / `#E1E6EC` | `#1F262E` / `#090C10` | A secondary control; a well or table head |
| `border` / `borderStrong` | `#D3D9E0` / `#6F7C8B` | `#2A323C` / `#6B7684` | A decorative rule; a boundary that must be seen |
| `text` / `textMuted` | `#141A21` / `#566270` | `#E6EDF3` / `#98A4B3` | Content; supporting meta |
| `primary` | `#2457A6` | `#79B1F5` | The one accent: links, the back control, the primary button |

Why blue and not the Fair's warmth: the brief's warm-notebook option was on the
table and lost on the job rather than on taste. The screens this system has to
carry first are a list and a detail full of state, and a warm paper ground puts
every state colour on a tinted field. The warmth the brief asks for is spent
instead in **one** place, on the incident number and its marks. This is the
direction 3c's dispatch console inherits most directly, which is the other
reason it won.

## Type

The platform system font, no face shipped — it renders identically on the three
platforms and costs nothing. Six steps, tracking tightened on the two largest
and left at zero from body down. Sizes run one step smaller than the 09l stub
(`body` 15, not 16) because density is the point; `touchTarget` stays 44 pt, so
nothing became harder to hit.

`figure` is the number step: `tabular-nums`, so a column of incident numbers
aligns on the digit rather than drifting.

## The colour language

| Thing | Rule |
| --- | --- |
| State | **Open** carries `info` and is the only state with colour; **Closed** is `neutral` and recedes |
| Priority | **High** is `danger`, the loudest thing on a row; **Low** is `neutral`; **Normal** gets no badge at all |
| Private | `restricted` — violet, distinct from every state and priority hue, so it reads as "restricted", never as "danger" |
| Always | The label text is always present. Colour is never the only carrier: a reader with no colour vision sorts the list by the words |

Badges are tinted chips — the tone's ink on a ~14% (light) / ~22% (dark) wash of
itself — rather than solid blocks, so a row with three marks stays calm.

## Motion budget

The whole budget, from `tokens.motion`:

- **Press feedback only.** `scale 0.97` on press-in, 120 ms, strong ease-out
  (`0.23, 1, 0.32, 1`), on anything pressable. Rows and buttons are touched
  dozens of times a session, so the feedback is near-imperceptible by design.
  `pressRetentionOffset` keeps a drifting finger from cancelling.
- **Nothing enters with an animation on a list.** No `entering` on virtualized
  rows, no stagger. An empty or error body may fade in over 200 ms — that is
  content the person waited for.
- **Screen transitions are the platform's**, never rebuilt in JS.
- **No springs, no haptics** in v0: nothing here is dragged and nothing snaps.
- **Reduced motion drops the scale** and keeps opacity, and ships with the
  animation rather than after it.

## Accessibility floor

- Every text-on-background pair that occurs passes **WCAG AA (4.5:1)** in both
  schemes; the lowest is 4.60:1 (the `neutral` badge's ink on its own tint,
  dark). Every non-text boundary that carries meaning clears **3:1**; the
  lowest is 3.75:1 (`borderStrong` on `surface`, dark). The full table — 42
  pairs, generated from `tokens.ts` rather than read off a screen — is in the
  3a.4 PR.
- `border` is decorative and does **not** meet 3:1 — that is deliberate, and why
  `borderStrong` exists. Anything whose boundary carries meaning (a field, a
  control, a focus ring) uses `borderStrong` or `focus`, both of which clear 3:1.
- 44 pt minimum touch target; grow the hit area with `hitSlop` before growing
  the visual.
- Dynamic type is respected: no measured or hard-coded heights on text.
- Colour is never the sole carrier of meaning.

## The mark

A rail and three ledger lines — the number column and the summaries beside it,
ragged at the right the way a list of them is. No wordmark inside the icon: it
has to survive being 16 px in a browser tab. It is drawn by
`scripts/brand-assets.mjs` from the `primary` / `onPrimary` tokens, so the icon,
the Android adaptive layers, the monochrome layer and the favicon are all
regenerated by running that script rather than edited as binaries.

## Deliberately not done

- **No custom typeface.** The system font is right until something proves it is
  not; a face is weight on every platform.
- **No elevation on the list.** Levels 1 and 2 exist in the tokens for the
  toolbar and for the sheets 3b brings; rows separate with a rule and tone.
- **No user-facing scheme preference.** The OS decides, per 09o.
- **The `overlay` and `surfaceSunken` roles are defined but not yet used** —
  they land with the sheets and the dispatch table (3b, 3c) rather than being
  retrofitted later.
- **No splash screen.** `expo-splash-screen` is not installed, so `app.json`
  configures none; `assets/splash-icon.png` is drawn and waiting for the day it
  is. That is an inherited gap, not a decision this direction made.
- **No `Sheet`, `TabBar` or `Toolbar` primitives.** `ScreenHeader` is the
  toolbar for now; the other two arrive with 3b.1.
