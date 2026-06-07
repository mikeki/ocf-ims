# Phase 3 · PR #3 — Rename Ranger → People (UI / JSON / URL / identifiers)

**Status: In progress (started 2026-06-06).**

Parent plan: [`30-remove-clubhouse.md`](30-remove-clubhouse.md). Follows
[`31-local-people-directory.md`](31-local-people-directory.md) (PR #1, merged as #16)
and [`32-retire-clubhouse.md`](32-retire-clubhouse.md) (PR #2, merged as #17). With
the Clubhouse gone and a local `PERSON` model in place, the data layer already speaks
"person" (`PERSON`, `PERSON_ID`, `INCIDENT__PERSON`, `VISIT__PERSON`). This PR finishes
the rename through the **outward-facing vocabulary** — the JSON wire contract, the HTTP
URLs, the Go/TS identifiers, the templ UI, and the prose — so nothing user-visible says
"Ranger" anymore.

This is the first slice that **intentionally breaks the wire contract** (JSON keys and
URL paths change). That is acceptable: OCF IMS is a fresh, web-UI-only beta with no live
sessions and no external API consumers.

---

## Goal

After this PR, "Ranger" survives only in the frozen migration history and in the
upstream project's name. The current schema, queries, API, JSON, and UI all use
**People / Person / Involvement** vocabulary.

## Decisions (2026-06-06)

| Decision | Choice |
|---|---|
| URL path + JSON array key | **`people`** — `/…/incidents/{n}/people/{personHandle}`, JSON key `"people"` |
| Attachment "role" term | **`involvement`** (DB column, JSON key, UI label) — locked earlier in Phase 3 |
| Go/TS types | `IncidentRanger`→`IncidentPerson`, `VisitRanger`→`VisitPerson` |
| Prose sweep | **Full** — rewrite all user-visible "Ranger" prose, not just identifiers |
| Domain "staff" noun in prose | **`volunteer`** (e.g. "by volunteer transport", "the Sanctuary volunteer who sat with the guest") |
| Dead Clubhouse external links | **Removed** — `ranger-clubhouse.burningman.org` URLs (incident.templ on-duty link, ims.ts `clubhousePersonURL`) are defunct post-Clubhouse-retirement |
| Path param carrying a handle | `rangerName` → `personHandle` |

## Scope

### In scope

1. **DB migration v35** — rename column `ROLE` → `INVOLVEMENT` on `INCIDENT__PERSON`
   and `VISIT__PERSON`.
   - New append-only `store/schema/35-from-34.sql` (`alter table … change column`,
     `update SCHEMA_INFO set VERSION = 35`).
   - Mirror in `store/schema/current.sql` (both tables + bump version to 35).
   - Update `store/queries.sql` (the two `insert … (… ROLE)` statements →
     `INVOLVEMENT`; the `:many` read queries select the column via `sqlc.embed`/`*`,
     so regeneration picks up the rename).
   - Regenerate sqlc (`store/imsdb/`, not committed) and fix Go field references
     (`.Role` → `.Involvement` on generated row/param structs).
   - `go test ./store/integration` (`TestMigrateSameAsCurrentSchema` requires the
     migrated schema to be byte-identical to `current.sql`).

2. **JSON wire types** (`json/incident.go`, `json/visit.go`)
   - Type `IncidentRanger` → `IncidentPerson`; `VisitRanger` → `VisitPerson`.
   - Field `Role *string` (`json:"role"`) → `Involvement *string`
     (`json:"involvement"`).
   - Field `Rangers *[]IncidentRanger` (`json:"rangers"`) → `People *[]IncidentPerson`
     (`json:"people"`); same for `Visit`.
   - `json.Person.DirectoryID` (`json:"directory_id"`) → `PersonID`
     (`json:"person_id"`) — the Clubhouse-era name for what is now literally the local
     `PERSON.ID` (set from `r.ID` in `directory.go`); TS `Person.directory_id` →
     `person_id`. Its only frontend consumer (the Clubhouse person link) was removed,
     so this is a clean vocabulary rename of a now-otherwise-unused field.

3. **API handlers / routes** (`api/`)
   - Handler types: `AttachRangerToIncident`→`AttachPersonToIncident`,
     `DetachRangerFromIncident`→`DetachPersonFromIncident`, and the two visit
     equivalents (`…RangerToVisit`/`…RangerFromVisit` → `…PersonToVisit`/
     `…PersonFromVisit`).
   - Routes in `api/mux.go`: `…/rangers/{rangerName}` → `…/people/{personHandle}`
     (4 routes — incident attach/detach, visit attach/detach).
   - `PathValue("rangerName")` → `PathValue("personHandle")`; locals `rangerName`→
     `personHandle`, `rangersByIncident`/`rangersByVisit`→`peopleBy…`, loop `ranger`→
     `person`, `rangersJson`→`peopleJson`.
   - `incidentToJSON`/`visitToJSON` param `incidentRangers`/`visitRangers` →
     `incidentPeople`/`visitPeople`; struct literal `IncidentRanger{Role:…}` →
     `IncidentPerson{Involvement:…}`.

4. **Authz claim methods** (`lib/authz/claim.go` + all call sites)
   - `RangerHandle`→`PersonHandle`, `RangerOnSite`→`PersonOnSite`,
     `RangerPositions`→`PersonPositions`, `RangerTeams`→`PersonTeams`,
     `RangerOnDutyPosition`→`PersonOnDutyPosition`, and the `WithRanger*` setters →
     `WithPerson*`. Call sites in `api/helpers.go`, `api/auth.go`, `api/attachment.go`,
     `api/report.go`.

5. **Directory** (`directory/directory.go` + call sites)
   - Interface + impl method `GetRangers` → `GetPeople`; call sites in
     `api/personnel.go`, `api/auth.go`, `directory/local_test.go`.

6. **Frontend — TypeScript** (`web/typescript/`)
   - `ims.ts`: types `IncidentRanger`/`VisitRanger` → `…Person`; fields `role`→
     `involvement`, `rangers`→`people`; `renderRangerHandles`→`renderPersonHandles`;
     drop `clubhousePersonURL` (dead external link).
   - `urls.ts`: `url_incidentRanger`/`url_visitRanger` constants → `…Person`, path
     `/rangers/<ranger_name>` → `/people/<person_handle>`.
   - `incidents.ts`: column def `incident_ranger_handles`→`incident_person_handles`,
     `"data":"rangers"`→`"people"`, `renderRangerHandles`→`renderPersonHandles`.
   - `incident.ts` / `sanctuary_visit.ts`: functions `addRanger`/`removeRanger`/
     `setRangerRole`/`drawRangers`/`drawRangersToAdd` → `addPerson`/`removePerson`/
     `setPersonInvolvement`/`drawPeople`/`drawPeopleToAdd`; element bindings + DOM ids
     (`ranger_add`→`person_add`, `ranger_handles`→`person_handles`,
     `incident_rangers_list`→`incident_people_list`, `…_li_template` likewise,
     `visit_rangers_*`→`visit_people_*`); `window.addRanger`→`window.addPerson` etc.

7. **Frontend — templ** (`web/template/incident.templ`, `sanctuary_visit.templ`)
   - DOM ids/labels mirroring the TS changes above (`incident_rangers_list`→
     `incident_people_list`, `for="ranger_add"`, `list="ranger_handles"`, the
     `onchange`/`onclick` handler names, etc.).
   - Headings: "Rangers" → "People"; "Rangers Involved" → "People Involved".
   - Labels/placeholders: aria-label "Description of Ranger role" → "Description of
     involvement"; placeholder "Short description of role" → "Short description of
     involvement"; aria-label "Add Ranger Handle" → "Add Person".
   - Prose (full sweep, `volunteer`): "by Ranger transport" → "by volunteer
     transport" (×2); "the … Sanctuary Ranger who sat with the guest" → "the …
     Sanctuary volunteer who sat with the guest".
   - Remove the dead `ranger-clubhouse.burningman.org/reports/on-duty` on-duty link.

8. **Playwright** (`playwright/tests/ims.spec.ts`)
   - Helper `addRanger(page, rangerName)` → `addPerson(page, personHandle)`; selectors
     `getByLabel("Add Ranger Handle")` → `getByLabel("Add Person")`; test data
     `"… Role"` → `"… Involvement"`; var `runnerRanger`→`runnerPerson`,
     `"Runner Role"`→`"Runner Involvement"`.

### Out of scope (deferred within Phase 3)

- `PERSON.is_admin` flag (admins remain env `IMS_ADMINS` matched on handle).
- Local `onduty:` modeling (no timesheet source yet; `onduty:` stays inert).
- Set-password UX.
- `handle` → `nickname` terminology (decided to keep `HANDLE` end-to-end in PR #1;
  any change is a separate holistic pass).
- `lib/argon2id` / `lib/authn/password.go` comment terminology (cosmetic).

### Deliberately left "ranger" tokens (discovered during implementation)

The full-prose sweep intentionally stops short of these — each is an external
reference, a pre-existing latent bug, or retired-Clubhouse content that needs an OCF
answer that doesn't exist yet. All are flagged for follow-up:

- **GitHub URLs** (`github.com/burningmantech/ranger-ims-go`, `…/ranger-ims-server`)
  in TS comments — real upstream repo links; kept like any external URL.
- **`web/typescript/report.ts:428` `"ranger_handles": authors`** — a JSON key sent on
  incident-create that has **no matching Go field** (the field is `people`/
  `IncidentPerson`) and the **wrong shape** (array of strings, not person objects).
  Go has no `DisallowUnknownFields`, so it is silently ignored — a pre-existing no-op
  /latent bug, not vocabulary. Left untouched; fixing the behavior is separate.
- **`web/typescript/incidents.ts:104`** `ranger-tech-…@burningman.org` — a BRC contact
  email; OCF's real contact is unknown. Needs an OCF address, not a rename.
- **`web/template/incidents.templ:34`** — `#ranger-operations-center` Slack channel +
  `RSL/Operator/WSL` BRC ops jargon; OCF's equivalents are unknown.
- **`web/template/login.templ:79–98`** — `ranger-clubhouse.burningman.org` password-
  reset + credentials-notice links. Dead post-Clubhouse, but reworking them needs the
  OCF credential/reset story (set-password UX is deferred). Only the `Ranger`
  vocabulary on line 41 was fixed. **Follow-up: post-Clubhouse login-page cleanup.**

## Status — implementation complete (2026-06-06)

All steps done; verified with `go run bin/build/build.go` (sqlc/templ/tsgo + compile),
`go test ./...`, `go test ./store/integration ./api/integration` (Docker), `go vet`,
and `golangci-lint` (0 issues). The `store/integration` byte-identical check confirms
the v35 migration matches `current.sql`.

## Build / verify

- `go run bin/build/build.go` (runs sqlc + templ + tsgo, then compiles).
- `go test ./...` + `go test ./store/integration ./api/integration` (Docker).
- `golangci-lint run` clean.
- Playwright (if live stack available) or at least confirm the renamed DOM ids are
  internally consistent between templ and TS.

## Commit ordering (buildable steps)

1. Plan doc (this file) — committed first.
2. DB: migration v35 + current.sql + queries.sql (regen + `.Role`→`.Involvement`).
3. JSON types (`json/`).
4. Go API + authz + directory identifiers (compiles against new JSON types).
5. Frontend (templ + TS) + Playwright.

Each Go step must `go build ./...` clean before the next.
