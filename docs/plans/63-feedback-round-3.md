# Phase 6 — Feedback Round 3 (post-Phase-7 review fixes)

> **Status:** ✅ Built — 6f (PR #47), 6h (PR #48), 6g (PR #49) all merged.
> **Owner:** Miguel · **Last updated:** 2026-06-18
>
> Third feedback round: the **Maintainer's** own review of the latest shipped
> work (the people registry **5e**, dashboards **7**, and people→event nav
> **6e**) running against a live server. Unlike rounds 1–2 these are mostly
> **runtime defects** — bugs that the Go tests and server-side templ render
> smoke can't catch because they only manifest in the browser (Playwright isn't
> in CI). Slices remain independently sequenceable.

## 1. Feedback intake & routing

| Area | Item | Routed to |
|---|---|---|
| People | From the event doorway the event picker still shows / isn't pinned to the current event | **6f** |
| People | Can't edit wristband # / participation (role); name doesn't look auto-populated | **6f** (+ verify) |
| Dashboard | Opening the dashboard from an event says "No event selected" | **6f** |
| Incident | "Incident Type" add-dropdown on a new incident doesn't look sorted | **6h** (decision) |
| Incident | Searching a person → "Create new person" → error *"Failed to create person: null"*; want a fields modal | **6g** |

Three of the five (the two People items + the Dashboard one) share **one root
cause** and are fixed together in **6f**.

---

## 2. Slices

### 6f — Event context lost on event-scoped pages *(root-cause fix)* — ✅ Built (PR #47)

> **As built.** Moved the `eventName`/`urlEvent` reads inside `initDashboard()` /
> `initPeoplePage()`, after `await commonPageInit()`. Hardening also applied: the
> top-level `pathIds` initializer is now `idsFromPath()` (both `idsFromPath` and
> `parseInt10` are hoisted function declarations, so callable at module load), so
> any page reading `pathIds` before init now gets real path values.


**Symptoms (all three are the same bug):**
1. Dashboard from an event → "No event selected."
2. People from the event doorway → picker not pinned/locked to the URL event.
3. People → the per-event **wristband / participation** editor is hidden, so
   those fields can't be edited.

**Root cause.** Both pages read the event name from the path into a
**module-level constant at import time**:

- `web/typescript/dashboard.ts:66` — `const eventName = ims.pathIds.eventName;`
- `web/typescript/people.ts:74` — `const urlEvent = ims.pathIds.eventName;`

But `pathIds` is only populated **inside** `commonPageInit()`
(`ims.ts:353` — `pathIds = idsFromPath()`), which runs *after* those module
constants are evaluated. So both constants capture the initial default
(`eventName: null`). Consequences:

- Dashboard: `eventName == null` → the "No event selected" guard fires
  (`dashboard.ts:83`).
- People: `urlEvent == null` → the event-doorway branch
  (`people.ts:99`, pin + `disabled = true`) never runs; it falls through to the
  admin-doorway branch, so the picker is free and `currentEvent` comes from
  localStorage (often `""`).
- People (knock-on): with `currentEvent == ""`, `reflectEventSelection()`
  (`people.ts:162`) keeps `editPersonEventSection` / `addPersonEventSection`
  hidden — that's why **wristband/participation can't be edited**.

**Fix.** Read the event name from `pathIds` **after** `commonPageInit()` resolves,
not at module load. Concretely: drop the top-level `const` and read
`ims.pathIds.eventName` inside `initDashboard()` / `initPeoplePage()` after the
`await ims.commonPageInit()` line. (`pathIds` is an exported `let` reassigned in
`commonPageInit`, so a fresh read there sees the populated value.)

**On the "name not auto-populated" report.** The edit modal already sets
`editPersonName.value = person.name ?? ""` (`people.ts:259`) and the modal header
shows `personDisplayLabel` (name **or** handle). For a **handle-only** registry
person the name field is legitimately empty and the header shows the handle —
which reads as "we only see the nickname." This is expected, not a bug; **verify**
during 6f that a person *with* a name populates the field (it should), and
consider a placeholder/label tweak so a handle-only person is less confusing.

**Hardening (optional, same slice).** `pathIds` being null until `commonPageInit`
is an easy trap to fall into again. Consider populating `pathIds` once at
`ims.ts` module load (call `idsFromPath()` at the top-level `let` initializer)
so any page reading it before init gets the real value. Low risk, prevents the
next recurrence — but keep it scoped/optional so the slice stays small.

**Files:** `web/typescript/dashboard.ts`, `web/typescript/people.ts`
(optionally `web/typescript/ims.ts`). No schema/API change.

**Tests.** Pure-runtime bug; the Playwright `dashboard` and `people_event_nav`
specs are the natural guards (not in CI). Add assertions there that, from the
event doorway, the dashboard renders stats (no "No event selected") and the
People picker is `disabled` and equal to the URL event.

### 6g — "Create new person" from the incident person combobox — ✅ Built (PR #49)

