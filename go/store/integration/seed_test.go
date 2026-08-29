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

// TestSeedAreasMatchCanonical guards against drift between the dev/demo seed's
// AREA rows (event 1) and store.CanonicalAreas — the Go list every new event is
// auto-populated from. Both must stay identical (same slugs, names, and order)
// so a seeded dev event and a freshly-created prod event have the same areas.
func TestSeedAreasMatchCanonical(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	database := rand.Text()
	username := rand.Text()
	password := rand.Text()

	_, db := newUnmigratedDB(t, ctx, database, username, password)
	defer shut(db)

	require.NoError(t, store.MigrateDB(ctx, db))
	require.NoError(t, store.Seed(ctx, db, conf.SeedDemo))

	rows, err := db.QueryContext(ctx,
		"select SLUG, NAME, SORT_ORDER from AREA where EVENT = 1 order by SORT_ORDER")
	require.NoError(t, err)
	defer func() { require.NoError(t, rows.Close()) }()

	type seededArea struct {
		slug, name string
		sortOrder  int
	}
	var seeded []seededArea
	for rows.Next() {
		var a seededArea
		require.NoError(t, rows.Scan(&a.slug, &a.name, &a.sortOrder))
		seeded = append(seeded, a)
	}
	require.NoError(t, rows.Err())

	require.Len(t, seeded, len(store.CanonicalAreas),
		"dev seed area count must match store.CanonicalAreas")
	for i, want := range store.CanonicalAreas {
		assert.Equal(t, want.Slug, seeded[i].slug, "slug at index %d", i)
		assert.Equal(t, want.Name, seeded[i].name, "name at index %d", i)
		assert.Equal(t, i, seeded[i].sortOrder, "sort order at index %d", i)
	}
}

func rowCount(t *testing.T, ctx context.Context, db *sql.DB, table string) int {
	t.Helper()
	var count int
	err := db.QueryRowContext(ctx, "select count(*) from `"+table+"`").Scan(&count)
	require.NoError(t, err)
	return count
}
