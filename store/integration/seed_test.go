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
	"testing"

	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSeedDemoData verifies that the demo seed profile populates a
// freshly-migrated (empty) database and is idempotent: a second call against the
// now-populated database is a no-op rather than a duplicate load. It also checks
// that SeedNone is a no-op.
func TestSeedDemoData(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	database := rand.Text()
	username := rand.Text()
	password := rand.Text()

	_, db := newUnmigratedDB(t, ctx, database, username, password)
	defer shut(db)

	require.NoError(t, store.MigrateDB(ctx, db))

	// Empty after migration (schema only).
	assert.Equal(t, 0, rowCount(t, ctx, db, "PERSON"))

	// SeedNone loads nothing.
	require.NoError(t, store.Seed(ctx, db, conf.SeedNone))
	assert.Equal(t, 0, rowCount(t, ctx, db, "PERSON"), "SeedNone must not load data")

	// The demo profile populates the demo data.
	require.NoError(t, store.Seed(ctx, db, conf.SeedDemo))
	people := rowCount(t, ctx, db, "PERSON")
	assert.Positive(t, people, "expected demo people to be seeded")
	assert.Positive(t, rowCount(t, ctx, db, "EVENT"), "expected demo event(s) to be seeded")

	// Second call is a no-op (idempotent) — counts must not change.
	require.NoError(t, store.Seed(ctx, db, conf.SeedDemo))
	assert.Equal(t, people, rowCount(t, ctx, db, "PERSON"), "seed must not duplicate on re-run")
}

func rowCount(t *testing.T, ctx context.Context, db *sql.DB, table string) int {
	t.Helper()
	var count int
	err := db.QueryRowContext(ctx, "select count(*) from `"+table+"`").Scan(&count)
	require.NoError(t, err)
	return count
}
