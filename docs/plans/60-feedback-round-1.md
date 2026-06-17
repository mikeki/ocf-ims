# Phase 6 — Feedback Round 1 (beta usage feedback)

> **Status:** 6a shipped — "Other"/"Weapon" types + action-log coverage done;
> areas reseed still blocked on the stakeholder area list. 6c journal drafts
> shipped. 6b booth field + 6d incident-form UX shipped together (this PR).
> **Last updated:** 2026-06-15
>
> First round of feedback from real usage of the beta, collected 2026-06-11.
> Phase 6 was previously reserved for Dashboards & Metrics — that work moved to
> **Phase 7** (`70-dashboards.md`, TODO). Slices here are intentionally
> independent: **sequence them in any order at implementation time**, including
> interleaved with the remaining Phase 5 slices.

## 1. Feedback intake

| From | Feedback | Routed to |
|---|---|---|
| Stakeholder A | Locations: cover each path segment inside the 8; add larger landmarks (e.g. Drum Tower); a fill space for booth number | **6a** (areas data) + **6b** (booth field) |
| Stakeholder A | People: list *all* folks, not just people with a login | **Phase 5e** — [`51-people-registry.md`](51-people-registry.md) |
| Stakeholder A | Incident type: add "Other" for anything strange worth recording | **6a** |
| Stakeholder B | Auto-save when entering an incident — lost info on connection loss / tabbing out | **6c** |
| Maintainer | Cohesive people feature: one database of people, admin-editable emails/profiles, people search | **Phase 5e** — [`51-people-registry.md`](51-people-registry.md) |
| Maintainer | Some admin features aren't tracked in the action log | **6a** |

The people items reshape `PERSON`, which the remaining Phase 5 slices (5c crews,
5d admin UI) build on — so they live in the Phase 5 family, not here.

## 2. Slices

### 6a — Quick wins (data + flags, no schema)

One small PR; zero migrations.

- **Areas reseed** (Stakeholder A). The Phase 4c AREA model already supports this — areas
  are per-event, admin-manageable live (`/ims/app/admin/areas`), and
  [`40-domain-model.md`](40-domain-model.md) explicitly deferred
  "stakeholder-final wording — reseed when OCF stakeholders confirm". This is
  that confirmation arriving. Work: update `store/fakeimsdb/seed.sql` with the
  figure-8 **path segments** and **landmarks** (Drum Tower, …); for any live DB,
  enter the same areas via the admin page (no deploy needed).
  - **Open item:** get the final segment/landmark list from Stakeholder A before the PR.
- **"Other" + "Weapon" incident types** (Stakeholder A; "Weapon" folded in from
  round 2 §3). **Done.** Two rows added to the `INCIDENT_TYPE` seed in
  `store/schema/current.sql` (types are seeded there) — "Other" group `null`
  (ungrouped; renders under the existing "Ungrouped" heading, sorted last),
  "Weapon" group `safety`. Live DBs: add via the existing types admin page. No
  migration — the migrate test now normalizes the `AUTO_INCREMENT` counter, so
  growing reference-data seeds in `current.sql` stays migration-free. The
  flat-alphabetical type listing (round 2 D-R3) stays with 6d (frontend).
- **Action-log coverage** (Maintainer). **Done** — all four endpoints below
  flipped to `LogRequest(true, …)`; the obsolete "plaintext password" comments
  were removed (the log records metadata only — method/path/user/status/duration,
  never request bodies — verified in `LogRequest`) and a CLAUDE.md note now
  documents the opt-in flag so new mutating endpoints register it. The middleware
  logs per-endpoint via a boolean (`LogRequest(true/false, …)` in `api/mux.go`);
  audit findings (now all fixed):

  | Endpoint | Today | Fix |
  |---|---|---|
  | `POST /ims/api/events/{e}/visits` (create) | `false`, no stated reason | → `true` |
  | `POST /ims/api/events/{e}/visits/{n}` (edit) | `false`, no stated reason | → `true` |
  | `POST /ims/api/personnel` (create) | `false` — "may contain a plaintext password" | → `true` — the concern is obsolete: the action log **never captures request bodies** (metadata only: method/path/user/status/duration). Verify that holds at impl time, then flip. |
  | `POST /ims/api/personnel/{h}/password` | `false` — same comment | → `true`, same reasoning |

  Everything else mutating is already covered (incidents, reports, journal
  entries, areas, events, types, person edit/admin-toggle, attachments).
  Also: add a line to `CLAUDE.md` (API structure section) that **new mutating
  endpoints must register with `LogRequest(true, …)`** — the flag is opt-in per
  endpoint and silently unlogged otherwise; make it a review-checklist item.

