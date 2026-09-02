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
	"slices"
	"testing"
	"time"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
)

type MethodURL struct {
	Method string
	Path   string
}

func TestAdminOnlyEndpoints(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisNonAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	apisNotAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}

	adminOnly := []MethodURL{
		{http.MethodGet, "/ims/api/actionlogs"},
		{http.MethodPost, "/ims/api/events"},
		// NOTE: POST .../areas is intentionally not listed here. It is no longer
		// strictly admin-only — creating an area is allowed for event writers,
		// while editing an existing area stays admin-only. Its authorization is
		// covered by area_test.go (TestAreaMutationRequiresAdmin and
		// TestAreaCreateAllowedForEventWriter).
		// NOTE: POST .../incident_types is intentionally not listed here. It moved to the
		// ImsService taxonomy RPCs in 1c (the POST multiplexer decomposed into
		// Create/Update/Approve/SetHidden); its admin-gating (403 for a non-admin, 401 for
		// unauth) is covered by TestIncidentTypeWriteAuthorization below.
		{http.MethodGet, "/ims/api/debug/buildinfo"},
		{http.MethodGet, "/ims/api/debug/runtimemetrics"},
		{http.MethodPost, "/ims/api/debug/gc"},
	}

	for _, api := range adminOnly {
		// admin is allowed in
		code := apiCall(t, api, apisAdmin)
		require.True(t, permitted(code), "%v %v wanted non-401/403 status code, got %v", api.Method, api.Path, code)

		// nonadmin is forbidden
		code = apiCall(t, api, apisNonAdmin)
		require.True(t, forbidden(code), "%v %v wanted 403 status code, got %v", api.Method, api.Path, code)

		// unauthenticated is unauthorized
		code = apiCall(t, api, apisNotAuthenticated)
		require.True(t, unauthorized(code), "%v %v wanted 401 status code, got %v", api.Method, api.Path, code)
	}
}

// TestIncidentTypeWriteAuthorization pins the incident-type write RPCs' admin-gating now that POST
// /ims/api/incident_types is retired from REST (it was an entry in the admin-only route sweep): the
// admin writes require GlobalAdministrateIncidentTypes, so a non-admin is forbidden and an
// unauthenticated caller is unauthorized. CreateIncidentType stands in for the four admin writes
// (they share requireAdmin); the happy path is covered by the itype functional tests.
func TestIncidentTypeWriteAuthorization(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisNonAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	apisNotAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}

	name := rand.NonCryptoText()

	// A non-admin lacks GlobalAdministrateIncidentTypes: 403.
	_, resp := apisNonAdmin.editType(ctx, imsjson.IncidentType{Name: &name})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Unauthenticated: 401.
	_, resp = apisNotAuthenticated.editType(ctx, imsjson.IncidentType{Name: &name})
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

