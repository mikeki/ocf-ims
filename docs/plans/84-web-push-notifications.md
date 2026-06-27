# Plan 84 — Web push notifications

Status: **In progress — 84a (server plumbing) + 84b (client subscription) built; 84c–84d to do**

Part of the [collaboration & notifications track](80-collaboration-and-notifications.md).
A **third delivery channel** for the notifications built in
[`82-notifications.md`](82-notifications.md) (which already ships the in-app bell),
layered on the **same** server-side generation points. Sibling to the email
channel ([`83-email-infrastructure.md`](83-email-infrastructure.md)).

## Motivation

The in-app bell (plan 82) only tells you something happened **while you have IMS
open**. At the Fair, the people who most need to know they were `@mentioned` or
**added to an incident** are out in the field with a phone in their pocket and the
tab closed. Web push delivers an **OS-level notification to the phone's lock
screen** even when IMS isn't open — the same reach as a native app, with no app to
install from a store.

### Why this before email

Email (plan 83) is **blocked on IT** — it needs an SMTP relay or provider,
credentials, and SPF/DKIM/DMARC on an OCF domain. Web push needs **none of that**:

- **No third party, no IT.** We self-generate a VAPID key pair (one command). The
  browser's own push service (Google/Apple/Mozilla) does delivery; we never sign up
  for anything.
- **Only hard prerequisite: HTTPS in production** (service workers require a secure
  context; `localhost` is exempt for dev).

So this is the push channel we can ship **now**, independent of the email long pole.

## How web push works (the moving parts)

1. **Service worker** — a background script the browser keeps alive after the tab
   closes. It receives the `push` event and calls `showNotification()`, and on
   `notificationclick` focuses/opens the relevant incident or report. *(New — we
   have no service worker today.)*
2. **Subscription** — on a user gesture, the page calls
   `PushManager.subscribe({ applicationServerKey: <VAPID public key>, userVisibleOnly: true })`.
   The browser returns a **subscription**: an `endpoint` URL (at its push service) +
   two keys (`p256dh`, `auth`). The page POSTs this to us; we store it.
3. **Sending** — to notify, the server POSTs an **encrypted, VAPID-signed** payload
   to that `endpoint`. The push service wakes the service worker, which shows the
   notification. A Go library does the encryption + VAPID JWT for us.

### What we already have

The favicon/PWA scaffolding is **already in the tree** — we're further along than it
looks:

- `web/static/logos/site.webmanifest` (web app manifest)
- `web/static/logos/android-chrome-192x192.png`, `…-512x512.png`,
  `apple-touch-icon.png` (the icons iOS/Android want)

What's missing: a **service worker**, the **manifest wired into `<head>`**,
subscription **storage + API**, the **send path**, **VAPID keys** in config, and a
**Settings toggle** to opt in per device.

## The iOS caveat (name it up front)

- **Android & desktop** (Chrome/Firefox/Edge): works in a normal browser tab —
  grant permission once.
- **iPhone/iPad (Safari)**: Apple only allows web push for a site **added to the
  Home Screen** (installed as a PWA), on **iOS 16.4+**. A plain Safari tab cannot
  subscribe. For our small, known roster this is a one-time "Share → Add to Home
  Screen" onboarding step, but it's real friction and must be documented (84d).

## Design

### Data model

```
PUSH_SUBSCRIPTION
  ID          integer  pk auto_increment
  PERSON_ID   integer  not null      -- FK PERSON (who this device belongs to)
  ENDPOINT    varchar  not null unique -- the push-service URL (identity of a device)
  P256DH      varchar  not null       -- client public key (for payload encryption)
  AUTH        varchar  not null       -- client auth secret
  USER_AGENT  varchar                 -- best-effort label for a "your devices" list
  CREATED     double   not null
```

One person → **many** subscriptions (phone, laptop, …). `ENDPOINT` is the natural
unique key (re-subscribing the same browser upserts). Dead subscriptions are pruned
when the push service returns **404/410 Gone** on send.

### API

- `POST   /ims/api/push/subscribe`   — body = the browser's `PushSubscription` JSON;
  upsert by endpoint for the caller. `LogRequest(true)`.
- `DELETE /ims/api/push/subscribe`   — body = `{endpoint}`; remove that device.
  `LogRequest(true)`.
- The **VAPID public key** is exposed to the client on the **auth response**
  (`GET /ims/api/auth` → `GetAuthResponse.PushVAPIDPublicKey`), which the client
  already fetches on every page — this codebase has no separate `/ims/api/bag`
  client-config endpoint. The page subscribes with that key; a build with no VAPID
  key omits the field, so the client treats push as **off** (the Settings toggle
  hides itself).

### Config (`.env` / `conf/imsconfig.go`)

- `IMS_VAPID_PUBLIC` / `IMS_VAPID_PRIVATE` — the key pair (private is a **secret**).
- `IMS_VAPID_SUBJECT` — a `mailto:` or URL contact, required by the spec.
- Generated once with the chosen library's keygen; absent ⇒ feature disabled (dev
  default), mirroring how attachments/seed backends degrade.

### Sending (server)

- Library: **`github.com/SherClockHolmes/webpush-go`** — pure Go (no cgo), does
  message encryption (aes128gcm) + VAPID JWT. New `go.mod` dependency.