### 6b — Booth number field (Stakeholder A)

**Done (2026-06-15).** As built: schema migration **44-from-43** adds
`INCIDENT.LOCATION_BOOTH varchar(32)` (appended last in `current.sql` to match
the ALTER; the migration replay test passes, AUTO_INCREMENT-normalized). `Booth
*string` added to `json/incident.go`'s `Location`; `api/incident.go` reads it and
applies the same nil-means-unchanged / empty-means-clear semantics as
`description` (`conv.StringToSql(..., 32)`). UI: a "Booth:" input in the incident
Location card (between Area and Details) with `editLocationBooth()` →
`location.booth`. Booth also surfaces in the incident-list location summary
(`shortDescribeLocation` / `safeShortDescribeLocation` in `ims.ts`, as "Booth X").
Round-trip + clear-vs-unchanged covered by `TestIncidentLocationBooth`.

Decided 2026-06-11: a **dedicated structured field**, not a free-text convention
(searchable/reportable later) and not booths-as-child-areas (hundreds of seed
rows, unwieldy dropdown).

- **Schema** (migration number assigned at implementation time, coordinating
  with 5c/5e): `INCIDENT` add `LOCATION_BOOTH varchar(32) null`. Append last in
  `current.sql` per the replay test's column-ordering check.
- **JSON/API**: `location.booth` joins `location.area_slug` /
  `location.description` in `json/incident.go`'s `Location` struct, same
  nil-means-unchanged / empty-means-clear semantics (`api/incident.go`). Trim +
  length-validate.
- **UI**: a "Booth #" input in the incident Location card between area and
  details; `editLocationBooth()` handler mirroring the existing two
  (`web/typescript/incident.ts:1192`).
- **Tests**: round-trip in the incident API tests; clear-vs-unchanged semantics.

### 6c — Journal draft persistence (Stakeholder B's auto-save)

**Done.** Journal-entry drafts now persist to `localStorage` (shared logic in
`ims.ts`, keyed `journal_draft_<event>_<page-type>_<number|"new">`): a debounced
write on input, restore-on-load with a subtle "Unsaved draft restored." note,
clear-on-submit, the `"new"`→number key migration on creation, and a
`beforeunload` flush so the last keystrokes can't be lost. Covers both the
incident and report pages. A Playwright test (`journal_draft_persistence`)
exercises the migrate + restore + clear path (not in CI; run locally).

Grounding: most incident fields **already save per-field on blur** (each edit is
its own XHR). The real data-loss hole is the **journal-entry textarea** — text
lives only in the DOM until "Add Entry" is clicked; the `beforeunload` handler
(`incident.ts:174`, `report.ts:98`) warns but persists nothing. localStorage is
currently used only for tokens/prefs, never form data.

Scope for beta — **drafts, not an offline queue**:

- Persist the journal textarea to **localStorage on input** (debounced), keyed
  by `(event, incident-number | "new", page-type)`.
- **Restore on page load** when a draft exists (with a subtle "draft restored"
  indication); **clear on successful submit** (`ims.ts` `submitJournalEntry`).
- **New-incident edge:** drafts start under the `"new"` key; when the first save
  assigns a number (`IMS-Incident-Number` header → `pushState`), migrate the
  draft key. Mirror for new reports.
- Keep `beforeunload` as a second line of defense.

Known-but-deferred (documented so they aren't re-discovered): failed per-field
saves trigger `loadAndDisplayIncident()` which reverts in-flight DOM edits
(low/medium risk, error badge shown); no retry/queue for failed saves. Revisit
post-fair if connectivity at the site proves bad — a retry queue is a much
bigger lift and beta-risky.

## 3. Sequencing & risk

All three slices are independent of each other **and** of Phase 5; any order.
6a is ~a day and blocked only on Stakeholder A's area list; 6b is a small full-stack
slice (one nullable column); 6c is frontend-only. Risk **Low** across the board —
the riskiest line is the localStorage key migration on incident creation (6c),
covered by a Playwright test.

## 4. Exit criteria

- Areas reflect Stakeholder A's confirmed list (seed + live DB); "Other" type exists.
- Every mutating endpoint writes to the action log (or carries a comment saying
  why not); CLAUDE.md documents the opt-in gotcha.
- Incidents carry a structured booth number end-to-end.
- Journal text survives a tab close / refresh / connection drop and restores on
  return; cleared once submitted.
- `go test ./...`, generators, build green.
