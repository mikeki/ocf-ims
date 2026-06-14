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
	"encoding/json"
	"net/http"
	"slices"
	"testing"

	"github.com/mikeki/ocf-ims/api"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
)

// findPerson returns the listing entry with the given person_id, failing the test
// if it isn't present.
func findPerson(t *testing.T, people []imsjson.Person, personID int64) imsjson.Person {
	t.Helper()
	i := slices.IndexFunc(people, func(p imsjson.Person) bool { return p.PersonID == personID })
	require.GreaterOrEqual(t, i, 0, "person %d not found in listing", personID)
	return people[i]
}

// TestCreateAndEditPerson exercises in-app person creation and status/on-site
// editing: permission gating, validation, the duplicate-handle guard, that a
// created person can log in, and that deactivating removes a person from the
// login directory while reactivating restores them. It uses dedicated handles so
// it doesn't disturb other parallel tests.
func TestCreateAndEditPerson(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	apisNoAuth := ApiHelper{t: t, serverURL: shared.serverURL}

	const newHandle = "EdithTestRanger"
	const newPassword = "edith-password"

	// A non-admin (no GlobalAdministratePersonnel) cannot create people.
	resp := apisAlice.createPerson(ctx, api.CreatePersonRequest{Handle: newHandle, Password: newPassword})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Validation: empty handle and too-short password are rejected.
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{Handle: ""})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{Handle: newHandle, Password: "short"})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The admin creates the person.
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		Handle:   newHandle,
		Email:    "edithtestranger@example.com",
		Password: newPassword,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	// Create returns the new person (with its server-assigned person_id), which is
	// the URL key for the edits below.
	var created imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&created))
	require.NoError(t, resp.Body.Close())
	require.Positive(t, created.PersonID)
	newPersonID := created.PersonID

	// Creating the same handle again is a conflict.
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{Handle: newHandle, Password: newPassword})
	require.Equal(t, http.StatusConflict, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The new (active) person shows up in the admin listing...
	people, resp := apisAdmin.getAllPersonnel(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.True(t, slices.ContainsFunc(people, func(p imsjson.Person) bool {
		return p.Handle == newHandle && p.Status == "active"
	}), "created person should appear active in the admin listing")

	// ...and can log in with the assigned password.
	statusCode, _, token := apisNoAuth.postAuth(ctx, api.PostAuthRequest{
		Identification: newHandle,
		Password:       newPassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
	require.NotEmpty(t, token)

	// Edit validation: unknown handle is 404, bad status is 400.
	resp = apisAdmin.editPerson(ctx, nonexistentPersonID, api.EditPersonRequest{Status: "active"})
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.editPerson(ctx, newPersonID, api.EditPersonRequest{Status: "bogus"})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Deactivate the person: now they can no longer log in (the login directory is
	// active-only) but still appear in the admin listing as inactive.
	resp = apisAdmin.editPerson(ctx, newPersonID, api.EditPersonRequest{Status: "inactive"})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	statusCode, _, _ = apisNoAuth.postAuth(ctx, api.PostAuthRequest{
		Identification: newHandle,
		Password:       newPassword,
	})
	require.Equal(t, http.StatusUnauthorized, statusCode)

	people, resp = apisAdmin.getAllPersonnel(ctx)
	require.NoError(t, resp.Body.Close())
	require.True(t, slices.ContainsFunc(people, func(p imsjson.Person) bool {
		return p.Handle == newHandle && p.Status == "inactive"
	}), "deactivated person should still appear (as inactive) in the admin listing")

	// Reactivate (and set on-site): login works again.
	resp = apisAdmin.editPerson(ctx, newPersonID, api.EditPersonRequest{Status: "active", Onsite: true})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	statusCode, _, _ = apisNoAuth.postAuth(ctx, api.PostAuthRequest{
		Identification: newHandle,
		Password:       newPassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
}

// TestEditPersonProfileAndParticipation exercises the 5e.4 admin People editor:
// editing name + email (the closed frozen-email gap), the per-event wristband +
// participation-type upsert and its event scoping, the wristband-uniqueness
// conflict, and the identity invariant for a handle-less registry person. It uses
// a dedicated event and dedicated handles so it doesn't disturb parallel tests.
func TestEditPersonProfileAndParticipation(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	// A dedicated event so this test's per-event participation rows don't collide
	// with any other test's wristbands.
	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// A login-capable person to edit.
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		Handle:   "FrankTestRanger",
		Email:    "frank@example.com",
		Password: "frank-password",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var frank imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&frank))
	require.NoError(t, resp.Body.Close())
	frankID := frank.PersonID

	// --- profile edit: name + email both change (the frozen-email gap is closed). ---
	newName := "Franklin Delano"
	newEmail := "franklin@example.com"
	resp = apisAdmin.editPerson(ctx, frankID, api.EditPersonRequest{
		Name: &newName, Email: &newEmail, Status: "active",
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	people, resp := apisAdmin.getAllPersonnelForEvent(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	got := findPerson(t, people, frankID)
	require.Equal(t, newName, got.Name)
	require.Equal(t, newEmail, got.Email)

	// --- per-event participation upsert, with name/email left unchanged (nil). ---
	resp = apisAdmin.editPerson(ctx, frankID, api.EditPersonRequest{
		Status: "active", Event: eventName, Wristband: "Z-9001", ParticipationType: "crew",
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	people, resp = apisAdmin.getAllPersonnelForEvent(ctx, eventName)
	require.NoError(t, resp.Body.Close())
	got = findPerson(t, people, frankID)
	require.Equal(t, "Z-9001", got.Wristband)
	require.Equal(t, "crew", got.ParticipationType)
	// The nil-pointer name/email were preserved, not cleared.
	require.Equal(t, newName, got.Name)
	require.Equal(t, newEmail, got.Email)

	// The per-event fields are scoped to the event: absent from the unscoped listing.
	peopleNoEvent, resp := apisAdmin.getAllPersonnel(ctx)
	require.NoError(t, resp.Body.Close())
	gotNoEvent := findPerson(t, peopleNoEvent, frankID)
	require.Empty(t, gotNoEvent.Wristband)
	require.Empty(t, gotNoEvent.ParticipationType)

	// --- wristband uniqueness within an event is a conflict. ---
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{Handle: "GraceTestRanger", Password: "grace-password"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var grace imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&grace))
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.editPerson(ctx, grace.PersonID, api.EditPersonRequest{
		Status: "active", Event: eventName, Wristband: "Z-9001", ParticipationType: "participant",
	})
	require.Equal(t, http.StatusConflict, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// --- identity invariant: a handle-less registry person can't have name cleared. ---
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{Name: "Registry Only", Event: eventName})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var registry imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&registry))
	require.NoError(t, resp.Body.Close())
	emptyName := ""
	resp = apisAdmin.editPerson(ctx, registry.PersonID, api.EditPersonRequest{Name: &emptyName, Status: "active"})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// --- gating: a non-admin can't edit a person. ---
	resp = apisAlice.editPerson(ctx, frankID, api.EditPersonRequest{Status: "active"})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}
