# Phase 6 — Feedback Round 4 (dashboard polish + people roster)

> **Status:** Plan — for review. **Owner:** TBD · **Last updated:** 2026-06-18
>
> Fourth feedback round from the **Maintainer's** review of the shipped
> dashboard (Phase 7) and people registry (5e / 6e) on a live server. Two
> independent items, sequenceable in either order:
>
> - **6i** — Dashboard auto-refresh should *update changed charts in place and
>   glow what moved*, not full-repaint every chart on every tick. Frontend-only.
> - **6j** — People needs an explicit **per-event participation roster**: add a
>   person to an event, and remove them — distinguishing "added by mistake"
>   (delete) from "ejected / not present" (kept, for the record). Touches schema.

## 1. Feedback intake & routing

| Area | Item | Routed to |
|---|---|---|
| Dashboard | Refresh repaints the whole page; want only the changed graph to adjust + glow | **6i** |
| People | No way to explicitly add a person to *this* event's roster | **6j** |
| People | No way to remove a person from an event (accidental add) — keep the global person | **6j** |
| People | No way to record that someone was *ejected* / *not present* this year | **6j** |

---

## 2. Slices

### 6i — Dashboard: update charts in place + glow the changed container

**Symptom.** Every (auto-)refresh visibly flashes the whole dashboard: each chart
is destroyed and recreated, and both tables are torn down and rebuilt, even when
nothing changed. The Maintainer wants the eye drawn *only* to what actually
moved.

**Current behaviour.** `dashboard.ts render()` redraws unconditionally on every
tick:

- `makeChart()` (`dashboard.ts:181`) does `Chart.getChart(canvas)?.destroy();
  new Chart(canvas, config)` — added in 7c so a reused canvas wouldn't throw
  *"Canvas is already in use"*. So all six charts are recreated each refresh.
- `drawAreaTable()` / `drawFollowUps()` (`dashboard.ts:253`, `:263`) remove every
  `<tr>` and re-clone the row templates each time.
- The four stat cards (`stat_total/open/closed/avg_close`) are reassigned each
  time. No change-detection anywhere.

**Design.**

1. **Hold chart instances**, don't recreate. Keep a `Map<string, Chart>` keyed by
   canvasId. First render: `new Chart(...)`. Subsequent renders: if the data for
   that chart changed, mutate `chart.data.labels` and `chart.data.datasets[].data`
   (and `backgroundColor` for the doughnuts, whose palette length tracks the
   bucket count) in place and call `chart.update()`. `makeChart`'s
   `destroy()` stays only as a first-build safety net.
2. **Diff before drawing.** Cache the last-rendered payload per chart / per stat /
   per table (a small deep-equal over labels+counts, the stat numbers, and the
   table rows). Only update — and only glow — the pieces whose data changed.
3. **Glow the container that changed.** Add a transient CSS class to the
   Bootstrap `.card` (or the stat card / table card) of whatever changed; remove
   it on `animationend` so it can re-fire next tick. New `@keyframes` +
   `.glow-changed` rule in `web/static/style.css` (a brief box-shadow/background
   pulse that reads in both light and dark themes).
4. **No glow on first load.** The initial render establishes the baseline; glow
   only fires on *subsequent* refreshes (manual or auto), so opening the page
   doesn't light everything up.

**Containers to track (ids already in `dashboard.templ`):**

| Piece | Canvas / element | Card to glow |
|---|---|---|
| State | `chart_state` | enclosing `.card` |
| Priority | `chart_priority` | enclosing `.card` |
| Category | `chart_category` | enclosing `.card` |
| Type | `chart_type` | enclosing `.card` |
| Area | `chart_area` | enclosing `.card` |
| Per-day | `chart_byday` | enclosing `.card` |
| 4 stat cards | `stat_total` … `stat_avg_close` | each stat `.card` |
| Busiest locations | `area_table_body` | enclosing `.card` |
| Open follow-ups | `followups_table_body` | enclosing `.card` |

Charts sit inside `.card-body` with no id on the card itself, so the glow target
is `canvas.closest(".card")` (or add explicit ids in `dashboard.templ` if that
reads cleaner — small templ tweak, optional).

