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

// TestSetPersonAdmin exercises the in-app IS_ADMIN toggle: permission gating,
// effective admin grant (via a fresh token), and the last-admin guard. Promotion
// and demotion run against the dedicated Carol user so they don't disturb other
// parallel tests. The last-admin guard is checked against AdminTestRanger (the
// only persistently-flagged admin, so it's the one the guard protects) — the
// guard returns 409 *without* writing, so AdminTestRanger stays an admin and
// other tests are unaffected.
func TestSetPersonAdmin(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	apisNoAuth := ApiHelper{t: t, serverURL: shared.serverURL}

	// A non-admin cannot set the admin flag.
	resp := apisAlice.setPersonAdmin(ctx, userCarolHandle, true)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// An unknown handle is a 404.
	resp = apisAdmin.setPersonAdmin(ctx, "NoSuchPersonHandle", true)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Carol is not an admin to start with: a fresh login reports admin=false.
	statusCode, _, carolToken := apisNoAuth.postAuth(ctx, api.PostAuthRequest{
		Identification: userCarolHandle,
		Password:       userCarolPassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
	apisCarol := ApiHelper{t: t, serverURL: shared.serverURL, jwt: carolToken}
	authResp, _ := apisCarol.getAuth(ctx, "")
	require.False(t, authResp.Admin)

	// The admin flags Carol as an administrator.
	resp = apisAdmin.setPersonAdmin(ctx, userCarolHandle, true)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The cache was invalidated, so a fresh login for Carol now carries admin in
	// the token and getAuth reports admin=true.
	statusCode, _, carolToken = apisNoAuth.postAuth(ctx, api.PostAuthRequest{
		Identification: userCarolHandle,
		Password:       userCarolPassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
	apisCarol = ApiHelper{t: t, serverURL: shared.serverURL, jwt: carolToken}
	authResp, _ = apisCarol.getAuth(ctx, "")
	require.True(t, authResp.Admin)

	// Clearing Carol is fine — AdminTestRanger remains an admin.
	resp = apisAdmin.setPersonAdmin(ctx, userCarolHandle, false)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Attempting to clear the last remaining admin (AdminTestRanger) is blocked
	// with 409 to avoid leaving the instance with no administrator. The guard
	// rejects before writing, so AdminTestRanger stays an admin.
	resp = apisAdmin.setPersonAdmin(ctx, userAdminHandle, false)
	require.Equal(t, http.StatusConflict, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}
