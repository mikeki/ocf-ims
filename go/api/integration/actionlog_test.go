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

	authapi "github.com/mikeki/ocf-ims/internal/auth"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetActionLog(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	referrer := "testGetActionLog"
	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t), referrer: referrer}

	// Generate one action-logged request carrying this test's unique Referer to read back.
	// A login (POST /auth) is still REST and action-logged (LogRequest(true)) and — being a
	// raw imsPost — carries the Referer the getActionLogs read filters on. The former fixture,
	// GET /auth, is now the GetAuthStatus RPC: a NO_SIDE_EFFECTS read the action-log interceptor
	// deliberately skips, so it can no longer serve as a logged fixture.
	statusCode, _, _ := apisAdmin.postAuth(ctx, authapi.PostAuthRequest{
		Identification: userAdminEmail,
		Password:       userAdminPassword,
	})
	require.Equal(t, http.StatusOK, statusCode)

	longAgo := time.Now().Add(-500 * time.Hour).UnixMilli()
	longFromNow := time.Now().Add(500 * time.Hour).UnixMilli()
	logs, response := apisAdmin.getActionLogs(ctx, conv.FormatInt(longAgo), conv.FormatInt(longFromNow))
	require.NotNil(t, response)
	require.Equal(t, http.StatusOK, response.StatusCode)
	require.NoError(t, response.Body.Close())

	var foundLog imsjson.ActionLog
	for _, al := range logs {
		if al.Referrer == referrer {
			foundLog = al
		}
	}
	assert.NotZero(t, foundLog)
	assert.Equal(t, "/ims/api/auth", foundLog.Path)
	assert.Equal(t, "POST", foundLog.Method)

	// Now test error cases
	_, response = apisAdmin.getActionLogs(ctx, "not a valid time", "")
	require.NotNil(t, response)
	require.Equal(t, http.StatusBadRequest, response.StatusCode)
	require.NoError(t, response.Body.Close())
	_, response = apisAdmin.getActionLogs(ctx, "", "not a valid time")
	require.NotNil(t, response)
	require.Equal(t, http.StatusBadRequest, response.StatusCode)
	require.NoError(t, response.Body.Close())
}
