//
// See the file COPYRIGHT for copyright information.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

package store

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"

	"github.com/pressly/goose/v3"
)

const (
	// migrationsDir is the path, within migrationsFS, that holds the goose
	// migration files. See store.go for the embed.
	migrationsDir = "schema/migrations"

	// gooseDialect is the goose dialect for MariaDB (MariaDB speaks the MySQL
	// protocol/DDL).
	gooseDialect = "mysql"

	// baselineVersion is the goose version of 00001_baseline.sql. The one-time
	// adoption path (adoptLegacyDB) stamps this as already-applied on a
	// pre-goose database whose schema already matches the baseline.
	baselineVersion = 1

	// legacyBaselineSchemaVersion is the old SCHEMA_INFO.VERSION that the
	// flattened baseline (00001_baseline.sql) was squashed from. A pre-goose DB
	// is only adopted if it sits exactly at this version; anything behind it is
	// rejected (see adoptLegacyDB).
	legacyBaselineSchemaVersion = 45
)

func init() {
	// goose's legacy package-level API keeps the migration FS and dialect in
	// globals. Set them once at startup; migrations are embedded in the binary.
	goose.SetBaseFS(migrationsFS)
	err := goose.SetDialect(gooseDialect)
	if err != nil {
		// gooseDialect is a compile-time constant goose knows, so this can't
		// fail in practice.
		panic(fmt.Sprintf("invalid goose dialect %q: %v", gooseDialect, err))
	}
}

// MigrateDB brings the IMS database up to the latest schema using goose,
// applying every pending migration in store/schema/migrations. It is safe to
// call on every boot: a database already at head is a no-op.
//
// As a one-time step, a database created by the *previous* (SCHEMA_INFO-based)
// migration system is adopted into goose without re-running the baseline DDL —
// see adoptLegacyDB. That path is temporary and will be removed once all such
// databases have crossed over.
func MigrateDB(ctx context.Context, imsDBQ *sql.DB) error {
	err := adoptLegacyDBIfNeeded(ctx, imsDBQ)
	if err != nil {
		return fmt.Errorf("[adoptLegacyDBIfNeeded]: %w", err)
	}

	err = goose.Up(imsDBQ, migrationsDir)
	if err != nil {
		return fmt.Errorf("[goose.Up]: %w", err)
	}

	version, err := goose.GetDBVersion(imsDBQ)
	if err != nil {
		return fmt.Errorf("[goose.GetDBVersion]: %w", err)
	}
	slog.Info("IMS DB schema is up to date", "gooseVersion", version)
	return nil
}

// adoptLegacyDBIfNeeded performs the one-time crossover of a pre-goose database
// (one that still carries the old SCHEMA_INFO version cursor and has no goose
// ledger yet) into goose's world, without re-running the baseline DDL over its
// already-present tables.
//
// TEMPORARY: this whole path exists only for databases created by the old
// migration system. Once those have been adopted (and since fresh installs go
// straight to goose), it can be deleted — see docs/plans/08-db-migration-tooling.md
// (Slice E).
func adoptLegacyDBIfNeeded(ctx context.Context, db *sql.DB) error {
	gooseLedgerExists, err := tableExists(ctx, db, "goose_db_version")
	if err != nil {
		return fmt.Errorf("[tableExists goose_db_version]: %w", err)
	}
	schemaInfoExists, err := tableExists(ctx, db, "SCHEMA_INFO")
	if err != nil {
		return fmt.Errorf("[tableExists SCHEMA_INFO]: %w", err)
	}

	// Only a pre-goose DB (old cursor present, no goose ledger) needs adoption.
	// Fresh DBs (neither table) and already-adopted DBs (goose ledger present)
	// fall straight through to goose.Up.
	if gooseLedgerExists || !schemaInfoExists {
		return nil
	}

	var schemaVersion int
	err = db.QueryRowContext(ctx, "select VERSION from SCHEMA_INFO").Scan(&schemaVersion)
	if err != nil {
		return fmt.Errorf("[read SCHEMA_INFO.VERSION]: %w", err)
	}
	// Fail closed: only adopt a DB that sits exactly at the version the baseline
	// was squashed from. A behind-baseline DB must be brought up to that version
	// under the previous release first, rather than being mis-stamped as the
	// baseline.
	if schemaVersion != legacyBaselineSchemaVersion {
		return fmt.Errorf(
			"refusing to adopt pre-goose DB at SCHEMA_INFO.VERSION=%d; expected %d "+
				"(bring it up to %d under the previous release first)",
			schemaVersion, legacyBaselineSchemaVersion, legacyBaselineSchemaVersion,
		)
	}

	slog.Info("Adopting pre-goose database into goose (one-time)",
		"schemaInfoVersion", schemaVersion, "baselineVersion", baselineVersion)

	// Let goose create and initialize its own ledger table (don't hand-write
	// goose's internal DDL), then record the baseline as already applied so
	// goose.Up skips its DDL.
	_, err = goose.EnsureDBVersion(db)
	if err != nil {
		return fmt.Errorf("[goose.EnsureDBVersion]: %w", err)
	}
	_, err = db.ExecContext(ctx,
		"insert into goose_db_version (version_id, is_applied) values (?, true)",
		baselineVersion,
	)
	if err != nil {
		return fmt.Errorf("[stamp baseline applied]: %w", err)
	}
	// The old cursor table is now defunct.
	_, err = db.ExecContext(ctx, "drop table SCHEMA_INFO")
	if err != nil {
		return fmt.Errorf("[drop SCHEMA_INFO]: %w", err)
	}
	return nil
}

// tableExists reports whether a table of the given name exists in the
// connection's current database.
func tableExists(ctx context.Context, db *sql.DB, name string) (bool, error) {
	var count int
	err := db.QueryRowContext(ctx,
		"select count(*) from information_schema.tables "+
			"where table_schema = database() and table_name = ?",
		name,
	).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("[QueryRowContext]: %w", err)
	}
	return count > 0, nil
}
