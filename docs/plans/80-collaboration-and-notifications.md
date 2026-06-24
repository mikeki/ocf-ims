# Plan 80 — Collaboration & notifications (track overview)

Status: **Backlog — captured for sequencing, not yet scheduled**

This is the umbrella doc for a loosely-related set of ideas raised on 2026-06-24
about keeping people aware of what's happening across incidents. It exists to
**preserve the context and the dependency ordering** so the work isn't lost; the
individual features have their own plan docs.

## The ideas

| # | Idea | Plan | State |
|---|------|------|-------|
| 1 | Incident page live-refreshes when others add journal entries | — | **Already built** (see below) |
| 2 | Send email from the system | [`83-email-infrastructure.md`](83-email-infrastructure.md) | Blocked on IT (infra prerequisites) |
| 3 | `@mention` people in a journal entry | [`81-journal-mentions.md`](81-journal-mentions.md) | Idea — design sketched |
| 4 | Notifications ("you were mentioned / added to an incident") | [`82-notifications.md`](82-notifications.md) | Idea — design sketched |

### 1. Live incident refresh — already implemented (no work)

Recorded here so we don't "rediscover" it as missing. When anyone adds a journal
entry, the server already pushes a live update:

- `api/journalentry.go` → `defer eventSource.notifyIncidentUpdate(event.ID, incidentNumber)`
  on insert.
- `api/eventsource.go` publishes it over a server-sent-events channel
  (`EventSourceChannel = "imsevents"`, the `EventSourcerer`).
- The client holds **one** `EventSource` connection (`requestEventSourceLock()`)
  and rebroadcasts to all tabs via a `BroadcastChannel`; the open incident page
  (`web/typescript/incident.ts`) reloads when an update for the incident it is
  showing arrives.

So this is **real-time push**, strictly better than a polling timer. If a page is
ever observed going stale, that is an SSE reconnect **bug** (e.g. laptop sleep or
a network blip dropping the EventSource), and the right fix is a **focus-gated
poll only as a fallback when the SSE connection looks dead** — not replacing the
push system.

## Dependencies & sequencing

```
(2) Email infrastructure ──────────────┐  (enables the email *channel*; not required for in-app)
                                        ▼
(3) Journal @mentions ───►  (4) Notifications
        │                        ▲
        └── a mention is one notification trigger; "added to an incident"
            (involvement) is another and needs no mention support
```

- **(3) @mentions** is the natural first build: self-contained, reuses the
  existing people-search typeahead, and produces the first notification trigger.
- **(4) Notifications** comes next. It is designed **type-first** (an enum of
  triggers: mentioned, added-to-an-incident, …) so it isn't mentions-only, and
  ships **in-app first** (a notifications table + a nav badge, fed by the SSE
  channel that already exists). The **email delivery channel is layered on later**
  and depends on (2).
- **(2) Email** is the long pole because it is mostly **IT/DNS work** (a sending
  path, credentials, and SPF/DKIM/DMARC on an OCF domain). It is worth starting
  the request with IT in parallel because it also unlocks the long-deferred
  **emailed password reset** (see `34-post-clubhouse-login.md` appendix), not just
  notifications.

Suggested order: **(3) → (4 in-app)**, with **(2)** pursued in parallel and **(4
email)** folded in once (2) lands.

## Notes

- All of this is **post-beta** / longer-term; nothing here blocks the current
  plan-52 / plan-53 work.
- None of these change incident/report data semantics; (3) and (4) add small side
  tables (`JOURNAL_ENTRY__MENTION`, a notifications table) and (2) is pure
  infrastructure + config.
