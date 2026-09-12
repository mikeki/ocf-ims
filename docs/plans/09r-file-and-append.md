<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09r — D2 and slice 3b.2: file an incident, append an entry

> **Status:** **Brief written, prototype round built — waiting on the pick** (2026-09-11).
> The surface is `app/(dev)/compose.tsx` + `src/prototypes/d2/`, dev-only, deleted after
> the pick.
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, §6 **D1** and the 3b.2 row)
> under [09-proto-connect-platform.md](09-proto-connect-platform.md)
> **Follows:** [09q](09q-field-flows.md) (3b.1 — the Board). The Board is where filing starts
> and where a filed incident lands; nothing in 3b.2 is reachable except through it.
> **Owner:** Design (the picker round, run by the maintainer) → Architect (this brief, the
> draft / mention / invalidation rules, review) → Builder (Sonnet, the screens).
> **The skills:** Emil Kowalski's skills govern all UI work (the maintainer's rule,
> 2026-09-10) — `prototype` for the round below, `animate-expo` for anything that moves,
> `review-animations` before the PR is called done.
> **Last updated:** 2026-09-11

## Objective

3b.2 is the first slice that **writes**. Until now the client has been a window; after it a
person at the fair can, from their phone, file an incident and add to one — the two things a
volunteer actually does with the system, and the two things dispatch waits on. Everything
later in 3b assumes them: 3b.4 attaches a photo to an entry, 3b.5 notifies someone that an
entry mentioned them, 3b.6 makes the entry appear on another phone by itself.

09i §8 lists the deliverable: new incident (summary, priority, types with "Other" →
`ProposeIncidentType`, area picker over `ListAreas`, location description / booth, first
entry); append an entry with an `@mention` picker over `ListPersonnel`; "on behalf of";
`viewer_may_add_journal` gating; optimistic list updates; invalidations. **One of those does
not exist on the incident side of the wire** — see the next section — and moves to 3b.3.

## What is already true on the wire (verified, 2026-09-11)

No proto change, no server slice. Every RPC 3b.2 needs is there; two facts shape the slice.

| Question | Answer | Source |
|---|---|---|
| File | `CreateIncident{event_id, incident: IncidentUpdate}` → `incident_number`. An absent field takes the create default (state OPEN, priority NORMAL, empty lists) | `rpc/v1/incident.proto` |
| File with a first entry | `IncidentUpdate.journal_entries[]` rides on the same call — one round trip, no "create then append" | same |
| Append | `UpdateIncident{update: {journal_entries: [NewJournalEntry]}}` with nothing else set | same |
| What an entry carries | `NewJournalEntry{text, mentioned_person_ids[]}` — **and nothing else** | same |
| Who may append | `IncidentView.viewer_may_add_journal`. Server side: `write_incidents`, or a 52f per-incident grant **with a journal-only payload** — a grantee's update that touches any other field is `permission_denied`, not silently trimmed | `internal/incident/connect.go` `isJournalOnly` |
| Who may file | `AccessForEvent.write_incidents` | `rpc/v1/auth.proto` |
| Mentions | ids on the entry; the server resolves handle / name. The typeahead is `ListPersonnel{event_id, query}`: **under 2 characters answers an empty list**, matches handle, name and wristband, any signed-in caller may ask | `internal/person/personnel.go` `searchPersonnel` |
| Types | `ListIncidentTypes` (global, any caller). `hidden` stays out of the picker. `ProposeIncidentType{event_id, incident_type: {name}}` needs `write_incidents` and returns the id — **on a name collision, the existing type's id**, so the client attaches whatever comes back and never has to search first | `internal/incidenttype/connect.go` |
| Areas | `ListAreas{event_id}` gated on `read_areas` (the Board already does this). `CreateArea{event_id, area: {name}}` from a writer is a **proposal** (unapproved, proposer recorded) that returns a slug usable at once; an area admin's is approved on the spot | `internal/area/connect.go` |
| Priority | `LOW = 1`, `NORMAL = 3`, `HIGH = 5`; `UNSPECIFIED` means unchanged, which on create means NORMAL | `resources/v1/incident.proto` |
| Location | `IncidentLocation{area_slug?, description?, booth?}`, each optional, an empty string clears | same |
| Summary | optional, max 1024. The server files an incident with no summary | same |

### The two facts that shape the slice

