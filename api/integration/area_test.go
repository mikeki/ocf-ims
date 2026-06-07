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

	// The slug is derived from the name.
	name := "Chela Mela"
	slug, resp := apis.editArea(ctx, eventName, imsjson.Area{Name: &name})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	assert.Equal(t, "chela-mela", slug)

	areas, resp := apis.getAreas(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	got, ok := findArea(areas, "chela-mela")
	require.True(t, ok)
	assert.Equal(t, name, *got.Name)
	assert.Nil(t, got.ParentSlug)
	assert.Equal(t, int32(0), *got.SortOrder)
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

	name := "Dragon Plaza"
	slug, resp := apis.editArea(ctx, eventName, imsjson.Area{Name: &name})
	require.NoError(t, resp.Body.Close())
	require.Equal(t, "dragon-plaza", slug)

	// Renaming changes the display name but not the immutable slug.
	newName := "The Dragon's Plaza"
	_, resp = apis.editArea(ctx, eventName, imsjson.Area{Slug: slug, Name: &newName})
	require.NoError(t, resp.Body.Close())

	areas, resp := apis.getAreas(ctx, eventName)
	require.NoError(t, resp.Body.Close())
	got, ok := findArea(areas, "dragon-plaza")
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

func TestAreaRequiresNameOnCreate(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	apis := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, apis)

	_, resp := apis.editArea(ctx, eventName, imsjson.Area{})
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}
