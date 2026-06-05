# Phase 1 — Preparation & Clean-up Pass

> **Status:** Ready to execute &nbsp;·&nbsp; **Parent:** [00-master-plan.md](00-master-plan.md)
> &nbsp;·&nbsp; **Last updated:** 2026-06-05

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

- [ ] **Task 0 — Remove Concentric Streets** per
      [11-remove-concentric-streets.md](11-remove-concentric-streets.md) (the big one).
- [ ] **Task 1 — Re-run the audit.** Before editing, re-grep to confirm nothing
      changed since this plan was written:
      ```bash
      grep -rniE 'deprecated|fixme|xxx|legacy|obsolete|do not use|no longer' \
        --include='*.go' . \
        | grep -vE 'store/imsdb|directory/clubhousedb|web/static'
      grep -rn 'FirstRecommendedParams\|SecondRecommendedParams\|PHPDefaultParams\|NonCryptoHash64' --include='*.go' .
      ```
      Reconcile any new hits with the lists above.
- [ ] **Task 2 — Remove dead code (A1–A6).** Delete the items and their
      tests. After each deletion, `go build ./...` to catch surprises.
- [ ] **Task 3 — Tidy comment noise (B3–B5).** Delete the dead commented
      blocks (the intent is now captured in this plan). Get a quick thumbs-up on
      B4 (S3 validation) from whoever relaxed it.
- [ ] **Task 4 — Document the migration policy.** Add a short note (here or in
      `CLAUDE.md`) that migrations are append-only history and old ones are
      intentionally retained. Closes out B6.
- [ ] **Task 5 — Triage remaining TODOs.** For B1/B2 (and any TODO found in
      Task 1 not covered here), either fix-now-if-trivial or leave the TODO in
      place with a back-reference to this plan / a future phase. The goal is that
      every remaining TODO is *intentional*, not forgotten.
- [ ] **Task 6 — Green check.** Run the full gate:
      ```bash
      go run bin/build/build.go      # regenerates sqlc/templ/tsgo + compiles
      go test ./...                  # unit tests
      npx eslint                     # JS/TS lint
      go tool golangci-lint run      # if available; else per .golangci.yml
      ```
      Integration tests (`go test ./store/integration ./api/integration`) require
      Docker — run if available.
- [ ] **Task 7 — Commit & tag the baseline.** One focused commit (or a few:
      "remove dead argon2id params", "remove empty stub tests", "drop dead
      comment blocks"). Tag the result as the clean pre-OCF baseline so Phase 2
      starts from a known-good point.

## Execution notes

- Keep commits small and single-purpose — this pass should be trivially
  reviewable, since the whole value is "obviously safe, no behavior change".
- The build runs code generation; if generated files churn unexpectedly, that's a
  signal something non-trivial changed — stop and investigate.
- Don't expand scope. If you find a tempting refactor, add it to the DEFER list
  or the relevant later-phase plan instead of doing it here.

## Exit criteria

- [ ] All A-items removed; repo compiles.
- [ ] Comment-noise B3–B5 deleted (or explicitly kept with a reason).
- [ ] Every remaining TODO/FIXME is intentional and accounted for.
- [ ] Build + unit tests + lint green; integration tests green where Docker is
      available.
- [ ] Clean baseline committed and tagged. → proceed to **Phase 2** (`20-terminology.md`).
