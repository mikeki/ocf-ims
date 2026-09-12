<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09q — D1 and slice 3b.1: "My work", the field app's first screen

> **Status:** **Built** — the picker round ran and chose Segmented (2026-09-11); slice
> 3b.1 shipped in #256. Open: `/review-animations`, and a hand check on a real phone.
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, §6 **D1** and the 3b.1 row)
> under [09-proto-connect-platform.md](09-proto-connect-platform.md)
> **Follows:** [09p](09p-stream-and-push.md) (3b.0 — the server half of the field app:
> `WatchEvent` and native push). 3b.0 built the plumbing; **nothing in the client consumes
> it yet** — that is 3b.6, four slices away.
> **Owner:** Design (the picker round, run by the maintainer) → Architect (this brief,
> the classification and watermark rules, review) → Builder (Sonnet, the screen).
> **The skills:** Emil Kowalski's skills govern all UI work here (the maintainer's rule,
> 2026-09-10) — `prototype` for the round below, `animate-expo` for anything that moves,
> `review-animations` before the PR is called done.
> **Last updated:** 2026-09-11

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

## The prototype round (the maintainer's to run)

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

### What happened — the round, 2026-09-10

Three variants were built on a throwaway surface (`src/prototypes/d1/` + a dev-only
`app/(dev)/mywork.tsx`), each applied to the same fixture event and sharing one row
component, so the comparison was about shape and not about three row designs. The
classification and the watermark ran for real, not as mock output.

| Variant | Axis | Outcome |
|---|---|---|
| Two lists | Separation — a place you go | Never reconciles the asymmetry, but splits "what is waiting for me" across two headings, and leans on the section header to say what a row is |
| **Segmented** | **Filter — a view of the event** | **CHOSEN, 2026-09-11.** No new destination; each segment counts only what it lists |
| Inbox | Queue — a list needing attention | Best single answer to "what next", at the price of sorting `last_modified` directly against a report's newest entry |

Two defects were found by running it rather than by reading it: the Segmented badge
counted unread *reports* while the segment listed only incidents (a count pointing at
rows the filter removes), and the unread dot carried colour as its only signal with no
accessible name. Both fixed in the surface.

### Decisions taken in the round

1. **Incidents keep `#214`; reports become `R-38`.** An incident and a report can both
   be 214 in the same event, so something has to disambiguate them — but only one of the
   two needs to carry the mark. (`I-214` / `R-38` was tried first and rejected: it taxes
   the common case and forces a sweep of every shipped screen and of the tracer, to buy
   clarity in the one place the pair actually collide.) Incidents are the record the fair
   runs on and the one the app and the radio already call `#214`; marking only reports
   buys the same clarity for a fraction of the change — `IncidentRow`, `IncidentScreen`
   and the linked-incident buttons are untouched.
   **The cost is an asymmetry that quietly takes a side on open question 5.** Giving
   reports their own namespace entrenches them as a different KIND of record. If they
   turn out to be a later PHASE of an incident, this is the notation that has to be
   undone — cheap now, less so once it is in people's mouths.
2. **The screen is a "Board", not "My work"** — the word is the header's title. The
   picker preview put the event on the back control (`‹ 2026   Board`); what shipped
   keeps 09n's convention that back is labelled with the *parent screen* (`Events`,
   which is also what the tracer selects on) and shows the event's name in the header's
   right slot: `‹ Events   Board   2026`. Swapping to the preview's form is a one-line
   change in `BoardScreen.tsx` if it reads better on a phone.
3. **"All" marks the rows that are yours.** A 3 px rule down the leading edge in
   `primary`, plus the "why" line ("You filed", "You're on it") that everyone else's row
   does not spend. Without it, at 185 rows a *read* row of yours is indistinguishable
   from a stranger's, and the segments become the only place ownership is legible. The
   rule is deliberately not another chip: it survives a fast scroll, costs the row no
   height, and cannot be mistaken for the badges, which are all about the incident rather
   than about you. It shows only where a list mixes — never in Mine, where every row
   would wear it.

### What the round found about scale

The first fixture set had eight incidents, which flattered every variant. Rebuilt with
**185** — a fair-scale Saturday evening — two things appeared that a small list hides:

1. **The list must be virtualized.** A `ScrollView` of every incident in the event is
   not viable; the surface now uses `FlatList`. Worth knowing for 3c as well: on the web
   build, React Native Web's virtualization is weak — 156 of 185 rows were in the DOM —
   so the dispatch table cannot assume `FlatList` alone solves this.
