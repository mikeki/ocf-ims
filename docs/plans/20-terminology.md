# Phase 2 — Terminology (Burning Man → OCF)

> **Status:** Draft — most decisions locked (Report; Ranger → first-class
> Person/People; nickname/`person_id`; `ROLE`→involvement; **Event kept verbatim**;
> **API is web-UI-only**). Remaining: small-term wording, and the Fair org-structure
> (crews/titles/roles) which is its own **Phase 4** design. &nbsp;·&nbsp;
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
| **Personnel entity: "Ranger" → "Person / People"** | The people in the system become a **first-class local `Person`/`People` entity**, owned by OCF IMS — *not* a string reference into an external Clubhouse directory. | OCF doesn't use Clubhouse, so the external-directory dependency goes away regardless. The JSON layer **already** calls them `Person` (`json/personnel.go:19`); only the store (`Ranger`) and UI lag. "People" also makes the involvement list read naturally as **"people involved."** A *Person* is an identity; "can log in" is an attribute (credentials + a role grant), so not every Person must be a login account. |
| **Identifier: "callsign"/"handle" → "nickname"** | Humans are shown/searched by a unique, changeable **`nickname`**. References between rows (involvement, authorship) key on a stable **`person_id`**, not the nickname string. | OCF-friendly wording, and it **fixes an existing `FIXME`** — `current.sql:90` notes `RANGER_HANDLE` is wrongly used as a foreign key ("Primary key is DMS Person ID"). Local People let us key on `person_id` and let a nickname change without breaking incident history. |
| **Incident-attachment "ROLE" free-text → "involvement"** | Rename the free-text `INCIDENT__RANGER.ROLE` / `VISIT__RANGER.ROLE` field (how a person was involved) to **`involvement`**. | Reserves the word **"role" exclusively for Phase-4 permissions** (Coordinator / Management). Today the same word means two unrelated things — a foot-gun we remove now. |

> ⚠️ **Deadline tension (read this).** A deep rename is ~75–100 files, needs
> schema migrations, regenerates sqlc/templ/tsgo, **breaks the JSON/HTTP API
> contract**, and requires updating the Playwright suite. The master plan's
> beta-first sequencing favored a lighter touch for the ~4-week event window. The
> deep rename is the chosen direction; to keep it shippable we **slice it into
> independent, per-entity vertical PRs** (below), each green on its own, so the
> beta can cut over at any completed slice rather than waiting for the whole phase.
>
> **The Person/People slice (2b) is now bigger than a rename** — it introduces a
> local identity table to replace the Clubhouse directory. That's real data-model
> work, not just words. Two mitigations keep it deadline-safe: (1) it's an
> independent slice, so the rest of Phase 2 (Report, branding, small terms) ships
> regardless of its timing; (2) the *history* enhancement is explicitly pushed to
> Phase 3. If 2b can't land before the event, the beta can still run terminology +
> a minimal People table and defer the richer identity work.

## Surface-area analysis (measured 2026-06-05, source only, generated excluded)

| Term | Source lines | Where it lives | Deep-rename cost |
|---|---:|---|---|
| `Incident` | 1888 | **kept** — OCF keeps incidents | none (no rename) |
| `Event` | 2093 | partition key — `EVENT` table, `event_id` on every entity, all URLs | **KEEP structural; UI relabel only** (see below) |
| `Visit` | 1058 | visit/sanctuary subsystem | rename if OCF wording differs (TBD) |
| `Ranger` | 767 | `RANGER_HANDLE` cols, `INCIDENT__RANGER`/`VISIT__RANGER`, many Go types, personnel concept | **→ first-class `Person`/`People` + `nickname`/`person_id` — see below** |
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
| Ranger (the person) | **Person / People** (first-class local entity) | ✅ decided — see below |
| Ranger handle / callsign | **nickname** (+ stable `person_id` for FKs) | ✅ decided — see below |
| Attached-Ranger "role" (free text) | **involvement** | ✅ decided — see below |
| "Rangers" attached to an incident (list) | **People Involved** | ✅ decided |
| Event | **Event** (kept everywhere, incl. UI) | ✅ decided — keep; *not* "Fair" (see below) |
| Black Rock City | **Oregon Country Fair** | mostly UI/config/branding |
| Patrol | Path Rove / Gate / Radio Handle | ⚠️ confirm OCF term |
| Ranger HQ | Fair Central / QM | ⚠️ confirm OCF term |
| Participant | Fair Family / Participant | ⚠️ confirm OCF term |
| Camp | Booth / Crew / Camping Area | ⚠️ confirm OCF term |
| Citizen Contact | — | dropped (not in code) |
| Intervention | — | dropped (not in code) |

