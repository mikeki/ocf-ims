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
// fresh database: the first event is seeded from the canonical list, the next
// event copies the previous event's areas, and an admin's edit to one event is
// carried forward into the event created after it.
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

	// Second event: inherits the first event's areas verbatim.
	ev2 := mkEvent("E2")
	require.NoError(t, dbq.PopulateNewEventAreas(ctx, ev2))
	areas2, err := dbq.Areas(ctx, db, ev2)
	require.NoError(t, err)
	require.Len(t, areas2, len(areas1))
	for i := range areas1 {
		assert.Equal(t, areas1[i].Slug, areas2[i].Slug)
		assert.Equal(t, areas1[i].Name, areas2[i].Name)
		assert.Equal(t, areas1[i].SortOrder, areas2[i].SortOrder)
	}

	// An admin adds an area to the second event.
	require.NoError(t, dbq.CreateArea(ctx, db, imsdb.CreateAreaParams{
		Event:      ev2,
		Slug:       "extra-spot",
		Name:       "Extra Spot",
		ParentSlug: sql.NullString{},
		SortOrder:  int32(len(store.CanonicalAreas)),
	}))

	// Third event: inherits from the most recent area-bearing event (ev2),
	// including the admin's edit.
	ev3 := mkEvent("E3")
	require.NoError(t, dbq.PopulateNewEventAreas(ctx, ev3))
	areas3, err := dbq.Areas(ctx, db, ev3)
	require.NoError(t, err)
	require.Len(t, areas3, len(store.CanonicalAreas)+1)
	var found bool
	for _, a := range areas3 {
		if a.Slug == "extra-spot" {
			found = true
			assert.Equal(t, "Extra Spot", a.Name)
		}
	}
	assert.True(t, found, "the edit made to ev2 should carry forward into ev3")
}
