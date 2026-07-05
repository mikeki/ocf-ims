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
	"testing"

	"github.com/mikeki/ocf-ims/api"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
)

// TestDefaultPasswordCreate covers granting IMS access with the shared default
// password (IMS_DEFAULT_PASSWORD_HASH) rather than a typed one. The created person
// can immediately log in with the default, and the access invariants (fair name +
// email) still hold on this path.
func TestDefaultPasswordCreate(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisNoAuth := ApiHelper{t: t, serverURL: shared.serverURL}

	handle := "DefaultPw" + rand.NonCryptoText()
	email := handle + "@example.com"

	// Grant access using the shared default password (no password field supplied).
	resp := apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		Handle:             handle,
		Email:              email,
		UseDefaultPassword: true,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var created imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&created))
	require.NoError(t, resp.Body.Close())

	// The new person can sign in with the shared default password (the cache was
	// invalidated on create, so this is effective immediately).
	statusCode, _, token := apisNoAuth.postAuth(ctx, api.PostAuthRequest{
		Identification: email,
		Password:       sharedDefaultPassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
	require.NotEmpty(t, token)

	// Default-password access still requires a fair name (the operational identity)...
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		Name:               "No Handle",
		UseDefaultPassword: true,
	})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// ...and an email (the login identifier).
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		Handle:             "NoEmail" + rand.NonCryptoText(),
		UseDefaultPassword: true,
	})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

// TestSetPersonPasswordDefault covers resetting an existing person to the shared
// default password: after the reset they can log in with the default and their old
// specific password stops working.
func TestSetPersonPasswordDefault(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisNoAuth := ApiHelper{t: t, serverURL: shared.serverURL}

	const initialPassword = "a-specific-initial-password"
	handle := "ResetToDefault" + rand.NonCryptoText()
	email := handle + "@example.com"

	// A login-capable person created with a specific password...
	resp := apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		Handle:   handle,
		Email:    email,
		Password: initialPassword,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var created imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&created))
	require.NoError(t, resp.Body.Close())

	// ...is reset to the shared default.
	resp = apisAdmin.setPersonPasswordDefault(ctx, created.PersonID)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// They can now log in with the shared default...
	statusCode, _, token := apisNoAuth.postAuth(ctx, api.PostAuthRequest{
		Identification: email,
		Password:       sharedDefaultPassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
	require.NotEmpty(t, token)

	// ...and the old specific password no longer works.
	statusCode, _, _ = apisNoAuth.postAuth(ctx, api.PostAuthRequest{
		Identification: email,
		Password:       initialPassword,
	})
	require.Equal(t, http.StatusUnauthorized, statusCode)
}
