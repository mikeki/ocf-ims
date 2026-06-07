# Phase 3 · PR #4 — Post-Clubhouse login: password management & self-service reset

**Status: PLAN — for review (drafted 2026-06-06).** No code yet. This document is the
plan; once approved it is implemented **on this same branch** (`phase3-password-reset`)
and the PR grows from plan-only into the full feature.

Parent plan: [`30-remove-clubhouse.md`](30-remove-clubhouse.md). Follows
[`31-local-people-directory.md`](31-local-people-directory.md) (#16),
[`32-retire-clubhouse.md`](32-retire-clubhouse.md) (#17), and
[`33-people-rename.md`](33-people-rename.md) (#18). Those three retired the external
Clubhouse directory and stood up a local `PERSON` identity + credential store. This PR
closes the **last functional gap Clubhouse left behind: there is no way to set, change,
or recover a password from inside IMS.**

---

## Why this PR exists

Login already works fully locally — `api/auth.go:120` verifies `{identification,
password}` against `PERSON.PASSWORD` (argon2id) with no Clubhouse dependency at request
time. But Clubhouse used to own everything *around* the password:

1. **Recovery.** The "Forgot your password?" link on the login page
   (`web/template/login.templ:76-85`) points at `ranger-clubhouse*.burningman.org` —
   now dead. A locked-out OCF user has no path back in.
2. **Setting / changing.** There is **no** password-set or password-change endpoint
   anywhere. The only way to set a password today is for an operator to run
   `cmd/hashpassword` and hand-write the hash into `PERSON.PASSWORD` via SQL.
3. **Onboarding copy.** `credentialsNotice()` (`login.templ:87-105`) still tells users
   to use their "Clubhouse Production / Staging server" credentials.
4. **Naming residue.** The argon2id cost params are still called `ClubhouseParams`
   (`lib/argon2id/argon2id.go:77`) with a "standard Clubhouse parameters" comment in
   `lib/authn/password.go:28`, referenced from `cmd/hashpassword.go:44`.

This PR delivers the **full self-service password story** (scope chosen 2026-06-06):
admins can set/reset any user's password, and users can recover their own password via
an emailed reset link. It removes the dead Clubhouse UI and folds in the argon2id
rename.

---

## Decisions (locked 2026-06-06)

| Decision | Choice |
|---|---|
| Overall scope | **Full self-service reset** — cleanup + admin set-password + emailed forgot-password flow |
| Login-page recovery UI | Rewire to a **local** flow; **remove** the Clubhouse credentials notice; keep a working "Forgot your password?" link pointing at the new local page |
| argon2id rename | **Fold in** — `ClubhouseParams` → `DefaultParams`, scrub "Clubhouse" comments in `lib/argon2id` + `lib/authn` + `cmd/hashpassword` (identifier/comment only; **existing hashes unaffected**, cost params byte-identical) |
| Admin set-password works without email | **Yes** — the admin path has no email dependency, so it is usable even before email infra is configured (de-risks the email long-pole) |
| Reset-token storage | Store only a **SHA-256 hash** of a high-entropy random token in a new `PASSWORD_RESET` table; single-use; short TTL. A DB leak must not yield usable reset links |
| Enumeration safety | The "request reset" endpoint **always returns 200** regardless of whether the email exists |

## Open decisions (resolve during plan review)

These are the questions the review of this PR should settle before/along with coding.
Defaults are my recommendation.

1. **Email delivery mechanism (the long pole).** Self-service reset needs to send mail.
   Options, behind a pluggable `lib/notify` mailer seam that mirrors the existing
   `AttachmentsStore` (`none`/`local`/`s3`) config pattern:
   - **(A — recommended) SMTP** (`IMS_EMAIL_TYPE=smtp`). Most portable: works with
     Google Workspace / Gmail app passwords, Mailgun/SES SMTP creds, etc. One small
     dependency or stdlib `net/smtp` + STARTTLS. OCF almost certainly has a mailbox we
     can relay through.
   - **(B) AWS SES** (`IMS_EMAIL_TYPE=ses`). Natural fit since attachments already use
     AWS S3 — same SDK/creds story. Requires an AWS account + verified sender domain.
   - **(C) Transactional HTTP API** (SendGrid/Postmark/Mailgun). Best deliverability,
     adds a vendor + API key.
   - **Default dev/test sender (`IMS_EMAIL_TYPE=none`/`log`)**: writes the reset link
     to the server log instead of sending — lets the whole flow be built, tested, and
     demoed with **zero external infra**, and is what CI/integration tests use.

   > Recommendation: build the `log` sender + **SMTP** sender now; leave SES/HTTP as
   > future senders behind the same interface. **Which mechanism does OCF want in
   > production, and is there an SMTP relay/mailbox available?**

2. **Admin set-password surface.** Wire the admin "set this user's password" action
   into the existing personnel admin page (`/ims/app/admin/...`), or ship it
   API-only for this PR and add UI later? *Recommendation: API endpoint now + a minimal
   admin UI hook, since the API alone still requires curl.*

3. **Password policy.** Minimum length / complexity. *Recommendation: min 12 chars, max
   256 (max already enforced at login, `auth.go:101`), no composition rules (NIST-style:
   length over complexity). Confirm the minimum.*

4. **Reset token TTL & rate limiting.** *Recommendation: 1-hour TTL, single-use,
   invalidate all of a user's outstanding tokens when a new one is requested or a reset
   completes; basic per-email/per-IP rate limit on the request endpoint.*

5. **Should a successful reset/admin-set invalidate existing sessions?** Refresh tokens
   are JWTs with no server-side revocation list today. *Recommendation: out of scope —
   note it as a known limitation; full session revocation is its own effort.*

---

## Architecture

Mirror the patterns already in the tree. Nothing exotic.

### New `lib/notify` mailer seam (pattern: `AttachmentsStore`)

```
lib/notify/
  notify.go     // Mailer interface { Send(ctx, to, subject, body) error }
  log.go        // logMailer — writes the message to slog (dev/test/default)
  smtp.go       // smtpMailer — net/smtp + STARTTLS (production option A)
  // (future) ses.go, http.go behind the same interface
```

Config block in `conf/imsconfig.go` alongside `AttachmentsStore`:

```go
type EmailConfig struct {
    Type     EmailType // "none"/"log" | "smtp" | (future) "ses"
    From     string    // e.g. "ims@oregoncountryfair.org"
    BaseURL  string    // public origin for building reset links, e.g. https://ims.…
    SMTP     SMTPConfig
}
```

Read from env in `cmd/serveconfig.go` (`IMS_EMAIL_TYPE`, `IMS_EMAIL_FROM`,
`IMS_PUBLIC_URL`, `IMS_SMTP_HOST/PORT/USER/PASSWORD`). `Validate()` requires
`From`+`BaseURL` when type != none and SMTP creds when type == smtp.

### New schema (migration v36 — `store/schema/36-from-35.sql` + `current.sql`)

```sql
create table PASSWORD_RESET (
    TOKEN_HASH  binary(32)  not null,   -- SHA-256 of the random reset token
    PERSON_ID   integer     not null,
    EXPIRES     double      not null,   -- unix seconds, matches existing time cols
    USED        boolean     not null default false,
    CREATED     double      not null,
    primary key (TOKEN_HASH),
    foreign key `PR_TO_PERSON` (PERSON_ID) references PERSON(ID)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- update SCHEMA_INFO VERSION = 36
```

Append-only: add `36-from-35.sql`, bump `current.sql` to 36, never touch old
migrations or frozen fixtures. `store/integration` byte-identical check must pass.

### New queries (`store/queries.sql`, regenerated via sqlc)

- `CreatePasswordReset` (insert)
- `GetPasswordResetByTokenHash` (select, for validation)
- `MarkPasswordResetUsed` / `DeletePasswordResetsForPerson` (invalidate)
- `SetPersonPassword` (`update PERSON set PASSWORD = ? where ID = ?`)

### New backend endpoints (`api/`)

| Method + path | Auth | Purpose |
|---|---|---|
| `POST /ims/api/auth/password-reset-request` | none | `{email}` → always 200; if a person matches, mint token, store hash, email link |
| `POST /ims/api/auth/password-reset` | none | `{token, new_password}` → validate (exists/unexpired/unused), set password, mark used |
| `POST /ims/api/people/{personHandle}/password` | admin | `{new_password}` → admin sets a user's password directly (no email) |

All hashing server-side via `argon2id.CreateHash(pw, argon2id.DefaultParams)`. Reuse the
`auth.go` long-password guard (>256 → 400) and the new min-length policy. Token compare
is constant-time on the hash.

### Frontend (`web/`)

- `login.templ`: drop `credentialsNotice()`; replace `passwordResetLink()` Clubhouse
  URLs with a link to the new local `/ims/auth/forgot` page. Keep the "Please log in
  with your IMS credentials." line.
- New templ pages + TS:
  - `/ims/auth/forgot` — enter email, POST to request endpoint, show a neutral
    "if that address exists, a reset link was sent" confirmation.
  - `/ims/auth/reset` — reads `?token=…`, enter+confirm new password, POST to reset
    endpoint, on success redirect to login.
- Register both in `web/mux.go` next to the existing `GET /ims/auth/login`
  (`web/mux.go:162`).
- (If open-decision #2 = yes) minimal admin set-password control on the personnel admin
  page.

### argon2id rename (fold-in)

- `lib/argon2id/argon2id.go`: `ClubhouseParams` → `DefaultParams` (values unchanged);
  update doc comment.
- `lib/authn/password.go:28`: rewrite the "standard Clubhouse parameters" comment.
- `cmd/hashpassword.go:44`: update the reference + comment.
- Grep to confirm no other `ClubhouseParams` references remain.

---

## Security considerations

- **Token**: ≥32 bytes from `crypto/rand`, URL-safe base64; **only its SHA-256 is
  stored**. Lookup by hash; constant-time. Single-use + short TTL.
- **Enumeration**: request endpoint returns the same 200 + same body whether or not the
  email exists; do the work (or a dummy delay) either way.
- **No password in any response** (consistent with `api/personnel.go` which already
  strips it).
- **Admin endpoint** is admin-gated via the existing `IMS_ADMINS`/claims check used by
  `GetAuth`/personnel.
- **Rate limiting** on the request endpoint (open-decision #4).
- **Known limitation**: existing JWT refresh tokens are not server-revocable, so a reset
  does not kill live sessions (open-decision #5).

---

## Testing

- **Unit**: argon2id rename compiles + existing hashes still verify; password-policy
  validation; token hashing/expiry logic; `logMailer` captured output.
- **`api/integration`** (real MariaDB): full happy path — request → (capture link from
  `logMailer`) → reset → login with new password succeeds, old fails; expired token
  rejected; used token rejected; admin set-password path; enumeration returns 200 for
  unknown email.
- **`store/integration`**: v36 migration replays clean and is byte-identical to
  `current.sql`.
- **Playwright** (optional, if UI lands): forgot → reset → login round-trip against the
  `log` mailer.
- Full gate before each push: `go run bin/build/build.go`, `go test ./...`,
  `go test ./store/integration ./api/integration`, `go vet`, golangci-lint (0 issues).

---

## Out of scope (deferred, noted for the record)

- `PERSON.is_admin` column (admins stay env `IMS_ADMINS` on handle).
- Local `onduty:` modeling (no timesheet source).
- Server-side session/refresh-token revocation.
- Self-service *change* password while logged in (this PR covers set-by-admin + reset;
  a logged-in "change my password" form can be a tiny follow-up reusing
  `SetPersonPassword`).
- Email templates beyond a plain-text reset message.
- SES / transactional-HTTP mailers (interface left open for them).

---

## Build sequence (buildable commits on this branch)

Because generated code is not committed, each commit must compile after `-generate-only`.

1. **This plan doc** (the PR opener; what gets reviewed first).
2. **argon2id rename** (self-contained, safe, no behavior change).
3. **Backend core**: schema v36 + queries + `lib/notify` (log+smtp) + config + the three
   endpoints + admin set-password. Green build + integration tests.
4. **Frontend**: login.templ cleanup + forgot/reset pages + TS + routes (+ optional
   admin UI hook).
5. **Docs**: `.env.example`, README, CLAUDE.md (email config + interim/admin password
   process), CHANGELOG.

Admin set-password (no email dependency) is usable after commit 3 even if production
email is still being decided — that is the intentional de-risking.

---

## Files to touch (anticipated)

**New**: `store/schema/36-from-35.sql`; `lib/notify/{notify,log,smtp}.go`;
`api/password.go` (+ test); `web/template/forgot.templ`, `web/template/reset.templ`;
`web/typescript/forgot.ts`, `web/typescript/reset.ts`; `web/typescript/urls.ts` entries.

**Modified**: `store/schema/current.sql`, `store/queries.sql`; `conf/imsconfig.go`,
`cmd/serveconfig.go`; `api/mux.go` (routes), `api/auth.go` (maybe shared helpers);
`lib/argon2id/argon2id.go`, `lib/authn/password.go`, `cmd/hashpassword.go`;
`web/template/login.templ`, `web/mux.go`; `.env.example`, `README.md`, `CLAUDE.md`,
`CHANGELOG.md`. Possibly `api/personnel.go` + a personnel admin templ/TS for the admin
UI hook.

---

## Status — to be updated as work lands

- [ ] Plan reviewed & open decisions resolved
- [ ] argon2id rename
- [ ] schema v36 + queries
- [ ] `lib/notify` mailer (log + smtp)
- [ ] config + env wiring
- [ ] reset-request / reset / admin-set endpoints
- [ ] frontend pages + login.templ cleanup
- [ ] tests green (unit + integration)
- [ ] docs updated
