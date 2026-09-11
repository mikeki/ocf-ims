<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09q — D1 and slice 3b.1: "My work", the field app's first screen

> **Status:** Brief — **the shape question is open and belongs to Miguel.** The
> `/prototype` skill runs only when he invokes it (never on its own), so the picker round
> in § *The prototype round* is the next action, not something a builder starts.
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, §6 **D1** and the 3b.1 row)
> under [09-proto-connect-platform.md](09-proto-connect-platform.md)
> **Follows:** [09p](09p-stream-and-push.md) (3b.0 — the server half of the field app:
> `WatchEvent` and native push). 3b.0 built the plumbing; **nothing in the client consumes
> it yet** — that is 3b.6, four slices away.
> **Owner:** Design (the picker round, Miguel) → Architect (this brief, the classification
> and watermark rules, review) → Builder (Sonnet, the screen).
> **The skills:** Emil Kowalski's skills govern all UI work here (Miguel's rule,
> 2026-09-10) — `prototype` for the round below, `animate-expo` for anything that moves,
> `review-animations` before the PR is called done.
> **Last updated:** 2026-09-10

## Objective

3b.1 is the field app's front door: **the incidents and reports that are mine**, with a
mark on the ones that changed since I last looked. It is the first screen in the client
that answers a question about *me* rather than about an event, and it is the surface every
later 3b slice hangs off — 3b.2 files from it, 3b.5 deep-links into it, 3b.6 makes it move
by itself.

D1 in 09i §6 covers all of 3b's flows (sign in, pick event, my incidents, incident detail,
new incident, append entry, reports, notifications, settings). **This brief takes only the
first of them.** The rest get their own rounds as their slices come up — the composer with
3b.2, notifications with 3b.5 — because a prototype round is worth running against a real
question, and the composer's question is not the list's.

## What is already true on the wire (verified, 2026-09-10)

Everything 3b.1 needs is in the contract today. No proto change, no server slice.

| Question | Answer | Source |
|---|---|---|
| Who am I? | `person_id` | `GetAuthStatusResponse.person_id` |
| Did I create it? | `created_by.person_id` | `Incident.created_by`, `Report.created_by` (both `PersonRef`, both optional) |
| Am I attached? | `people[].person.person_id` | `Incident.people[]` (`IncidentPerson`) |
| Was I mentioned? | `journal_entries[].mentions[].person_id` | `JournalEntry.mentions` (`repeated PersonRef`) |
| Are the entries in the list read? | Yes | `ListIncidents`/`ListReports` return full `journal_entries`; the client asks with `exclude_system_entries: true`, which drops only generated entries — **mentions live in author-typed entries, so they survive** |

So the "mine" classification is a pure function of one `ListIncidents` response, one
`ListReports` response, and one integer. `src/features/incidents/hooks.ts` already polls
`ListIncidents` every 30 s with `excludeSystemEntries: true`; 3b.1 adds the reports
equivalent and reuses both.

