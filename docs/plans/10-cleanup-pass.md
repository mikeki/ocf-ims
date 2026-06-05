# Phase 1 — Preparation & Clean-up Pass

> **Status:** ✅ Done &nbsp;·&nbsp; **Parent:** [00-master-plan.md](00-master-plan.md)
> &nbsp;·&nbsp; **Last updated:** 2026-06-05
>
> **Shipped 2026-06-05** as five reviewable PRs against `master`, all merged:
> - **#1** Concentric Streets removal (`11-remove-concentric-streets.md`) — commit `032e92b`
> - **#2** dead argon2id presets (A1–A3) — `ca95fb7`
> - **#3** `NonCryptoHash64` (A4) — `0bbc0b3`
> - **#4** empty stub tests (A5–A6) — `98750cf`
> - **#5** comment noise (B3–B5) + migration-policy doc (B6) — `5eb3c57`
>
> Merged baseline = `master` @ `5eb3c57`. Full build (codegen + compile),
> `go test ./...`, and the Docker integration suites
> (`store/integration` + `api/integration`) are green.

## Objective

Get to a **stable, low-noise baseline** before any OCF work begins. Remove
genuinely dead code, triage every outstanding TODO/FIXME (resolve or explicitly
defer with a reason), and confirm the build, tests, and linters are green. **No
behavioral changes** — this pass should be invisible to users.

## Scope & non-goals

- ✅ In scope: deleting dead/unreferenced code, removing empty test stubs,
  triaging TODO/FIXME markers, tidying commented-out blocks.
