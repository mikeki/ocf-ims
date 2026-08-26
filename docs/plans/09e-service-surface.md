# 09e — Service surface (Phase 0, slice 0e)

> **Status:** In progress — for review (PR #204, rebased onto `master` after #203 merged)
> **Parent:** [09-proto-connect-platform.md](09-proto-connect-platform.md) (Phase 0)
> **Follows:** [09d-taxonomies-admin.md](09d-taxonomies-admin.md)
> **Last updated:** 2026-08-25

## Objective

Define the RPC surface: the single `ImsService` plus a
`<Verb><Resource>Request`/`Response` for every RPC, under `proto/ocf/ims/service/v1/`.
This is where the constraints and fields that 0b–0d deferred finally land —
**presence/required** constraints on request envelopes, **derived viewer-dependent**
fields on response envelopes, the **auth** envelopes (deferred from 0c), and the crew
**delete/member** mutations (deferred from 0c) as explicit RPCs. The deliverable that
gates the slice is the **route → RPC mapping table** below: every current REST route
is either mapped to an RPC or classified as an M8 plain-HTTP exception (or the
deliberately-excluded visits subsystem). Zero unclassified routes.

## What landed

- `service/v1/service.proto` — the single **`ImsService`** (M3), **58 unary RPCs**, and
  **nothing else**: `service/v1/` holds only this file, so the API index stands alone.
- `service/rpc/v1/*.proto` (package `ocf.ims.service.rpc.v1`) — the request/response
  envelopes, **one file per resource** (`auth`, `incident`, `report`, `event`, `area`,
  `crew`, `person`, `incident_type`, `outcome`, `notification`, `metrics`,
  `action_log`, `push`), each keeping its RPCs' **request and response paired**. A
  dedicated request and response per RPC (including empty ones — buf's
  `RPC_REQUEST_RESPONSE_UNIQUE` forbids sharing, so each empty message is its own type).
  `service.proto` references them as `rpc.v1.<Name>`.
  *(Layout history: first cut put these envelopes in `service/v1/` alongside
  `service.proto` — 14 look-alike siblings that buried the index; a second cut grouped
  them into four domain files but one became an `admin.proto` grab-bag, which is
  grouping by caller/authorization — the very thing 0d rejected for packages. Splitting
  the service into its own directory and the envelopes into a per-resource
  `service/rpc/v1` package fixes both: the index is isolated, and every envelope file is
  a clean single resource. buf only requires files to match their package, not
  one-file-per-service.)*
- Response wrappers for the *caller*-relative read-only decorations 0b kept off the
  resources: `IncidentView` (`viewer_may_add_journal`), `ReportView`
  (`may_edit_summary`, `may_add_journal_entry`), `AccessForEvent` (the per-viewer
  permission set), and `ListNotificationsResponse.unread`. Per-**person** read-only
  flags stay on the resource: `IncidentPerson.has_event_access` is output-only on the
  resource (Q1 below), not a parallel map on the view.

## Route → RPC mapping table

All 70 registered `/ims/api/*` routes (the plan's "~65"). **M** = mapped to an RPC,
**H** = M8 plain-HTTP exception, **X** = deliberately excluded (retiring subsystem).

| Method + path | Handler | Disposition | RPC / reason |
|---|---|---|---|
| POST `/auth` | PostAuth | M | `Login` |
| GET `/auth` | GetAuth | M | `GetAuthStatus` |
| POST `/auth/refresh` | RefreshAccessToken | M | `RefreshToken` |
| POST `/auth/password` | SetOwnPassword | M | `ChangeOwnPassword` |
| POST `/auth/profile` | SetOwnProfile | M | `UpdateOwnProfile` |
| POST `/auth/picture` | SetOwnProfilePicture | H | blob upload (multipart) |
| DELETE `/auth/picture` | DeleteOwnProfilePicture | M | `DeleteOwnProfilePicture` |
| GET `/events/{e}/incidents` | GetIncidents | M | `ListIncidents` |
| POST `/events/{e}/incidents` | NewIncident | M | `CreateIncident` |
| GET `/events/{e}/incidents/{n}` | GetIncident | M | `GetIncident` |
| POST `/events/{e}/incidents/{n}` | EditIncident | M | `UpdateIncident` |
| GET `.../incidents/{n}/attachments/{a}` | GetIncidentAttachment | H | blob download |
| POST `.../incidents/{n}/attachments` | AttachToIncident | H | blob upload |
| POST `.../incidents/{n}/people/{p}` | AttachPersonToIncident | M | `AttachPersonToIncident` |
| DELETE `.../incidents/{n}/people/{p}` | DetachPersonFromIncident | M | `DetachPersonFromIncident` |
| POST `.../incidents/{n}/journal_entries/{j}` | EditIncidentJournalEntry | M | `UpdateIncidentJournalEntry` |
| GET `/events/{e}/reports` | GetReports | M | `ListReports` |
| POST `/events/{e}/reports` | NewReport | M | `CreateReport` |
| GET `/events/{e}/reports/{n}` | GetReport | M | `GetReport` |
| POST `/events/{e}/reports/{n}` | EditReport | M | `UpdateReport` |
| GET `.../reports/{n}/attachments/{a}` | GetReportAttachment | H | blob download |
| POST `.../reports/{n}/attachments` | AttachToReport | H | blob upload |
| POST `.../reports/{n}/journal_entries/{j}` | EditReportJournalEntry | M | `UpdateReportJournalEntry` |
| GET `/events/{e}/visits` | GetVisits | X | visits subsystem retiring (0d §5) |
| GET `/events/{e}/visits/{n}` | GetVisit | X | visits retiring |
| POST `/events/{e}/visits` | NewVisit | X | visits retiring |
| POST `/events/{e}/visits/{n}` | EditVisit | X | visits retiring |
| POST `.../visits/{n}/people/{p}` | AttachPersonToVisit | X | visits retiring |
| DELETE `.../visits/{n}/people/{p}` | DetachPersonFromVisit | X | visits retiring |
| GET `.../visits/{n}/attachments/{a}` | GetVisitAttachment | X | visits retiring (blob anyway) |
| POST `.../visits/{n}/attachments` | AttachToVisit | X | visits retiring (blob anyway) |
| POST `.../visits/{n}/journal_entries/{j}` | EditVisitJournalEntry | X | visits retiring |
| GET `/events/{e}/areas` | GetAreas | M | `ListAreas` |
| POST `/events/{e}/areas` | EditAreas | M | `CreateArea` + `UpdateArea` + `ApproveArea` + `MarkAreaDuplicate` (¹) |
| GET `/events/{e}/crews` | GetCrews | M | `ListCrews` |
| POST `/events/{e}/crews` | EditCrews | M | `SaveCrew` + `DeleteCrew` + `SetCrewMembership` (¹) |
| GET `/events/{e}/crews/mine` | MyCrews | M | `ListMyCrews` |
| POST `/events/{e}/crews/mine` | EditMyCrew | M | `SetMyCrewMembership` |
| GET `/events/{e}/metrics` | GetMetrics | M | `GetMetrics` |
| GET `/events` | GetEvents | M | `ListEvents` |
| POST `/events` | EditEvent | M | `SaveEvent` |
| GET `/incident_types` | GetIncidentTypes | M | `ListIncidentTypes` |
| POST `/incident_types` | EditIncidentTypes | M | `CreateIncidentType` + `UpdateIncidentType` + `ApproveIncidentType` + `SetIncidentTypeHidden` (¹) |
| POST `/events/{e}/incident_types` | ProposeIncidentType | M | `ProposeIncidentType` |
| GET `/outcomes` | GetOutcomes | M | `ListOutcomes` |
| POST `/outcomes` | EditOutcomes | M | `CreateOutcome` + `UpdateOutcome` + `ApproveOutcome` + `SetOutcomeHidden` (¹) |
| POST `/events/{e}/outcomes` | ProposeOutcome | M | `ProposeOutcome` |
| GET `/personnel` | GetPersonnel | M | `ListPersonnel` |
| POST `/personnel` | CreatePerson | M | `CreatePerson` |
| POST `/personnel/{p}` | EditPerson | M | `UpdatePerson` |
| POST `/personnel/{p}/password` | SetPersonPassword | M | `SetPersonPassword` |
| POST `/personnel/{p}/admin` | SetPersonAdmin | M | `SetPersonAdmin` |
| POST `/personnel/{p}/participation` | SetPersonParticipation | M | `SetPersonParticipation` |
| DELETE `/personnel/{p}/participation` | RemovePersonEvent | M | `RemovePersonFromEvent` |
| POST `/personnel/{p}/picture` | SetPersonProfilePicture | H | blob upload |
| DELETE `/personnel/{p}/picture` | DeletePersonProfilePicture | M | `DeletePersonProfilePicture` |
| GET `/personnel/{p}/picture` | GetPersonProfilePicture | H | blob serve |
| GET `/notifications` | GetNotifications | M | `ListNotifications` |
| POST `/notifications/read` | MarkNotificationsRead | M | `MarkAllNotificationsRead` |
| POST `/notifications/{id}/read` | MarkNotificationsRead | M | `MarkNotificationRead` |
| POST `/push/subscribe` | PostPushSubscribe | M | `SubscribePush` |
| DELETE `/push/subscribe` | DeletePushSubscribe | M | `UnsubscribePush` |
| GET `/eventsource` | EventSourcerer | H | SSE stream (M8; Connect server-streaming candidate) |
| GET `/debug/buildinfo` | GetBuildInfo | H | diagnostic/admin debug surface |
| GET `/debug/runtimemetrics` | GetRuntimeMetrics | H | diagnostic/admin debug surface |
| POST `/debug/gc` | PerformGC | H | diagnostic/admin debug surface |
| GET `/readyz` | (inline) | H | readiness probe (unauth up/down) |
| GET `/ims/api/ping` | (inline) | H | liveness probe |
| GET `/{$}` | (inline) | H | root banner |

**Totals: 70 routes — 46 mapped (M), 15 plain-HTTP exceptions (H), 9 excluded (X).**
46 REST routes map to **58 RPCs**. (¹) Four admin write endpoints **body-multiplex**
several verbs on one POST via selector fields, and each splits into its real verbs:
`POST /crews` → `SaveCrew`/`DeleteCrew`/`SetCrewMembership`; `POST /areas` →
`CreateArea`/`UpdateArea`/`ApproveArea`/`MarkAreaDuplicate`; `POST /incident_types`
and `POST /outcomes` → `Create`/`Update`/`Approve`/`SetHidden` each. Zero unclassified.

Not counted here: the `web/` templ page routes are the legacy HTML UI, a separate HTTP
surface frozen for replacement by the Expo client (Phases 2–4), not part of the API
contract.

## Key decisions

1. **One `ImsService`** (M3), not service-per-resource. connect-go emits one client and
   one handler interface; the interceptor spine (1b) is declared once.
1a. **Selector keys are qualified** (`incident_number`, `report_number`, `person_id`,
   `notification_id`) rather than a bare `number`/`id`, matching how the ref types name
   their keys (`common.IncidentRef.incident_number`) and disambiguating requests that
   carry more than one id (e.g. `UpdateIncidentJournalEntryRequest` has both
   `incident_number` and `journal_entry_id`). The resources keep their own key as
   `number` (a resource's own field is unqualified in its own context; a
   selector/reference to it is qualified).
2. **Presence vs derived, resolved per 0b–0d.** Required/presence constraints
   (`string.min_len`, `int32.gt = 0` on path keys) live on the **request** messages.
   Derived read-only fields split by *whom they describe*: a **caller**-relative flag
   lives on the **response** wrapper (`IncidentView.viewer_may_add_journal`,
   `ReportView`/`AccessForEvent`); a flag about a **resource member** lives on the
   resource as output-only (`IncidentPerson.has_event_access` — Q1). This completes and
   refines the split 0b decision #3/#4 set up.
3. **Create/update carry the whole resource** (Phase-0 rule) — e.g.
   `CreateIncidentRequest{event_name, Incident}`. Server-assigned fields on the resource
   are ignored on create.
4. **Body-multiplexing write endpoints split into their real verbs.** Four admin POSTs
   carry several operations on one JSON body via selector fields, and each decomposes
   into explicit RPCs: `POST /crews` → `SaveCrew`/`DeleteCrew`/`SetCrewMembership` (the
   0c decision); `POST /areas` → `CreateArea`/`UpdateArea`/`ApproveArea`/
   `MarkAreaDuplicate`; `POST /incident_types` and `POST /outcomes` →
   `Create`/`Update`/`Approve`/`SetHidden` each. Approve, set-hidden and mark-duplicate
   are state transitions and a destructive merge, not "save the resource" — the same
   reason crews split. `SaveEvent` is the one write **kept** as an upsert (event.id == 0
   creates, else updates): it carries no such extra verbs, only create-or-update by a
   client-supplied name, and its response now returns the server-assigned `event_id`
   (which the empty response, and the REST `IMS-Event-ID` header, had dropped).
5. **Blob endpoints stay plain HTTP, deletes become RPCs.** Attachment/picture
   *upload* (multipart) and *download/serve* are M8 plain-HTTP; the picture *delete*
   endpoints carry no blob and become RPCs (`DeleteOwnProfilePicture`,
   `DeletePersonProfilePicture`). So a resource's ops can straddle two transports.
6. **Visits are excluded, not mapped** — consistent with dropping `visit.proto`
   (0d §5). The 9 visit routes are marked **X**; they are not "plain-HTTP exceptions"
   (they are not staying — the subsystem is being removed), so they get their own
   disposition rather than being mislabeled H.
7. **Debug endpoints are plain-HTTP exceptions**, not RPCs — one-off diagnostic shapes
   (buildinfo/runtimemetrics/gc), admin-only, not part of the product contract.

## Open questions — resolved (review, 2026-08-26)

The three questions flagged during 0e were worked through and applied to the contract:

- **Q1 — `has_event_access` placement → on the resource.** The `map<int32,bool>` on
  `IncidentView` is gone; the flag is now an **output-only field on the `IncidentPerson`
  resource** (ignored on write, like `Incident.created`). It is a fact about the
  involved *person*, not the *viewer*, and the contract already carries read-only echoes
  (`created_by`, `PersonRef.handle`/`name`) on resources — so this is consistent, and
  clients read it inline with no map join. The **view keeps only caller-relative flags**
  (`viewer_may_add_journal`). Considered and rejected: an `IncidentPersonView` wrapper
  (would force a duplicate/half-populated `incident.people`).
- **Q2 — `RefreshToken` stays empty.** The web client's refresh token rides in the
  HttpOnly cookie; the native Expo client's body-carried token is a **Phase-3a addition**
  (a decision 3a owns), non-breaking to add pre-ship. The proto comment now says so.
- **Q3 — decompose the multiplexers, don't just upsert.** Investigation showed
  `POST /areas`, `POST /incident_types` and `POST /outcomes` each **body-multiplex**
  create/update/approve/(set-hidden | mark-duplicate) — the same shape crews had. They
  split into explicit verbs (see decision #4). `SaveEvent` stays an upsert but its
  response now returns the assigned `event_id`. Net: **49 → 58 RPCs.**

## Verification

- `buf lint` clean. `buf breaking` clean against `master` — now at 0b–0d after #203
  merged, so master is a meaningful baseline and 0e only adds.
- `buf generate proto` now emits the connect stubs
  (`gen/ocf/ims/service/v1/servicev1connect/service.connect.go`) — 0a–0d produced none,
  as no service existed. OpenAPI regenerated. The pnpm template emits 14 service TS
  files.
- `go build ./...` green. `go mod tidy` flips **`connectrpc.com/connect` from indirect
  to a direct require** (0b predicted this at the first service) — the only go.mod
  change, and the expected one.
- golangci-lint **0 issues** on `gen/`.
- **After the review round (Q1–Q3):** `buf lint` + `buf breaking` vs `master` still
  clean (the resource `IncidentPerson` only *gains* a field; the reshaped service
  envelopes are 0e-only files, so nothing on master breaks); regenerate + `go build`
  green; `go mod tidy` still a no-op. `ImsService` is now **58 RPCs**.

## Gate

`buf lint` + `buf breaking` clean; Go, TypeScript and OpenAPI generate from a clean
tree; the mapping table has **zero unclassified routes**. Phase 0 gate met.
