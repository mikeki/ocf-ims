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
	"io"
	"testing"

	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/lib/testctr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
)

// TestMigrateFreshDB verifies that goose migrates an empty database to head and
// that MigrateDB is idempotent (a second call is a clean no-op). A handful of
// representative tables are checked to confirm the baseline actually applied.
func TestMigrateFreshDB(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	database := rand.Text()
	username := rand.Text()
	password := rand.Text()

	_, db := newUnmigratedDB(t, ctx, database, username, password)
	defer shut(db)

	require.NoError(t, store.MigrateDB(ctx, db))
	// Re-running is a clean no-op.
	require.NoError(t, store.MigrateDB(ctx, db))

	for _, table := range []string{"EVENT", "PERSON", "INCIDENT", "REPORT", "VISIT", "CREW", "CREW_MEMBERSHIP"} {
		assert.Truef(t, tableExists(t, ctx, db, table), "expected table %s to exist", table)
	}
	// The dormant TEAM tables were retired (00027); confirm they're gone at head.
	for _, table := range []string{"TEAM", "PERSON__TEAM"} {
		assert.Falsef(t, tableExists(t, ctx, db, table), "expected table %s to be dropped", table)
	}
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

func shut(c io.Closer) {
	_ = c.Close()
}
