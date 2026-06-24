# Plan 83 — Email infrastructure

Status: **Blocked — gathering prerequisites from the IT crew**

Part of the [collaboration & notifications track](80-collaboration-and-notifications.md).

## Motivation

The system cannot send email **at all** today. There is no SMTP code, no mail
library in `go.mod`, and no email/notification config in `conf/imsconfig.go` or
`.env.example`. `PERSON.EMAIL` (varchar(128), unique) is collected and editable but
never used to send anything.

Email is a **shared enabler**, not a feature in itself. It unlocks:

- **Emailed / self-service password reset** — long deferred (see the appendix of
  [`34-post-clubhouse-login.md`](34-post-clubhouse-login.md)); today a locked-out
  user must ask an admin.
- **The email delivery channel for notifications** ([`82-notifications.md`](82-notifications.md)).

## What we need from IT (the prerequisites)

This is mostly **IT / DNS work**, which is why it's the long pole:

1. **A sending path** — one of:
   - an **SMTP relay** the server can reach (host, port, TLS settings), or
   - a **transactional email provider** (SendGrid / AWS SES / Postmark / Mailgun) —
     better deliverability and delivery logs.
2. **Credentials** — SMTP username/password, or the provider API key.
3. **A "From" address** on an OCF-controlled domain (e.g. `ims@…`) **and its DNS
   records — SPF, DKIM, DMARC.** This is what actually determines whether mail
   lands in the inbox vs. spam, and it's the part only IT can do.
4. **A decision: SMTP relay vs. provider.** Provider = less ops once DNS is set;
   SMTP = fine if a relay already exists.

## Our side (small, once the above exists)

- Config: a handful of env vars (`IMS_SMTP_HOST` / `PORT` / `USER` / `PASS` /
  `FROM`, or provider API key) added to `conf/imsconfig.go` + `.env.example`.
- A mail-sending helper — Go stdlib `net/smtp` for SMTP, or a small library
  (e.g. `wneessen/go-mail`) / the provider SDK.
- A thin **mail service abstraction** (interface) so senders (password reset,
  notifications) don't care about the backend, and so a `noop` backend can be used
  in dev/tests (mirrors the existing store/attachments backend pattern).
- Reuse the existing `PERSON.EMAIL`.

## Open questions / risks

- **Deliverability** is the real risk; without correct SPF/DKIM/DMARC, mail is
  unreliable. Treat DNS as a hard prerequisite, not an afterthought.
- **Provider vs. SMTP** affects our dependency footprint and ops; decide with IT.
- **Rate / bounce handling** — out of scope for a first cut; revisit if volume
  grows.

## Next step

Relay the prerequisites list above to the IT crew and get answers on (1)–(4).
The implementation work is small and can follow quickly once the sending path,
credentials, and From-address/DNS are in place.
