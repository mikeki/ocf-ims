# Platform — DB migration tooling (goose)

> **Status:** Plan — for review. **Last updated:** 2026-06-21
>
> Replace the hand-rolled migration system (`current.sql` + an append-only
> `XX-from-YY.sql` chain + a manually-bumped `SCHEMA_INFO.VERSION`) with
> [**goose**](https://github.com/pressly/goose), and collapse the schema down to
> a **single source of truth**: one `store/schema/migrations/` directory that is
> both applied at runtime by goose *and* read by sqlc for codegen.
>
> Triggered by a deliberate flatten: the schema will be squashed to its current
> state (v44) as `00001_baseline.sql`, so the project starts the new system with
> one migration. The eventual production target is a **single VM running the app
> and a local MariaDB**, brought up "very similar to dev mode" — so this plan also
> unifies how schema is applied across dev / CI / prod into one path.

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

## 3. Decisions (proposed — confirm before build)

| # | Decision | Outcome |
|---|---|---|
| D1 | Tool | **goose** (`github.com/pressly/goose/v3`), embedded and run in-process on boot. Chosen over golang-migrate (goose's dir-as-schema + Go-migration escape hatch fit better) and over Atlas (declarative diffing is more tool/concept than we want for a soon-to-be-rebuilt system). |
| D2 | Source of truth | **The `migrations/` directory.** `current.sql` is deleted; sqlc's `schema:` repoints at the directory. One artifact. |
| D3 | Flatten | **Squash to `00001_baseline.sql` = the v44 schema.** The whole `NN-from-MM.sql` chain and `current.sql` are deleted. No ledger backfill: the demo DB is disposable (reset), and the VM/prod DB will be fresh. |
| D4 | Version scheme | **goose sequential integers, zero-padded width 5** (`00001_…`), `-- +goose Up` / `-- +goose Down` annotated. (Timestamps avoid branch collisions but are noisier; for a near-single-maintainer repo sequential is clearer. Revisit if parallel migration authoring becomes common.) |
| D5 | Migrations are schema-only | **Unchanged rule.** Migrations contain DDL only — no seed/data. (Carries forward today's invariant; OCF launches fresh.) `Down` migrations are written best-effort for dev convenience but are **not** relied on in prod. |
| D6 | Seed | **App-owned, on boot, env-gated, idempotent** (`IMS_SEED_DEMO`). Replaces the dev compose init-script seed. See §4. |
| D7 | Apply on boot | **Keep.** `MigrateDB` still runs on every `serve` boot (`SqlDB(..., true)`); only its internals change. |
| D8 | Docker unification | **App owns schema in every environment.** Remove the `current.sql` init mount from `docker-compose.dev.yml`; dev/CI/prod all get schema from `goose.Up` on boot. |

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

### Slice B — Swap the runner
1. Rewrite `store/migrate.go`: `MigrateDB(ctx, db)` keeps its signature but now
   sets the goose dialect (`mysql`), points goose at the embedded migrations FS
   (`goose.SetBaseFS`), and calls `goose.Up`. Delete `repoSchemaVersion`,
   `dbSchemaVersion`, the `SCHEMA_INFO` reads, and the string-parsing.
2. Update the embeds in `store/store.go`: replace `//go:embed
   schema/current.sql` and `//go:embed schema/*-from-*.sql` with a single
   `//go:embed schema/migrations/*.sql`.
3. Drop the now-unused `SchemaVersion` sqlc query (`store/queries.sql` /
   regenerate) if nothing else references it.
4. Replace `store/integration/migrate_test.go`: new test brings up one fresh
   MariaDB container, runs `MigrateDB`, asserts (a) no error, (b) a second
   `MigrateDB` is a clean no-op (goose reports nothing pending), (c) the expected
   tables exist. Retire `36.sql` and the chain-vs-current drift comparison
   (there is no longer a second artifact to drift against).

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
1. **`docker-compose.dev.yml`:** remove the `current.sql` →
   `docker-entrypoint-initdb.d/1.schema.sql` mount and the `seed.sql` →
   `2.seed.sql` mount (lines ~85–86). Set `IMS_SEED_DEMO: "true"` in the `ims-go`
   service env. Dev now gets schema from the app on boot, identical to prod.
2. **`docker-compose.cicd.yml`:** already app-owns-schema; confirm it still comes
   up green (the app now uses goose, otherwise unchanged). Leave `IMS_SEED_DEMO`
   unset/off.
3. **Delete** `store/schema/current.sql` and every `store/schema/NN-from-MM.sql`.
   Grep for stragglers referencing them (`current.sql`, `SCHEMA_INFO`,
   `from-`, the `Migrations`/`CurrentSchema` vars).
4. **Reset the demo DB:** drop `./.docker/mysql/data-ims/` so the next `docker
   compose up` brings up a fresh DB that `goose.Up` + seed-on-boot populates.
5. **Docs:** update `CLAUDE.md` (the "Database Migrations" + "Configuration"
   sections), this README row, and add VM bring-up notes (MariaDB on the box →
   app migrates + seeds on boot via `IMS_SEED_DEMO`).

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
- **Existing dev/demo DBs.** Any already-initialized data dir has no
  `goose_db_version` table; goose would try to apply `00001_baseline` over an
  existing schema and fail. Because the demo DB is disposable we **reset** it
  (Slice D.4) rather than backfilling the ledger. (If we ever needed to preserve
  a populated DB across the switch, the move would be to pre-insert a
  `goose_db_version` row marking `00001` applied — noted, not needed.)
- **Down migrations.** Written best-effort for dev; not part of the prod
  rollback story (we roll forward). Don't let anyone wire prod rollback to
  `goose down`.

## 7. Out of scope

- Atlas / declarative schema management (considered, not chosen — see D1).
- Production rollback tooling / `goose down` in prod.
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
- [ ] `IMS_SEED_DEMO=true` seeds on boot, idempotent across restarts; off ⇒
      schema-only.
- [ ] `docker compose -f docker-compose.dev.yml up` on a wiped data dir yields a
      migrated + seeded DB with **no** init-script schema mount.
- [ ] `docker-compose.cicd.yml` comes up green.
- [ ] `current.sql` and the `NN-from-MM.sql` chain are gone; no dangling
      references; `go test ./...` + lint green.
- [ ] `CLAUDE.md`, this README, and VM bring-up notes updated.
