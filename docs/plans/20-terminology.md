# Phase 2 — Terminology (Burning Man → OCF)

> **Status:** Draft — core decisions captured; per-term wording and the
> Ranger→role split still need OCF stakeholder sign-off. &nbsp;·&nbsp;
> **Parent:** [00-master-plan.md](00-master-plan.md) &nbsp;·&nbsp;
> **Last updated:** 2026-06-05 &nbsp;·&nbsp; **Prereq:** Phase 1 ✅ (`master` @ `5eb3c57`)

## Objective

Replace Black Rock Rangers / Burning Man domain terminology with Oregon Country
Fair terminology across the **whole stack** — UI, API, and database — so the
system reads as a native OCF tool. This is the highest user-visible change of the
conversion.

## Decisions locked

| Decision | Choice | Rationale |
|---|---|---|
| **Rename depth** | **Deep** — rename through every layer: DB columns/tables (+ migrations), sqlc queries, Go types, JSON field names, URL paths, *and* UI strings. | Cleaner long-term; avoids a permanent split between user-facing words and internal identifiers. We accept the larger surface area and the API-contract break (see risks). |
| **"Field Report" → "Report"** | Rename the entity to **Report**. | Avoids the confusing "Incident Report"/"Incident" collision. "Report" reads cleanly at OCF. (Exact UI noun still open to OCF tweak.) |

> ⚠️ **Deadline tension (read this).** A deep rename is ~75–100 files, needs
> schema migrations, regenerates sqlc/templ/tsgo, **breaks the JSON/HTTP API
> contract**, and requires updating the Playwright suite. The master plan's
> beta-first sequencing favored a lighter touch for the ~4-week event window. The
> deep rename is the chosen direction; to keep it shippable we **slice it into
> independent, per-entity vertical PRs** (below), each green on its own, so the
> beta can cut over at any completed slice rather than waiting for the whole phase.

## Surface-area analysis (measured 2026-06-05, source only, generated excluded)

| Term | Source lines | Where it lives | Deep-rename cost |
|---|---:|---|---|
| `Incident` | 1888 | **kept** — OCF keeps incidents | none (no rename) |
| `Event` | 2093 | partition key — `EVENT` table, `event_id` on every entity, all URLs | **KEEP structural; UI relabel only** (see below) |
| `Visit` | 1058 | visit/sanctuary subsystem | rename if OCF wording differs (TBD) |
| `Ranger` | 767 | `RANGER_HANDLE` cols, `INCIDENT__RANGER`/`VISIT__RANGER`, many Go types, personnel/role concept | **two distinct meanings — see below** |
| `FieldReport` / `field_report` / `FIELD_REPORT` | 698 | `FIELD_REPORT` + `FIELD_REPORT__REPORT_ENTRY` tables, JSON `field_reports`, `/field_reports` URLs, `FieldReport*` Go types | **first slice — "Report"** |
| `Camp` | 435 | `PLACE.TYPE='camp'`, `VISIT.GUEST_CAMP_*` columns | rename (TBD term) |
| `ReportEntry` / `REPORT_ENTRY` | 450 | log-line table (a *different* concept) | unchanged — **collision note below** |
| `Patrol` | 14 | minor (UI/strings) | trivial |
| `HQ` / headquarters | 17 | minor | trivial |
| `Participant` | 18 | minor | trivial |
| `Citizen` | 0 | not present | drop from mapping |
| `Intervention` | 0 | not present | drop from mapping |

## Term mapping (refined)

| Ranger / BRC term | OCF term | Status |
|---|---|---|
| Field Report | **Report** | ✅ decided (UI noun tweakable) |
| Ranger | **role split** — see below | ⚠️ needs OCF stakeholders |
| Event | **Event** (kept structural; UI may show "Fair") | ⚠️ recommend keep — see below |
| Black Rock City | **Oregon Country Fair** | mostly UI/config/branding |
| Patrol | Path Rove / Gate / Radio Handle | ⚠️ confirm OCF term |
| Ranger HQ | Fair Central / QM | ⚠️ confirm OCF term |
| Participant | Fair Family / Participant | ⚠️ confirm OCF term |
| Camp | Booth / Crew / Camping Area | ⚠️ confirm OCF term |
| Citizen Contact | — | dropped (not in code) |
| Intervention | — | dropped (not in code) |

### ⚠️ "Ranger" has two meanings — don't conflate them
In the **data model**, `RANGER_HANDLE` / `IncidentRanger` / `VisitRanger` mean
*"the person attached to this incident/visit"* — a personnel reference, not the BRC
"Ranger" role. So this term splits two ways:
- **As a data-model noun** ("the person assigned") → a neutral term like
  **Responder**, **Staff**, or **Personnel**. This is what the schema/types rename to.
- **As an org role** (who can do what) → the OCF volunteer structure
  (Basic Reporter / Crew Lead / Coordinator / Management). That's **Phase 4**
  ([roles & permissions](00-master-plan.md)), not here — Phase 2 only renames the
  *word*, not the permission model.

