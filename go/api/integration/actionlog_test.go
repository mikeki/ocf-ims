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
	"time"

	resourcesv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/resources/v1"
	servicerpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestGetActionLog(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	referrer := "testGetActionLog"
	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t), referrer: referrer}

	// Generate one action-logged request carrying this test's unique Referer to read back. The
	// multipart profile-picture upload (POST /personnel/{id}/picture) stays REST for the whole
	// migration (binary, M8), is action-logged (LogRequest(true)), and — as a raw request — carries
	// the Referer the read below keys on, so it is the durable fixture (an RPC records no Referer).
	// The admin uploads to its own record (self-upload is always allowed).
	before := time.Now().Add(-time.Second)
	uploadPath := "/ims/api/personnel/" + strconv.FormatInt(userAdminPersonID, 10) + "/picture"
	resp := apisAdmin.uploadProfilePicture(ctx, userAdminPersonID, onePixelPNG)
	require.NoError(t, resp.Body.Close())

	// The read is bounded and newest-first, so window it from just before the fixture: parallel
	// tests keep appending rows, but everything newer than `before` fits well inside one page.
	logs, response := apisAdmin.listActionLogs(ctx, &servicerpcv1.ListActionLogsRequest{
		MinTime: timestamppb.New(before),
	})
	require.NotNil(t, response)
	require.Equal(t, http.StatusOK, response.StatusCode)
	require.NoError(t, response.Body.Close())

	var foundLog *resourcesv1.ActionLog
	for i, al := range logs {
		if al.GetReferrer() == referrer {
			foundLog = al
		}
		if i > 0 {
			assert.False(t, al.GetCreatedAt().AsTime().After(logs[i-1].GetCreatedAt().AsTime()),
				"rows must come back newest first")
		}
	}
	require.NotNil(t, foundLog)
	assert.Equal(t, uploadPath, foundLog.GetPath())
	assert.Equal(t, "POST", foundLog.GetMethod())

	// max_time is exclusive: a window that ends before the fixture was written excludes it.
	older, response := apisAdmin.listActionLogs(ctx, &servicerpcv1.ListActionLogsRequest{
		MaxTime: timestamppb.New(before),
	})
	require.Equal(t, http.StatusOK, response.StatusCode)
	require.NoError(t, response.Body.Close())
	for _, al := range older {
		assert.NotEqual(t, referrer, al.GetReferrer(), "max_time must exclude the fixture")
	}

	// limit caps the page (at least the fixture exists in the window, so exactly one comes back).
	one, response := apisAdmin.listActionLogs(ctx, &servicerpcv1.ListActionLogsRequest{
		MinTime: timestamppb.New(before), Limit: 1,
	})
	require.Equal(t, http.StatusOK, response.StatusCode)
	require.NoError(t, response.Body.Close())
	require.Len(t, one, 1)

	// A limit past the server cap is rejected by protovalidate (int32.lte), not clamped.
	_, response = apisAdmin.listActionLogs(ctx, &servicerpcv1.ListActionLogsRequest{Limit: 1001})
	require.Equal(t, http.StatusBadRequest, response.StatusCode)
	require.NoError(t, response.Body.Close())
}
