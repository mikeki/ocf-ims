// SPDX-License-Identifier: Apache-2.0

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
func MigrateDB(ctx context.Context, imsDBQ *sql.DB) error {
	err := goose.UpContext(ctx, imsDBQ, migrationsDir)
	if err != nil {
		// A failed migration blocks boot; log it at Error so it's unmistakable in
		// the structured logs (the caller turns startup errors into a panic, whose
		// stderr trace is easy to miss).
		slog.Error("Database migration failed", "err", err)
		return fmt.Errorf("[goose.UpContext]: %w", err)
	}

	version, err := goose.GetDBVersionContext(ctx, imsDBQ)
	if err != nil {
		return fmt.Errorf("[goose.GetDBVersionContext]: %w", err)
	}
	slog.Info("IMS DB schema is up to date", "gooseVersion", version)
	return nil
}
