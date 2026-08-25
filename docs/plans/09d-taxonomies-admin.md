# 09d — Taxonomies and admin (Phase 0, slice 0d)

> **Status:** In progress — for review (lands in PR #203, alongside 0b/0c)
> **Parent:** [09-proto-connect-platform.md](09-proto-connect-platform.md) (Phase 0)
> **Follows:** [09c-people-access.md](09c-people-access.md)
> **Last updated:** 2026-08-25

## Objective

Model the taxonomy and admin read-models as `resources/v1` messages. Same 0b
conventions throughout. No RPCs.

## What landed

| Proto | Messages / enums | Mirrors |
|---|---|---|
| `resources/v1/incident_type.proto` | `IncidentType`, enum `IncidentTypeGroup` | `json.IncidentType` |
| `resources/v1/outcome.proto` | `Outcome` | `json.Outcome` |
| `resources/v1/action_log.proto` | `ActionLog` | `json.ActionLog` |
| `resources/v1/notification.proto` | `Notification`, enum `NotificationType` | `json.Notification` |
| `resources/v1/metrics.proto` | `Metrics`, `MetricCount`, `MetricDay`, `MetricIncidentRef` | `json.Metrics` et al. |

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
4. **`Notification.type` is a proto enum** (`NotificationType`), not the free string
   `json.Notification` used — `NOTIFICATION.TYPE` is a closed MySQL enum, designed
   "type-first ... so it grows to cover more" (migration 00008). The message stays
   **flat, not a `oneof`**: the two current types (`mentioned`, `added_to_incident`)
   are near-identical in shape (both point at an incident/report + actor, differing
   only in a couple of type-dependent fields), matching the single flat backing
   table. Revisit the `oneof` if a materially different-shaped type is added — cheap
   while the contract is unreleased.
5. **White Bird visits are deliberately excluded** (user decision 2026-08-25). An
   earlier draft of this slice added `visit.proto` (and 0b's `Incident.visits`
   referenced visit ids), but the visits subsystem is being removed from the system
   soon, so the forward-looking contract does not model it. `visit.proto` was dropped
   and the `Incident.visits` field removed (0b's incident renumbered to stay dense;
   nothing has shipped, so field-number reuse is free). Consequently `json.Visit` /
   `json.VisitPerson` intentionally have **no** `resources/v1` counterpart.
6. **`resources/admin/v1` was considered and rejected** — resources are packaged by
   domain (M1), not by who may call them. Admin-ness is fuzzy as a partition
   (`IncidentType`/`Outcome` are admin-managed but writer-read; `Metrics` is
   admin-gated today but a plain read-model), authorization already lives in the
   interceptor spine / service methods (0e/1b), and a package split would force a
   resource to change import paths when its access rule changes. Grouping admin
   *RPCs* is a service-surface concern for 0e, not a resource-package split.

## Verification

- `buf lint` clean (vendored protovalidate module excluded); `go tool buf generate
  proto` emits Go + OpenAPI, and `--template buf.gen.web.yaml proto` emits the
  `…Json` TypeScript, for all 12 `resources/v1` messages plus the 2 `common/v1`
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
