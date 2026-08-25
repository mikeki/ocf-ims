# 09c — People and access (Phase 0, slice 0c)

> **Status:** In progress — for review (lands in PR #203, alongside 0b/0d)
> **Parent:** [09-proto-connect-platform.md](09-proto-connect-platform.md) (Phase 0)
> **Follows:** [09b-core-domain.md](09b-core-domain.md)
> **Last updated:** 2026-08-25

## Objective

Model the people-and-access domain as `resources/v1` messages, following the
conventions established in 0b (SPDX one-line header, `common/v1` for shared `*Ref`
types, resource-level constraints limited to always-valid invariants, scalar
`int32` ids, `google.protobuf.Timestamp`, enums prefixed and `_UNSPECIFIED = 0`).
No RPCs.

## What landed

| Proto | Messages / enums | Mirrors |
|---|---|---|
| `resources/v1/person.proto` | `Person`, `PersonCrew`, enum `ParticipationType` | `json.Person`, `json.PersonCrew` |
| `resources/v1/crew.proto` | `Crew`, `CrewMember` | `json.Crew`, `json.CrewMember` |

## Key decisions

1. **Auth envelopes are deferred to 0e, not modelled here.** The plan's slice text
   lists "auth envelopes (login, refresh, profile)" under 0c, but 0b established
   that *all* request/response envelopes live in the service surface (0e), because
   they carry presence/required constraints and derived, viewer-dependent response
   fields. The auth shapes are exactly that: `PostAuthRequest/Response`,
   `RefreshAccessTokenResponse`, and `GetAuthResponse` (the whoami/profile response,
   whose `AccessForEvent` map is *computed* per-viewer permissions) have no backing
   resource — they are pure service envelopes. Modelling them in 0e keeps the
   convention clean and matches the user's "all the resource nouns now, the service
   surface separately in 0e" framing. This slice therefore contributes the person /
   crew **nouns**; `AccessForEvent` and the auth request/response messages land in
   0e alongside the other RPC envelopes.
2. **`ParticipationType` is a proto enum** (the per-event access ladder). Unlike
   `IncidentPriority` — whose enum numbers mirror a stored tinyint — participation
   is a MySQL *string* enum, so the proto numbers are just a dense ladder-ordered
   sequence (writer=1 … ejected=7), not wire values. The stored value stays
   `EJECTED`; the UI relabels it "booted" (round-10), which is a display concern.
3. **The full `Person` registry entity lives in `resources/v1`**, distinct from the
   lightweight `common/v1.PersonRef` (id + handle + name) that other resources embed.
   The password hash (`json:"-"`) has no field — it is never on the wire.
   `person_id` is `int32` (json.Person used `int64`, but `PERSON.ID` is a plain
   integer and the contract standardizes person ids on `int32`, as in `PersonRef`).
   Endpoint-specific field population (email/phone admin-only, wristband /
   participation / crews only on event-scoped reads) is a server concern, not
   contract shape.
4. **`Crew`'s write-only operation selectors are excluded.** `json.Crew` overloads
   one type for reads and writes, carrying `delete` (remove the crew) and `member`
   (a single membership mutation) besides its fields. Those are RPC operations, not
   resource state, so they belong on 0e request envelopes; the resource carries only
   `slug`/`name`/`sort_order`/`members`. Crews are admin-managed only (no
   propose/approve workflow), so — unlike area / incident-type / outcome — there are
   no `approved`/`proposer` fields.

## Verification

Covered by the combined 0b/0c/0d run — see [09d](09d-taxonomies-admin.md#verification).
`buf lint` clean; `ParticipationType` emits with all seven rungs; `go build ./...`
green; golangci **0 issues** on `gen/`.
