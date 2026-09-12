<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09v — slice 3b.6: live updates

> **Status:** **Built** — 2026-09-12, the next PR in the 3b client stack. The device
> half (a long stream through Caddy on a phone, foreground and background) is owed.
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, the 3b.6 row)
> under [09-proto-connect-platform.md](09-proto-connect-platform.md)
> **Follows:** [09p](09p-stream-and-push.md) (3b.0b — `WatchEvent`, the per-subscriber
> poke stream with a 25 s heartbeat and an `Unauthenticated` end on token expiry).
> **Owner:** Architect (`src/api/stream.ts`, the transport's fetch) → Builder (the hub,
> the screens' claim).
> **Last updated:** 2026-09-12

## Objective

A change someone else makes shows up on your screen without a pull and without waiting
for the 30 s poll — and the poll stays, as the fallback for a stream that will not open.

## What is already true on the wire (verified, 2026-09-12)

- `WatchEvent{event_ids}` is a Connect server stream of `WatchEventResponse{poke}`; the
  first message is an establishing heartbeat, then a heartbeat every 25 s, then
  `INCIDENT_CHANGED{event_id, incident_number}` / `REPORT_CHANGED{event_id, report_number}`
  filtered per subscriber. A poke carries no content.
- An expired access token ends the stream with `Unauthenticated` (09p Q4). A stream
  authenticates once, from the headers it opened with.
- React Native's `fetch` cannot stream a response body; `expo/fetch` can (09i E6).

## What 3b.6 builds

**`src/api/stream.ts`** (architect-tier): `watchEvents(client, {eventIds, signal}, handlers)`
— one long-lived stream, reopened with full-jitter backoff (1 s → 30 s cap) when it drops,
declared stale and reopened when two heartbeats go missing (60 s). It runs through the
auth transport, so the Bearer and the proactive refresh are the interceptor's; an
`Unauthenticated` end is a drop like any other, and the next attempt carries a refreshed
token. `onOpen(gap)` says whether a previous stream had dropped — the caller's cue for a
full refetch, since anything may have happened in the gap.

**The live hub** (`features/live/hub.ts`, built by `ApiProvider`): one stream per event
while any screen watches it, shared by reference count; paused when the app leaves the
foreground (AppState) and reopened with a full refetch when it returns; web tabs keep
theirs. A poke invalidates the record it names and the list it sits in; the screens'
queries refetch through the access-gated reads. A gap invalidates every read of the
event. The Board, the incident and the report claim the stream with `useLiveEvent`.

**The transport** uses `expo/fetch` on native, for every call — the unary calls do not
care, and the stream needs it.

## Acceptance criteria

- A second session's append appears on the first within seconds, not at the next poll.
- The stream closes in the background and the return refetches; a drop refetches.
- The token's expiry mid-stream is invisible: the stream comes back with a fresh Bearer.
- The 30 s polls are untouched.

## Verification

The 09i §9 list; the tracer opens the same incident in two sessions and sees the second's
entry on the first within the poll interval. Owed: a 10-minute stream through Caddy on a
real phone, foreground → background → foreground (09p's own open check).

## Checklist

- [x] `src/api/stream.ts` (backoff, staleness, gap) + tests over the fake's stream
- [x] The hub (reference count, pokes → invalidations, AppState) + tests
- [x] The screens' claim; `expo/fetch` on native
- [x] Fake IMS: a scriptable `WatchEvent`
- [x] Tracer: the two-session step
- [x] `/review-animations` Approve (nothing new moves; a refetch redraws in place)
- [ ] Phone: a long stream through Caddy, background and back

## Open questions

1. **Stop polling while live?** The poll and the stream both run today; a live Board
   refetches at most every 30 s for nothing. Cheap, and a safety net until the phone check
   proves the stream on both platforms. Recommendation: keep both until then.
2. **One stream per event, or one per session?** `WatchEvent` takes many ids; the hub opens
   one per event because the field app is in one event at a time. The dispatch console (3c)
   can widen it.
