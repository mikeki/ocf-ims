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

	"github.com/mikeki/ocf-ims/api"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/stretchr/testify/require"
)

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
	require.NoError(t, resp.Body.Close())

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
	resp = apisAdmin.editPerson(ctx, "NoSuchPersonHandle", api.EditPersonRequest{Status: "active"})
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.editPerson(ctx, newHandle, api.EditPersonRequest{Status: "bogus"})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Deactivate the person: now they can no longer log in (the login directory is
	// active-only) but still appear in the admin listing as inactive.
	resp = apisAdmin.editPerson(ctx, newHandle, api.EditPersonRequest{Status: "inactive"})
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
	resp = apisAdmin.editPerson(ctx, newHandle, api.EditPersonRequest{Status: "active", Onsite: true})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	statusCode, _, _ = apisNoAuth.postAuth(ctx, api.PostAuthRequest{
		Identification: newHandle,
		Password:       newPassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
}
