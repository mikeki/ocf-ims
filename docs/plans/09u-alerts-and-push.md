<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09u — slice 3b.5: alerts and push

> **Status:** **Merged (#264, 2026-09-13)** — built 2026-09-12 as the next PR in the 3b client stack. The device
> half of the verification (a real phone, a real push) is owed, and it needs an EAS project
> id first (open question 1).
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, the 3b.5 row)
> under [09-proto-connect-platform.md](09-proto-connect-platform.md)
> **Follows:** [09p](09p-stream-and-push.md) (3b.0c — `RegisterPushDevice` /
> `UnregisterPushDevice`, the `ExpoPushSender`) and [09t](09t-reports.md) (the
> `report_requested` notification).
> **Owner:** Builder (the screen, the bell) with the Architect owning `src/push/`
> (the token and permission flow) and the session hook.
> **Last updated:** 2026-09-12

## Objective

The person sees what was addressed to them — a mention, being added to an incident, a
request for their report — in one list with an unread count, opens it in one tap, and
gets the same thing on the lock screen when the app is closed.

## What is already true on the wire (verified, 2026-09-12)

- `ListNotifications` answers the caller's recent notifications plus `unread`; the two
  mark RPCs are scoped to the caller. `Notification` carries the event **name**, the
  incident or report number and summary, the actor's handle, `created` and `read`.
- A push (web or Expo) carries `{title: "OCF IMS", body, data.url}` where `url` is the
  **templ app's** path: `/ims/app/events/<name>/incidents/N`,
  `/ims/app/events/<name>/reports/N`, or `/ims/app/events/<name>/reports/new?incident=N`.
  The client routes by event **id**, so both surfaces resolve the name through the events
  list it already holds.
- `RegisterPushDevice` validates the `ExponentPushToken[` prefix and upserts on the token;
  `UnregisterPushDevice` deletes by token. Push stays off on a server without
  `IMS_EXPO_PUSH_ENABLED`, which is staging today.

## What 3b.5 builds

**The Alerts screen** (`/alerts`, global — notifications are per person, not per event):
the list newest first as the server gives it, each row the templ client's words
("Marisol mentioned you", "Dee asked for your report on an incident"), the record in the
Board's notation (`#12 Lost child`, `R-3 Fence down`) and the event, the unread mark the
Board's way (a labelled dot). A tap marks the one read and opens what it is about; "Mark
all read" sits in the header while there is anything unread. Polled every 30 s while
mounted (the stream is 3b.6); the server's `read` is the truth, no device watermark.

**The bell** is a word: "Alerts" in the header's right slot on the Board and the events
list, with the unread count as a chip when there is one. It reads the same query as the
screen, so the two never disagree.

**Push** (`src/push/`, architect-tier): a `PushService` seam (`available`, permission,
request, token, settings, received / opened listeners, the launching tap) with the Expo
implementation in `expo.ts` — unavailable on web, in a simulator, and in a build with no
EAS project id, so the card and the registration simply do not exist there. The
permission is asked **from the Alerts screen at a tap** ("Turn on notifications"), never
on launch; a denial shows "Open settings" since the OS will not ask twice. A device whose
permission is already granted registers on every signed-in mount (the server upserts).
The token is remembered on the device and **unregistered on sign-out through a new
session hook (`beforeSignOut`) that runs while the Bearer is still good**, bounded to
three seconds so a slow network never holds a sign-out. In the foreground a notification
refetches the list; a tap (or the tap that launched the app) becomes a route once the
events list can name the event.

## Acceptance criteria

- The bell counts the unread; the screen lists them; a tap marks read and opens; mark all.
- No permission prompt on launch. The prompt comes from the card's button only.
- A granted device registers on sign-in and unregisters on sign-out with a valid Bearer.
- A tapped push lands on the incident, the report, or the report form with the link.
- Nothing under `features/` imports `expo-notifications`.

## Verification

The 09i §9 list; the tracer opens the alerts from the Board and comes back. The device
checks below are owed.

## Checklist

- [x] `alerts/links.ts` (wording, hrefs, the push URL resolver) + tests
- [x] Alerts screen, mark one / all, the bell on the Board and the events list
- [x] `src/push/` seam + Expo implementation; registration; the sign-out hook; `PushEffects`
- [x] Fake IMS: the three notification RPCs and the two device RPCs; fake push
- [x] `app.json`: the `expo-notifications` plugin; packages via `expo install`
- [x] Tracer step
- [x] `/review-animations` Approve (press feedback on the bell only; the count chip appears with no animation)
- [ ] EAS project id in `app.json` (open question 1)
- [ ] Phone hand check: the prompt at the tap, a denial, a push from staging with `IMS_EXPO_PUSH_ENABLED`, a tap from the lock screen, sign-out unregistration

## Open questions

1. **The EAS project id.** `getExpoPushTokenAsync` needs `extra.eas.projectId`, which
   means an Expo account and an EAS project for the app. Without it the push surface is
   unavailable by construction (the app still works; the card is hidden). The
   recommendation: create the project as the first step of 3b.7 (store readiness) and put
   the id in `app.json` then, rather than blocking this slice on it.
2. **Where the alerts live.** 09i E15 imagined a bottom tab (Incidents · Reports · Alerts ·
   Me); D1 folded incidents and reports into the Board's segments, so there is no tab bar.
   The word in the header is the cheapest thing that reads; a tab bar can come with "Me"
   (3d.4) if the maintainer wants one. Screenshots decide.
3. **Web push.** 09i E8 keeps Expo web without web push in Phase 3 (the bell is the web
   channel). Unchanged here.
