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
	"embed"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/mikeki/ocf-ims/conf"
	_ "github.com/mikeki/ocf-ims/lib/noopdb"
	"log/slog"
)

// migrationsFS holds the goose migrations applied on boot (and read by sqlc for
// codegen — see sqlc.yaml). This is the single schema source of truth.
//
//go:embed schema/migrations/*.sql
var migrationsFS embed.FS

func SqlDB(ctx context.Context, dbStoreCfg conf.DBStore, migrateDB bool) (*sql.DB, error) {
	var mariaCfg conf.DBStoreMaria
	var err error
	switch dbStoreCfg.Type {
	case conf.DBStoreTypeNoOp:
		return sql.Open("noop", "")
	case conf.DBStoreTypeMaria:
		fallthrough
	default:
		mariaCfg = dbStoreCfg.MariaDB
	}

	db, err := openDB(ctx, mariaCfg)
	if err != nil {
		return nil, fmt.Errorf("[openDB]: %w", err)
	}

	if migrateDB {
		err = MigrateDB(ctx, db)
		if err != nil {
			return nil, fmt.Errorf("[MigrateDB]: %w", err)
		}
	} else {
		slog.Info("IMS DB migration not requested")
	}

	slog.Info("Connected to IMS database")

	return db, nil
}

func openDB(ctx context.Context, mariaCfg conf.DBStoreMaria) (*sql.DB, error) {
	slog.Info("Setting up IMS DB connection")

	// Capture connection properties.
	cfg := mysql.NewConfig()
	cfg.User = mariaCfg.Username
	cfg.Passwd = mariaCfg.Password
	cfg.Net = "tcp"
	cfg.Addr = fmt.Sprintf("%v:%v", mariaCfg.HostName, mariaCfg.HostPort)
	cfg.DBName = mariaCfg.Database
	cfg.MultiStatements = true

	// Get a database handle.
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		return nil, fmt.Errorf("[sql.Open]: %w", err)
	}
	db.SetMaxOpenConns(int(mariaCfg.MaxOpenConns))
	pingErr := db.PingContext(ctx)
	if pingErr != nil {
		return nil, fmt.Errorf("[db.PingContext]: %w", pingErr)
	}
	return db, nil
}
