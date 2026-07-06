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
	"net/http"
	"slices"
	"testing"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// bobPersonID is a person seeded by imsPeopleTestSeed (BobTestRanger); crew
// membership references PERSON directly, so a seeded person id is enough.
const (
	bobPersonID   = 6002
	bobHandle     = "BobTestRanger"
	carolPersonID = 6003
)

func findCrew(crews imsjson.Crews, slug string) (imsjson.Crew, bool) {
	idx := slices.IndexFunc(crews, func(c imsjson.Crew) bool { return c.Slug == slug })
	if idx < 0 {
		return imsjson.Crew{}, false
	}
	return crews[idx], true
}

// TestCreateAndListCrews verifies an admin can create a crew and read it back.
// Unlike areas, a new event starts with no crews (no seed/inherit), so the counts
// are exact.
func TestCreateAndListCrews(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	apis := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, apis)

	before, resp := apis.getCrews(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Empty(t, before, "a new event starts with no crews")

	name := "Green Dot"
	slug, resp := apis.editCrew(ctx, eventName, imsjson.Crew{Name: &name})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	assert.Equal(t, "green-dot", slug)

	crews, resp := apis.getCrews(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Len(t, crews, 1)
	got, ok := findCrew(crews, "green-dot")
	require.True(t, ok)
	assert.Equal(t, name, *got.Name)
	assert.Empty(t, got.Members, "a new crew has no members")
}

// TestCrewMembershipAndLeaders exercises add-member, toggle-leader, and
// remove-member on a crew.
func TestCrewMembershipAndLeaders(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	apis := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, apis)

	name := "Gate Crew"
	slug, resp := apis.editCrew(ctx, eventName, imsjson.Crew{Name: &name})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Add Bob as a plain member.
	_, resp = apis.editCrew(ctx, eventName, imsjson.Crew{
		Slug:   slug,
		Member: &imsjson.CrewMemberEdit{PersonID: bobPersonID},
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	crews, resp := apis.getCrews(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	crew, ok := findCrew(crews, slug)
	require.True(t, ok)
	require.Len(t, crew.Members, 1)
	assert.EqualValues(t, bobPersonID, crew.Members[0].PersonID)
	assert.Equal(t, bobHandle, crew.Members[0].Handle)
	assert.False(t, crew.Members[0].IsLeader)

	// Promote Bob to leader.
	_, resp = apis.editCrew(ctx, eventName, imsjson.Crew{
		Slug:   slug,
		Member: &imsjson.CrewMemberEdit{PersonID: bobPersonID, IsLeader: true},
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	crews, resp = apis.getCrews(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	crew, _ = findCrew(crews, slug)
	require.Len(t, crew.Members, 1, "promoting an existing member does not duplicate the row")
	assert.True(t, crew.Members[0].IsLeader)

	// Remove Bob.
	_, resp = apis.editCrew(ctx, eventName, imsjson.Crew{
		Slug:   slug,
		Member: &imsjson.CrewMemberEdit{PersonID: bobPersonID, Remove: true},
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	crews, resp = apis.getCrews(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	crew, _ = findCrew(crews, slug)
	assert.Empty(t, crew.Members)
}

// TestCrewRenameKeepsSlug verifies a rename updates the name but not the slug.
func TestCrewRenameKeepsSlug(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	apis := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, apis)

	orig := "Sanitation"
	slug, resp := apis.editCrew(ctx, eventName, imsjson.Crew{Name: &orig})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, "sanitation", slug)

	renamed := "Sanitation & Recycling"
	_, resp = apis.editCrew(ctx, eventName, imsjson.Crew{Slug: slug, Name: &renamed})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	crews, resp := apis.getCrews(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	got, ok := findCrew(crews, "sanitation")
	require.True(t, ok, "slug is immutable across a rename")
	assert.Equal(t, renamed, *got.Name)
}

// TestCrewDeleteRemovesMembership verifies deleting a crew also clears its
// membership rows (the FK would otherwise block the delete).
func TestCrewDeleteRemovesMembership(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	apis := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, apis)

	name := "Recycling"
	slug, resp := apis.editCrew(ctx, eventName, imsjson.Crew{Name: &name})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	_, resp = apis.editCrew(ctx, eventName, imsjson.Crew{
		Slug:   slug,
		Member: &imsjson.CrewMemberEdit{PersonID: carolPersonID, IsLeader: true},
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	_, resp = apis.editCrew(ctx, eventName, imsjson.Crew{Slug: slug, Delete: true})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	crews, resp := apis.getCrews(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, ok := findCrew(crews, slug)
	assert.False(t, ok, "the crew (and its membership) is gone")
}

// TestCrewRequiresAdmin verifies both reading and writing crews are admin-only.
func TestCrewRequiresAdmin(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	admin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, admin)

	alice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	// A non-admin cannot read the crew roster.
	_, resp := alice.getCrews(ctx, eventName)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// A non-admin cannot create a crew.
	name := "Sneaky Crew"
	slug, resp := alice.editCrew(ctx, eventName, imsjson.Crew{Name: &name})
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	assert.Empty(t, slug)

	crews, resp := admin.getCrews(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	assert.Empty(t, crews, "the forbidden create added nothing")
}

// TestCrewAddMemberBadPerson verifies adding a non-existent person is a friendly
// 404 rather than a 500 from the raw FK violation.
func TestCrewAddMemberBadPerson(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	apis := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, apis)

	name := "Medical"
	slug, resp := apis.editCrew(ctx, eventName, imsjson.Crew{Name: &name})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	_, resp = apis.editCrew(ctx, eventName, imsjson.Crew{
		Slug:   slug,
		Member: &imsjson.CrewMemberEdit{PersonID: 999999},
	})
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}
