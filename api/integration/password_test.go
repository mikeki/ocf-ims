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

	"github.com/mikeki/ocf-ims/api"
	"github.com/stretchr/testify/require"
)

func TestSetPersonPassword(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	apisNoAuth := ApiHelper{t: t, serverURL: shared.serverURL}

	const newPassword = "a-brand-new-password"

	// A non-admin (lacking GlobalAdministratePersonnel) cannot set a password.
	resp := apisAlice.setPersonPassword(ctx, userBobHandle, newPassword)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// An unknown handle is a 404.
	resp = apisAdmin.setPersonPassword(ctx, "NoSuchPersonHandle", newPassword)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// A too-short password is rejected.
	resp = apisAdmin.setPersonPassword(ctx, userBobHandle, "short")
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The admin sets Bob's password.
	resp = apisAdmin.setPersonPassword(ctx, userBobHandle, newPassword)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Bob can now log in with the new password (cache was invalidated, so this is
	// effective immediately)...
	statusCode, _, token := apisNoAuth.postAuth(ctx, api.PostAuthRequest{
		Identification: userBobHandle,
		Password:       newPassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
	require.NotEmpty(t, token)

	// ...and the old password no longer works.
	statusCode, _, _ = apisNoAuth.postAuth(ctx, api.PostAuthRequest{
		Identification: userBobHandle,
		Password:       userBobInitialPassword,
	})
	require.Equal(t, http.StatusUnauthorized, statusCode)
}