**1. "On behalf of" is not an incident thing.** `JournalEntry.on_behalf_of` exists on the
read side, but the only write that reads it is the **report** path (`reportWriteToJSON`
copies `on_behalf_of.person_id`; `NewJournalEntry` for incidents has no such field and the
templ client's incident page "leaves it null"). It was a 6m feature for reports — a booth
files several entries for the same person. The 09i 3b.2 row bundles it with incident
entries; that is a slip in the plan, not a gap in the contract. **It moves to 3b.3 with the
rest of report writing.** Adding it to `NewJournalEntry` would be a proto change for a
behaviour nobody asked for on incidents.

**2. A grantee's composer must send a pure journal payload.** The write body is
presence-tracked, so the client has to be careful about what "nothing else set" means on
the wire: `state` and `priority` are enums (`UNSPECIFIED` = unchanged, fine), but
`summary`, `private`, `location` and the three lists are `optional` — a client that builds
an `IncidentUpdate` from a form with every field present, even "unchanged", turns a
grantee's append into a 403. The append path builds the message from **only** the entry. A
test asserts the request has exactly one populated field.

### The payload, measured (the question 09q deferred)

`ListIncidents{event_id, exclude_system_entries: true}` against the staging seed,
2026-09-11:

| | Incidents | Human entries | Identity | gzip |
|---|---|---|---|---|
| System entries excluded | 203 | 1 | 84 KB | 10.8 KB |
| System entries included | 203 | 15 | 86 KB | 11.2 KB |
| `ListReports` | — | — | 419 B | 297 B |

The number flatters: the seed's 203 incidents carry **one** human-written entry between
them, so the response is ~415 bytes per incident of pure summary. A fair-scale incident with
five entries of 200 bytes is ~1.4 KB, so a real Saturday evening is nearer **300 KB /
~40 KB gzip** per poll. That is acceptable for 3b.2 on a 30 s poll. It stops being acceptable
when 3b.6 refetches on every poke, at which point the server-side "mine" filter (09i §8
follow-up) becomes a 3b.6 prerequisite. **Recorded; not this slice.**

## The prototype round (the maintainer's to run)

The direction is settled (Dispatch, [09o](09o-design-v0.md)) and the Board's shape is
settled (Segmented, [09q](09q-field-flows.md)). **This round does not revisit either.**
Every variant reads tokens through `useTheme()` and reuses the primitives and the shipped
`ScreenHeader`, `WorkRow` and `JournalEntryRow` unchanged. What is open is **what filing
is** on a phone at a fair: how much the app asks before it lets you send.

The three variants share one set of ingredients — the same composer input with the same
`@` typeahead, the same type / area / priority pickers, the same fixture event — so the
comparison is about the flow and not about three composer designs.

| Variant | Axis | The claim it makes | What it costs |
|---|---|---|---|
| **Radio** | *Speed* — filing is sending a message | The Board grows a docked "What's happening?" bar. One box: the first line becomes the summary, the whole text the first entry. Priority, type and area are chips beneath it that you *can* tap and never must. On an incident the same bar is the composer, always there when you may add to the journal. | Incidents land untyped and unplaced more often; dispatch triages what the field didn't. A bar under the list costs the list a row of height on every screen |
| **Intake** | *Completeness* — filing is a form | A "New" control on the Board opens a full-screen form in the incident's own order: summary, priority, types, location, first entry, File. Appending is a "New entry" button that opens a composer sheet over the incident. What dispatch relies on is captured at intake. | A form on a phone is a scroll-and-keyboard fight; slower per filing, and the sheet is a tap before every entry |
| **Walk** | *Sequence* — filing is a few questions | The same "New" control starts a walk: what happened → where → how urgent and what kind → file, one question per screen, with skip on the optional ones. Each picker gets the whole screen and a big list. Appending is the composer as a screen of its own. | The most taps of the three, and a wizard for something a busy volunteer does twenty times a shift starts to feel like a form that won't fit |

**How to run it:**

```
/prototype D2 — filing and appending for plan 09i slice 3b.2 (docs/plans/09r-file-and-append.md).
Three variants on the axes in that file's prototype-round table: Radio, Intake, Walk.
Dispatch and the Board's shape are chosen — diverge on the FLOW, not on colour or on the row;
read tokens through useTheme() and reuse the primitives, ScreenHeader, WorkRow and
JournalEntryRow. Do not modify src/design/* or the existing src/features/*. Dev-only Expo
Router route outside the session gates; realistic data from src/test/fixtures.ts, no server —
the writes land in local state so the flow can be walked end to end. Motion: only PressFeedback
and StateFade from src/design/motion.tsx; nothing enters with an animation on a list. Picker
from PICKER.md, at the top (a docked composer owns the bottom).
```

Each variant must let the maintainer, with fixture data: file an incident with and without
the optional fields, type a type name that does not exist and see the "propose it" offer,
type an area that does not exist and see the "create it for this event" offer, append an
entry to an existing incident that `@`-mentions someone from the typeahead, and see that
entry appear in the journal — all in light and dark.

### What happened — the round, 2026-09-11

Built on `app/(dev)/compose.tsx` over `src/prototypes/d2/`: one in-memory `ImsService`
with the five write RPCs' semantics (`store.ts`), one set of ingredients (`ingredients.tsx`
— the composer with the `@` typeahead, the priority / type / area choosers), stand-ins for
the Board and the incident with slots for each variant's entry point and composer
(`mini.tsx`), and the three flows. Every flow was walked end to end with the project's
Playwright runner — file with a proposed type, a created area and a mention; append with a
mention; see both in the journal — in light, and loaded in dark. The pick is recorded here
when it is made, in a table like 09q's.

