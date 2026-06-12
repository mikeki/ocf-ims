# Phase 6 — Feedback Round 2 (structured stakeholder review)

> **Status:** Plan / for review. **Owner:** TBD · **Last updated:** 2026-06-12
>
> Second feedback round: a **structured questionnaire** returned by **Stakeholder
> C** (a new reviewer; round 1's informal batch is
> [`60-feedback-round-1.md`](60-feedback-round-1.md)). This round lands almost
> entirely on the **incident entry form** — see the new slice **6d** below. Items
> that extend round-1 slices or other phases are routed in §1; slices remain
> independently sequenceable.

## 1. Feedback intake & routing

| Source section | Item | Disposition |
|---|---|---|
| TAB 1 (priority) | Required fields more prominent | **6d** |
| TAB 1 (priority) | "Add Entry" → a "Submit" button at the bottom; worry people don't save | **6d** (rename decided — §7) |
| TAB 1 (priority) | Move Attached Reports/Visits + Linked Incidents below entries | **6d** |
| Ease of Use | More indication a dropdown is present on People + Incident Types | **6d** |
| Workflow / Terminology | What are "Attached Reports/Visits" / "Linked Incidents"? Visible to IR-enterers? | **6d** (label/help) + open Q (§6) |
| Workflow | "Would linked incidents auto-populate?" | Open Q (§6) — rec: keep manual for beta |
| Incident Categories | "Other" category | Already **6a** (round 1) |
| Incident Categories | Add "Weapon" type | Folds into **6a** (§3) |
| Incident Categories | List incident types alphabetically | **6d** (§3) — small |
| Reporting | More locations in the dropdown | Already **6a** (round 1) |
| Reporting | Witnesses, phone numbers, contact info for follow-up | Routes to **5e** (§3) |
| Terminology | "On Hold"/"Dispatched"/"On Scene" state wording | **Deferred** — leave as-is for beta (§4) |
| Mobile / scale | Offline "enter locally, upload later"; many concurrent users; "cows"(comms?) | **Deferred** — infra/platform track (§4) |
| OCF Culture, etc. | Workflow fits, learnable, few fields (liked), categories clear, mobile OK, not bureaucratic | **Positive validation** (§5) — no work |

## 2. Slice 6d — Incident-form UX & clarity

All grounded against `web/template/incident.templ`, `web/typescript/incident.ts`,
`web/typescript/ims.ts` (line numbers indicative, verify at impl). No schema
change; template + TypeScript + CSS only. Mirror the report page where noted.

**Current page order (top→bottom):** IMS#/State/Started → Outcome → Summary →
People | Incident Types → Location → **Attached Reports/Visits | Linked
Incidents** → *Entries from Incident and attached Reports/Visits* (journal +
"Add Entry" button).

### 6d.1 — "Add Entry" → "Submit" + reorder so it's at the bottom
- Rename the journal control **"Add Entry (Control ⏎)" → "Submit (Control ⏎)"**
  (`incident.templ` ~L346; **and the twin on the report page**, `report.templ`,
  for consistency). The enable/disable + colour logic
  (`ims.ts` `journalEntryEdited` ~L1224, submit ~L1312) is unchanged — only the
  label.
- **Reorder:** move the Attached Reports/Visits + Linked Incidents two-column row
  (`incident.templ` ~L265–315) to **below** the journal-entries card
  (~L322–360). This is the stakeholder's "move attached reports and linked
  incidents below entries," and it makes the renamed **Submit** button genuinely
  the last primary control — so "Submit" reads as "submit my note," addressing
  the worry without implying a whole-form save (there isn't one; every other
  field autosaves on change).
- **Reinforce save-state** (companion to round-1 **6c**): keep the
  unsaved-text colour change, keep the `beforeunload` guard, and 6c's
  localStorage draft means an un-submitted note survives a tab close / refresh.
  Together these answer "I worry people think they saved when they didn't."

> **Risk note (acknowledged):** "Submit" on a per-field-autosave form can imply a
> form-level save that doesn't exist. Mitigated by the reorder (Submit is the
> last control, adjacent to the journal box) + 6c drafts. Revisit wording if
> field testing still shows confusion.

### 6d.2 — Required-field prominence
- Today **no field is visually marked required**; the only guard is a JS alert
  when closing an incident with no incident type (`incident.ts` ~L1156).
- Mark the agreed required set (proposed: **Summary** + **≥1 Incident Type** —
  decision **D-R2**, §7) with a visual cue (asterisk / accent) and an inline
  hint, and promote the close-time incident-type check into a visible
  required-marker rather than an alert-on-close surprise. State defaults to
  "New"; Location is often unknown at entry — **don't** force it.

### 6d.3 — Dropdown affordance on People + Incident Types
- Both inputs are `<input type="text" list="…">` datalist typeaheads
  (`incident.templ`: People `#person_add` ~L170, Incident Types
  `#incident_type_add` ~L207) — they look like plain text boxes, so users don't
  realise a list exists.
- Add a visible affordance: a caret/chevron (and/or a clickable button that opens
  the list) + clearer placeholder ("type to search…"). Apply the same treatment
  to the area select if it reads as plain text. CSS + small markup; the
  datalist mechanics stay.

