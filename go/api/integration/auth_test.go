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
	"testing"
	"time"

	"connectrpc.com/connect"
	servicerpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/gen/ocf/ims/service/v1/servicev1connect"
	authapi "github.com/mikeki/ocf-ims/internal/auth"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPostAuthAPIAuthorization(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisNotAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}

	// A user who doesn't exist gets s 401
	statusCode, body, token := apisNotAuthenticated.postAuth(ctx, authapi.PostAuthRequest{
		Identification: "Not a real user",
		Password:       "password123",
	})
	require.Equal(t, http.StatusUnauthorized, statusCode)
	require.Contains(t, body, "bad credentials")
	require.Empty(t, token)

	// A user with the correct password gets logged in and gets a JWT
	statusCode, _, token = apisNotAuthenticated.postAuth(ctx,
		authapi.PostAuthRequest{
			Identification: userAliceEmail,
			Password:       userAlicePassword,
		},
	)
	require.Equal(t, http.StatusOK, statusCode)
	require.NotEmpty(t, token)

	// Login is by EMAIL only: the fair name (handle) is no longer accepted as a login
	// identifier, so logging in with it is rejected like any unknown user.
	statusCode, _, token = apisNotAuthenticated.postAuth(ctx, authapi.PostAuthRequest{
		Identification: userAliceHandle,
		Password:       userAlicePassword,
	})
	require.Equal(t, http.StatusUnauthorized, statusCode)
	require.Empty(t, token)

	// A valid user (matched by email) with the wrong password gets denied entry
	statusCode, body, token = apisNotAuthenticated.postAuth(ctx, authapi.PostAuthRequest{
		Identification: userAliceEmail,
		Password:       "not my password",
	})
	require.Equal(t, http.StatusUnauthorized, statusCode)
	require.Contains(t, body, "bad credentials")
	require.Empty(t, token)
}

func TestGetAuthAPIAuthorization(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisNonAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	apisNotAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}

	// non-admin user can authenticate
	getAuth, resp := apisNonAdmin.getAuth(ctx, "")
	require.NotNil(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Equal(t, authapi.GetAuthResponse{
		Authenticated: true,
		User:          userAliceHandle,
		PersonID:      userAlicePersonID,
		Admin:         false,
	}, getAuth)
	require.NoError(t, resp.Body.Close())

	// admin user can authenticate
	getAuth, resp = apisAdmin.getAuth(ctx, "")
	require.NotNil(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Equal(t, authapi.GetAuthResponse{
		Authenticated:      true,
		User:               userAdminHandle,
		PersonID:           userAdminPersonID,
		Admin:              true,
		CanManagePersonnel: true,
	}, getAuth)
	require.NoError(t, resp.Body.Close())

	// unauthenticated client cannot authenticate
	getAuth, resp = apisNotAuthenticated.getAuth(ctx, "someNonExistentEvent")
	require.NotNil(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Equal(t, authapi.GetAuthResponse{
		Authenticated: false,
	}, getAuth)
	require.NoError(t, resp.Body.Close())
}

func TestGetAuthWithEvent(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}

	// create an event. The admin needs no per-event role: admins bypass per-event
	// checks (plan 52b), so getAuth reports full access on any event.
	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{
		Name: &eventName,
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	authResp, resp := apisAdmin.getAuth(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	eventID := authResp.EventAccess[eventName].EventID
	require.NotZero(t, eventID)
	require.Equal(t, authapi.GetAuthResponse{
		Authenticated:      true,
		User:               userAdminHandle,
		PersonID:           userAdminPersonID,
		Admin:              true,
		CanManagePersonnel: true,
		EventAccess: map[string]authapi.AccessForEvent{
			eventName: {
				EventID:         eventID,
				ReadIncidents:   true,
				WriteIncidents:  true,
				WriteReports:    true,
				ReadVisits:      true,
				WriteVisits:     true,
				AttachFiles:     true,
				ReadAreas:       true,
				InviteReporters: true,
			},
		},
	}, authResp)
	require.NoError(t, resp.Body.Close())
}

// TestGetAuthWithMissingEvent covers requesting event access for an event that doesn't exist.
// Under the numeric-id contract the caller passes an event id; a non-existent one is deliberately
// NOT a 404 — GetAuthStatus returns an all-false access entry so the caller can't distinguish "no
// such event" from "no access" (ported from REST). (The REST endpoint's name-validation 400 for a
// malformed event NAME has no analogue now that the event is addressed by id, so that case is
// dropped with the route.)
func TestGetAuthWithMissingEvent(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}

	// getAuth resolves an unknown name to a sentinel id that no event has, exercising the
	// server's "event might exist, but no access" branch.
	gar, httpResp := apisAdmin.getAuth(ctx, "ThisEventDoesNotExist")
	assert.Equal(t, http.StatusOK, httpResp.StatusCode)
	require.NoError(t, httpResp.Body.Close())
	assert.Contains(t, gar.EventAccess, "ThisEventDoesNotExist")
	assert.Equal(t, authapi.AccessForEvent{
		ReadIncidents:  false,
		WriteIncidents: false,
		WriteReports:   false,
		ReadVisits:     false,
		WriteVisits:    false,
		AttachFiles:    false,
	}, gar.EventAccess["ThisEventDoesNotExist"])
}

// TestPostAuthMakesRefreshCookie exercises the login → refresh-cookie → refresh round trip over
// Connect. Login (ImsService.Login) sets the HttpOnly refresh cookie on its RPC response header,
// which the client reads back to drive RefreshToken. (The REST POST /auth that carried this in a
// plain HTTP Set-Cookie was retired in slice 1c.)
func TestPostAuthMakesRefreshCookie(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	client := servicev1connect.NewImsServiceClient(http.DefaultClient, shared.serverURL.String())

	// A user with the correct password can log in and get access + refresh tokens.
	loginResp, err := client.Login(ctx, connect.NewRequest(&servicerpcv1.LoginRequest{
		Email:    userAliceEmail,
		Password: userAlicePassword,
	}))
	require.NoError(t, err)

	// check that the returned access token looks good
	jwter := authz.JWTer{SecretKey: shared.cfg.Core.JWTSecret}
	claims, err := jwter.AuthenticateJWT(loginResp.Msg.GetToken())
	require.NoError(t, err)
	require.Equal(t, userAliceHandle, claims.PersonHandle())
	loginExpiryMs := loginResp.Msg.GetExpiresAt().AsTime().UnixMilli()
	require.Greater(t, loginExpiryMs, time.Now().UnixMilli())

	// check that the refresh token was shipped over by cookie (Set-Cookie on the RPC response)
	cookie, err := http.ParseSetCookie(loginResp.Header().Get("Set-Cookie"))
	require.NoError(t, err)
	require.True(t, cookie.HttpOnly)
	require.True(t, cookie.Secure)
	// and that it's valid
	claims, err = jwter.AuthenticateRefreshToken(cookie.Value)
	require.NoError(t, err)
	require.Equal(t, userAliceHandle, claims.PersonHandle())

	// now use the refresh token to get a fresh access token
	apisNotAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL}
	code, refreshResp := apisNotAuthenticated.refreshAccessToken(ctx, cookie)
	require.Equal(t, http.StatusOK, code)
	// and confirm the new access token's validity
	claims, err = jwter.AuthenticateJWT(refreshResp.Token)
	require.NoError(t, err)
	require.Equal(t, userAliceHandle, claims.PersonHandle())
	// this new token should expire no earlier than the old one
	require.GreaterOrEqual(t, refreshResp.ExpiresUnixMs, loginExpiryMs)
}
