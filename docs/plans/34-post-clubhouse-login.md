# Phase 3 · PR #4 — Post-Clubhouse login: admin password reset + login cleanup

**Status: PLAN — for review (drafted 2026-06-06; scope revised 2026-06-06 to defer
self-service email reset).** No code yet. This document is the plan; once approved it is
implemented **on this same branch** (`phase3-password-reset`) and the PR grows from
plan-only into the feature.

Parent plan: [`30-remove-clubhouse.md`](30-remove-clubhouse.md). Follows
[`31-local-people-directory.md`](31-local-people-directory.md) (#16),
[`32-retire-clubhouse.md`](32-retire-clubhouse.md) (#17), and
[`33-people-rename.md`](33-people-rename.md) (#18). Those retired the external Clubhouse
directory and stood up a local `PERSON` identity + credential store. This PR closes the
**last functional gap Clubhouse left behind: there is no way to set, change, or recover a
password from inside IMS.**

---

## Why this PR exists

Login already works fully locally — `api/auth.go:120` verifies `{identification,
password}` against `PERSON.PASSWORD` (argon2id) with no Clubhouse dependency at request
time. But Clubhouse used to own everything *around* the password:

1. **Recovery.** The "Forgot your password?" link on the login page
   (`web/template/login.templ:76-85`) points at `ranger-clubhouse*.burningman.org` —
   now dead. A locked-out OCF user has no path back in.
2. **Setting / changing.** There is **no** password-set endpoint anywhere. The only way
   to set a password today is for an operator to run `cmd/hashpassword` and hand-write
   the hash into `PERSON.PASSWORD` via SQL.
3. **Onboarding copy.** `credentialsNotice()` (`login.templ:87-105`) still tells users
   to use their "Clubhouse Production / Staging server" credentials.
4. **Naming residue.** The argon2id cost params are still called `ClubhouseParams`
   (`lib/argon2id/argon2id.go:77`) with a "standard Clubhouse parameters" comment in
   `lib/authn/password.go:28`, referenced from `cmd/hashpassword.go:44`.

**Scope decision (2026-06-06):** full self-service *emailed* reset is **deferred** (email
delivery is the heaviest dependency and OCF's mail story isn't settled). Instead, this PR
makes recovery work **operationally**: an admin can reset any user's password from inside
IMS, and the login page tells a locked-out user to ask a crew leader or an admin. The
emailed self-service flow is preserved as a documented future design (appendix below).

---

## Decisions (locked 2026-06-06)

| Decision | Choice |
|---|---|
| Recovery model | **Admin-assisted** — admin resets the user's password in-app; **self-service emailed reset DEFERRED** |
| Admin reset mechanism | **In-app admin set-password** (endpoint + minimal admin UI), not manual CLI+SQL |
| Login-page recovery UI | **Remove** the Clubhouse credentials notice; replace the "Forgot your password?" external link with static text: *"Forgot your password? Ask a crew leader or an admin to reset it."* |
| argon2id rename | **Fold in** — `ClubhouseParams` → `DefaultParams`, scrub "Clubhouse" comments in `lib/argon2id` + `lib/authn` + `cmd/hashpassword` (identifier/comment only; **existing hashes unaffected**, cost params byte-identical) |
| Schema change | **None** — `PERSON.PASSWORD` already exists; no migration, no new table |
| Gating | **By permission, not a hardcoded admin check** — new `GlobalAdministratePersonnel` global permission gates both the endpoint and the UI control |
| Who holds the permission (this PR) | **Admins only.** Mapped to the `Administrator` role in `RolesToGlobalPerms`. Non-admin crew-leader delegation is **deferred to the Phase 5 roles model** (the authz layer can't grant a global capability to a non-admin today) |
| Password not echoed | The set-password response never returns the password/hash (consistent with `api/personnel.go`) |

## Open decisions (resolve during plan review)

Defaults are my recommendation; only these remain.

1. **Password policy** — minimum length for an admin-set password. *Recommendation: min
   8, max 256 (max already enforced at login, `auth.go:101`), no composition rules
   (NIST-style: length over complexity). Note: dev seeds in `store/fakeimsdb/seed.sql`
   are inserted via SQL, not this endpoint, so a minimum here doesn't affect them.*
2. **Admin UI placement** — there is no admin people-management page today (admin pages
   are root / actionlogs / events / types / debug / places). *Recommendation: add a
   small new `GET /ims/app/admin/people` page that lists personnel via the existing
   `GET /ims/api/personnel` and offers a per-person "Set password" control, linked from
   `adminroot.templ`.* Alternative: bolt the control onto an existing page. Confirm.
3. **Force-change-on-next-login** for admin-set temp passwords — nice-to-have. *Recommendation:
   out of scope for this PR (no "must change password" flag/flow yet); revisit with the
   logged-in "change my password" follow-up.*

---

## Architecture

Mirror patterns already in the tree. No new infrastructure, no schema change.

### New authorization: `GlobalAdministratePersonnel` permission

The current model has no middle tier: global permissions are binary
(`AnyAuthenticatedUser` vs `Administrator`), admin comes only from the `IMS_ADMINS`
env list (no `PERSON.is_admin`), and the `position:`/`team:` expression engine only
grants **per-event** roles via `EVENT_ACCESS` — it cannot confer a global capability.
So gating by a permission that a non-admin could hold needs a new flag.

- Add `GlobalAdministratePersonnel` to `GlobalPermissionMask`
  (`lib/authz/permission.go`, the global flags block ~line 90).
- Map it to the `Administrator` role in `RolesToGlobalPerms` (~line 99) so **admins
  hold it now**. No other role grants it in this PR.
- Gate **by the permission**, using the canonical pattern (`getGlobalPermissions` →
  `globalPermissions & authz.GlobalAdministratePersonnel == 0` → `herr.Forbidden`) —
  **not** a raw `slices.Contains(admins, handle)` check. This makes the gate
  future-proof: when Phase 5 adds a way to grant global capabilities to non-admin
  crew leaders, they get password-reset by gaining this permission, no endpoint change.
- **Deferred to Phase 5** (explicitly out of scope here): the mechanism by which a
  non-admin crew leader is granted `GlobalAdministratePersonnel` (position/team/role
  based). Today only env-admins have it.

### New query (`store/queries.sql`, regenerated via sqlc)

- `SetPersonPassword` — `update PERSON set PASSWORD = ? where ID = ?`

### New backend endpoint (`api/`)

| Method + path | Auth | Purpose |
|---|---|---|
| `POST /ims/api/personnel/{personHandle}/password` | `GlobalAdministratePersonnel` | `{password}` → resolve handle → person, hash server-side, `SetPersonPassword`. 404 if no such handle; 403 if caller lacks the permission |

- Lives in a new `api/password.go` (handler + permission gate + validation), registered
  in `api/mux.go` next to the personnel route (`api/mux.go:449`).
- Hash via `argon2id.CreateHash(pw, argon2id.DefaultParams)` (the renamed prod params).
- Reuse the long-password guard (>256 → 400) and the new min-length policy.
- Gate on `GlobalAdministratePersonnel` via `getGlobalPermissions` (see above).

### Frontend (`web/`)

- `login.templ`: delete `credentialsNotice()`; replace `passwordResetLink()` Clubhouse
  URLs with static text *"Forgot your password? Ask a crew leader or an admin to reset
  it."* Keep "Please log in with your IMS credentials." `deployment` param may become
  unused in those helpers — clean up accordingly.
- New `web/template/adminpeople.templ` + `web/typescript/adminpeople.ts`: list personnel
  (existing `GET /ims/api/personnel`), per-person "Set password" control → `POST
  /ims/api/personnel/{handle}/password`. Register `GET /ims/app/admin/people` in
  `web/mux.go`; add a link from `adminroot.templ`. Add the URL to
  `web/typescript/urls.ts`.
- **UI gating is permission-driven too.** The frontend needs to know whether the user
  holds `GlobalAdministratePersonnel` to show/hide the "Set password" control and the
  adminroot link. Expose it in the existing auth/access response (e.g. add a
  `canManagePersonnel` bool to `GetAuthResponse` in `api/auth.go`, computed from global
  permissions) rather than gating the UI on `admin` — keeping the front end consistent
  with the permission-based backend. (The endpoint is the real enforcement; the UI gate
  is just UX.)

### argon2id rename (fold-in)

- `lib/argon2id/argon2id.go`: `ClubhouseParams` → `DefaultParams` (values unchanged);
  update doc comment.
- `lib/authn/password.go:28`: rewrite the "standard Clubhouse parameters" comment.
- `cmd/hashpassword.go:44`: update the reference + comment.
- Grep to confirm no other `ClubhouseParams` references remain.

---

## Security considerations

- **Permission-gated**: the set-password endpoint requires `GlobalAdministratePersonnel`;
  callers without it get 403. (Held by env-admins only in this PR.)
- **No password in any response** (consistent with `api/personnel.go`).
- **Server-side hashing** with prod argon2id params; long-password guard retained.
- **Known limitation**: existing JWT refresh tokens are not server-revocable, so an
  admin reset does not kill the target user's live sessions. Out of scope; noted.
- No reset tokens / no email in this PR, so the token-handling attack surface from the
  deferred design does not exist yet.

---

## Testing

- **Unit**: argon2id rename compiles + existing hashes still verify; password-policy
  validation (too-short rejected, >256 rejected); permission gate (caller lacking
  `GlobalAdministratePersonnel` → 403); `RolesToGlobalPerms[Administrator]` includes the
  new flag.
- **`api/integration`** (real MariaDB): an admin sets a user's password → that user logs
  in with the new password (success) and the old one fails; unknown handle → 404;
  non-privileged caller → 403.
- **`store/integration`**: unaffected (no schema change) but must stay green.
- **Playwright** (optional, if admin UI lands): admin sets a password, target logs in.
- Full gate before each push: `go run bin/build/build.go`, `go test ./...`,
  `go test ./store/integration ./api/integration`, `go vet`, golangci-lint (0 issues).

---

## Out of scope (deferred, noted for the record)

- **Self-service emailed password reset** — deferred this PR; design preserved in the
  appendix so it isn't lost. Picking it up later means: `lib/notify` mailer seam, a
  `PASSWORD_RESET` table (schema bump), request/reset endpoints, forgot/reset pages, and
  an OCF email-delivery decision.
- **Granting `GlobalAdministratePersonnel` to non-admin crew leaders** — the gate exists
  now, but the mechanism to confer it on non-admins (position/team/role-based) lands with
  the **Phase 5 roles model**. Until then only env-admins hold it.
- Logged-in "change my own password" form (small follow-up; reuses `SetPersonPassword`).
- "Must change password on next login" flag/flow.
- `PERSON.is_admin` column (admins stay env `IMS_ADMINS`).
- Local `onduty:` modeling; server-side session/refresh-token revocation.

---

## Build sequence (buildable commits on this branch)

Generated code is not committed, so each commit must compile after `-generate-only`.

1. **This plan doc** (the PR opener; reviewed first). ✅ committed
2. **argon2id rename** (self-contained, safe, no behavior change).
3. **Backend**: `GlobalAdministratePersonnel` permission (flag + `Administrator` map) +
   `SetPersonPassword` query + `api/password.go` endpoint (permission gate + validation) +
   route + `canManagePersonnel` in the auth response. Green build + integration test.
4. **Frontend**: login.templ cleanup + admin people page (list + set-password) + route +
   urls.ts + adminroot link.
5. **Docs**: README / CLAUDE.md (admin reset process; note emailed self-service is
   future), CHANGELOG, `.env.example` if any new knob (none expected).

---

## Files to touch (anticipated)

**New**: `api/password.go` (+ test); `web/template/adminpeople.templ`;
`web/typescript/adminpeople.ts`.

**Modified**: `lib/authz/permission.go` (new `GlobalAdministratePersonnel` flag +
`Administrator` mapping); `api/auth.go` (`canManagePersonnel` in `GetAuthResponse`);
`store/queries.sql`; `api/mux.go` (route); `lib/argon2id/argon2id.go`,
`lib/authn/password.go`, `cmd/hashpassword.go`; `web/template/login.templ`,
`web/template/adminroot.templ`, `web/mux.go`, `web/typescript/urls.ts`; `README.md`,
`CLAUDE.md`, `CHANGELOG.md`.

---

## Status — implementation complete (2026-06-06)

- [x] Plan reviewed & open decisions resolved (min 8 / max 256 no-composition policy; new `/ims/app/admin/people` page; force-change-on-login out of scope)
- [x] argon2id rename
- [x] `GlobalAdministratePersonnel` permission (flag + `Administrator` map) + `canManagePersonnel` in auth response
- [x] `SetPersonPassword` query
- [x] set-password endpoint + permission gate + validation + route (`POST /ims/api/personnel/{personHandle}/password`)
- [x] login.templ cleanup (Clubhouse links/notice → "ask a crew leader/admin")
- [x] admin people page (list + set-password, permission-gated UI) + route + adminroot link
- [x] tests green (unit + api integration: `TestSetPersonPassword`, updated `TestGetAuth*`)
- [x] docs updated (CLAUDE.md, CHANGELOG)

Verified: `go run bin/build/build.go`, `go test ./...`, `go test ./api/integration ./store/integration`, `go vet`, golangci-lint (0 issues) all green.

---

## Appendix — deferred design: self-service emailed reset

Preserved so the work isn't re-derived when OCF's email story is ready. Pick up as a
later PR.

- **Mailer seam** `lib/notify/{notify,log,smtp}.go` — `Mailer` interface mirroring the
  `AttachmentsStore` config pattern; `log` sender (dev/CI), `smtp` sender (prod), SES/HTTP
  future. Config block `EmailConfig{Type, From, BaseURL, SMTP}` in `conf/imsconfig.go`,
  env `IMS_EMAIL_*` / `IMS_PUBLIC_URL` in `cmd/serveconfig.go`.
- **Schema** `PASSWORD_RESET(TOKEN_HASH binary(32) pk, PERSON_ID fk, EXPIRES double,
  USED bool, CREATED double)` — store only the **SHA-256** of a ≥32-byte `crypto/rand`
  token; single-use; short TTL (≈1h).
- **Endpoints** `POST /ims/api/auth/password-reset-request` (`{email}`; **always 200** to
  avoid enumeration; mint token, store hash, email link) and `POST
  /ims/api/auth/password-reset` (`{token, new_password}`; validate exists/unexpired/unused
  → set password → mark used).
- **Frontend** `/ims/auth/forgot` (enter email) + `/ims/auth/reset` (reads `?token=`, set
  new password); login page's recovery link would then point at `/ims/auth/forgot`.
- **Security** constant-time hash lookup, rate-limiting on request, invalidate
  outstanding tokens on new request / completion.
