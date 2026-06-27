# Plan 82 — Notifications

Status: **Idea — design sketch, not scheduled**

Part of the [collaboration & notifications track](80-collaboration-and-notifications.md).
Depends on [`81-journal-mentions.md`](81-journal-mentions.md) for the mention
trigger. Delivery channels layer on the same server-side generation points: the
in-app bell (built here), the **email** channel (gated on
[`83-email-infrastructure.md`](83-email-infrastructure.md)), and **web push** to
phones/desktops ([`84-web-push-notifications.md`](84-web-push-notifications.md) —
needs no IT/DNS work, so it can ship before email).

## Motivation

People work across many incidents and can't watch them all. They should be told
when something needs their attention elsewhere — they were `@mentioned`, they were
**added to an incident**, or they were asked something. Today there is no way to
know without stumbling onto it.

## Design

### Type-first, not mention-only

This is designed around an **explicit notification-type enum from the start**, so
it isn't just "mention notifications." Initial types:

- `mentioned` — you were `@mentioned` in a journal entry (trigger from plan 81).
- `added_to_incident` — you were added to an incident's involvement (needs no
  mention support; fires from the attach-person path).
- (room to grow: `asked` / follow-up requests, state changes on incidents you're
  involved in, etc.)

### Delivery — in-app first, then other channels

- **In-app (first):** a notifications table; a **nav badge / inbox** showing
  unread count; mark-as-read. Fed by the **existing SSE channel** (`api/eventsource.go`)
  so a logged-in user sees a new notification live without reloading.
- **Web push (next, no IT needed):** the same notification pushed to a subscribed
  phone/desktop even when IMS is closed — reaches field staff with the tab shut.
  Self-contained (self-generated VAPID keys + HTTPS), so it can ship **before**
  email. See [`84-web-push-notifications.md`](84-web-push-notifications.md).
- **Email (later):** the same notification, optionally emailed. **Gated on
  [`83-email-infrastructure.md`](83-email-infrastructure.md)** existing. Per-user
  preferences (which types email vs. in-app only) come with this stage.

### Data model (sketch)

```
NOTIFICATION
  ID          integer  pk auto_increment
  RECIPIENT   integer  not null   -- FK PERSON (who is notified)
  TYPE        enum('mentioned','added_to_incident', ...) not null
  EVENT       integer             -- source event (for linking/scoping)
  INCIDENT_NUMBER integer         -- source incident (nullable; type-dependent)
  JOURNAL_ENTRY   integer         -- source entry (nullable; e.g. for 'mentioned')
  ACTOR       integer             -- FK PERSON who caused it (nullable)
  CREATED     double   not null
  READ_AT     double             -- null = unread
```

Notifications are **generated server-side** at the trigger points (writing a
journal entry with mentions; attaching a person to an incident), in the same
transaction/`defer` as the existing SSE publish.

### UI

- A bell/badge in the nav with an unread count; a dropdown or page listing recent
  notifications, each linking to its source incident (and entry).
- Mark individual / all read.

## Open questions

- **Self-notifications** — suppress notifying the actor about their own action.
- **De-duplication / batching** — multiple mentions of the same person on one
  entry should produce one notification; rapid-fire updates shouldn't spam.
- **Retention** — how long to keep read notifications.
- **Access** — a notification must not leak incident content the recipient can't
  otherwise see; respect the same per-event / per-incident access as the incident
  itself (note the 52f grant model — a reporter added to an incident gains access
  to it, so "added_to_incident" is self-consistent).
- **Email preferences** — per-type opt in/out (deferred to the email stage).

## Slices (when scheduled)

- **82a** — schema (`NOTIFICATION`) + server-side generation at the two initial
  triggers (`mentioned` via plan 81's mention rows; `added_to_incident` via the
  attach-person path) + tests.
- **82b** — in-app UI: nav badge + list + mark-read, live via the existing SSE
  channel.
- **82c** *(after [`83`](83-email-infrastructure.md))* — email delivery +
  per-user, per-type preferences.
- **Web push** — its own delivery channel with its own slices; see
  [`84-web-push-notifications.md`](84-web-push-notifications.md) (84a–84d).
