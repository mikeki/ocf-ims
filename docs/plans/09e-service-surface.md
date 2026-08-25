# 09e — Service surface (Phase 0, slice 0e)

> **Status:** In progress — for review (separate PR, stacked on #203)
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

- `service/v1/service.proto` — the single **`ImsService`** (M3), **49 unary RPCs**.
- 13 envelope files (`auth`, `incident`, `report`, `event`, `area`, `crew`, `person`,
  `incident_type`, `outcome`, `notification`, `metrics`, `action_log`, `push`) holding
  the request/response messages. A dedicated request and response per RPC (including
  empty ones — buf's `RPC_REQUEST_RESPONSE_UNIQUE` forbids sharing, so each empty
  message is its own type).
- Response wrappers for the derived read-only decorations 0b kept off the resources:
  `IncidentView` (`viewer_may_add_journal`, `person_has_event_access`), `ReportView`
  (`may_edit_summary`, `may_add_journal_entry`), `AccessForEvent` (the per-viewer
  permission set), and `ListNotificationsResponse.unread`.

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
| POST `/events/{e}/areas` | EditAreas | M | `SaveArea` |
| GET `/events/{e}/crews` | GetCrews | M | `ListCrews` |
| POST `/events/{e}/crews` | EditCrews | M | `SaveCrew` + `DeleteCrew` + `SetCrewMembership` (¹) |
| GET `/events/{e}/crews/mine` | MyCrews | M | `ListMyCrews` |
| POST `/events/{e}/crews/mine` | EditMyCrew | M | `SetMyCrewMembership` |
| GET `/events/{e}/metrics` | GetMetrics | M | `GetMetrics` |
| GET `/events` | GetEvents | M | `ListEvents` |
| POST `/events` | EditEvent | M | `SaveEvent` |
| GET `/incident_types` | GetIncidentTypes | M | `ListIncidentTypes` |
| POST `/incident_types` | EditIncidentTypes | M | `SaveIncidentType` |
| POST `/events/{e}/incident_types` | ProposeIncidentType | M | `ProposeIncidentType` |
| GET `/outcomes` | GetOutcomes | M | `ListOutcomes` |
| POST `/outcomes` | EditOutcomes | M | `SaveOutcome` |
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
46 REST routes map to 49 RPCs (¹ one REST endpoint, `POST /crews`, multiplexes three
operations on its body and splits into three RPCs). Zero unclassified.

Not counted here: the `web/` templ page routes are the legacy HTML UI, a separate HTTP
surface frozen for replacement by the Expo client (Phases 2–4), not part of the API
contract.

## Key decisions

1. **One `ImsService`** (M3), not service-per-resource. connect-go emits one client and
   one handler interface; the interceptor spine (1b) is declared once.
2. **Presence vs derived, resolved per 0b–0d.** Required/presence constraints
   (`string.min_len`, `int32.gt = 0` on path keys) live on the **request** messages;
   the derived viewer-dependent fields live on the **response** wrappers
   (`IncidentView`/`ReportView`/`AccessForEvent`). This completes the split 0b decision
   #3/#4 set up.
3. **Create/update carry the whole resource** (Phase-0 rule) — e.g.
   `CreateIncidentRequest{event_name, Incident}`. Server-assigned fields on the resource
   are ignored on create.
4. **`POST /crews` splits into three RPCs** (`SaveCrew`, `DeleteCrew`,
   `SetCrewMembership`) rather than one upsert carrying `delete`/`member` selectors —
   the 0c decision to make those explicit RPCs. This is the one place the REST→RPC map
   is not 1:1.
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

## Open questions for review

- **`IncidentView.person_has_event_access` as a `map<int32,bool>`** — the per-person
  derived flag (`json.IncidentPerson.has_event_access`) had nowhere clean to go once it
  was kept off the resource `IncidentPerson`. A parallel map keyed by person id is the
  current answer; the alternative is a response-side `IncidentPersonView` wrapping the
  resource person + the flag. The map is simpler; the wrapper is more uniform. Worth a
  call before 1d builds against it.
- **`RefreshToken` reads a cookie, not the request body.** Modeled with an empty
  request; the handler still reads the HttpOnly cookie from headers (unchanged under
  Connect). Flagged in case we'd rather carry the token explicitly.
- **`SaveEvent` / `SaveArea` / `SaveCrew` / `SaveIncidentType` / `SaveOutcome` are
  upserts** mirroring the single REST write endpoint, rather than split
  Create/Update RPCs. Kept 1:1 with the routes; revisit if the handlers want the split.

## Verification

- `buf lint` clean. `buf breaking` clean against the parent branch
  `feat/0b-core-domain` (0e only adds). *(Against `origin/master` it errors on image
  count — master (0a) predates the second protovalidate buf module and the whole
  domain model, so it is not a meaningful 0e baseline.)*
- `buf generate proto` now emits the connect stubs
  (`gen/ocf/ims/service/v1/servicev1connect/service.connect.go`) — 0a–0d produced none,
  as no service existed. OpenAPI regenerated. The pnpm template emits 14 service TS
  files.
- `go build ./...` green. `go mod tidy` flips **`connectrpc.com/connect` from indirect
  to a direct require** (0b predicted this at the first service) — the only go.mod
  change, and the expected one.
- golangci-lint **0 issues** on `gen/`.

## Gate

`buf lint` + `buf breaking` clean; Go, TypeScript and OpenAPI generate from a clean
tree; the mapping table has **zero unclassified routes**. Phase 0 gate met.