Found by running it rather than reading it:

1. **Radio doubles the summary.** "First line is the summary, the whole text is the first
   entry" puts the same sentence on the incident twice for a one-line message — the header
   and the first journal entry read identically. Either the first line is the summary and
   *only the rest* is the entry (a one-liner then has no entry, which is fine), or the
   summary is its own field. Whichever variant wins, the rule is decided in this file
   before the build, not in the composer.
2. **The typeahead has to own the caret.** The `@` trigger is a function of the text up to
   the caret, not of the whole text, so the composer tracks `onSelectionChange`; an
   inserted token moves the caret past itself. RN Web's selection events behave; a device
   check is still owed for the native keyboard.
3. **The MCP browser's synthesised clicks do not drive RN Web presses** (09q's warning,
   confirmed again); the flows were proven with the real runner.

## The rules the winner inherits (shape-independent)

Whatever is picked, these hold, and they are the architect-tier part of the slice.

### The write payloads

- **File** is one `CreateIncident`. The first entry, when there is one, rides in
  `journal_entries` on that call. The response's `incident_number` is the navigation target:
  the filing screen is **replaced** by the incident, never pushed under it, so back from the
  new incident goes to the Board.
- **Append** is one `UpdateIncident` whose `update` carries **only** `journal_entries`. A
  test asserts that no other field is present on the wire (the grantee 403 above).
- **A type that doesn't exist** is `ProposeIncidentType` first, then the returned id goes in
  `incident_type_ids`. The client never searches for a collision; the server resolves it.
- **An area that doesn't exist** is `CreateArea` first, then the returned slug goes in
  `location.area_slug`. The offer is only shown to a caller with `write_incidents`; a
  proposed area renders exactly like an approved one on the phone (the admin's review is a
  3d concern).
- **"Other"** is pinned last in the type list as the type-your-own trigger, as the templ
  client does. It is never sent as a type.

### Mentions

- `@` at a word start (start of text, or after whitespace) opens the typeahead; whitespace
  closes it; an `@` mid-word (an email) does not open it. **Below two characters the server
  answers nothing, so the client asks nothing.**
- Picking inserts `@<handle>` (handle, else name — one word, never the "Fair (Legal)" label)
  plus a space, and records `{personId, token}`.
- **At submit, only mentions whose token is still in the text are sent.** Deleting the word
  drops the mention. One function, `mentionedIds(text, picked)`, with its own test.
- The pending mentions are per composer and are cleared on a successful submit.

### Drafts (the one concession to offline, 09i §3)

- Keyed per event and per target: `ocf-ims/draft/<eventId>/incident/<number>` and
  `…/incident/new`. Pure functions over `AsyncStorageLike`, like `seen.ts`; the hook wires
  the real module.
- Saved on a 400 ms debounce while typing; **flushed on blur and on background**.
- Restored on open with a visible note ("Restored an unsent entry"), never silently.
- A `new` draft **migrates onto the assigned number** after a successful file, so a reload a
  second later still finds it.
- Cleared on a successful submit. **Cleared on sign-out**, unlike the watermark and the
  remembered event: a draft is incident content, and the persisted query cache that holds
  incident content is cleared on sign-out for the same reason.

### Gating

- The filing entry point shows only with `write_incidents`.
- The composer shows only with `viewer_may_add_journal`. A reader sees the journal with no
  composer and no explanation; the absence is the message.
- The "propose it" / "create it" offers show only with `write_incidents` — the server would
  refuse anyway; the client just doesn't offer.

### Cache

- After **file**: invalidate `ListIncidents(event)`; the new incident is opened by number,
  so `GetIncident` fetches fresh. The Board's watermark needs nothing: something I created is
  not unread (09q).
