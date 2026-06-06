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
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"connectrpc.com/connect"
	imsv1 "github.com/burningmantech/ranger-ims-go/gen/ocf/ims/v1"
	"github.com/burningmantech/ranger-ims-go/gen/ocf/ims/v1/imsv1connect"
	imsjson "github.com/burningmantech/ranger-ims-go/json"
	"github.com/burningmantech/ranger-ims-go/lib/rand"
	"github.com/stretchr/testify/require"
)

// incidentRPCClient builds a Connect IncidentService client against the shared
// test server.
func incidentRPCClient() imsv1connect.IncidentServiceClient {
	return imsv1connect.NewIncidentServiceClient(http.DefaultClient, shared.serverURL.String())
}

// withJWT returns the request with a Bearer token set, so the RequireAuthN
// middleware (which wraps the Connect handler in the mux) can authenticate it.
func withJWT[T any](req *connect.Request[T], jwt string) *connect.Request[T] {
	if jwt != "" {
		req.Header().Set("Authorization", "Bearer "+jwt)
	}
	return req
}

// TestIncidentServiceConnect exercises the first proto-first Connect endpoint
// end-to-end against a real MariaDB, using the REST incident API as the oracle:
// the Connect responses must agree with what REST returns for the same data.
func TestIncidentServiceConnect(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	adminJWT := jwtForAdmin(ctx, t)
	aliceJWT := jwtForAlice(t, ctx)
	admin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: adminJWT}
	alice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: aliceJWT}
	client := incidentRPCClient()

	// An event Alice may write to.
	eventName := rand.NonCryptoText()
	_, resp := admin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = admin.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Create an incident via REST, then attach a Ranger to exercise the
	// PersonInvolvement mapping.
	incNum := alice.newIncidentSuccess(ctx, sampleIncident1(eventName))
	resp = alice.attachRangerToIncident(ctx, eventName, incNum, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The REST view is the oracle the Connect response must match.
	restInc, httpResp := alice.getIncident(ctx, eventName, incNum)
	require.Equal(t, http.StatusOK, httpResp.StatusCode)
	require.NoError(t, httpResp.Body.Close())

	t.Run("GetIncident matches REST", func(t *testing.T) {
		getResp, err := client.GetIncident(ctx, withJWT(connect.NewRequest(
			&imsv1.GetIncidentRequest{Event: eventName, Number: incNum}), aliceJWT))
		require.NoError(t, err)
		got := getResp.Msg.GetIncident()
		require.NotNil(t, got)

		require.Equal(t, restInc.Number, got.GetNumber())
		require.Equal(t, restInc.Event, got.GetEvent())
		require.Equal(t, eventName, got.GetEvent())
		// sample state "new", priority 5 (-> HIGH).
		require.Equal(t, imsv1.IncidentState_INCIDENT_STATE_NEW, got.GetState())
		require.Equal(t, imsv1.IncidentPriority_INCIDENT_PRIORITY_HIGH, got.GetPriority())
		require.NotNil(t, restInc.Summary)
		require.Equal(t, *restInc.Summary, got.GetSummary())
		// Timestamps agree to the second.
		require.Equal(t, restInc.Created.Unix(), got.GetCreated().AsTime().Unix())

		// people_involved agrees with REST rangers, and includes the one we attached.
		var protoNicknames []string
		for _, p := range got.GetPeopleInvolved() {
			protoNicknames = append(protoNicknames, p.GetNickname())
		}
		var restHandles []string
		if restInc.Rangers != nil {
			for _, r := range *restInc.Rangers {
				restHandles = append(restHandles, r.Handle)
			}
		}
		require.ElementsMatch(t, restHandles, protoNicknames)
		require.Contains(t, protoNicknames, userAliceHandle)
	})

	t.Run("ListIncidents matches REST", func(t *testing.T) {
		listResp, err := client.ListIncidents(ctx, withJWT(connect.NewRequest(
			&imsv1.ListIncidentsRequest{Event: eventName}), aliceJWT))
		require.NoError(t, err)

		restList, httpResp := alice.getIncidents(ctx, eventName)
		require.Equal(t, http.StatusOK, httpResp.StatusCode)
		require.NoError(t, httpResp.Body.Close())

		require.Len(t, listResp.Msg.GetIncidents(), len(restList))
		var nums []int32
		for _, i := range listResp.Msg.GetIncidents() {
			nums = append(nums, i.GetNumber())
		}
		require.Contains(t, nums, incNum)
	})

	t.Run("raw JSON POST (browser path)", func(t *testing.T) {
		// The browser's hand-written client (web/typescript/connectrpc.ts) does a
		// plain fetch POST with Content-Type application/json — the Connect unary
		// JSON protocol, NOT the binary protocol the connect-go client above uses.
		// Exercise that exact wire format here so the frontend path is covered.
		reqBody, err := json.Marshal(map[string]string{"event": eventName})
		require.NoError(t, err)
		url := shared.serverURL.JoinPath("/ocf.ims.v1.IncidentService/ListIncidents").String()
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(reqBody))
		require.NoError(t, err)
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Connect-Protocol-Version", "1")
		httpReq.Header.Set("Authorization", "Bearer "+aliceJWT)

		httpResp, err := http.DefaultClient.Do(httpReq)
		require.NoError(t, err)
		body, err := io.ReadAll(httpResp.Body)
		require.NoError(t, err)
		require.NoError(t, httpResp.Body.Close())
		require.Equal(t, http.StatusOK, httpResp.StatusCode, "body: %s", body)
		require.Equal(t, "application/json", httpResp.Header.Get("Content-Type"))

		// proto3 JSON: lowerCamelCase fields, enums as string names.
		var decoded struct {
			Incidents []struct {
				Number   int32  `json:"number"`
				State    string `json:"state"`
				Priority string `json:"priority"`
			} `json:"incidents"`
		}
		require.NoError(t, json.Unmarshal(body, &decoded))
		var nums []int32
		for _, i := range decoded.Incidents {
			nums = append(nums, i.Number)
		}
		require.Contains(t, nums, incNum)
		// The created sample incident is "new"/priority 5 -> proto enum strings.
		for _, i := range decoded.Incidents {
			if i.Number == incNum {
				require.Equal(t, "INCIDENT_STATE_NEW", i.State)
				require.Equal(t, "INCIDENT_PRIORITY_HIGH", i.Priority)
			}
		}
	})

	t.Run("unauthenticated is rejected", func(t *testing.T) {
		_, err := client.ListIncidents(ctx, connect.NewRequest(
			&imsv1.ListIncidentsRequest{Event: eventName}))
		require.Error(t, err)
		require.Equal(t, connect.CodeUnauthenticated, connect.CodeOf(err))
	})

	t.Run("no permission is denied", func(t *testing.T) {
		// A separate event Alice has no access to.
		otherEvent := rand.NonCryptoText()
		_, resp := admin.createEvent(ctx, imsjson.Event{Name: &otherEvent})
		require.Equal(t, http.StatusNoContent, resp.StatusCode)
		require.NoError(t, resp.Body.Close())

		_, err := client.ListIncidents(ctx, withJWT(connect.NewRequest(
			&imsv1.ListIncidentsRequest{Event: otherEvent}), aliceJWT))
		require.Error(t, err)
		require.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
	})

	t.Run("unknown event is not found", func(t *testing.T) {
		_, err := client.ListIncidents(ctx, withJWT(connect.NewRequest(
			&imsv1.ListIncidentsRequest{Event: "no-such-event-" + rand.NonCryptoText()}), aliceJWT))
		require.Error(t, err)
		require.Equal(t, connect.CodeNotFound, connect.CodeOf(err))
	})

	t.Run("unknown incident number is not found", func(t *testing.T) {
		_, err := client.GetIncident(ctx, withJWT(connect.NewRequest(
			&imsv1.GetIncidentRequest{Event: eventName, Number: 999999}), aliceJWT))
		require.Error(t, err)
		require.Equal(t, connect.CodeNotFound, connect.CodeOf(err))
	})
}
