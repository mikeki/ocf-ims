# 09d — Taxonomies and admin (Phase 0, slice 0d)

> **Status:** In progress — for review (lands in PR #203, alongside 0b/0c)
> **Parent:** [09-proto-connect-platform.md](09-proto-connect-platform.md) (Phase 0)
> **Follows:** [09c-people-access.md](09c-people-access.md)
> **Last updated:** 2026-08-25

## Objective

Model the taxonomy and admin read-models as `resources/v1` messages, and — since
the user asked to land *all* resource nouns before the 0e service surface — the one
remaining resource DTO (`Visit`). Same 0b conventions throughout. No RPCs.

## What landed

| Proto | Messages / enums | Mirrors |
|---|---|---|
| `resources/v1/incident_type.proto` | `IncidentType`, enum `IncidentTypeGroup` | `json.IncidentType` |
| `resources/v1/outcome.proto` | `Outcome` | `json.Outcome` |
| `resources/v1/action_log.proto` | `ActionLog` | `json.ActionLog` |
| `resources/v1/notification.proto` | `Notification` | `json.Notification` |
| `resources/v1/metrics.proto` | `Metrics`, `MetricCount`, `MetricDay`, `MetricIncidentRef` | `json.Metrics` et al. |
| `resources/v1/visit.proto` | `Visit`, `VisitPerson` | `json.Visit`, `json.VisitPerson` |

With this, **every `json/` DTO now has a `resources/v1` (or `common/v1`)
counterpart** — `resources/v1` is complete ahead of 0e.

## Key decisions

1. **`IncidentTypeGroup` is a proto enum**, not the free string `json.IncidentType`
   used: `INCIDENT_TYPE.GROUP` is a closed MySQL enum
   (`safety`/`conduct`/`operations`/`compliance`), so — as with `IncidentState` in
   0b — the contract models it as an enum. `UNSPECIFIED` maps to the nullable column
   being null (ungrouped). Both taxonomies (`IncidentType`, `Outcome`) carry the
   `approved` / `proposer` propose-approve fields; `proposer` is a
   `common.v1.PersonRef` (the renamed `json.Mention`).
2. **`Metrics` is modelled as a computed read-model resource**, with its request
   (the event selector) deferred to 0e. Per the contract's "no epoch numbers" rule,
   `json.Metrics.GeneratedAtMS` (Unix-millis) becomes a `google.protobuf.Timestamp`
   `generated_at`. `MetricDay.date` stays a `string` — it is a calendar-day key
   (`YYYY-MM-DD`, server-local), not an instant. `MetricIncidentRef` is kept a local
   minimal message (number + summary) rather than reusing `common.IncidentRef`: the
   metrics context already knows the event, so carrying `IncidentRef`'s event fields
   would only add empty values. The list/aggregate response wrappers
   (`json.NotificationList`'s `unread` count) likewise stay a 0e response concern.
3. **`ActionLog` keeps `json.ActionLog`'s `int64` ids** (`id`, `user_id`,
   `position_id`) rather than the contract's usual `int32` person id. It is a raw
   audit mirror — an append-only, potentially high-volume log with its own row ids —
   and `user_id`/`position_id` are the raw ids recorded at request time, not the
   resolved typed references used elsewhere. `http_status` was `int16`; proto has no
   16-bit type, so `int32`. Metadata only — bodies are never logged.
4. **`Visit` is included to complete `resources/v1`**, though the plan's slice text
   places it in no slice (the White Bird Visits UI is disabled for 2026 (#61), the
   backend intact). `Incident.visits` already references visit ids, so the contract
   would be incomplete without it. Guest identity collapses from
   `json.Visit`'s write-id-plus-read-echo pair (`guest_person_id` +
   `guest_name`/`guest_handle`) into a single `guest` `PersonRef`, the same pattern
   0b used for journal mentions; the epoch-double arrival/departure times become
   `Timestamp`s. **Flagged for review** — easy to drop if it should wait.

## Verification

- `buf lint` clean (vendored protovalidate module excluded); `go tool buf generate
  proto` emits Go + OpenAPI, and `--template buf.gen.web.yaml proto` emits the
  `…Json` TypeScript, for all 13 `resources/v1` messages plus the 2 `common/v1`
  refs — **no `gen/buf/validate/**`**.
- `go build ./...` green; `go mod tidy` leaves `go.mod`/`go.sum` unchanged (the 0b
  connect-indirect / protovalidate-direct state is unaffected — still no services
  until 0e).
- golangci-lint **0 issues** on `gen/` (license header propagates from each
  `.proto`, so files are detected as generated).
- `ParticipationType` (7 rungs) and `IncidentTypeGroup` (4 groups + unspecified)
  emit as generated enums; protovalidate constraint imports present in the new
  `*.pb.go`.

## Next / open

- **0e — the service surface** (separate PR): `service/v1/<resource>.proto`
  envelopes — where the auth messages, presence/required constraints, derived
  response fields (`AccessForEvent`, viewer flags, `NotificationList.unread`), and
  the write-only mutation selectors (crew `delete`/`member`) all land — plus the
  single `ImsService` and the route→RPC mapping table (all 65 REST routes, zero
  unclassified = the gate).
- Field numbers stay reusable until app-store ship (Phase 0 rule); nothing is
  `reserved` yet.
