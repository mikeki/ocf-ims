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
	"strconv"
	"testing"

	resourcesv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/resources/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetActionLog(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	referrer := "testGetActionLog"
	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t), referrer: referrer}

	// Generate one action-logged request carrying this test's unique Referer to read back.
	// As the API migrates to Connect, the action-log interceptor records RPCs but captures no
	// Referer (that is a REST-only field), so an RPC can't serve as a Referer-keyed fixture (Login,
	// then createEvent, each stopped being one as they were extracted). The multipart
	// profile-picture upload (POST /personnel/{id}/picture) stays REST for the whole migration
	// (binary, M8), is action-logged (LogRequest(true)), and — as a raw request — carries the Referer
	// the getActionLogs read filters on, so it is the durable fixture. The admin uploads to its own
	// record (self-upload is always allowed).
	uploadPath := "/ims/api/personnel/" + strconv.FormatInt(userAdminPersonID, 10) + "/picture"
	resp := apisAdmin.uploadProfilePicture(ctx, userAdminPersonID, onePixelPNG)
	require.NoError(t, resp.Body.Close())

	// ListActionLogs takes no time/name/path filters (the empty request), so the read returns the
	// whole table and the fixture is found by its unique Referer in Go. The REST endpoint's
	// invalid-time → 400 cases have no analogue in the id-keyed/empty contract (like the other
	// extracted reads), so they are dropped rather than ported.
	logs, response := apisAdmin.getActionLogs(ctx)
	require.NotNil(t, response)
	require.Equal(t, http.StatusOK, response.StatusCode)
	require.NoError(t, response.Body.Close())

	var foundLog *resourcesv1.ActionLog
	for _, al := range logs {
		if al.GetReferrer() == referrer {
			foundLog = al
		}
	}
	require.NotNil(t, foundLog)
	assert.Equal(t, uploadPath, foundLog.GetPath())
	assert.Equal(t, "POST", foundLog.GetMethod())
}