// TestListIncidentTypesAuthorization pins the ListIncidentTypes RPC's authorization now that GET
// /ims/api/incident_types is retired from REST (it was the last entry in the old
// any-authenticated-user route sweep, alongside GET /events and GET /personnel, both already
// relocated to their own RPC auth tests): an unauthenticated caller is rejected, and any
// authenticated user may read the taxonomy (GlobalReadIncidentTypes is granted to every signed-in
// user).
func TestListIncidentTypesAuthorization(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisNonAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	apisNotAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}

	// Unauthenticated: 401.
	_, resp := apisNotAuthenticated.getTypes(ctx)
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Any authenticated user (admin or not) may read the taxonomy.
	_, resp = apisAdmin.getTypes(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, resp = apisNonAdmin.getTypes(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

// TestOutcomeWriteAuthorization pins the outcome write RPCs' admin-gating now that POST
// /ims/api/outcomes is retired from REST (the POST multiplexer decomposed into
// Create/Update/Approve/SetHidden): the admin writes require GlobalAdministrateOutcomes, so a
// non-admin is forbidden and an unauthenticated caller is unauthorized. CreateOutcome stands in for
// the four admin writes (they share requireAdmin); the happy path is covered by outcome_test.go.
func TestOutcomeWriteAuthorization(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisNonAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	apisNotAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}

	name := rand.NonCryptoText()

	// A non-admin lacks GlobalAdministrateOutcomes: 403.
	_, resp := apisNonAdmin.editOutcome(ctx, imsjson.Outcome{Name: &name})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Unauthenticated: 401.
	_, resp = apisNotAuthenticated.editOutcome(ctx, imsjson.Outcome{Name: &name})
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

// TestListOutcomesAuthorization pins the ListOutcomes RPC's authorization now that GET
// /ims/api/outcomes is retired from REST: an unauthenticated caller is rejected, and any
// authenticated user may read the taxonomy (GlobalReadOutcomes is granted to every signed-in user).
func TestListOutcomesAuthorization(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisNonAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	apisNotAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}

	// Unauthenticated: 401.
	_, resp := apisNotAuthenticated.getOutcomes(ctx)
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Any authenticated user (admin or not) may read the taxonomy.
	_, resp = apisAdmin.getOutcomes(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, resp = apisNonAdmin.getOutcomes(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

func TestEventEndpoints_ForNoEventPerms(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	// The admin creates the event and grants roles; the subject under test is a
	// non-admin (Alice). Admins now bypass per-event roles entirely (plan 52b), so
	// a non-admin is the only way to exercise the no-perms → reporter → writer
	// progression.
	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	apisNotAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}

	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	eventPath := "/ims/api/events/" + eventName
	// The incident CRUD routes, the incident sub-resource writes (attach/detach a person,
	// strike a journal entry), and the report reads + writes (list, single, create, update,
	// strike-a-journal-entry) were all retired from REST (plan 09h/1c) — they are now the
	// ImsService.ListIncidents / CreateIncident / GetIncident / UpdateIncident /
	// AttachPersonToIncident / DetachPersonFromIncident / UpdateIncidentJournalEntry and the
	// ListReports / GetReport / CreateReport / UpdateReport / UpdateReportJournalEntry RPCs. Their
	// unauth (401) and forbidden (403) behavior is covered through the Connect client in
	// TestIncidentAPIAuthorization, TestIncidentSubresourceWriteAuthorization,
	// TestReportReadAuthorization and TestReportWriteAuthorization, so they are no longer
	// enumerated here. Only the report-attachment upload/download (still REST) remains below.
	getIncidentAttachment := MethodURL{http.MethodGet, eventPath + "/incidents/1/attachments/1"}
	postIncidentAttachment := MethodURL{http.MethodPost, eventPath + "/incidents/1/attachments"}
	getReportAttachment := MethodURL{http.MethodGet, eventPath + "/reports/1/attachments/1"}
	postReportAttachment := MethodURL{http.MethodPost, eventPath + "/reports/9999999/attachments"}
	getVisits := MethodURL{http.MethodGet, eventPath + "/visits"}
	getVisit := MethodURL{http.MethodGet, eventPath + "/visits/1"}
	getVisitAttachment := MethodURL{http.MethodGet, eventPath + "/visits/1/attachments/1"}
	createVisit := MethodURL{http.MethodPost, eventPath + "/visits"}
	updateVisit := MethodURL{http.MethodPost, eventPath + "/visits/1"}
	postVisitAttachment := MethodURL{http.MethodPost, eventPath + "/visits/1/attachments"}
	postVisitRE := MethodURL{http.MethodPost, eventPath + "/visits/9999999/journal_entries/2"}
	postVisitPerson := MethodURL{http.MethodPost, eventPath + "/visits/1/people/some_name"}
	deleteVisitPerson := MethodURL{http.MethodDelete, eventPath + "/visits/1/people/some_name"}
	getAreas := MethodURL{http.MethodGet, eventPath + "/areas"}

	allPerms := []MethodURL{
		getIncidentAttachment,
		postIncidentAttachment,
		getReportAttachment,
		postReportAttachment,
		getVisits,
		getVisit,
		getVisitAttachment,
		createVisit,
		updateVisit,
		postVisitAttachment,
		postVisitRE,
		postVisitPerson,
		deleteVisitPerson,
		getAreas,
	}
	reporter := []MethodURL{
		getReportAttachment,
		postReportAttachment,
		getAreas,
	}

	// The 52b ladder has no read-only rung: a non-writer/non-reporter sees nothing.
	writer := slices.Clone(allPerms)

	for _, api := range allPerms {
		// unauthenticated is unauthorized
		code := apiCall(t, api, apisNotAuthenticated)
		require.True(t, unauthorized(code), "%v %v wanted 401 status code, got %v", api.Method, api.Path, code)
	}

	// to begin, the non-admin user has no permissions on this event (no
	// participation row), so every per-event endpoint is forbidden.
	for _, api := range allPerms {
		code := apiCall(t, api, apisAlice)
		require.True(t, forbidden(code), "%v %v wanted 403 status code, got %v", api.Method, api.Path, code)
	}

	// make the user a reporter (per-event PERSON__EVENT role)
	resp = apisAdmin.addReporter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// now the user can hit some more endpoints
	for _, api := range allPerms {
		switch {
		case api == postReportAttachment:
			// the user won't be able to write to an FR for which they're not an author,
			// e.g. the one in this dummy call, so we should expect a 403 or 404, but we
			// can confirm they got the right error message
			code := apiCall(t, api, apisAlice)
			require.True(t, forbiddenOrNotFound(code), "%v %v wanted 403/404 status code, got %v", api.Method, api.Path, code)
		case slices.Contains(reporter, api):
			// permitted
			code := apiCall(t, api, apisAlice)
			require.True(t, permitted(code), "%v %v wanted non-401/403 status code, got %v", api.Method, api.Path, code)
		default:
			// forbidden
			code := apiCall(t, api, apisAlice)
			require.True(t, forbidden(code), "%v %v wanted 403 status code, got %v", api.Method, api.Path, code)
		}
	}

	// finally, make the user a writer
	resp = apisAdmin.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// now the user can hit many more endpoints
	for _, api := range allPerms {
		if slices.Contains(writer, api) {
			// permitted
			code := apiCall(t, api, apisAlice)
			require.True(t, permitted(code), "%v %v wanted non-401/403 status code, got %v", api.Method, api.Path, code)
		} else {
			// forbidden
			code := apiCall(t, api, apisAlice)
			require.True(t, forbidden(code), "%v %v wanted 403 status code, got %v", api.Method, api.Path, code)
		}
	}
}

func TestPublicAPIs_RequireNoAuthn(t *testing.T) {
	t.Parallel()
	public := []MethodURL{
		{http.MethodGet, "/"},
		{http.MethodGet, "/ims/api/ping"},
		// readyz is unauthenticated like ping; with a healthy DB it returns 200.
		{http.MethodGet, "/ims/api/readyz"},
	}
	apisNotAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}
	for _, api := range public {
		code := apiCall(t, api, apisNotAuthenticated)
		require.Equalf(t, http.StatusOK, code, "Got status code %v for %v %v", code, api.Method, api.Path)
	}
}

func TestEventSource_RequiresNoAuthn(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	path := shared.serverURL.JoinPath("ims/api/eventsource")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, path.String(), nil)
	require.NoError(t, err)
	client := http.Client{Timeout: 10 * time.Second}

	// #nosec G704 // SSRF via taint analysis.
	resp, err := client.Do(req)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	// The response body will keep streaming until the test ends, so we can just read
	// a prefix of the expect response to know that things look good.
	expectedFirstBytes := []byte("id: 0\nevent: InitialEvent")
	buf := make([]byte, len(expectedFirstBytes))
	_, err = io.ReadFull(resp.Body, buf)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
}

func apiCall(t *testing.T, api MethodURL, user ApiHelper) (statusCode int) {
	t.Helper()
	ctx := t.Context()
	var httpResp *http.Response
	switch api.Method {
	case http.MethodDelete:
		_, httpResp = user.imsDelete(ctx, user.serverURL.JoinPath(api.Path).String(), nil)
	case http.MethodGet:
		_, httpResp = user.imsGetBodyBytes(ctx, user.serverURL.JoinPath(api.Path).String())
	case http.MethodPost:
		httpResp = user.imsPost(ctx, map[string]any{}, user.serverURL.JoinPath(api.Path).String())
	}
	require.NotNil(t, httpResp)
	require.NoError(t, httpResp.Body.Close())
	return httpResp.StatusCode
}

func permitted(status int) bool {
	return !unauthorized(status) && !forbidden(status)
}

func unauthorized(status int) bool {
	return status == http.StatusUnauthorized
}

func forbidden(status int) bool {
	return status == http.StatusForbidden
}

func forbiddenOrNotFound(status int) bool {
	return status == http.StatusNotFound || status == http.StatusForbidden
}