### "Ranger" → first-class **Person / People** (decided)
The word "Ranger" in this codebase is overloaded. Untangling it surfaced **three
distinct person-references**, all currently stored as a bare callsign string
pointing at the external Clubhouse directory:

| # | Where (today) | Meaning | Cardinality |
|---|---|---|---|
| 1 | `REPORT_ENTRY.AUTHOR` | **Who wrote this log line** — the author/reporter | one per entry |
| 2 | `INCIDENT__RANGER` / `VISIT__RANGER` (`RANGER_HANDLE` + free-text `ROLE`) | **People *involved/attached*** to the incident, and *how* | many per incident |
| 3 | `directory.User` (logged-in handle, gated by event access modes) | **The authenticated user** acting in the system | the session |

The app's own "what's new" text confirms #2 is an *involvement* list, not a
reporter/responder slot: *"Ranger 'roles' can be set on Incidents, indicating how
each Ranger was involved"* (`web/template/root.templ:40`). The free-text `ROLE`
box (UI: *"Short description of role"*, max 50 chars) is where "responder",
"transport", "witness", etc. are typed.

**Decision:** unify all three onto a single first-class local **`Person`** entity
(identified by **`nickname`**, keyed by **`person_id`**), owned by OCF IMS:
- #1 `REPORT_ENTRY.AUTHOR` → a `person_id` reference (the **author**).
- #2 the attachment becomes **"People Involved"**, and its free-text `ROLE` is
  renamed **`involvement`** (see foot-gun note below).
- #3 the logged-in **user** is just a `Person` that *has credentials and a role
  grant* — login-ability is an attribute, not a separate entity.

This is why the rename **can't stay purely cosmetic**: dropping Clubhouse forces a
real identity model. Replacing the external directory with a local `Person` table
is the natural home for it, and it resolves the standing `current.sql:90` `FIXME`
(handle-as-foreign-key → `person_id`).

