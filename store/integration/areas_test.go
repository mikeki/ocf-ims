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
	"crypto/rand"
	"database/sql"
	"testing"

	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestPopulateNewEventAreas verifies the seed-once-then-inherit behavior on a
// fresh database: the first event is seeded from the canonical list, an admin's
// edits to it (a new area added, an existing area renamed) are carried forward
// into the next event, and inheritance then chains to a third event.
func TestPopulateNewEventAreas(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	_, db := newUnmigratedDB(t, ctx, rand.Text(), rand.Text(), rand.Text())
	defer shut(db)
	require.NoError(t, store.MigrateDB(ctx, db))

	dbq := store.NewDBQ(db, imsdb.New())
	mkEvent := func(name string) int32 {
		id, err := dbq.CreateEvent(ctx, db, imsdb.CreateEventParams{Name: name})
		require.NoError(t, err)
		return int32(id)
	}
	areaBySlug := func(areas []imsdb.Area, slug string) (imsdb.Area, bool) {
		for _, a := range areas {
			if a.Slug == slug {
				return a, true
			}
		}
		return imsdb.Area{}, false
	}

	// First event: no predecessor, so it is seeded from the canonical list.
	ev1 := mkEvent("E1")
	require.NoError(t, dbq.PopulateNewEventAreas(ctx, ev1))
	areas1, err := dbq.Areas(ctx, db, ev1)
	require.NoError(t, err)
	require.Len(t, areas1, len(store.CanonicalAreas))
	for i, want := range store.CanonicalAreas {
		assert.Equal(t, want.Slug, areas1[i].Slug)
		assert.Equal(t, want.Name, areas1[i].Name)
		assert.False(t, areas1[i].ParentSlug.Valid, "canonical areas are flat")
		assert.Equal(t, int32(i), areas1[i].SortOrder)
	}

	// An admin edits event 1: add a brand-new area, and rename an existing one
	// (slug is immutable, only the display name changes).
	require.NoError(t, dbq.CreateArea(ctx, db, imsdb.CreateAreaParams{
		Event:      ev1,
		Slug:       "extra-spot",
		Name:       "Extra Spot",
		ParentSlug: sql.NullString{},
		SortOrder:  int32(len(store.CanonicalAreas)),
	}))
	const renamedSlug = "chela-mela"
	const renamedName = "Chela Mela (Renamed)"
	orig, ok := areaBySlug(areas1, renamedSlug)
	require.True(t, ok)
	require.NoError(t, dbq.UpdateArea(ctx, db, imsdb.UpdateAreaParams{
		Name:       renamedName,
		ParentSlug: orig.ParentSlug,
		SortOrder:  orig.SortOrder,
		Event:      ev1,
		Slug:       renamedSlug,
	}))

	// Second event: inherits event 1's *current* set, including both edits.
	ev2 := mkEvent("E2")
	require.NoError(t, dbq.PopulateNewEventAreas(ctx, ev2))
	areas2, err := dbq.Areas(ctx, db, ev2)
	require.NoError(t, err)
	require.Len(t, areas2, len(store.CanonicalAreas)+1)

	added, ok := areaBySlug(areas2, "extra-spot")
	require.True(t, ok, "the area added to event 1 should be inherited")
	assert.Equal(t, "Extra Spot", added.Name)

	renamed, ok := areaBySlug(areas2, renamedSlug)
	require.True(t, ok)
	assert.Equal(t, renamedName, renamed.Name, "the rename made to event 1 should be inherited")

	// Third event: inheritance chains from the most recent area-bearing event.
	ev3 := mkEvent("E3")
	require.NoError(t, dbq.PopulateNewEventAreas(ctx, ev3))
	areas3, err := dbq.Areas(ctx, db, ev3)
	require.NoError(t, err)
	require.Len(t, areas3, len(store.CanonicalAreas)+1)
	chained, ok := areaBySlug(areas3, renamedSlug)
	require.True(t, ok)
	assert.Equal(t, renamedName, chained.Name)
}