> **As built (both parts together, per decision).** Backend: added
> `mustWriteJSONStatus(w, req, code, resp)` (sets Content-Type → `WriteHeader` →
> body); `mustWriteJSON` delegates with 200; `CreatePerson` uses the status
> variant. An `api/integration` assertion checks `POST /personnel` returns
> `Content-Type: application/json`. UX: a shared `QuickAddPersonModal` templ
> component (`web/template/quickaddperson.templ`, wired by
> `ims.openQuickAddPersonModal`) is included on the incident and visit pages; the
> combobox gained an optional `onCreate` hook that opens it pre-filled with the
> typed text. Falls back to the (now-working) inline create when no hook is set.


**Symptom.** On an incident, searching a person and clicking **"Create new
person ____"** shows *"Failed to create person: null"* and nothing is created.

**Root cause (backend).** `CreatePerson.ServeHTTP` (`api/person.go:101`) calls
`w.WriteHeader(http.StatusCreated)` **before** `mustWriteJSON(...)`. `mustWriteJSON`
sets `Content-Type: application/json` *after* the status line is already
committed (`api/helpers.go:121`) — a header write after `WriteHeader` is a no-op
in `net/http`. So the 201 goes out **without** an `application/json` content type.
On the client, `fetchNoThrow` only parses the body when
`content-type === "application/json"` (`ims.ts:210`), so it returns
`{json: null, err: null}`; `createRegistryPerson` then reports
`Failed to create person: ${err}` → literally `"... null"` (`ims.ts:650`).
`CreatePerson` is the **only** JSON handler that calls `WriteHeader` before
`mustWriteJSON` — every other handler defaults to 200 with the header set first,
which is why GET search/etc. work and only create breaks.

**Fix (the actual bug).** Set the content type before the status code. Cleanest:
give `mustWriteJSON` an optional status (e.g. `mustWriteJSONStatus(w, req, code,
resp)`) that sets the header *then* `WriteHeader(code)` *then* writes; have
`CreatePerson` use it and drop its standalone `WriteHeader`. Audit for any other
`WriteHeader`-before-`mustWriteJSON` callers (currently only this one).

**Enhancement (the UX the Maintainer asked for).** Today the combobox does a
**name-only inline create** (`createRegistryPerson` posts just `{name, event}`).
Replace the silent inline create with the **Add-Person modal** (the same one the
People page uses) pre-filled with the typed text, so the user can add
handle/email/wristband/participation before saving, then attach the result. This
is the bigger piece; it can land after the one-line content-type fix.

**Decision needed:** ship the **content-type fix alone** first (unblocks the
existing inline create immediately), then do the **modal** as a follow-up — or do
both together? Recommend: fix first, modal as 6g.2.

**Files:** `api/person.go`, `api/helpers.go` (content-type); `web/typescript/ims.ts`
+ the incident person-attach wiring and a shared add-person modal (modal). No
schema change. Add an `api/integration` assertion that `POST /personnel` returns
`Content-Type: application/json` and a parseable body.

### 6h — Incident type add-dropdown ordering *(decision, not a clear bug)* — ✅ Built (PR #48)

> **Decision: flat alphabetical in this dropdown.** `drawIncidentTypesToAdd`
> now sorts the datalist plain A→Z by name; category grouping is unchanged in the
> grouped checklist and the type-info list.


**Symptom.** The "Add:" incident-type input on a new incident
(`incident.templ:223`, a `<datalist>`) "doesn't seem sorted."

**Reality.** The list **is** sorted — by **category, then name**
(`compareIncidentTypesByGroup`, `ims.ts:2318`; applied at `incident.ts:144`).
Within a category it's alphabetical, but across the whole list it clusters by
group, so scanning for a plain A→Z name order reads as "unsorted." Flat
alphabetical was explicitly considered and dropped in round 1 (6b, D-R3) in
favour of category grouping.

**Decision needed.** Three options:
- **Keep** category-then-name (status quo; matches the 6b decision).
- **Flat alphabetical** in this add-dropdown specifically (what the reviewer
  likely expects), while category grouping stays anywhere else it's used.
- **Group with visible headers** so the clustering is obvious (a `<datalist>`
  can't render `<optgroup>`-style headers well; would need a real custom
  combobox like the person picker).

No code until the ordering is chosen. If "flat alphabetical here," it's a
one-line sort swap in `drawIncidentTypesToAdd` (`incident.ts:773`).

---

## 3. Decisions (resolved)

1. **6g sequencing** — **both together** (content-type fix + add-person modal in
   one PR).
2. **6h ordering** — **flat alphabetical** in this add-dropdown specifically;
   category grouping stays elsewhere.
3. **6f hardening** — **yes**: also populate `pathIds` at `ims.ts` module load
   (via `idsFromPath()`) to prevent recurrence, in addition to read-after-init.

## 4. Notes

- All three slices are independent and can ship in any order. **6f** is the
  highest-impact (three visible breakages, one small frontend fix) and the
  natural first PR.
- These are runtime-only regressions; CI (Go tests + server-side templ render)
  passed for the PRs that introduced them. Worth a follow-up to get the
  Playwright specs running somewhere (even nightly) so this class of bug is
  caught — tracked as a non-blocking note, not a slice here.
