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
	"context"
	"net/http"
	"slices"
	"testing"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
)

// requireSeesIncident asserts the caller can read the incident directly and that it
// appears in their incidents list.
func requireSeesIncident(t *testing.T, ctx context.Context, api ApiHelper, eventName string, num int32) {
	t.Helper()
	_, resp := api.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	list, resp := api.getIncidents(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.True(t, slices.ContainsFunc(list, func(i imsjson.Incident) bool { return i.Number == num }),
		"incident %d should be in the list", num)
}

// TestPrivateIncidentVisibility covers the private-incident read rules: once an
// incident is marked private, only the creator, an admin, and people granted
// per-incident access (52f) may see it — a plain event writer no longer can.
func TestPrivateIncidentVisibility(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	admin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	alice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)} // creator (writer)
	erin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForErin(t, ctx)}   // another writer
	dave := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForDave(t, ctx)}   // reporter (to be granted)

	eventName := rand.NonCryptoText()
	_, resp := admin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	for _, handle := range []string{userAliceHandle, userErinHandle} {
		resp = admin.addWriter(ctx, eventName, handle)
		require.Equal(t, http.StatusNoContent, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
	}
	resp = admin.addReporter(ctx, eventName, userDaveHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Alice (writer) creates the incident, so she is the creator.
	num := alice.newIncidentSuccess(ctx, imsjson.Incident{Event: eventName, Summary: new("sensitive op")})

	// While public, another writer (Erin) can see it.
	requireSeesIncident(t, ctx, erin, eventName, num)

	// Alice marks it private (allowed: she's the creator).
	resp = alice.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event: eventName, Number: num, Private: new(true),
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The stored flag round-trips.
	got, resp := alice.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, got.Private)
	require.True(t, *got.Private)

	// Creator and admin still see it (single + list).
	requireSeesIncident(t, ctx, alice, eventName, num)
	requireSeesIncident(t, ctx, admin, eventName, num)

	// Erin (writer, not creator/admin/granted) no longer can: the single read is a
	// 404 (existence hidden) and the incident is absent from her list.
	_, resp = erin.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	erinList, resp := erin.getIncidents(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.False(t, slices.ContainsFunc(erinList, func(i imsjson.Incident) bool { return i.Number == num }),
		"private incident must not appear in a non-creator writer's list")

	// Dave (reporter, no event read) can't see it before any grant.
	_, resp = dave.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Grant Dave per-incident access; now he can see the private incident.
	resp = alice.attachPersonToIncidentBody(ctx, eventName, num, userDavePersonID,
		imsjson.IncidentPerson{GrantedAccess: true})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	requireSeesIncident(t, ctx, dave, eventName, num)
}

// TestPrivateIncidentToggleAuthorization covers who may change the privacy flag:
// only an admin or the incident's creator. A non-creator writer is refused, and a
// granted reporter (who may append journal entries) cannot flip it either.
func TestPrivateIncidentToggleAuthorization(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	admin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	alice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)} // creator (writer)
	erin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForErin(t, ctx)}   // another writer
	dave := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForDave(t, ctx)}   // reporter

	eventName := rand.NonCryptoText()
	_, resp := admin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	for _, handle := range []string{userAliceHandle, userErinHandle} {
		resp = admin.addWriter(ctx, eventName, handle)
		require.Equal(t, http.StatusNoContent, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
	}
	resp = admin.addReporter(ctx, eventName, userDaveHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	num := alice.newIncidentSuccess(ctx, imsjson.Incident{Event: eventName, Summary: new("op")})

	// A non-creator writer may not toggle privacy.
	resp = erin.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event: eventName, Number: num, Private: new(true),
	})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	// ...and it stayed public.
	got, resp := erin.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, got.Private)
	require.False(t, *got.Private)

	// The creator may toggle it private...
	resp = alice.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event: eventName, Number: num, Private: new(true),
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// ...and an admin may toggle it back to public.
	resp = admin.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event: eventName, Number: num, Private: new(false),
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// A granted reporter may add journal entries but may not toggle privacy.
	resp = alice.attachPersonToIncidentBody(ctx, eventName, num, userDavePersonID,
		imsjson.IncidentPerson{GrantedAccess: true})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = dave.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event: eventName, Number: num, Private: new(true),
	})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}
