# 09b — Core domain (Phase 0, slice 0b)

> **Status:** In progress — for review
> **Parent:** [09-proto-connect-platform.md](09-proto-connect-platform.md) (Phase 0)
> **Follows:** [09a-codegen-skeleton.md](09a-codegen-skeleton.md)
> **Last updated:** 2026-08-24

## Objective

Model the core domain as `resources/v1` protobuf messages — **no RPCs** (service
envelopes are 0e) — with protovalidate constraints written as each message is
modelled (M5). Resources covered (plan 09 §6): incident, report, journal entry,
person involvement, linked incident, area, event.

## What landed

The throwaway `example.proto` from 0a is **deleted**; these are the first real
messages. Each mirrors the hand-written `json/` DTO it will replace:

| Proto | Messages | Mirrors |
|---|---|---|
| `common/v1/mention.proto` | `Mention` | `json.Mention` |
| `resources/v1/event.proto` | `Event` | `json.Event` |
| `resources/v1/area.proto` | `Area` | `json.Area` |
| `resources/v1/journal_entry.proto` | `JournalEntry`, `Attachment` | `json.JournalEntry`, `json.Attachment` |
| `resources/v1/incident.proto` | `Incident`, `Location`, `IncidentPerson`, `LinkedIncident`, enums `IncidentState`/`IncidentPriority` | `json.Incident` et al. |
| `resources/v1/report.proto` | `Report` | `json.Report` |

## Key decisions

1. **protovalidate is vendored, not a BSR dep** (the decision deferred from 0a).
   `third_party/protovalidate/buf/validate/validate.proto` is exported from
   `buf.build/bufbuild/protovalidate` (its only non-WKT imports are google WKTs,
   which buf bundles). It is a second buf module, **excluded from lint/breaking**,
   and **import-only**: `buf generate proto` targets just the first-party module,
   so `gen/buf/validate/**` is never produced. This keeps **proto generation**
   fully hermetic — no `buf.build` egress in CI *or* the `golang:alpine` Docker
   build. A BSR dep would have forced `buf.build` egress into every build and
   fetched on each one.
   - Note: protoc-gen-go still adds a blank import of the protovalidate Go stubs
     (`buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go/...`) to the
     generated `*.pb.go` — the standard way protovalidate registers its extensions
     in Go. That is an ordinary Go-module dependency fetched via GOPROXY, not a
     direct `buf.build` fetch, and it was already in `go.sum` from 0a. `go mod tidy`
     therefore promotes it to a direct require and — since 0b has no services yet —
     demotes `connectrpc.com/connect` to indirect (it flips back at 0e's first
     service).
2. **`Mention` lives in `common/v1`** (M3: a type earns common/v1 on its second
   consumer) — incident, area, journal entry and report all reference it.
3. **Constraints split by message role.** Because create/update reuse the whole
   resource (Phase 0 contract rule), a resource-level constraint must also hold for
   create *input* — where most fields are unset. So resources/v1 carries only
   **always-valid invariants** (string `max_len`, enum `defined_only`);
   **presence/required** constraints (`min_len`, required fields) belong on the
   create/update *request* envelopes in 0e.
4. **Derived, viewer-dependent read-only flags are excluded from the resources**
   (`viewer_may_add_journal`, `may_edit_summary`, `may_add_journal_entry`,
   `has_event_access`) — they are not resource state and belong on the read
   *response* envelopes (0e).
5. **Write-input id-lists collapse into resolved objects.** `json.JournalEntry`'s
   `mentioned_person_ids`/`on_behalf_of_person_id` (write) and
   `mentions`/`on_behalf_of` (read) become single `Mention` fields; on write the
   client sets `person_id` and the server resolves handle/name.
6. **Enums** start at `_UNSPECIFIED = 0`; `IncidentPriority` uses the stored wire
   values (1/3/5) as its enum numbers. Timestamps are `google.protobuf.Timestamp`.
7. **`person_id` standardized to `int32`** (`json.IncidentPerson` used `int64` in
   one spot; the registry key is `int32` everywhere else, incl. `Mention`).

## Verification

- `buf lint` clean (vendored module excluded); `buf generate proto` emits Go +
  OpenAPI, and the pnpm template emits TypeScript (`…Json` types), for the
  first-party module only — **no `gen/buf/validate/**`**.
- `go build ./...` green; golangci-lint **0 issues** on `gen/` (license header
  propagates from each `.proto`, so files are detected as generated).
- Enums, `optional` presence, and protovalidate constraint bytes verified present
  in the generated descriptors.

## Next / open

- Remaining Phase 0 slices: **0c** people & access, **0d** taxonomies & admin,
  **0e** the service surface (RPC envelopes — where presence/required constraints
  and the derived response fields land) + the route→RPC mapping table.
- Field numbers stay reusable until app-store ship (Phase 0 rule); nothing is
  `reserved` yet.
