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
	"io"
	"net/http"
	"testing"

	resourcesv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/resources/v1"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
)

func TestGetAndEditEvent(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}

	testEventName := rand.NonCryptoText()

	editEventReq := imsjson.Event{
		Name: &testEventName,
	}

	eventID, resp := apisAdmin.createEvent(ctx, editEventReq)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Listing is Connect-only now (the REST GET /events was retired in 1c); create
	// is still REST until EditEvent is extracted.
	listResp, err := apisAdmin.listEvents(ctx)
	require.NoError(t, err)
	// The list may include events from other tests.
	var foundEvent *resourcesv1.Event
	for _, event := range listResp.GetEvents() {
		if event.GetId() == eventID {
			foundEvent = event
		}
	}
	require.NotNil(t, foundEvent)
	require.Equal(t, testEventName, foundEvent.GetName())
	require.NotZero(t, foundEvent.GetId())
}

func TestEditEvent_errors(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}

	testEventName := "This name is ugly (has spaces and parentheses)"

	editEventReq := imsjson.Event{
		Name: &testEventName,
	}

	// use editEvent rather than createEvent, because createEvent fails if it can't actually create the event
	resp := apisAdmin.editEvent(ctx, editEventReq)
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	b, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	require.Contains(t, string(b), "names must match the pattern")
}