- After **append**: an **optimistic** entry in the `GetIncident` cache (negative id, author =
  my handle, `created` = now, the text and the mention refs), then invalidate `GetIncident`
  and `ListIncidents(event)` on settle. On error, roll back and **keep the text in the
  composer and in the draft**; the error renders beneath the composer, not as a screen.
- After a proposal: invalidate `ListIncidentTypes`; after a create-area: `ListAreas(event)`.
- The 30 s poll and pull-to-refresh are untouched.

### Privacy

Nothing new. The client adds no privacy logic (09q); the server's write path answers 404 for
an incident the caller may not see, and the screen already renders that as "Not found".

### Motion

The existing budget only: `PressFeedback` on every pressable, `StateFade` on an empty or
error body. **The typeahead's result list does not animate in.** A composer sheet, if the
pick has one, uses the platform's own presentation (`presentation: "formSheet"` /
`"modal"` on the stack), never a hand-rolled slide. `/review-animations` runs before the PR
is called done.

## 3b.2 acceptance criteria (the builder's list, after the pick)

1. The picked flow files an incident with every field in `IncidentUpdate` the round showed,
   and with none of the optional ones; the incident opens by its returned number.
2. Append sends a journal-only `IncidentUpdate`; a test asserts the wire shape.
3. Mentions: typeahead trigger rules, insertion, and the submit-time filter each have a test.
4. Drafts: save, restore-with-note, migrate `new` → number, clear-on-submit, and
   clear-on-sign-out each have a test.
5. "Other" → propose → attached; unmatched area → create → set. Both against the fake
   `ImsService`, which grows `CreateIncident`, `UpdateIncident`, `ProposeIncidentType`,
   `CreateArea` and `ListPersonnel` with the server's semantics (collision → existing id;
   query under two characters → empty).
6. Gating: no entry point without `write_incidents`; no composer without
   `viewer_may_add_journal`; no offers without `write_incidents`.
7. Every state is designed: a failed file (form-level error, fields kept), a failed append
   (inline, text kept), a validation violation on `summary` (the `Field` error line — the
   09l F12 path finally has a real caller).
8. The tracer grows a step: file an incident, append an entry that mentions the seed's
   other user, sign out. Interim mode against staging.
9. No change to `src/api/*`, `src/session/*`, `src/lib/permissions.ts` — architect-tier.
   The sign-out draft clear is the one exception and is the architect's edit.
10. The 09i §9 list passes.

## Out of scope

- **Reports.** Filing one, appending to one, on-behalf-of — all 3b.3, which also owes the
  Reports-vs-Incidents conversation (09q open question 4) before it is briefed.
- **Photos.** 3b.4. The composer leaves room for an attach control; it does not draw one.
- **Editing an incident** — state, priority after filing, people, links, private. That is
  3c.2's editor. 3b.2 sets fields at filing time only.
- **Live updates and push.** 3b.6 and 3b.5.
- **A server-side "mine" filter.** Measured above; a 3b.6 prerequisite, not this slice.

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

Hand checks go against **staging**, never a local stack. **Staging must never hold real
data** — file test incidents with obviously test content, and expect them to be there for
the next person.

## Checklist

- [ ] The maintainer runs `/prototype` with the invocation above and picks a flow
- [ ] The pick and its reasoning are recorded in this file
- [ ] `mentionedIds`, the draft functions and the journal-only payload land with their tests
- [ ] The fake `ImsService` grows the five write-side RPCs
- [ ] The screens are built against the picked flow
- [ ] `/review-animations` run and clean
- [ ] The prototype surface is deleted (the skill's cleanup rule)
- [ ] Tracer step added; interim mode green against staging
- [ ] Staging hand check on a real phone: file, append with a mention, see it in the journal

## Open questions

1. **Does the first line of the text become the summary, or is the summary its own field?**
   Radio says the former; Intake and Walk the latter. The picker answers it. Whichever wins,
   the server treats `summary` and the first entry as independent, so a summary-less filing
   is legal and the Board row shows "(no summary)" — a state the picked flow must make hard
   to reach by accident.
2. **Should a filed incident be marked seen on this device?** The watermark says something
   I created is never unread, so no mark is needed today. If 09q open question 5 (a
   `last_modified` on reports) ever lands for incidents' summaries too, revisit.
3. **Is a proposed area distinguishable on the phone?** Not in this slice — it renders like
   any other. Dispatch's admin sees the proposal queue on the web. If the field needs to
   know "this area is pending", that is a row decoration for 3c to decide.
4. **The typeahead's floor is two characters and the fair has one-letter handles.** Rare,
   and the server's rule; a person with a one-character handle is found by their name. Noted
   so nobody files it as a client bug.