**The client-side filter is deliberate, and the plan says so** (09i §8, 3b.1: "client-side;
a server filter is a noted follow-up"). The cost is honest: the response carries every
incident in the event with its journal, and the phone throws most of it away. That is
acceptable at fair scale and becomes a server slice when it isn't. It is recorded here so
the next person doesn't think it was an oversight.

### The asymmetry that shapes the screen

**`Incident` has `last_modified`. `Report` does not.**

```proto
message Incident { … google.protobuf.Timestamp last_modified = 5; … }
message Report   { … /* created, journal_entries — and nothing else temporal */ }
```

`Report` carries `created` and its journal, and that is all. A report also has **no
`people`** — there is no "attached to a report", so a report is mine only by authorship or
mention.

Two consequences the design has to absorb rather than paper over:

1. **"Changed at" is computed differently per type.** For an incident it is
   `last_modified`; for a report it is `max(created, journal_entries[].created)`. Any
   variant that interleaves the two into one ordering is sorting on two different
   definitions of the same column. That is fine — but it must be a decision, not an
   accident, and the helper that computes it belongs in one place.
2. **A report's non-journal edits are invisible to the watermark.** Editing a report's
   summary moves nothing a client can see, so such an edit will not mark the row unread.
   Say so in the UI's terms or accept it silently — but know it.

## The prototype round (this is Miguel's to run)

The design direction is settled — **Dispatch**, chosen in D0
([09o](09o-design-v0.md)), values in `src/design/tokens.ts`, reasoning in
`packages/interface/DESIGN.md`. **This round does not revisit it.** Every variant reads
tokens through `useTheme()` and reuses the existing primitives unchanged. What is open is
**shape**: what this screen *is*.

Three candidate axes, each a direction defensible on its own:

| Variant | Axis | The claim it makes | What it costs |
|---|---|---|---|
| **Two lists** | *Separation* — my work is a place you go | A dedicated route with its own header; incidents and reports in labelled sections. Cheapest to reason about; each section keeps its own empty state and its own ordering, so the `last_modified` asymmetry never has to be reconciled. | Another destination to navigate to, and the count of "things waiting for me" is split across two headings |
| **Segmented** | *Filter* — my work is a view of the event | The existing incidents list gains an All / Mine control; reports are a second segment. The screen you already know, narrowed. | Three segments is a lot of chrome on a phone; "mine" stops being a place and becomes a setting, which is easy to leave in the wrong position |
| **Inbox** | *Queue* — my work is a list of things needing attention | One chronological feed, incidents and reports interleaved, unread first, read below. The strongest answer to "what do I do next". | Forces the two "changed at" definitions into one sort; loses the per-type framing; hardest to make legible when a row could be either type |

**How to run it:**

```
/prototype D1 — the "My work" screen for plan 09i slice 3b.1 (docs/plans/09q-field-flows.md).
Three variants on the axes in that file's prototype-round table: Two lists, Segmented, Inbox.
Dispatch is already chosen — diverge on SHAPE, not colour; read tokens through useTheme()
and reuse the existing primitives. Do not modify src/design/* or the existing src/features/*.
Dev-only Expo Router route outside the session gates; realistic data from src/test/fixtures.ts,
no server. Motion: only PressFeedback and StateFade from src/design/motion.tsx — nothing
enters with an animation on a list.
```

Each variant must show, with fixture data: a mix of mine-by-creation / mine-by-attachment /
mine-by-mention, at least two unread rows and several read ones, both an incident and a
report, a private incident, and the empty state ("nothing is yours yet" is a *good* state
at the start of a shift, not an error).

## The rules the winner inherits (shape-independent)

Whatever is picked, these are the same, and they are the architect-tier part of the slice.

### Mine

An item is mine when **any** holds, against `GetAuthStatus.person_id`:

- `created_by?.person_id === me`
- (incidents only) some `people[].person?.person_id === me`
- some `journal_entries[].mentions[].person_id === me`

`person_id` is `0` when absent on the wire (proto3 scalar), and `GetAuthStatus` returns `0`
for an unauthenticated caller — so **`me === 0` classifies nothing as mine**, and the
function must not be reachable before the session is `signedIn`. Test that explicitly; a
zero that matches a zero would silently make every unattributed item everyone's.

### Unread

No server support exists, and none is being added. A **watermark per item**, local to the
device:

- Key it per event and per item, following `src/features/events/selected.ts` — pure
  functions over `AsyncStorageLike`, the hook wires the real module, so tests need only
  `src/test/storage.ts`.
- The stored value is the `changedAt` the row had when it was last opened.
- A row is unread when `changedAt > watermark`, and when there is **no** watermark and the
  item is not mine-by-creation — something arrived for me that I have never seen.
- Something I created myself is **not** unread on arrival. I just made it.
- **Not cleared on sign-out** — same reasoning as the remembered event: a device at the
  fair keeps its state across sign-outs. It holds ids and timestamps, nothing sensitive.
- Writing the watermark happens on **open**, not on render. A row scrolling past is not a
  read.

`changedAt(item)` is the single helper carrying the asymmetry above. One function, one
test file, used by every variant.

### Privacy

A private incident that reaches this list reached it through the server's own read gate —
`ListIncidents` already applies `mayViewIncident` (CLAUDE.md § Private incidents). The
client adds **no** privacy logic and must not try to: the row renders the `restricted`
badge the incidents list already renders, and nothing else. If a private incident is mine
by grant, it is mine.

## 3b.1 acceptance criteria (the builder's list, after the pick)

1. The screen renders the picked shape, from `ListIncidents` + `ListReports`, with pull-to-
   refresh and the existing 30 s poll.
2. "Mine" matches the three rules above; a Jest test covers each rule independently, the
   union, and the `me === 0` case.
3. Unread markers follow the watermark rules; a test covers first-sight, own-creation,
   open-then-return, and a changed row going unread again.
4. `changedAt` is one exported helper with its own test, including a report whose newest
   journal entry is older than its `created` (a report with no entries).
5. Every state is designed and reachable: loading, empty ("nothing is yours yet"), error
   with retry, and no-access — reusing `src/features/shell/`.
6. Reports rows state their type unambiguously. `#12` as an incident and `#12` as a report
   are different things and a volunteer will read them over a radio.
7. Motion is the existing budget only — `PressFeedback` on rows, `StateFade` on the
   empty / error body. **Nothing enters with an animation on a list**, and no new
   dependency. `/review-animations` runs before the PR is called done.
8. No changes to `src/api/*`, `src/session/*` or `src/lib/permissions.ts` — architect-tier
   (09i §7 rule 3); if the slice seems to need one, that is a finding to raise, not a
   file to edit.
9. The verification list in 09i §9 passes: `typecheck`, `lint`, `test`, `export:web`, `e2e`.

## Out of scope

- **Filing anything.** 3b.1 is read-only, like 3a.3 before it. The composer, the new-
  incident form, mentions-as-you-type and on-behalf-of are 3b.2 and get their own round.
- **Live updates.** The screen polls. Consuming `WatchEvent` — built in 3b.0b, unused — is
  3b.6, and it lands after the write path so there is something worth watching.
- **Push.** 3b.0c built the sender; the permission prompt and token registration are 3b.5.
- **A server-side "mine" filter.** Noted in 09i §8 and above; not this slice.
- **Photos, attachments.** 3b.4.

## Verification

From the repo root, the 09i §9 list:

```bash
pnpm install --frozen-lockfile
pnpm generate
pnpm -F @ocf-ims/interface typecheck
pnpm lint
pnpm -F @ocf-ims/interface test
pnpm -F @ocf-ims/interface export:web
pnpm -F @ocf-ims/interface e2e
```

Hand checks go against **staging** (`https://ims-staging.maybloom.tech`), never a local
docker stack. The seeded demo data has to actually contain items that are Miguel's by each
of the three rules — **check that before trusting a green screen**; an empty "My work" and
a broken "My work" look identical.

## Checklist

- [ ] Miguel runs `/prototype` with the invocation above and picks a shape
- [ ] The pick and its reasoning are recorded in this file (a table like 09o's), and in
      `DESIGN.md` if it changes how a primitive is used
- [ ] `changedAt`, `isMine` and the watermark land with their tests
- [ ] The screen is built against the picked shape
- [ ] `/review-animations` run and clean
- [ ] The prototype surface is deleted (the skill's cleanup rule)
- [ ] Staging hand check on a real phone, with data that exercises all three "mine" rules

## Open questions

1. **Does "mine" include incidents in events I am not looking at?** The screen sits under
   an event today (`app/(app)/events/[eventId]/…`). A volunteer works one event at a time
   at the fair, so per-event is almost certainly right — but "my work" is a phrase that
   implies *all* of it, and `ListIncidents` is per-event, so cross-event would be N calls.
   **Assumption until told otherwise: per-event, inside the selected event.**
2. **Does a mention by a system entry count?** It cannot happen today — the client asks
   with `exclude_system_entries: true` and system entries carry no mentions — but the
   answer decides whether the classification function should take the flag into account or
   ignore it. **Assumption: ignore it; classify over whatever entries the response holds.**
3. **Is an unread marker per item, or a count per section?** Shape-dependent; the picker
   answers it.
4. **Should a report's summary edit mark it unread?** It cannot be detected client-side
   (see the asymmetry above). Either accept the gap or add `last_modified` to `Report` — a
   proto change, a migration, and a server slice, so **not** in 3b.1. Recorded here so the
   choice is deliberate.