2. **"All" cannot tell you which rows are yours.** At eight rows it does not matter; at
   185 the only thing marking a mine-row in All is its unread dot, and a read one of
   yours is indistinguishable from everyone else's. Either All carries a mine marker, or
   the segments are the only place "mine" is legible — a decision the slice owes.

And it sharpens the payload question the plan deferred. The client-side filter downloads
**every incident in the event with its journal entries** to find the handful that are
yours. At 185 incidents on fair connectivity that is no longer obviously "acceptable at
fair scale, a server slice when it isn't" — it may already be the latter. Measure the
real response against staging before building, and if it is bad, a server-side filter is
a 3b.1 prerequisite rather than a follow-up.

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

## What 3b.1 cost that the brief did not predict

**A read-only report screen had to come with it.** The Board lists reports, the watermark
is written on OPEN, and there was no report detail to open — so a report row's unread mark
could never have been cleared. `src/features/board/ReportScreen.tsx` is the smallest thing
that makes the picked shape coherent: header, who filed it and when, whether it is attached
to an incident, and the journal. **Writing** a report is still 3b.3.

**The Reports segment cannot be pre-gated.** The server gates `ListReports` on three
separate read permissions (all / own / crew), and **`AccessForEvent` carries no
read-reports flag** — unlike `read_areas`, which is exactly how `useAreas` is gated. So the
client cannot know beforehand and has to ask: the Board issues the call, and hides the
segment if it comes back `permission_denied`, rather than offering a tab that answers an
error. A field on `AccessForEvent` would fix this properly; that is a server change, not
this slice.

**`aria-selected` is not derived from `accessibilityState` on the web.** React Native Web
does not map `accessibilityState={{ selected }}` to `aria-selected` for `role="tab"`, so a
screen reader on the web build could not tell which segment was current. The control now
sets both, and the tracer asserts the DOM attribute — only a real browser proves that
mapping, so a Jest test would not have caught it and did not.

**The tracer was already broken before this slice touched it.** `getByLabel("Password")`
became a strict-mode violation when 3a.4's `PasswordField` added a "Show password" button,
whose label also contains the word. It has been failing since that merge and nobody had
re-run it (09n's "hosted tracer green" box is still open). Fixed here with
`{ exact: true }`, because it was blocking this slice's verification.

**A warning for whoever automates against this UI:** the MCP Playwright browser's
synthesised clicks do not drive React Native Web's press responder at all — not the
segments, not the rows. The project's own Playwright runner does, and the tracer proves it.
Do not conclude a control is broken from that tool alone; drive it with the real runner or
dispatch a full pointer + mouse sequence.

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

Hand checks go against **staging** (the host in `docs/deployment.md`), never a local
docker stack. The seeded demo data has to actually contain items that are the tester's by each
of the three rules — **check that before trusting a green screen**; an empty "My work" and
a broken "My work" look identical.

## Checklist

- [x] The maintainer runs `/prototype` with the invocation above and picks a shape — **Segmented, 2026-09-11**
- [x] The pick and its reasoning are recorded in this file (a table like 09o's), and in
      `DESIGN.md` if it changes how a primitive is used
- [x] `changedAt`, `isMine` and the watermark land with their tests
- [x] The screen is built against the picked shape
- [ ] `/review-animations` run and clean
- [x] The prototype surface is deleted (the skill's cleanup rule)
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
4. **Are a Report and an Incident the same kind of thing at different times?** Raised by
   the project's sponsors, 2026-09-10, and explicitly deferred by the maintainer — recorded
   here so it is not lost. Two readings are in play: a Report as *somebody's report of an incident*
   (what the data model does today — `Report.incident` links one to an incident, and a
   report can exist with none), versus a Report as *a responder's write-up after the
   fact* (a phase of an incident, not a sibling of one). If the second is right, the two
   are one record with a lifecycle and the split in the schema is an accident of history;
   the app would grow a way to move between the phases rather than two parallel lists.
   This decides more than a screen — it decides whether "My work"/"Board" is one list or
   two, which is the question this very picker was asking. **It needs its own plan doc and
   a conversation with the sponsors before 3b.3 (Reports) is briefed.**
   **Answered 2026-09-12 → [09t](09t-reports.md): keep both.** A report stays its own
   record, filed on its own; an incident collects reports through a *request* (the
   incident's crew asks a person, who is notified and files a report that lands attached).
   The Board keeps two kinds of row.
5. **Should a report's summary edit mark it unread?** It cannot be detected client-side
   (see the asymmetry above). Either accept the gap or add `last_modified` to `Report` — a
   proto change, a migration, and a server slice, so **not** in 3b.1. Recorded here so the
   choice is deliberate.
