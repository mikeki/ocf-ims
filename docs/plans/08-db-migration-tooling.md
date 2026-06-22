# Platform — DB migration tooling (goose)

> **Status:** ✅ Done. Slice A (PR #56), B (PR #57), C (PR #58), D (PR #59), and
> E — remove the one-time adoption shim — in PR. goose is the single schema
> source (applied on boot + read by sqlc); `current.sql` and the old chain are
> gone; the dev DB crossed over and the adoption shim has been retired.
> **Last updated:** 2026-06-22
>
> Replace the hand-rolled migration system (`current.sql` + an append-only
> `XX-from-YY.sql` chain + a manually-bumped `SCHEMA_INFO.VERSION`) with
> [**goose**](https://github.com/pressly/goose), and collapse the schema down to
> a **single source of truth**: one `store/schema/migrations/` directory that is
> both applied at runtime by goose *and* read by sqlc for codegen.
>
> Triggered by a deliberate flatten: the schema is squashed to its current state
> (v44) as `00001_baseline.sql`, so the new system starts from a single baseline
> migration. A one-time **adoption** path lets the existing pre-goose database
> (the dev DB) cross over to goose in place — without re-running the baseline DDL
> over its already-present tables — and is removed once the crossover is done.
>
> The integration follows goose's own recommended model — **migrations embedded
> in the binary and applied on boot over the app's DB connection**. That model is
> **independent of deployment topology**: whether MariaDB ends up co-located with
> the app (a single VM, like dev) or on a separate host is purely a
> connection-string concern and is deliberately **not** assumed here. The plan
> still unifies how schema is applied across dev / CI / prod into one path, but
> the rationale is "the app owns schema application" (goose's model), not "prod
> looks like dev."

## 1. Objective & grounding

### 1.1 What we have today (verified 2026-06-21)

- **Two schema artifacts kept in sync by hand:**
  - `store/schema/current.sql` — the full v44 schema for fresh installs. It is
    *also* what sqlc reads for codegen (`sqlc.yaml` → `schema:
    store/schema/current.sql`).
  - `store/schema/NN-from-MM.sql` — the append-only migration chain
    (`05-from-04.sql` … `44-from-43.sql`) for upgrading existing DBs.
- **A manual version cursor.** `current.sql` carries `insert into SCHEMA_INFO
  (VERSION) values (44);`, and every migration file ends by hand-bumping it.
- **The runner** (`store/migrate.go`):
  - `repoSchemaVersion()` parses the target version out of `current.sql` by
    **string-splitting** on `insert into SCHEMA_INFO (VERSION) values (` — brittle.
  - `dbSchemaVersion()` reads `SCHEMA_INFO`; a missing table means "new DB" → 0.
  - `migrate()`: if `from == 0`, run `current.sql` wholesale; otherwise loop
    `from+1 … to`, reading each `schema/%02d-from-%02d.sql` and exec'ing it. **No
    transaction, no per-migration ledger.**
  - `MigrateDB()` is invoked on every boot: `cmd/serve.go:118` →
    `store.SqlDB(ctx, cfg, true)` → `MigrateDB`.
- **A drift test** (`store/integration/migrate_test.go` + frozen `36.sql`
  baseline): brings up two MariaDB containers, migrates the v36 baseline forward
  via the chain and migrates an empty DB via `current.sql`, then asserts the two
  produce identical `SHOW CREATE TABLE` output (AUTO_INCREMENT stripped). This
  test exists **solely** to catch `current.sql` ↔ chain drift — a tax we only pay
  because there are two artifacts.

### 1.2 How schema is applied in deployment today (two divergent paths)

The running binary always migrates on boot, but *how the schema first lands*
differs by environment — this is the crux of why "works in dev" proves little:

| Environment | Compose file | Who creates the schema | Chain exercised? |
|---|---|---|---|
| **Prod / CI** | `docker-compose.cicd.yml` (+ `Dockerfile`, `CMD ims serve`) | **The app.** ims-db is a bare MariaDB + data volume, no init scripts. App boots → `MigrateDB` sees no `SCHEMA_INFO` → `from=0` → runs embedded `current.sql`. | Only on an in-place upgrade of an already-populated DB. |
| **Dev** | `docker-compose.dev.yml` | **MariaDB's init scripts.** `current.sql` is mounted to `docker-entrypoint-initdb.d/1.schema.sql` and `seed.sql` to `2.seed.sql` (lines 85–86), run once on an empty data dir. App then boots and `MigrateDB` is a no-op (v44 == v44). | Never. |

Two consequences:

1. **Fresh installs — in both modes — only ever apply `current.sql`. The
   `XX-from-YY.sql` chain is exercised only by an in-place upgrade of a non-empty
   DB**, and nothing automated runs a *populated* old DB forward. The riskiest
   path is the least covered.
2. **Dev creates schema a completely different way than prod** (MariaDB
   init-script vs. the app).

### 1.3 Why this is error-prone (the problems goose removes)

- **Dual source of truth** → the whole drift test + a standing class of
  "forgot to update `current.sql`" / "forgot to update the chain" bugs.
- **Manual bookkeeping** → forgetting the `SCHEMA_INFO` bump or mis-numbering a
  file silently breaks migration; two parallel branches both grab the next
  integer and collide.
- **Fragile version parsing** of `current.sql` (`store/migrate.go`).
- **No per-migration ledger / no transaction** → a half-applied migration leaves
  the DB in an undefined state with no record of where it stopped.
- **Fresh path ≠ upgrade path** → fresh-install testing doesn't cover the real
  upgrade mechanism.

## 2. Target design

**One artifact, one application path, a tool-managed ledger.**

```
store/schema/migrations/        ← the ONLY schema artifact
  00001_baseline.sql            (v44 squashed, goose Up/Down annotated)
  00002_<next change>.sql
  ...
        │                              │
        │ applied at runtime           │ read for codegen
        ▼                              ▼
  goose.Up (on app boot)         sqlc  (schema: store/schema/migrations)
        │
        ▼
  goose_db_version  (per-migration ledger, replaces SCHEMA_INFO)
```

- **goose owns application.** On boot the app runs `goose.Up` over an embedded
  copy of `migrations/`. Fresh DB and upgrade are now the **same** code path —
  goose applies `00001_baseline.sql` then whatever is pending — so the §1.2
  divergence collapses to one row. goose records each applied migration in its
  own `goose_db_version` table (timestamped), replacing `SCHEMA_INFO` and the
  manual bump.
- **sqlc reads the same directory.** sqlc natively understands goose-annotated
  migration files: it applies the `-- +goose Up` portions in order to build its
  schema model and ignores the `Down` portions. `current.sql` is deleted; there
  is nothing left to keep in sync, and the drift test is retired.
- **The boot contract is unchanged.** `MigrateDB(ctx, db)` keeps its signature
  and is still called from `cmd/serve.go:118` with migrate=`true`. Only its guts
  change. Automatic-migration-on-boot behaves exactly as today — that is a
  requirement, not a side effect.
- **Seed on boot, app-owned.** Seeding moves out of the MariaDB init-script and
  into the app, gated by an env flag and made idempotent, so the demo/VM seeds
  itself on boot the same way migrations run on boot (see §4).

### 2.1 Migrating from the old (pre-goose) database — one-time adoption

Fresh databases are easy: goose creates `goose_db_version`, applies
`00001_baseline.sql`, then anything newer. The wrinkle is the **existing dev
database**, which already carries the full v44 schema under the old system (a
populated `SCHEMA_INFO`, no `goose_db_version`). Running `goose.Up` against it
blind would try to apply the baseline DDL over tables that already exist, and
fail. goose has **no built-in "baseline/stamp/fake-apply" command** (unlike
Flyway/Django), so we handle the crossover explicitly.

`MigrateDB` gains a small, explicitly temporary **adoption** step that runs
*before* `goose.Up`:

1. **Detect** the legacy state: `goose_db_version` is absent **and**
   `SCHEMA_INFO` is present.
2. **Assert** `SCHEMA_INFO.VERSION == <baseline version>` (44). If the DB is
   behind, **fail loudly** telling the operator to bring it up to v44 under the
   previous release first — we do not re-implement the old chain. (Fail closed:
   a behind-baseline DB is never silently stamped as baseline.)
3. **Adopt without re-running DDL:** let goose create its own
   `goose_db_version` table (e.g. via `goose.EnsureDBVersion` /
   `GetDBVersion`, which also seeds the v0 row — letting goose own that DDL so
   the shim isn't coupled to goose's internal table layout), then record the
   baseline as already applied
   (`insert into goose_db_version (version_id, is_applied) values (1, true)`),
   and drop the now-defunct `SCHEMA_INFO`.
4. **Fall through** to the normal `goose.Up`, which now sees the baseline as
   applied and runs only anything newer.

This path is **one-time and removable**: it only fires on a DB that still has
`SCHEMA_INFO`. Once the dev DB has crossed over (and since CI/prod start fresh),
nothing triggers it — we delete the shim and its transition fixture/test in a
later cleanup (tracked in §6). It is the data-preserving alternative to wiping
the dev data dir: the dev DB keeps its existing rows (incl. prior seed data),
which the idempotent seeder (§4) then leaves untouched.

## 3. Decisions (proposed — confirm before build)

| # | Decision | Outcome |
|---|---|---|
| D1 | Tool | **goose** (`github.com/pressly/goose/v3`), embedded and run in-process on boot. Chosen over golang-migrate (goose's dir-as-schema + Go-migration escape hatch fit better) and over Atlas (declarative diffing is more tool/concept than we want for a soon-to-be-rebuilt system). |
| D2 | Source of truth | **The `migrations/` directory.** `current.sql` is deleted; sqlc's `schema:` repoints at the directory. One artifact. |
| D3 | Flatten | **Squash to `00001_baseline.sql` = the v44 schema.** The whole `NN-from-MM.sql` chain and `current.sql` are deleted. The existing dev DB is **adopted in place** (§2.1), not reset — preserving its data; CI/prod start fresh. (Wiping the dev data dir remains a clean-slate fallback.) |
| D4 | Version scheme | **goose sequential integers, zero-padded width 5** (`00001_…`), `-- +goose Up` / `-- +goose Down` annotated. (Timestamps avoid branch collisions but are noisier; for a near-single-maintainer repo sequential is clearer. Revisit if parallel migration authoring becomes common.) |
| D5 | Migrations are schema-only | **Unchanged rule.** Migrations contain DDL only — no seed/data. (Carries forward today's invariant; OCF launches fresh.) `Down` migrations are written best-effort for dev convenience but are **not** relied on in prod. |
| D6 | Seed | **App-owned, on boot, env-gated, idempotent** (`IMS_SEED_DEMO`). Replaces the dev compose init-script seed. See §4. |
| D7 | Apply on boot | **Keep.** `MigrateDB` still runs on every `serve` boot (`SqlDB(..., true)`); only its internals change. |
| D8 | Schema-application model | **The app owns schema application in every environment**, per goose's embedded-on-boot model — *not* premised on any deployment topology. The DB being co-located (single VM, like dev) or remote is just a DSN and changes nothing here. Concretely: remove the `current.sql` init mount from `docker-compose.dev.yml` so dev matches the same app-owns-schema path as CI/prod. |
| D9 | Old-DB crossover | **A one-time, removable adoption shim** (§2.1) stamps the baseline as applied on a pre-goose DB instead of re-running it; behind-baseline DBs are rejected, not auto-upgraded. Removed once the dev DB has crossed over. |
| D10 | goose API surface | **Lean toward the Provider API** (`goose.NewProvider`, context-aware, no global mutable `SetDialect`/`SetBaseFS` state) as goose recommends; the legacy package-level API is an acceptable fallback. Finalize in Slice B — both support embedded FS and the manual baseline stamp. |

## 4. Seed-on-boot design

Today `store/fakeimsdb/seed.sql` (PERSON directory + demo events/incidents) is
loaded only in dev, via MariaDB's `docker-entrypoint-initdb.d`, which runs only
once on an empty data dir and only *before* the app boots. Once the app owns
schema, an init-script seed can't run (the schema won't exist yet). So seeding
moves into the app:

- **Embed** `seed.sql` in the binary (`//go:embed`), alongside the migrations.
- After `goose.Up` succeeds, **if `IMS_SEED_DEMO` is true**, run the seed —
  **idempotently**. Guard with a cheap emptiness probe (e.g. seed only when
  `EVENT` and `PERSON` are both empty) so app restarts don't duplicate rows.
- `IMS_SEED_DEMO` defaults **off** in prod config and **on** for dev/demo. The
  VM demo sets it on, so "bring up MariaDB + app" yields a fully seeded demo on
  first boot, exactly like today's dev experience — but with no init-script.
- This keeps the seed firmly **dev/demo-only**: a real production deployment
  leaves `IMS_SEED_DEMO` off and gets schema-only.

> **Note / open question (D6a):** the seed must be loadable *after* the schema
> exists, so it must not depend on init-script ordering. If `seed.sql` currently
> assumes a freshly-created empty DB, confirm it still applies cleanly against an
> app-migrated schema (it should — same tables). Verify during the build slice.

## 5. Slices

Sequenced so each step is independently verifiable. Suggested PR boundaries.

### Slice A — Introduce goose + baseline, keep `current.sql` (prove faithfulness)
1. Add `github.com/pressly/goose/v3` to `go.mod` (a normal runtime dependency,
   not a `go tool`).
2. Create `store/schema/migrations/00001_baseline.sql` = today's `current.sql`
   body, wrapped in `-- +goose Up` / `-- +goose Down`, **with the `SCHEMA_INFO`
   table + insert removed** (goose's `goose_db_version` replaces it). The `Down`
   drops the tables (best-effort).
3. Repoint `sqlc.yaml` `schema:` from `store/schema/current.sql` to
   `store/schema/migrations`. Run `go tool sqlc generate`.
4. **Verify the regenerated `store/imsdb/` is byte-identical to today's** (git
   diff clean). This proves the baseline faithfully reproduces v44 before we
   trust it at runtime. *(Acceptance gate for Slice A.)*

### Slice B — Swap the runner (incl. one-time adoption)
1. Rewrite `store/migrate.go`: `MigrateDB(ctx, db)` keeps its signature but now
   configures goose for `mysql`, points it at the embedded migrations FS, and
   applies up-to-head (Provider API preferred per D10, legacy `goose.Up`
   acceptable). Delete `repoSchemaVersion`, `dbSchemaVersion`, the `SCHEMA_INFO`
   reads, and the string-parsing.
2. Add the **adoption shim** (§2.1) ahead of the goose apply: detect
   legacy state (`SCHEMA_INFO` present, `goose_db_version` absent), assert
   `SCHEMA_INFO.VERSION == 44` (else fail loudly), let goose create its version
   table, stamp baseline `version_id=1` as applied, drop `SCHEMA_INFO`. Keep it
   clearly fenced/commented as temporary (removed in a later cleanup).
3. Update the embeds in `store/store.go`: replace `//go:embed
   schema/current.sql` and `//go:embed schema/*-from-*.sql` with a single
   `//go:embed schema/migrations/*.sql`.
4. Drop the now-unused `SchemaVersion` sqlc query (`store/queries.sql` /
   regenerate) if nothing else references it.
5. Replace `store/integration/migrate_test.go` with tests covering **both
   entry paths**:
   - *Fresh:* empty MariaDB → `MigrateDB` → no error; a second `MigrateDB` is a
     clean no-op (goose reports nothing pending); expected tables exist.
   - *Adoption:* load a frozen v44 snapshot (the old `current.sql`, copied to
     `store/integration/44-legacy.sql` **before** it is deleted in Slice D) →
     `MigrateDB` → the shim stamps baseline, drops `SCHEMA_INFO`, leaves the
     schema intact, and a re-run is a no-op. Also assert a **behind-baseline**
     snapshot is rejected.
   Retire `36.sql` and the chain-vs-`current.sql` drift comparison (there is no
   longer a second artifact to drift against). The adoption test + `44-legacy.sql`
   fixture are themselves temporary — they go when the shim does.

### Slice C — Seed on boot
1. Embed `store/fakeimsdb/seed.sql`; add an app-side seeder that runs after
   `MigrateDB` when `IMS_SEED_DEMO` is set, guarded by the emptiness probe (§4).
   Wire the env flag through `conf` / `imsconfig.go` with prod-off / dev-on
   defaults.
2. Call the seeder from the boot path (after `SqlDB` returns, or inside it after
   migrate — pick the spot that matches where config is available in
   `cmd/serve.go`).
3. Verify the seed applies cleanly against an app-migrated (not init-scripted)
   schema, and that a restart does not duplicate data.

### Slice D — Unify docker + flatten cleanup
1. **Freeze the v44 fixture first:** copy `store/schema/current.sql` to
   `store/integration/44-legacy.sql` (the adoption test's input) **before** the
   deletion in step 4, so the snapshot survives.
2. **`docker-compose.dev.yml`:** remove the `current.sql` →
   `docker-entrypoint-initdb.d/1.schema.sql` mount and the `seed.sql` →
   `2.seed.sql` mount (lines ~85–86). Set `IMS_SEED_DEMO: "true"` in the `ims-go`
   service env. Dev now gets schema from the app on boot, same path as CI/prod.
3. **`docker-compose.cicd.yml`:** already app-owns-schema; confirm it still comes
   up green (the app now uses goose, otherwise unchanged). Leave `IMS_SEED_DEMO`
   unset/off.
4. **Delete** `store/schema/current.sql` and every `store/schema/NN-from-MM.sql`.
   Grep for stragglers referencing them (`current.sql`, `SCHEMA_INFO`,
   `from-`, the `Migrations`/`CurrentSchema` vars).
5. **Cross over the dev DB in place:** on next boot the adoption shim (§2.1)
   stamps the existing dev DB and it continues with its data intact — **no reset
   required**. (Wiping `./.docker/mysql/data-ims/` remains a clean-slate option.)
6. **Docs:** update `CLAUDE.md` (the "Database Migrations" + "Configuration"
   sections) and this README row. Document the deployment model as
   *topology-agnostic*: the app migrates (and optionally seeds) on boot over its
   DB connection, whether MariaDB is co-located or on a separate host.

### Slice E — Remove the adoption shim (after crossover)
Once the dev DB has crossed over and no pre-goose DB remains anywhere, delete the
§2.1 adoption shim from `store/migrate.go`, plus the `44-legacy.sql` fixture and
its adoption test. `MigrateDB` is then a thin goose-apply with no special cases.
(Separate, low-risk PR — sequenced after Slice D has actually run against the dev
DB.)

## 6. Risks & caveats

- **MariaDB DDL is not transactional.** goose wraps each migration in a
  transaction, but DDL auto-commits, so a multi-statement migration that fails
  partway leaves a partial change and goose won't mark it applied (re-run then
  hits "already exists"). Mitigation: **one logical DDL change per migration
  file**, kept small. Still strictly better than today (no ledger at all). This
  is a MariaDB limit, not a goose one; Atlas wouldn't fix it either.
- **sqlc must parse the migration dir.** sqlc supports goose-annotated migration
  directories, but confirm in Slice A that codegen output is byte-identical
  before deleting `current.sql`. (Acceptance gate.)
- **Existing pre-goose DBs.** A populated data dir has no `goose_db_version`
  table; a blind `goose.Up` would re-run `00001_baseline` over existing tables
  and fail. Handled by the one-time **adoption shim** (§2.1, §D9), which stamps
  the baseline instead of running it. Its safety hinges on the
  `SCHEMA_INFO.VERSION == 44` assertion — a behind-baseline DB is **rejected**,
  never silently stamped. The shim (and its fixture/test) is deleted in Slice E.
- **Deployment topology is not a dependency.** The on-boot model works whether
  MariaDB is co-located or remote — it only needs a DB connection. Nothing in
  this design assumes the single-VM layout; that remains a free deployment
  choice. Operationally, note only that **on-boot migration means the app must
  reach the DB at startup** (already true today).
- **Down migrations.** Written best-effort for dev; not part of the prod
  rollback story (we roll forward). Don't let anyone wire prod rollback to
  `goose down`.

## 7. Out of scope

- Atlas / declarative schema management (considered, not chosen — see D1).
- Production rollback tooling / `goose down` in prod.
- **Deciding the deployment topology** (single VM vs. separate DB host). The
  design works for both; picking one is a separate operational decision.
- Any change to the schema itself: the baseline is a faithful squash of v44, not
  a redesign.
- The broader "system regenerated from scratch" effort — this plan makes the
  *current* tree's migrations robust in the meantime; it does not block or
  presume that rewrite.

## 8. Acceptance checklist

- [ ] `00001_baseline.sql` reproduces v44; regenerated `store/imsdb/` is
      byte-identical (Slice A gate).
- [ ] `MigrateDB` (goose) brings a fresh MariaDB to head; a second call is a
      no-op; integration test green.
- [ ] **Adoption:** a frozen v44 (`SCHEMA_INFO`-based) DB crosses over in place —
      baseline stamped, `SCHEMA_INFO` dropped, schema intact, re-run a no-op; a
      behind-baseline DB is rejected.
- [ ] `IMS_SEED_DEMO=true` seeds on boot, idempotent across restarts; off ⇒
      schema-only.
- [ ] `docker compose -f docker-compose.dev.yml up` on a wiped data dir yields a
      migrated + seeded DB with **no** init-script schema mount.
- [ ] `docker-compose.cicd.yml` comes up green.
- [ ] `current.sql` and the `NN-from-MM.sql` chain are gone; no dangling
      references; `go test ./...` + lint green.
- [ ] `CLAUDE.md` + this README updated; deployment documented as
      topology-agnostic (app migrates/seeds on boot over its DB connection).
- [ ] (Slice E, post-crossover) adoption shim + `44-legacy.sql` fixture/test
      removed; `MigrateDB` has no special cases.
