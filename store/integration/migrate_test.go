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

package integration_test

import (
	"context"
	"crypto/rand"
	"database/sql"
	_ "embed"
	"fmt"
	"io"
	"regexp"
	"slices"
	"testing"

	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/lib/testctr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"golang.org/x/sync/errgroup"
)

// legacySchemaV45 is a frozen snapshot of the schema produced by the *old*
// (SCHEMA_INFO-based) migration system at version 45 — the version the goose
// baseline (00001_baseline.sql) was squashed from. It is the input for the
// one-time adoption path. Frozen on purpose: leave it as-is.
//
//go:embed 45-legacy.sql
var legacySchemaV45 string

// SHOW CREATE TABLE embeds the table's live AUTO_INCREMENT counter, which is not
// part of the table's structure; strip it before comparing schemas.
var autoIncrementClause = regexp.MustCompile(` AUTO_INCREMENT=\d+`)

func normalizeCreateTable(createTable string) string {
	return autoIncrementClause.ReplaceAllString(createTable, "")
}

// TestMigrateFreshAndAdopted verifies the two entry paths of the goose runner
// produce the same schema:
//
//   - a FRESH database migrated straight from the embedded migrations, and
//   - a PRE-GOOSE database (the frozen v45 SCHEMA_INFO schema) crossed over by
//     the one-time adoption path.
//
// Both should end up at goose version 1, with no SCHEMA_INFO table, and with
// byte-identical CREATE TABLE for every table. MigrateDB is also re-run on each
// to confirm it is a no-op the second time.
func TestMigrateFreshAndAdopted(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	database := rand.Text()
	username := rand.Text()
	password := rand.Text()

	// Bring up two DB containers in parallel.
	var fresh, adopted *sql.DB
	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error {
		_, fresh = newUnmigratedDB(t, groupCtx, database, username, password)
		return nil
	})
	group.Go(func() error {
		_, adopted = newUnmigratedDB(t, groupCtx, database, username, password)
		return nil
	})
	require.NoError(t, group.Wait())
	defer shut(fresh)
	defer shut(adopted)

	// FRESH: migrate an empty DB straight up with goose.
	require.NoError(t, store.MigrateDB(ctx, fresh))
	// Re-running is a clean no-op.
	require.NoError(t, store.MigrateDB(ctx, fresh))

	// ADOPTED: start at the frozen pre-goose v45 schema, then migrate — this
	// exercises the one-time adoption path (stamp baseline, drop SCHEMA_INFO).
	require.NoError(t, runScript(ctx, adopted, legacySchemaV45))
	requireTableExists(t, ctx, adopted, "SCHEMA_INFO") // precondition: it's a legacy DB
	require.NoError(t, store.MigrateDB(ctx, adopted))
	// Re-running is a clean no-op (no longer takes the adoption path).
	require.NoError(t, store.MigrateDB(ctx, adopted))

	// Both DBs should be at goose baseline version 1 with no leftover cursor.
	for name, db := range map[string]*sql.DB{"fresh": fresh, "adopted": adopted} {
		assert.Equalf(t, int64(1), gooseVersion(t, ctx, db), "goose version (%s)", name)
		assert.Falsef(t, tableExists(t, ctx, db, "SCHEMA_INFO"), "SCHEMA_INFO should be gone (%s)", name)
	}

	// The two DBs should have identical schemas (same tables, same CREATE TABLE).
	freshTables := tableCreates(t, ctx, fresh)
	adoptedTables := tableCreates(t, ctx, adopted)
	require.Equal(t, keys(freshTables), keys(adoptedTables), "table sets differ")
	for table, create := range freshTables {
		assert.Equalf(t, create, adoptedTables[table], "CREATE TABLE differs for %s", table)
	}
}

// TestAdoptionRejectsBehindBaseline verifies the adoption path fails closed: a
// pre-goose DB that is *behind* the baseline version is refused rather than
// mis-stamped as the baseline.
func TestAdoptionRejectsBehindBaseline(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	database := rand.Text()
	username := rand.Text()
	password := rand.Text()

	_, db := newUnmigratedDB(t, ctx, database, username, password)
	defer shut(db)

	// A minimal legacy DB sitting at the wrong (behind-baseline) version.
	require.NoError(t, runScript(ctx, db,
		"create table SCHEMA_INFO (VERSION smallint not null);"+
			"insert into SCHEMA_INFO (VERSION) values (44);"))

	err := store.MigrateDB(ctx, db)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "refusing to adopt")
	// It must not have partially crossed over.
	assert.True(t, tableExists(t, ctx, db, "SCHEMA_INFO"))
	assert.False(t, tableExists(t, ctx, db, "goose_db_version"))
}

// gooseVersion returns the current goose schema version recorded in the ledger.
func gooseVersion(t *testing.T, ctx context.Context, db *sql.DB) int64 {
	t.Helper()
	var version int64
	err := db.QueryRowContext(ctx,
		"select max(version_id) from goose_db_version where is_applied = true").Scan(&version)
	require.NoError(t, err)
	return version
}

func tableExists(t *testing.T, ctx context.Context, db *sql.DB, name string) bool {
	t.Helper()
	var count int
	err := db.QueryRowContext(ctx,
		"select count(*) from information_schema.tables "+
			"where table_schema = database() and table_name = ?", name).Scan(&count)
	require.NoError(t, err)
	return count > 0
}

func requireTableExists(t *testing.T, ctx context.Context, db *sql.DB, name string) {
	t.Helper()
	require.Truef(t, tableExists(t, ctx, db, name), "expected table %s to exist", name)
}

// tableCreates returns the normalized CREATE TABLE statement for every
// application table (the goose ledger is excluded — it has no bearing on the
// application schema).
func tableCreates(t *testing.T, ctx context.Context, db *sql.DB) map[string]string {
	t.Helper()
	rows, err := db.QueryContext(ctx, "show tables")
	require.NoError(t, err)
	var names []string
	for rows.Next() {
		var name string
		require.NoError(t, rows.Scan(&name))
		if name == "goose_db_version" {
			continue
		}
		names = append(names, name)
	}
	require.NoError(t, rows.Err())
	shut(rows)

	creates := make(map[string]string, len(names))
	for _, name := range names {
		var tableName, createTable string
		err = db.QueryRowContext(ctx, "show create table `"+name+"`").Scan(&tableName, &createTable)
		require.NoError(t, err)
		creates[name] = normalizeCreateTable(createTable)
	}
	return creates
}

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	slices.Sort(out)
	return out
}

func newUnmigratedDB(t *testing.T, ctx context.Context, database, username, password string) (testcontainers.Container, *sql.DB) {
	t.Helper()

	ctr, cleanup, dbHostPort, err := testctr.MariaDBContainer(ctx, database, username, password)
	t.Cleanup(cleanup)
	require.NoError(t, err)

	db, err := store.SqlDB(ctx,
		conf.DBStore{
			Type: conf.DBStoreTypeMaria,
			MariaDB: conf.DBStoreMaria{
				HostName: "",
				HostPort: dbHostPort,
				Database: database,
				Username: username,
				Password: password,
			},
		},
		false,
	)
	require.NoError(t, err)
	return ctr, db
}

func runScript(ctx context.Context, imsDBQ *sql.DB, script string) error {
	_, err := imsDBQ.ExecContext(ctx, script)
	if err != nil {
		return fmt.Errorf("[ExecContext]: %w", err)
	}
	return nil
}

func shut(c io.Closer) {
	_ = c.Close()
}