- ❌ Out of scope: refactors that change behavior or architecture (e.g. the
  "action framework" and RESTful-endpoint TODOs — those are *tracked* here but
  executed later, if at all). Renaming/terminology (that's Phase 2). Migration
  consolidation that rewrites history.

## Key finding

The codebase is **already clean**. It's a from-scratch Go rewrite of the old
Python system, so there are **no Python compat shims, no build-tag-excluded
files, no feature-flag cruft**. The real dead-code list below is short. Most
"markers" are deliberate deferrals or documentation, not cruft.

The **one large exception** is the **Concentric Streets** feature — a fully
deprecated, Burning Man-specific geography concept ("no longer used as of late
2025", per the admin UI itself) that spans every layer and needs a schema
migration to remove. Because of its size it gets its own plan:
[**11-remove-concentric-streets.md**](11-remove-concentric-streets.md). Everything
else in Phase 1 is small and fast — which is the point: a quick, safe baseline.

---

## Verified work list

Each item below was verified by grepping for references across the repo
(excluding generated dirs). Verdicts: **REMOVE** (confirmed dead),
**DEFER** (real but out of scope — leave a tracked note), **KEEP** (verified
in-use; listed so we don't re-investigate later).

### A. REMOVE — confirmed dead code

| # | Item | Location | Evidence |
|---|------|----------|----------|
| A1 | `FirstRecommendedParams` | `lib/argon2id/argon2id.go:81-87` | Zero references anywhere (not even tests). |
| A2 | `SecondRecommendedParams` | `lib/argon2id/argon2id.go:92-98` | Zero references anywhere. |
| A3 | `PHPDefaultParams` | `lib/argon2id/argon2id.go:102-108` | Zero references anywhere. |
| A4 | `NonCryptoHash64` | `lib/rand/hash.go:23-29` | Referenced only by its own `hash_test.go` (incl. fuzz). No production caller. |
| A5 | `TestEventAccessTODO` | `api/integration/eventaccess_test.go:23-25` | Empty stub — body is just `t.Parallel()`. |
| A6 | `TestPersonnelTODO` | `api/integration/personnel_test.go:23-25` | Empty stub — body is just `t.Parallel()`. |

Notes:
- **A1–A3:** `argon2id.go` defines several `*Params` presets. Only
  `DevelopmentParams` (used by `lib/authn/password.go`) and `ClubhouseParams`
  (used by `cmd/hashpassword.go`) are actually wired up. The other three presets
  are unused. Remove them and their corresponding tests, if any.
- **A4:** When removing `NonCryptoHash64`, also remove its tests/fuzz in
  `lib/rand/hash_test.go`. Check whether `hash.go` becomes empty (delete file if
  so).
- **A5–A6:** Empty placeholder tests. Deleting them removes a false "test
  exists" signal. (The *real* coverage gaps they hint at — event-access and
  personnel integration tests — can be tracked as future work, but the empty
  stubs add noise.)

### B. DEFER — real, but out of Phase-1 scope (track, don't act)

| # | Item | Location | Why defer |
|---|------|----------|-----------|
| B1 | "Get rid of the `action` framework; use a standard POST (as visits do)" | `api/fieldreport.go:298` | Behavioral/architectural refactor. Touches API contract. Revisit during Phase 2/3 when field-report handling is already being changed. |
| B2 | "Make `EditEvent` RESTful — split create/update, add singular `GetEvent`" | `api/event.go:119` | API-shape change; not dead code. Track for an API-cleanup sub-phase. |
| B3 | "Maybe bring back pretty logging for local use" (commented block) | `cmd/serve.go:~218-224` | Intentional deferral. Either delete the comment (decision: not doing it) or leave as-is. **Recommend: delete the dead comment block** — the idea is captured here now. |
| B4 | Commented-out S3 credential validation | `conf/imsconfig.go:~116-118` | Represents a deliberately relaxed validation (IAM-role friendly). **Recommend: delete the commented lines** — the current behavior is intentional; the comment is just noise. Confirm with whoever relaxed it. |
| B5 | Commented-out flatpickr `.d.ts` fetches | `bin/fetchbuilddeps/fetchbuilddeps.go:~122-141` | Optional TS type defs, intentionally not fetched. **Recommend: delete** unless we plan to re-enable flatpickr typings. |
| B6 | Old migrations `01`–`31` in `store/schema/` | `store/schema/` | Migrations are history; consolidating risks breaking upgrades from existing DBs. **Decision: leave as-is**, document policy (see Task 4). |

> For B3/B4/B5 the recommendation is "delete the dead comment" — that's a
> noise-reduction edit with zero behavioral effect, so it *is* in Phase-1 scope.
> They're listed under DEFER only because each needs a one-line confirmation that
> we're not planning to re-enable the commented behavior. Default to deleting.

### C. KEEP — verified in-use (do not touch)

| Item | Location | Used by |
|------|----------|---------|
| `DevelopmentParams` | `lib/argon2id/argon2id.go:69-75` | `lib/authn/password.go:45` (+ tests) |
| `ClubhouseParams` | `lib/argon2id/argon2id.go:111-117` | `cmd/hashpassword.go:44` |
| `NewSaltedArgon2idDevOnly` | `lib/authn/password.go:43-46` | `lib/authn/password_test.go` only — **test helper**, intentional `DevOnly` API. Keep, but consider relocating to a test helper file if we want to keep non-test packages lean. Low priority. |
| `/gc/pauses:seconds` filter | `api/debug.go:123` | Active code that *skips* a deprecated Go runtime metric. Not a TODO — correct behavior. Keep. |

---

### D. REMOVE (large) — the Concentric Streets feature

The deprecated Concentric Streets / radial-clock geography feature is removed in
its own staged plan: [**11-remove-concentric-streets.md**](11-remove-concentric-streets.md).
It touches schema, queries, sqlc, JSON, API, authz, templates, TypeScript, seed,
and tests, and needs migration `32-from-31.sql`. Do it as part of Phase 1 but
track it separately from the small A-items above.

## Tasks

- [x] **Task 0 — Remove Concentric Streets** per
      [11-remove-concentric-streets.md](11-remove-concentric-streets.md) (the big one). — **PR #1.**
- [x] **Task 1 — Re-run the audit.** Re-grep confirmed the work list was still
      accurate; no new hits. Before editing, re-grep to confirm nothing
      changed since this plan was written:
      ```bash
      grep -rniE 'deprecated|fixme|xxx|legacy|obsolete|do not use|no longer' \
        --include='*.go' . \
        | grep -vE 'store/imsdb|directory/clubhousedb|web/static'
      grep -rn 'FirstRecommendedParams\|SecondRecommendedParams\|PHPDefaultParams\|NonCryptoHash64' --include='*.go' .
      ```
      Reconcile any new hits with the lists above.
- [x] **Task 2 — Remove dead code (A1–A6).** A1–A3 (argon2id presets) in PR #2,
      A4 (`NonCryptoHash64`) in PR #3, A5–A6 (stub tests) in PR #4. **Dev-only
      auth helpers were triaged and *kept* by design** — `NewSaltedArgon2idDevOnly`
      is an intentional test helper, and `DevelopmentParams`/`ClubhouseParams`
      are both in use (see the KEEP table, section C).
- [x] **Task 3 — Tidy comment noise (B3–B5).** All three commented blocks
      removed in PR #5. B4 (S3 validation): owner decided **2026-06-05 to keep the
      deletion** — the active code already requires only AWSRegion+Bucket
      (IAM-role friendly); S3 integration is revisited later.
- [x] **Task 4 — Document the migration policy.** Added to `CLAUDE.md`
      (Database Migrations section) in PR #5: migrations are append-only history,
      old ones intentionally retained, frozen fixtures left as-is. Closes B6.
- [x] **Task 5 — Triage remaining TODOs.** B1 (action-framework refactor in
      `api/fieldreport.go`) and B2 (RESTful `EditEvent` in `api/event.go`) are
      **intentionally deferred** — left in place as tracked future work, not dead
      code (see the DEFER table, section B). No forgotten TODOs remain.
- [x] **Task 6 — Green check.** `go run bin/build/build.go`, `go test ./...`,
      and the Docker integration suites (`store/integration` + `api/integration`)
      all green. **Caveat:** `npx eslint` is currently non-functional repo-wide
      (no `eslint.config.js`); TypeScript is validated by the `tsgo` build step
      instead. `golangci-lint` not run in this pass.
- [x] **Task 7 — Commit the baseline.** Shipped as five focused PRs (#1–#5),
      now merged. Baseline = `master` @ `5eb3c57` (not git-tagged; the merge
      commits serve as the known-good Phase 2 starting point).

## Execution notes

- Keep commits small and single-purpose — this pass should be trivially
  reviewable, since the whole value is "obviously safe, no behavior change".
- The build runs code generation; if generated files churn unexpectedly, that's a
  signal something non-trivial changed — stop and investigate.
- Don't expand scope. If you find a tempting refactor, add it to the DEFER list
  or the relevant later-phase plan instead of doing it here.

## Exit criteria

- [x] All A-items removed; repo compiles.
- [x] Comment-noise B3–B5 deleted (B4 explicitly kept-deleted with owner sign-off).
- [x] Every remaining TODO/FIXME is intentional and accounted for (B1/B2 deferred).
- [x] Build + unit tests green; integration tests green (Docker available).
      Lint: `eslint` non-functional repo-wide (tracked separately); `tsgo` validates TS.
- [x] Clean baseline committed (merged PRs #1–#5; `master` @ `5eb3c57`).
      → proceed to **Phase 2** (`20-terminology.md`).