**Files:** `web/typescript/dashboard.ts` (instance map + diff + glow trigger),
`web/static/style.css` (glow keyframes), optionally `web/template/dashboard.templ`
(card ids). **No API change** — `generated_at_ms` already exists, and the
"Last updated" label keeps ticking off the client fetch time (7c follow-up).

**Tests.** Pure-runtime; the Playwright `dashboard` spec is the natural guard
(not in CI). Add an assertion that a second refresh with identical data does
*not* glow any card, and that changing the underlying data glows exactly the
affected card. Server-side templ render smoke (`web.TestTemplEndpoints`) already
covers the page renders.

---

### 6j — People: per-event participation roster (add / remove / track)

**Goal (Maintainer's words):** *"make sure our people management makes sense"* —
be able to add a person to an event's roster, and remove them, while keeping the
**global** `PERSON` intact and re-addable. Two removal intents:

- **Added by mistake** → actually remove the participation row.
- **Ejected / not present this year** → keep the row for the record, mark the
  state; who and when is captured by the action log.

**Current state (verified).**

- `PERSON__EVENT` (`store/schema/current.sql:136`, schema **v44**) holds
  `(PERSON_ID, EVENT, WRISTBAND, PARTICIPATION_TYPE)`,
  `PARTICIPATION_TYPE enum('crew','participant','public')`.
- Rows are created **only** by `CreatePerson` (with an event;
  `api/person.go:235`) and `EditPerson` (`setPersonEvent`, read-first then
  Insert/Update; `api/person.go:458`). Both require `GlobalAdministratePersonnel`.
- Attaching a person to an **incident** (`INCIDENT__PERSON`) or **sanctuary
  visit** (`VISIT__PERSON`, `VISIT.GUEST_PERSON_ID`) is **fully independent** — it
  does **not** create a participation row. (So the assumption that attaching
  enrolls someone is not how it works today; we keep them independent.)
- There is **no DELETE** of `PERSON__EVENT` anywhere.
- The People page (`people.ts` / `people.templ`) loads `AllPeople` (every person,
  `LEFT JOIN PERSON__EVENT` → per-event wristband/participation badges) and
  filters client-side. The event picker is pinned on the event doorway, free on
  the admin doorway.

**Decisions (settled with the Maintainer):**

- **D1 — Roster by default + "Show all" toggle.** The event People page shows
  only people **with a participation row for the event** (the roster). A
  *Show all people* toggle (**off by default**) switches to the full registry so
  anyone can be found and added.
- **D2 — No auto-enroll.** Incident/visit attach stays orthogonal. Enrolment is
  always an explicit action where you pick the participation type.
- **D3 — Removal is two-flavoured, always warned:**
  - *Added by mistake* → **hard-delete** the `PERSON__EVENT` row (new endpoint).
  - *Ejected / not present* → **keep** the row, set `PARTICIPATION_TYPE` to a new
    value; the mutating call is action-logged, giving who+when for free.
- **D4 — Two new participation values:** extend the enum to
  `('crew','participant','public','not_present','ejected')`. `crew/participant/
  public` are the *active* roster; `not_present/ejected` are *kept-but-inactive*.

**Schema (migration `45-from-44.sql`, version 45).**

```sql
alter table PERSON__EVENT
  modify column PARTICIPATION_TYPE
    enum('crew','participant','public','not_present','ejected')
    not null default 'public';
update `SCHEMA_INFO` set `VERSION` = 45;
```

Mirror the same `enum(...)` in `store/schema/current.sql` and bump its version to
45. Re-run `go test ./store/integration` (`TestMigrateSameAsCurrentSchema` replays
v37→ from the frozen 36.sql baseline) and `go tool sqlc generate` (regenerates the
`PersonEventParticipationType` constants — two new ones appear).

**Queries (`store/queries.sql`).**

- **`DeletePersonEvent`** — `delete from PERSON__EVENT where PERSON_ID = ? and
  EVENT = ?;` (the "added by mistake" path).
- **`EventRoster`** (or extend `AllPeople`) — people **with** a row for the event
  (`inner join PERSON__EVENT`), carrying wristband + participation type, ordered
  by `coalesce(NAME, HANDLE)`. The *Show all* toggle keeps using `AllPeople`.

**API.**

- **New `DELETE /ims/api/personnel/{personId}/participation?event=NAME`** →
  `DeletePersonEvent`. Per the registry's page-path vs API-query asymmetry rule
  (identity is global, participation is per-event), the event rides as a **query
  param**, not a path sub-resource. Gate on `GlobalAdministratePersonnel`.
  **Register with `LogRequest(true, …)`** in `api/mux.go` — this is the audit
  trail; mutating, must be logged.
- **Add to event** and **mark ejected/not-present** reuse **`EditPerson`**
  (`POST /ims/api/personnel/{personId}` with `{event, participation_type,
  wristband?}`) — its `setPersonEvent` already Inserts-or-Updates. No new endpoint
  for those two; only the delete is new.
- **`validParticipation`** (`api/person.go:294`) must accept the two new values so
  `EditPerson` can set them. The Add/Edit *role* dropdown still offers only the
  three active roles; `not_present`/`ejected` are reached through the Remove
  action, not the role picker.

**Web UI (`people.templ`, `people.ts`).**

- Default view = **roster** (event participants). A **Show all people** toggle
  (off by default) flips to the full `AllPeople` list so non-members can be found.
- **Add person to event** — a global typeahead (existing `?q=` search) to pick any
  `PERSON`, then choose a participation type (and optional wristband) → POST to
  `EditPerson` with the event → row created. (Search-first-then-add, mirroring the
  incident person combobox.)
- **Remove from event** — per-row, **always warns**, offering two outcomes:
  - *Added by mistake (remove)* → `DELETE …/participation?event=`.
  - *Ejected / Not present (keep record)* → `EditPerson` setting
    `participation_type = ejected | not_present`.
  The dialog notes that the global person and any incident/visit links are
  retained — only event participation changes.
- Roster rows for `not_present` / `ejected` people render with a muted badge (or
  are surfaced under *Show all*) so an ejection stays visible without cluttering
  the active roster.

**Edge notes (call out in review, not necessarily code):**

- An `ejected` person keeps their `WRISTBAND`, which still occupies the
  `(EVENT, WRISTBAND)` unique key. If a wristband must be reassigned to someone
  else, the editor will 409 until the ejected person's wristband is cleared.
  Decide during build whether *eject* should also null the wristband — leaning
  **keep it** (it's part of the record) and let the admin clear it explicitly.
- Removing participation never touches `INCIDENT__PERSON` / `VISIT__PERSON`; an
  incident from this event can still reference a person with no (or an `ejected`)
  participation row. That's intended — identity is global.

**Files:** `store/schema/45-from-44.sql` (new) + `current.sql`; `store/queries.sql`
(`DeletePersonEvent`, roster select) + sqlc regen; `api/person.go` (or new
`api/personnel.go` handler) for the delete; `api/mux.go` (route +
`LogRequest(true)`); `web/template/people.templ`; `web/typescript/people.ts`.

**Tests.** `store/integration` migration replay (v45). `api/integration`: delete
participation removes only the row (person + any incident link survive); setting
`ejected` keeps the row; the delete endpoint is admin-gated (403 otherwise) and
action-logged. Playwright `people_event_nav` (not in CI): add-to-event then the
roster shows them; remove flows both behave.

---

## 3. Open decisions

1. **6i glow style** — box-shadow pulse vs background tint; pick the one that
   reads in both light and dark Bootstrap themes (implementation detail, settle
   in the PR).
2. **6j eject + wristband** — does *eject* also clear the wristband, or keep it
   (recommended: keep, clear explicitly)?
3. **6j roster query** — dedicated `EventRoster` query vs filtering `AllPeople`
   server-side by "has a row" — pick whichever keeps the *Show all* toggle
   cleanest (likely a dedicated query + the existing `AllPeople` for *Show all*).

## 4. Notes

- **6i** is frontend-only and low-risk; **6j** is the larger piece (schema +
  endpoint + UI) — sequence them independently. Either can be the first PR.
- Action-log coverage is the ejection audit trail: the new delete route **and**
  the existing `EditPerson` are both logged, so "who removed/ejected whom, and
  when" is captured without a new column.
