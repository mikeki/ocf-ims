# Plan 81 — `@mention` people in journal entries

Status: **Idea — design sketch, not scheduled**

Part of the [collaboration & notifications track](80-collaboration-and-notifications.md).

## Motivation

While writing a journal entry on an incident (or field report), a user often
wants to **tag another person** — to pull them in, attribute something, or ask
them to follow up. Today the entry is plain text, so a name is just text with no
link and nothing the system can act on. Adding structured `@mentions` makes the
person a real reference, and gives the notifications feature
([`82-notifications.md`](82-notifications.md)) its first trigger.

## Design

### Storage — a side table (not text parsing)

Mentions are recorded in a dedicated table, **not** by re-parsing entry text on
read. At OCF's scale this is simpler and reliable (the maintainer's call:
"a side table makes sense for something of this scale — it wouldn't work for a
social network, but definitely works for this").

Sketch:

```
JOURNAL_ENTRY__MENTION
  JOURNAL_ENTRY  integer  not null   -- FK to the journal entry
  PERSON_ID      integer  not null   -- FK to PERSON (the mentioned person)
  primary key (JOURNAL_ENTRY, PERSON_ID)
```

The mentioned person is referenced by **`PERSON_ID`** (the registry key from plan
5e), so it survives handle changes and works for login-less people too. The entry
text still stores the human-readable `@handle`/name for display; the table is the
authoritative, queryable record of who was mentioned.

### Authoring UI

- In the journal-entry textarea, typing `@` opens a typeahead. **Reuse the
  existing people search** (`?q=` from plan 5e, the same `setupPersonCombobox`
  machinery used by the incident/visit person pickers) — no new search endpoint.
- Selecting a match inserts a mention token into the text and records the
  `PERSON_ID` to send with the entry.
- Scope the searchable set sensibly (e.g. people on the event, falling back to the
  global registry like the existing picker does).

### Rendering

- Rendered journal entries highlight/link each mention (e.g. to the person, once
  there's a person view to link to; until then, just styled text).

### API

- The journal-entry create payload gains an optional list of mentioned
  `person_id`s; the handler writes the `JOURNAL_ENTRY__MENTION` rows alongside the
  entry. Mutating → keep `LogRequest(true, …)`.

## Open questions

- **Token syntax in stored text** — `@handle` is ambiguous for login-less people
  (no handle) and for duplicate names. Options: store a marker the renderer
  resolves via the mention rows, or just store the display name and rely on the
  side table for truth. Decide during build.
- **Edit/strike semantics** — journal entries are append-only (can't edit a saved
  entry), so mentions are fixed at write time; no update path needed.
- **Who can be mentioned** — anyone in the registry vs. only event participants.
  Lean toward event participants first.

## Slices (when scheduled)

- **81a** — schema (`JOURNAL_ENTRY__MENTION`) + API (accept + persist mention
  person_ids on entry create) + tests.
- **81b** — authoring UI (`@` typeahead reusing the people combobox) + render
  highlighted mentions.

(Notifications on a mention are **not** part of this plan — that's
[`82-notifications.md`](82-notifications.md), which consumes the mention rows.)
