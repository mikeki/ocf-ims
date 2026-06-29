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
	"net/http"
	"slices"
	"testing"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// makeEvent creates a fresh event and returns its name.
func makeEvent(ctx context.Context, t *testing.T, apis ApiHelper) string {
	t.Helper()
	eventName := rand.NonCryptoText()
	_, resp := apis.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	return eventName
}

func findArea(areas imsjson.Areas, slug string) (imsjson.Area, bool) {
	idx := slices.IndexFunc(areas, func(a imsjson.Area) bool { return a.Slug == slug })
	if idx < 0 {
		return imsjson.Area{}, false
	}
	return areas[idx], true
}

func TestCreateAndListAreas(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	apis := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, apis)

	// A new event already starts with a populated area set (seeded or inherited),
	// so assert on the delta. Use a name outside the canonical list to avoid a
	// slug collision with the starting set.
	before, resp := apis.getAreas(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	name := "Test Camp Zeta"
	slug, resp := apis.editArea(ctx, eventName, imsjson.Area{Name: &name})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	assert.Equal(t, "test-camp-zeta", slug)

	areas, resp := apis.getAreas(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	got, ok := findArea(areas, "test-camp-zeta")
	require.True(t, ok)
	assert.Equal(t, name, *got.Name)
	assert.Nil(t, got.ParentSlug)
	assert.Len(t, areas, len(before)+1, "exactly one area added")
}

// TestNewEventHasAreas verifies the event-create handler populates a new event
// with a non-empty area set end-to-end (the first event is seeded from the
// canonical list; later events inherit — the deterministic content of each path
// is covered by store/integration TestPopulateNewEventAreas). The shared suite
// DB is mutated in parallel, so this asserts the wiring, not exact contents.
func TestNewEventHasAreas(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	apis := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, apis)

	areas, resp := apis.getAreas(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	assert.NotEmpty(t, areas, "a new event should start with a populated area set")
}

// TestNewEventGroupHasNoAreas verifies that an event *group* (a container) is
// not populated with areas — only real events are.
func TestNewEventGroupHasNoAreas(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	apis := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}

	groupName := rand.NonCryptoText()
	isGroup := true
	_, resp := apis.createEvent(ctx, imsjson.Event{Name: &groupName, IsGroup: &isGroup})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	areas, resp := apis.getAreas(ctx, groupName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	assert.Empty(t, areas)
}

func TestAreaSlugCollision(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	apis := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, apis)

	name := "Main Camp"
	slug1, resp := apis.editArea(ctx, eventName, imsjson.Area{Name: &name})
	require.NoError(t, resp.Body.Close())
	slug2, resp := apis.editArea(ctx, eventName, imsjson.Area{Name: &name})
	require.NoError(t, resp.Body.Close())

	assert.Equal(t, "main-camp", slug1)
	assert.Equal(t, "main-camp-2", slug2)
}

func TestAreaRenameKeepsSlug(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	apis := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, apis)

	// Use a name outside the canonical list so the slug is collision-free.
	name := "Testy Plaza"
	slug, resp := apis.editArea(ctx, eventName, imsjson.Area{Name: &name})
	require.NoError(t, resp.Body.Close())
	require.Equal(t, "testy-plaza", slug)

	// Renaming changes the display name but not the immutable slug.
	newName := "The Testy Plaza"
	_, resp = apis.editArea(ctx, eventName, imsjson.Area{Slug: slug, Name: &newName})
	require.NoError(t, resp.Body.Close())

	areas, resp := apis.getAreas(ctx, eventName)
	require.NoError(t, resp.Body.Close())
	got, ok := findArea(areas, "testy-plaza")
	require.True(t, ok)
	assert.Equal(t, newName, *got.Name)
}

func TestAreaHierarchy(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	apis := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, apis)

	parentName := "White Bird"
	parentSlug, resp := apis.editArea(ctx, eventName, imsjson.Area{Name: &parentName})
	require.NoError(t, resp.Body.Close())

	// A child referencing a valid top-level parent is accepted.
	childName := "Big Bird"
	childSlug, resp := apis.editArea(ctx, eventName,
		imsjson.Area{Name: &childName, ParentSlug: &parentSlug})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	areas, resp := apis.getAreas(ctx, eventName)
	require.NoError(t, resp.Body.Close())
	child, ok := findArea(areas, childSlug)
	require.True(t, ok)
	require.NotNil(t, child.ParentSlug)
	assert.Equal(t, parentSlug, *child.ParentSlug)

	// An unknown parent is rejected.
	bogus := "does-not-exist"
	orphanName := "Little Wing"
	_, resp = apis.editArea(ctx, eventName,
		imsjson.Area{Name: &orphanName, ParentSlug: &bogus})
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Nesting under a child (second level) is rejected: single-level only.
	grandchildName := "Tiny Bird"
	_, resp = apis.editArea(ctx, eventName,
		imsjson.Area{Name: &grandchildName, ParentSlug: &childSlug})
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// An area may not be made its own parent.
	_, resp = apis.editArea(ctx, eventName,
		imsjson.Area{Slug: parentSlug, ParentSlug: &parentSlug})
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

// TestAreaMutationRequiresAdmin verifies that a user with no write access to the
// event cannot create or edit areas. Creating an area is allowed for incident
// editors (see TestAreaCreateAllowedForEventWriter); editing an existing area
// stays gated by GlobalAdministrateAreas, which only Administrators hold.
func TestAreaMutationRequiresAdmin(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	admin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, admin)

	// Baseline area count for this event (the starting populated set).
	before, resp := admin.getAreas(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Alice is a regular (non-admin) user with no access to this event.
	alice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	name := "Sneaky Area"
	slug, resp := alice.editArea(ctx, eventName, imsjson.Area{Name: &name})
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	assert.Empty(t, slug)

	// The forbidden request added no area: count is unchanged and "sneaky-area"
	// is absent.
	areas, resp := admin.getAreas(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	assert.Len(t, areas, len(before))
	_, ok := findArea(areas, "sneaky-area")
	assert.False(t, ok, "the forbidden create must not have added an area")
}

// TestAreaCreateAllowedForEventWriter verifies that an event writer (a Ranger
// who can edit incidents) may create a new area on the fly, but still may not
// edit an existing area (that remains admin-only).
func TestAreaCreateAllowedForEventWriter(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	admin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, admin)

	// Grant Alice write access to the event, then re-auth so her JWT carries it.
	resp := admin.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	alice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	// Baseline area count for this event (the starting populated set).
	before, resp := admin.getAreas(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// She can create a new area (a name outside the canonical list).
	name := "Found Spot"
	slug, resp := alice.editArea(ctx, eventName, imsjson.Area{Name: &name})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, "found-spot", slug)

	// The area is visible to everyone with the event (added to the starting set).
	areas, resp := admin.getAreas(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Len(t, areas, len(before)+1)
	_, ok := findArea(areas, slug)
	assert.True(t, ok)

	// But she may not rename it — editing an existing area is still admin-only.
	newName := "Renamed Spot"
	_, resp = alice.editArea(ctx, eventName, imsjson.Area{Slug: slug, Name: &newName})
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

func TestAreaRequiresNameOnCreate(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	apis := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, apis)

	_, resp := apis.editArea(ctx, eventName, imsjson.Area{})
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}