- A thin **push service** (interface) with a real backend and a **`noop`** backend
  for dev/tests, mirroring the mail-service abstraction sketched in plan 83 and the
  existing store/attachments backend pattern.
- **Fan-out at the existing notification triggers.** Wherever plan 82 calls
  `createNotification` (`api/notification.go`: mention + added-to-incident, incident
  **and** report), additionally enqueue a web-push send to every subscription of the
  recipient.
- **Best-effort, after commit, off the request path.** Push services are slow and
  flaky — sending must **never** sit inside the incident/report transaction. Fire it
  from a goroutine (or a small buffered worker) **after** the DB commit, like the
  existing SSE publish `defer`. Prune subscriptions that return 404/410.

### Client

- `web/static/sw.js` (served at a path that scopes `/ims/app/…`): `push` →
  `showNotification(title, {body, data:{url}, icon})`; `notificationclick` → focus an
  existing IMS tab or open `data.url`.
- Wire `<link rel="manifest">` (+ apple-touch-icon) into `head.templ`; register the
  service worker from the common page init.
- A **per-device toggle in Settings** ("Enable push notifications on this device")
  that, on click, requests `Notification.permission`, subscribes with the bag's VAPID
  key, and POSTs the subscription; toggling off unsubscribes + DELETEs. Per-device
  because each browser/phone subscribes independently. Reflects the three permission
  states (default / granted / denied — denied needs OS-level re-enable, so show a
  hint).

## Open questions / risks

- **Notification content vs. lock-screen privacy.** How much to put in the OS
  notification body — "You were mentioned in incident #12 (Medical)" vs. a
  content-free "You have a new IMS notification." The recipient already has access to
  what triggered it (the 52f grant model attaches access with involvement), but a
  lock screen is visible to bystanders. Lean **minimal** by default; possibly a
  preference later.
- **Preferences** — a per-channel **×** per-type opt-in matrix (in-app / push /
  email) is the eventual shape; shared with plan 82c's email preferences. Out of
  scope for the first cut (everyone with a subscription gets push for all types);
  revisit in 84d / alongside email.
- **HTTPS in production** — hard prerequisite. Confirm the prod hostname is
  TLS-served before 84b.
- **Subscription lifecycle** — endpoints expire/rotate; rely on 404/410 pruning and
  periodic re-subscribe on page load if the browser reports a changed subscription.
- **Retention / volume** — push is per-event-burst; no batching for a first cut.
  Revisit if it gets spammy (shared concern with plan 82's de-dup question).
- **Browser support floor** — document the iOS-16.4-installed-PWA requirement and
  that desktop Safari/Chrome/Firefox/Edge and Android Chrome/Firefox work in-tab.

## Slices

- **84a — Server plumbing.** ✅ **Built (PR #104).** `PUSH_SUBSCRIPTION` table (goose
  migration `00009`), VAPID config in `conf` (`conf.Push`, all-or-nothing
  validation, private key redacted) + `.env.example`, the public key exposed to the
  client on the **auth response** (`GetAuthResponse.PushVAPIDPublicKey`, omitted when
  unconfigured — there is no separate "bag" endpoint in this codebase), and
  `POST`/`DELETE /ims/api/push/subscribe` (both `LogRequest(true)`, endpoint-keyed
  read-first upsert, caller-scoped delete). The push-service seam lives in
  `lib/push` (a `Sender` interface + `NoopSender`); **no send yet** — that backend is
  wired in 84c. Tests: `conf` validation/redaction, `lib/push` no-op, and an
  end-to-end `api/integration` subscribe/upsert/scope/validation test.
- **84b — Client subscription.** ✅ **Built.** Service worker (`web/typescript/sw.ts`
  → `web/static/sw.js`, served from `/ims/sw.js` with `Service-Worker-Allowed: /ims/`
  so its scope covers the app; `push` → `showNotification`, `notificationclick` →
  focus/navigate an open IMS tab or open one), manifest fixed up to a real installable
  PWA (`name`/`start_url`/`scope`/correct icon paths — `<link rel="manifest">` was
  already in `head.templ`), SW registration on authenticated `commonPageInit`, push
  helpers in `ims.ts` (`pushSupported`/`pushPermission`/`enablePush`/`disablePush` +
  VAPID base64url→Uint8Array), and the **Settings per-device toggle** that drives the
  permission + subscribe + POST flow (and unsubscribe + DELETE), hidden unless the
  browser supports push and the server shipped a VAPID key. End state: a real device
  produces a `PUSH_SUBSCRIPTION` row — still nothing pushed. Verifiable by hand on
  Android/desktop (HTTPS or localhost).
- **84c — Send fan-out (the payoff).** Wire `webpush-go` into the push service and
  call it from the plan-82 generation points (mention + added-to-incident, incident
  and report), **after commit, off the request path**, with 404/410 pruning. After
  this, a real `@mention` lights up a subscribed phone.
- **84d — Polish & rollout (later).** A "your devices" list with per-device revoke;
  the per-channel/per-type **preference matrix** (shared with 82c email); the **iOS
  Add-to-Home-Screen onboarding** doc/UI; lock-screen content decision.

## Dependencies

- **Requires** plan 82's in-app notifications (built) — reuses its generation points
  and `NOTIFICATION` semantics; web push is purely an extra fan-out.
- **Independent of** plan 83 (email) — needs no IT/DNS work; can ship first.
- **Prereq:** HTTPS-served production host.