### ⚠️ Recommend KEEP "Event" as the structural term
`Event` is the system's partition key — `event_id` is on every incident, report,
visit, access rule, and URL (2093 source lines). Deep-renaming it (e.g. to "Fair")
would be the single largest and riskiest change in the conversion for almost no
user benefit, since users rarely see the raw word. **Recommendation:** keep
`Event`/`event_id` as the internal/structural noun; if OCF wants "Fair" in the UI,
relabel display strings only. Flag for explicit sign-off.

### ⚠️ "Report" sits next to "Report Entry"
The system already has a separate `REPORT_ENTRY` concept (the timestamped log
lines inside incidents/reports/visits). After the rename:
- `FIELD_REPORT__REPORT_ENTRY` → `REPORT__REPORT_ENTRY` — awkward, but **consistent
  with the existing `INCIDENT__REPORT_ENTRY` / `VISIT__REPORT_ENTRY` join-table
  convention**, so acceptable.
- The sqlc-generated Go type `FieldReportReportEntry` → `ReportReportEntry` is the
  one genuinely ugly artifact. **Recommendation:** accept it (it's generated and
  rarely typed by hand); revisit only if it grates in review.

## How a deep rename works per entity (the template)

Migration `29-from-28.sql` already did exactly this for **`STAY` → `VISIT`** and is
the proven template:

```sql
rename table STAY to VISIT;
alter table VISIT
    drop foreign key STAY_TO_EVENT,
    add constraint VISIT_TO_EVENT foreign key (`EVENT`) references `EVENT`(ID),
    ...;
rename table STAY__REPORT_ENTRY to VISIT__REPORT_ENTRY;
alter table VISIT__REPORT_ENTRY rename column STAY_NUMBER to VISIT_NUMBER, ...;
```

Each entity rename is one **vertical slice**:
1. **Migration** `XX-from-YY.sql` — `rename table`, `rename column`, drop/re-add
   FKs (named constraints), bump `SCHEMA_INFO`. Mirror in `current.sql`.
2. **`store/queries.sql`** — rename query names + columns. Regenerate sqlc
   (renames the generated Go types/structs automatically).
3. **`json/`** — rename Go struct types + `json:"..."` tags.
4. **`api/`** — rename handlers, URL route patterns, action-log strings.
5. **`web/typescript/`** + **`web/template/`** — rename URLs, types, UI text.
   Regenerate templ + tsgo (via `go run bin/build/build.go` — never bare tools).
6. **Tests** — Go unit + integration (`api/integration`, `store/integration`),
   and the **Playwright** suite (selectors + visible text).
7. **Verify** — full build, `go test ./...`, Docker integration suites green.

## Proposed execution (independent PRs)

Sliced so each lands green and the beta can adopt completed slices incrementally:

| PR | Scope | Notes |
|---|---|---|
| **2a** | **Field Report → Report** (all layers) | First & largest single entity; exercises the full template. ~migration + sqlc + api + json + urls + ui + tests. |
| **2b** | **Ranger → [Responder/Staff]** (data-model noun) | Pending the neutral-noun decision. Touches `RANGER_HANDLE`, `INCIDENT__RANGER`, `VISIT__RANGER`, many types. |
| **2c** | **Black Rock City → Oregon Country Fair** + branding strings | Mostly UI/config; low risk. |
| **2d** | **Small terms** — Patrol, HQ, Participant, Camp | Bundle the low-count items; confirm OCF wording first. |
| **(2e)** | **Event → Fair UI relabel** *(only if OCF wants it)* | Display-layer only; do **not** rename `event_id`/`EVENT`. |

Each PR: separate branch off `master`, green build + tests, opened for review —
same workflow as Phase 1.

## API-contract / external-client impact

The deep rename **changes JSON field names and URL paths** (e.g.
`/ims/api/.../field_reports` → `/reports`, `"field_reports"` → `"reports"`). The
first-party web UI and Playwright tests are updated in the same PRs. **Open
question:** are there *external* API consumers (mobile, integrations, scripts)? If
yes, we need a deprecation/redirect window or a coordinated cutover. If the API is
purely internal to the web UI, the break is contained. **Confirm before PR 2a.**

## Open questions for OCF stakeholders

1. **Field Report → "Report"** — confirm the user-facing noun (or pick another
   distinct word: Observation, Note, Log).
2. **Ranger** — (a) the neutral data-model noun (Responder / Staff / Personnel?),
   and (b) the org-role wording (deferred to Phase 4).
3. **Event** — keep as-is, or relabel to "Fair" in the UI only?
4. **Per-term wording** — Patrol, Ranger HQ, Participant, Camp → confirm exact OCF
   terms (drafts above are guesses).
5. **External API consumers?** — anyone besides the first-party web UI calling the
   JSON API? Sets whether the contract break needs a compatibility window.

## Exit criteria

- [ ] Per-term wording + Ranger split confirmed with OCF stakeholders.
- [ ] External-API-consumer question answered (compat window if needed).
- [ ] Each entity rename shipped as a green, independently-reviewable PR.
- [ ] No BRC-specific terminology remains in user-facing surfaces; build + unit +
      integration + Playwright green.
- [ ] User-facing docs (`docs/`, `README.md`, `CLAUDE.md`) updated to OCF terms.
      → proceed to **Phase 3** (`30-domain-model.md`).