### 6d.4 — Clarify the cross-reference sections
- "Attached Reports/Visits" and "Linked Incidents" confused the reviewer. Add
  short help text / tooltips explaining each ("link an existing Report or guest
  Visit to this incident"; "relate this incident to another incident — entered
  manually"). The §6 visibility question is largely answered by gating: the
  incident page needs `readIncidents`, which pure reporters (`EventReporter`)
  **don't** hold — so IR-only field staff don't see these at all. Confirm that
  matches OCF's intended who-enters-what before investing further.

## 3. Fold-ins to other slices

- **6a (round 1) gains "Weapon"** — one row in the `INCIDENT_TYPE` seed
  (`store/schema/current.sql`), alongside the already-planned "Other". Group:
  `safety` (or `null`) — confirm with stakeholder. Implement with 6a; live DBs
  add it via the types admin page.
- **6d/6a — alphabetical incident types.** The type datalist is currently drawn
  grouped by category then alpha within group. Stakeholder wants a flat
  alphabetical list for quick scanning. Recommendation: **flat-alphabetical in
  the incident type *input*** (the datalist), keep the category grouping in the
  *Info*/admin views (the reviewer separately said categories are "clear" and
  liked them). Small change to the datalist-draw in `incident.ts`. Micro-decision
  **D-R3** (§7).
- **5e (people registry) gains follow-up contact capture.** "Witnesses, phone
  numbers, contact info" for follow-up:
  - *Witness* is already expressible — add the involved person with
    `involvement` = "witness" (the free-text involvement field exists). 6d.3's
    affordance work makes that discoverable; no model change.
  - *Phone / contact* is **new**: add a `PHONE` (and/or generic contact) column
    to `PERSON` in 5e, editable in the admin profile and capturable inline when
    creating a person from the incident/visit flow. Update
    [`51-people-registry.md`](51-people-registry.md) §4.1 schema + §4.3 UI when
    5e is built. Decision **D-P5** (where one-off witness contact lives —
    global `PERSON` vs per-incident episode — mirrors the visit-guest
    privacy split; default: phone on `PERSON`, it's reusable for follow-up).

## 4. Noted / deferred (no beta work)

- **State wording** (On Hold / Dispatched / On Scene). Decided 2026-06-12:
  **leave as-is for beta**, revisit post-fair with real usage. These are
  Burning Man dispatch-model states; the enum was never reworked (Phase 4 added
  only the orthogonal OUTCOME). Recorded as a future terminology item — pointer
  added to [`20-terminology.md`](20-terminology.md) §2d.
- **Offline-first + concurrent-user scale.** "Reliable ethernet or a localized
  platform where things are entered locally and uploaded later," and doubts about
  many simultaneous users. This is the platform/infra track, **post-beta** — true
  offline entry + sync is a large lift. Round-1 **6c** (localStorage journal
  drafts) is the only beta-window mitigation; document that it is *partial*
  (drafts survive reload, but there's no offline create/sync or multi-field
  queue).

## 5. Positive validation (record, no work)

Reviewer confirmed: the reporting workflow matches how OCF handles incidents;
learnable in a few uses; "I like that there aren't too many fields"; categories
are clear; mobile screens navigable and data entry practical; feels supportive /
community-oriented and aligned with OCF values; nothing overly
bureaucratic/enforcement-focused. Keep these as guardrails — **don't** add
field-count or process weight that erodes them.

## 6. Open questions back to stakeholders

1. **Do "Attached Reports/Visits" / "Linked Incidents" need to be visible to
   IR-enterers?** Likely moot — pure reporters lack `readIncidents` and don't see
   the incident page. Needs confirmation of OCF's who-creates-incidents-vs-reports
   workflow.
2. **Should linked incidents auto-populate?** Today manual. Recommendation: keep
   manual for beta (auto-linking heuristics are speculative and error-prone);
   reconsider post-fair if a clear rule emerges.
3. **"Weapon" grouping** (safety vs its own) and the **required-field set**
   confirmation.

## 7. Decisions

**This round (2026-06-12):**
- **D-R1 — journal control wording:** rename **"Add Entry" → "Submit"** (literal
  stakeholder ask), mitigated by the 6d.1 reorder + 6c drafts.
- **State wording:** **leave as-is for beta** (§4).
- **Attribution:** new **Stakeholder C** (real identity tracked outside the repo).

**Still needed before build:**
| # | Decision | Recommendation |
|---|---|---|
| D-R2 | Required-field set | **Summary + ≥1 Incident Type**; State defaults, Location optional |
| D-R3 | Incident-type list ordering | **Flat alphabetical** in the input; keep grouping in Info/admin views |
| D-P5 | Witness/follow-up contact home (carried into 5e) | Phone on `PERSON` (reusable); episode-only detail stays on incident/visit |

## 8. Sequencing & risk

6d is template/TS/CSS only — **no schema, no migration** — and independent of
round 1 and Phase 5; do it any time. Low risk; the riskiest piece is the 6d.1
reorder (touches the incident page layout — covered by the Playwright incident
test) and the "Submit" wording (behavioural, watch in field testing). The
weapon/alphabetical bits ride with 6a; the contact-capture bit rides with 5e.

## 9. Exit criteria

- Incident form: required fields visibly marked; journal control reads "Submit"
  and sits below the entries; cross-reference sections moved below entries with
  help text; People + Incident Types inputs visibly look like dropdowns.
- "Weapon" type exists; incident-type input lists alphabetically.
- 5e carries follow-up contact (phone) + a discoverable witness path.
- State-wording and offline/scale concerns recorded as post-fair items.
- `go test ./...`, generators, build, and Playwright green.
