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
// password (IMS_DEFAULT_PASSWORD) rather than a typed one. The created person
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

// TestDefaultPasswordPromptAndSelfChange covers the post-login change-password flow:
// GET /auth flags a user still on the shared default, the self-service endpoint lets
// them replace it (no admin, no current-password required), and the flag then clears.
func TestDefaultPasswordPromptAndSelfChange(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisNoAuth := ApiHelper{t: t, serverURL: shared.serverURL}

	handle := "DefaultPrompt" + rand.NonCryptoText()
	email := handle + "@example.com"

	// A login-capable person on the shared default password.
	resp := apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		Handle:             handle,
		Email:              email,
		UseDefaultPassword: true,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// They log in with the default...
	statusCode, _, token := apisNoAuth.postAuth(ctx, api.PostAuthRequest{
		Identification: email,
		Password:       sharedDefaultPassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
	require.NotEmpty(t, token)
	apisUser := ApiHelper{t: t, serverURL: shared.serverURL, jwt: token}

	// ...and GET /auth flags that they're on the default.
	auth, resp := apisUser.getAuth(ctx, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.True(t, auth.UsingDefaultPassword)

	// The self-service endpoint requires authentication...
	resp = apisNoAuth.changeOwnPassword(ctx, "a-long-enough-password")
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// ...and enforces the minimum length.
	resp = apisUser.changeOwnPassword(ctx, "short")
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The user replaces the default with their own password.
	const newPassword = "my-own-strong-password"
	resp = apisUser.changeOwnPassword(ctx, newPassword)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The flag now clears (GET /auth recomputes it live against the stored hash).
	auth, resp = apisUser.getAuth(ctx, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.False(t, auth.UsingDefaultPassword)

	// The new password works; the shared default no longer does.
	statusCode, _, _ = apisNoAuth.postAuth(ctx, api.PostAuthRequest{Identification: email, Password: newPassword})
	require.Equal(t, http.StatusOK, statusCode)
	statusCode, _, _ = apisNoAuth.postAuth(ctx, api.PostAuthRequest{Identification: email, Password: sharedDefaultPassword})
	require.Equal(t, http.StatusUnauthorized, statusCode)

	// A user created with their own (non-default) password is flagged off the default
	// immediately (PASSWORD_CHANGED set on create), so it's never flagged.
	handle2 := "SpecificPw" + rand.NonCryptoText()
	email2 := handle2 + "@example.com"
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		Handle:   handle2,
		Email:    email2,
		Password: "a-specific-password",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, _, token2 := apisNoAuth.postAuth(ctx, api.PostAuthRequest{Identification: email2, Password: "a-specific-password"})
	require.NotEmpty(t, token2)
	apisUser2 := ApiHelper{t: t, serverURL: shared.serverURL, jwt: token2}
	auth2, resp := apisUser2.getAuth(ctx, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.False(t, auth2.UsingDefaultPassword)

	// A seeded user starts with PASSWORD_CHANGED=false but a non-default password —
	// the shape of a pre-existing/bulk-loaded account. GET /auth verifies once, finds
	// they're off the default, and must not flag them (and records it so it won't
	// re-verify). This exercises the lazy-heal path.
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	aliceAuth, resp := apisAlice.getAuth(ctx, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.False(t, aliceAuth.UsingDefaultPassword)
}

// TestSelfChangeRejectsDefault covers the guard that a self-service change may not set
// the password back to the shared default — otherwise the forced prompt could be
// "satisfied" while the user is still on the default.
func TestSelfChangeRejectsDefault(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisNoAuth := ApiHelper{t: t, serverURL: shared.serverURL}

	handle := "RejectDefault" + rand.NonCryptoText()
	email := handle + "@example.com"
	resp := apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		Handle:             handle,
		Email:              email,
		UseDefaultPassword: true,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	_, _, token := apisNoAuth.postAuth(ctx, api.PostAuthRequest{Identification: email, Password: sharedDefaultPassword})
	require.NotEmpty(t, token)
	apisUser := ApiHelper{t: t, serverURL: shared.serverURL, jwt: token}

	// "Changing" to the shared default is refused.
	resp = apisUser.changeOwnPassword(ctx, sharedDefaultPassword)
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// They're still on the default afterward.
	auth, resp := apisUser.getAuth(ctx, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.True(t, auth.UsingDefaultPassword)
}