> **Scope flag.** The *terminology + structural* rename (Ranger→Person/People,
> handle→nickname, `ROLE`→`involvement`, `person_id` FKs, local People table) is
> Phase 2. The **permission model** built on top (Basic Reporter / Coordinator /
> Management, and where each `Person`'s role grant lives) stays **Phase 4**
> ([roles & permissions](00-master-plan.md)). Phase 2 establishes the entity and
> the words; Phase 4 decides who-can-do-what. The directory-replacement question
> (how People get *created/sourced* without Clubhouse) is shared with Phase 4 —
> tracked there.

### ⚠️ "involvement" vs "role" — a foot-gun we close now
The People-Involved list already has a free-text field literally meaning "role"
(*how* someone was involved). Phase 4 introduces **"roles"** as *permissions*
(Coordinator / Management). Same word, two unrelated meanings. We rename the
involvement field to **`involvement`** now and reserve **"role"** exclusively for
the permission model, so the two never collide in schema, API, or UI.

### 💡 Future: involvement *history* (noted, likely Phase 3 — not Phase 2)
OCF wants to track how a person's involvement in an incident **changes over time**
(e.g. "responder" early, "transport" later). Two paths:
- **Baseline that already exists:** the **action log** (`store/actionlog/`) records
  all authenticated mutations, so *generic* "who changed involvement when" is
  partly recoverable today.
- **Structured (new model):** effective-dated involvement rows — a queryable
  history of (person, involvement, time-range) per incident. This is a **new
  domain-model concept**, not a rename, so it belongs in **Phase 3**
  ([domain model](00-master-plan.md)) and also feeds **Phase 5** metrics
  (who responded, response times). Phase 2 keeps involvement as a single mutable
  value (just renamed) so the rename stays shippable; the history table is a
  follow-on design item.

### 🏗️ Fair org structure — crews, titles, crew leaders (NEW model → Phase 4, own design doc)
> **Not Phase 2.** Captured here because it's entangled with the People entity and
> the "how are People created without Clubhouse" question. This is new domain model
> and almost certainly warrants its own design doc under Phase 4.

**What OCF wants (user, 2026-06-05):** People have **titles** and **roles**; some
People **manage crews**; crews can **nest** (crews within crews, each with its own
**crew leader**); and **crew leaders can invite new People** into the system.

**What exists today — the same shape, but flat and external.** IMS already grants
event access via `EVENT_ACCESS.EXPRESSION` strings matched against a person's
Clubhouse attributes (`lib/authz/permission.go:211`):

| Expression | Matches | OCF analogue |
|---|---|---|
| `position:<title>` | anyone holding that Clubhouse **position** | a **title / role** |
| `team:<title>` | anyone on that Clubhouse **team** | a **crew** |
| `onduty:<title>` | anyone currently on-duty in that position | on-shift grant |
| `person:<handle>` | one specific person | one person |

So "title" (position) and "crew" (team) are *already* permission primitives — but
**sourced read-only from Clubhouse and completely flat.** The gaps vs. OCF's vision:

- **No nesting.** Clubhouse `team` has no `parent_team_id`; crews can't contain crews.
- **No crew-leader concept.** `person_team` is plain membership — no "X leads crew Y".
- **No in-IMS invites / ownership.** Membership and identity are managed in
  Clubhouse; IMS only reads them. With Clubhouse gone, IMS must **own** crews,
  titles, and membership locally — which is exactly where the **first-class People
  table** (decided above) becomes the foundation: People + crews + titles + leader
  edges + invites all become local, editable data.

This connects three threads: the **People entity** (Phase 2, decided), **People
sourcing / invites** (Phase 4), and the **permission model** (Phase 4). A crew
leader inviting a person is *both* an onboarding flow *and* a permission grant.

**Vocabulary — three distinct concepts (decided 2026-06-05):**
- **Crew** = a group of People; **nestable** (crews within crews).
- **Title** = a descriptive position label (e.g. "Medical Lead"); cosmetic, does
  *not* by itself grant permissions.
- **Role** = a permission tier (Basic Reporter / Coordinator / Management) — the
  *only* thing that drives authorization. Keeps "role" un-collided with involvement.

**Invites — support both flows (decided 2026-06-05):** a crew leader can either
(a) send an **email invite** and let the invitee **self-register** (choose their own
nickname + credentials), or (b) **create the `Person` record directly** (nickname +
temp credentials) and hand it over. This *is* the answer to "how are People created
without Clubhouse." Both are scoped to the inviter's crew/authority.

**Open design questions (for the Phase 4 design doc):**
1. **Crew leader = a permission, not a new entity?** Probably a `Person`↔`crew`
   membership edge flagged `is_leader` (or a per-crew role), granting leader-scoped
   permissions over that crew and its sub-crews.
2. **What exactly can a crew leader do** beyond inviting — manage their crew's
   membership, create sub-crews, assign titles, assign involvement…? Defines the
   permission bits.
3. **Do permissions inherit down the crew tree?** Does leading a parent crew grant
   authority over sub-crews and their members?
4. **How do crews/titles/roles map onto today's `EVENT_ACCESS` expressions**
   (`team:`/`position:`/`person:`)? Do locally-owned crews/titles simply *become*
   the new source for those expressions, or does the grant model change?

### ✅ KEEP "Event" everywhere — incl. the UI (decided 2026-06-05)
**Confirmed by tracing actual usage.** `Event` is the system's top-level partition:
- Every incident, report, visit, place, and access rule is scoped to one event via
  an `EVENT` FK; **numbers restart at 1 per event** (composite PK `(EVENT, NUMBER)`,
  `current.sql:55`). It's load-bearing, not cosmetic (2093 source lines, all URLs).
- An event is identified by its **`NAME`**, which is the URL slug
  (`/ims/app/events/{eventName}/…`, `web/mux.go:123`). At BRC the name is the **year**.
- **Events already support grouping** (`IS_GROUP` + self-referencing `PARENT_GROUP`,
  added in migration `25-from-24.sql`; fully wired through `admin_events.ts`,
  `api/event.go`, and the `EventAndParentAccess` query). A *group* is an access
  container whose rules cascade to child events; a group itself can't hold
  incidents/reports (intentional).

**Why this fits OCF perfectly.** OCF is one annual Fair **plus smaller events
year-round** (work weekends, off-site) — which is exactly what this model already
expresses: the **Fair is one event** (`"OCF 2026"`), **smaller events are sibling
events**, and a per-year **group** can hold shared access rules across them.

**Decision: keep `Event` as the word in DB, API, *and* UI.** Do **not** relabel to
"Fair" — not every event is the Fair (a spring work-weekend isn't), so "Fair" would
be inaccurate. "Event" is the correct generic term. This removes the single largest
and riskiest rename from the phase for zero benefit.

### ⚠️ "Report" sits next to "Report Entry"
The system already has a separate `REPORT_ENTRY` concept (the timestamped log
lines inside incidents/reports/visits). After the rename:
- `FIELD_REPORT__REPORT_ENTRY` → `REPORT__REPORT_ENTRY` — awkward, but **consistent
  with the existing `INCIDENT__REPORT_ENTRY` / `VISIT__REPORT_ENTRY` join-table
  convention**, so acceptable.
- The sqlc-generated Go type `FieldReportReportEntry` → `ReportReportEntry` is the
  one genuinely ugly artifact. **Recommendation:** accept it (it's generated and
  rarely typed by hand); revisit only if it grates in review.

> #### 📌 Deferred follow-up (post-fair): rename `ReportEntry` → `LogEntry`
> Decided 2026-06-06 (after slice 2a shipped). The double-"report" in
> `REPORT__REPORT_ENTRY` / `ReportReportEntry` is only awkward because the *log-line*
> concept is still called "Report Entry." Renaming that concept to **`LogEntry`**
> (`REPORT_ENTRY` → `LOG_ENTRY`, join tables `<PARENT>__REPORT_ENTRY` →
> `<PARENT>__LOG_ENTRY`, JSON `report_entries` → `log_entries`, Go `ReportEntry` →
> `LogEntry`) reads better and ends the collision (`REPORT__LOG_ENTRY`,
> `ReportLogEntry`). **Not done now**: it's a *separate* entity rename touching
> incidents, reports, AND visits (not in the original Phase-2 term mapping), so it's
> a post-fair slice of its own — same vertical-rename template + migration as 2a,
> plus the FK-rename gotcha (implicit `*_ibfk_*` auto-follow, explicit FKs need
> manual drop/re-add). Group it with the other post-fair domain cleanups.

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
| **2a** | **Field Report → Report** (all layers) | ✅ **Done** (branch `feat/2a-field-report-to-report`). Migration `33-from-32.sql` (rename `FIELD_REPORT`/`FIELD_REPORT__REPORT_ENTRY` + `FIELD_REPORT_NUMBER`→`REPORT_NUMBER`, explicit `RRE_TO_*` FKs mirroring the STAY→VISIT precedent); `current.sql` v33; `queries.sql`; `json`/`api`/`urls`/`templ`/`ts` renamed (incl. `fr`/`FR` shorthand, the `IMS-Report-Number` header, and the `R#` attach sentinel); Playwright + integration tests updated. Migration integration test confirms the v6→v33 chain is byte-identical to `current.sql`. |
| **2b** | **Ranger → Person/People** (first-class local entity) | ➡️ **Promoted to its own Phase 3 (2026-06-06)** — see [`30-remove-clubhouse.md`](30-remove-clubhouse.md). Exploration showed this rename and the Clubhouse removal are the *same* change (can't key on `person_id` without a local Person table; login/authz still read Clubhouse), so doing it as a shallow Phase-2 string-rename would mean renaming twice. The whole thing — local `Person` table, `RANGER_HANDLE`/`AUTHOR` → `person_id`, `INCIDENT__RANGER`/`VISIT__RANGER` → `INCIDENT__PERSON`/`VISIT__PERSON`, `ROLE`→`involvement`, `Ranger*`→`Person*`, UI "People Involved" — now lives in Phase 3. |
| **2c** | **Black Rock City → Oregon Country Fair** + branding strings | ✅ **Done** (branch `feat/2c-ocf-branding`). Product name → **"Oregon Country Fair IMS"** (`cmd/root.go` `Use`/`Short`/`Long`, `README.md`, `CLAUDE.md`). Go **module path** `github.com/burningmantech/ranger-ims-go` → `github.com/mikeki/ocf-ims` (all 62 `.go` files + `go.mod`); **binary/image** `ranger-ims-go` → `ocf-ims` (`Makefile`, `Dockerfile`, `.air.toml`, `.gitignore`, `.dockerignore`, both `docker-compose.*`, `cicd.yml`, `bin/test_docker`, `bin/build/build.go`, `SKILL.md`). Live self-links updated to the real repo (`footer.templ`, `admin_debug.ts`, `ims.ts`). **Left as-is:** `COPYRIGHT` + per-file license headers (legal — needs OCF counsel, incl. the footer "© Burning Man Project" line); `CHANGELOG.md` + 5 in-code comment URLs (historical links to the *upstream* repo); `deploy.yml` (defunct AWS workflow); `seed.sql` Burning Man flavor (overlaps 2d); the `Ranger` *entity* (2b). Verified: full build, `go test ./...`, `go vet`, `gofmt`, `go mod tidy` clean; Docker image builds under new name and the cicd compose stack runs healthy (`/ims/app → 200`). |
| **2d** | **Small terms** — Patrol, HQ, Participant, Camp | Bundle the low-count items; confirm OCF wording first. |

> **No Event slice.** `Event` is kept verbatim (DB + API + UI), so there's no
> rename PR for it — see the Event decision above.

Each PR: separate branch off `master`, green build + tests, opened for review —
same workflow as Phase 1.

## API-contract / external-client impact

The deep rename **changes JSON field names and URL paths** (e.g.
`/ims/api/.../field_reports` → `/reports`, `"field_reports"` → `"reports"`). The
first-party web UI and Playwright tests are updated in the same PRs.

✅ **Resolved (2026-06-05): the API is web-UI-only** — no external consumers
(mobile, integrations, scripts). The OCF beta is a fresh deployment with no
Clubhouse and no third-party clients, so **the contract break is fully contained**
in the PRs we control. **No deprecation/redirect window or compatibility shims are
needed** — we can rename JSON fields and URLs outright.

## Open questions for OCF stakeholders

1. ~~**Field Report → "Report"**~~ — ✅ **decided: Report** (UI noun still tweakable).
2. ~~**Ranger → identity model**~~ — ✅ **decided: first-class `Person`/`People`,
   identified by `nickname`, keyed by `person_id`.** Remaining sub-questions:
   - **People sourcing** — without Clubhouse, how are People *created* (self-signup,
     admin-entered, imported roster)? → shared with **Phase 4**.
   - **Org-role wording** (Basic Reporter / Coordinator / Management) → **Phase 4**.
   - **Involvement history** — structured effective-dated history vs. rely on the
     action log? → **Phase 3** design item.
3. ~~**Event**~~ — ✅ **decided: keep `Event` everywhere (DB + API + UI); do *not*
   relabel to "Fair".** OCF runs one annual Fair **plus** smaller year-round events;
   the Fair is one event, smaller events are siblings, and the existing
   `IS_GROUP`/`PARENT_GROUP` grouping handles per-year access. "Event" is the
   correct generic term.
4. ~~**External API consumers?**~~ — ✅ **decided: web-UI-only**, no external
   clients; contract break is contained, no compat window needed.
5. **Per-term wording** — Patrol, Ranger HQ, Participant, Camp → confirm exact OCF
   terms (drafts above are guesses). *(Still open.)*

## Exit criteria

- [x] Personnel identity model decided — Ranger → first-class `Person`/`People`
      (`nickname` + `person_id`), `ROLE` → `involvement`.
- [x] Event decided — kept verbatim (DB + API + UI); not "Fair".
- [x] External-API-consumer question answered — web-UI-only, no compat window.
- [ ] Remaining per-term wording (Patrol, HQ, Participant, Camp) confirmed with
      OCF stakeholders.
- [ ] Each entity rename shipped as a green, independently-reviewable PR.
- [ ] No BRC-specific terminology remains in user-facing surfaces; build + unit +
      integration + Playwright green.
- [ ] User-facing docs (`docs/`, `README.md`, `CLAUDE.md`) updated to OCF terms.
      → proceed to **Phase 3** (`30-domain-model.md`).
