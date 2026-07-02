# Post-Fair person-identity work (deferred)

**Status: DEFERRED — to be done _after_ the Fair.** This doc records the person-identity
changes we consciously chose **not** to ship for the 2026 Fair, so they aren't lost.

## How we got here

Feedback round 9 originally planned a full-stack rename of the person identifiers
(`Handle`→`FairName`, `Name`→`LegalName`) plus making email the sole login identifier,
all in one branch (PR #158). That bundled a breaking, wide-blast-radius rename with
several smaller behavior changes, which was judged too risky to land right before the
Fair. So we split it:

- **Shipped (PR #159, on master):** the *display* half — prefer the fair name over the
  legal name wherever a single person label is shown; relabel the UI to "Fair Name" /
  "Full Legal Name" (labels only — no DB column / JSON key / Go+TS field / form-id
  renames); **login by email only**; and require a fair name to grant IMS access.
- **Shipped (this PR):** the server-side **email-for-access** guards that email-only
  login implies — create/edit/set-password now refuse to mint or strand a login that
  has no email. (See "Done here" below.)
- **Deferred (this doc):** the two items below. PR #158 is **closed**; its diff is the
  reference implementation for both.

## Done here (the email-for-access hardening)

Login now matches **EMAIL only** (PR #159), so the server must not create or leave a
login that can never sign in. Enforced in `api/`:

- **Create** (`person.go`): a password requires **both** a fair name and an email.
- **Edit** (`person.go`): refuses to clear the email of a person who has a password
  (`PersonByID` now also returns `HAS_PASSWORD`, without ever selecting the hash).
- **Set password** (`password.go`): refuses to set a password for a person with no
  email.

The client already enforced the same; this closes the raw-API gap.

## Deferred item 1 — non-unique fair names + the identity refactor it forces

**Goal:** let the fair name be a true, *non-unique* display callsign (two people may
share one), the way real radio handles work.

Today `PERSON.HANDLE` carries a **UNIQUE** key, and several code paths still treat the
fair-name string as an identity:

- Authz / JWT validity and `ManyEventPermissions` key on the handle string.
- Token refresh matches on the handle.
- "Own report" / "strike own journal entry" checks compare the author **handle**.
- `@mention` resolution assumes a handle maps to one person.

Making fair names non-unique requires re-keying all of that on the stable
**`person_id`** instead:

1. Migration: `drop index HANDLE` (drop the unique key; keep the column/index name).
2. JWT validity → require `person_id`, not a non-empty handle.
3. `ManyEventPermissions` / `EventPermissions` → take `personID`, not the handle.
4. Token refresh → match on `person_id`.
5. Own-report + strike checks → compare `AUTHOR_PERSON_ID`; expose `author_person_id`
   in the journal-entry JSON.
6. `@mention` resolution → a multimap (an ambiguous `@name` notifies **all** matches).

**Reference implementation:** the closed **PR #158** did exactly this — reuse it.

## Deferred item 2 — the deep rename `Handle`→`FairName`, `Name`→`LegalName`

**Goal:** finish the rename through every layer so the code matches the UI vocabulary.

Scope (all one atomic, breaking change — see the original plan in
`docs/plans/91-feedback-round-9.md`, "PR 0"):

- **DB:** `PERSON.HANDLE`→`FAIR_NAME`, `PERSON.NAME`→`LEGAL_NAME` (goose `RENAME
  COLUMN`; `PERSON` table only).
- **sqlc / Go:** regenerate; fix every `.Handle` / person-`.Name` reference.
- **JSON keys:** `handle`→`fair_name`, `name`→`legal_name`.
- **JWT:** claim field + wire key `han`→`fair_name` (invalidates all outstanding
  tokens ⇒ **one forced re-login** on deploy — note in the runbook).
- **TS / templ:** person object fields + form input ids to match.

Because the JWT wire key and DB column change together, this must land atomically and
forces a one-time re-login. **Reference implementation:** closed **PR #158**.

## Sequencing

Do these **after the Fair**, when a forced re-login and a wide-blast-radius change are
acceptable. Item 1 (non-unique + `person_id` identity) is the higher-value / lower-churn
of the two and can land first; item 2 (the cosmetic rename) can follow. Both should be
separate PRs, each merged manually after CI is green.
