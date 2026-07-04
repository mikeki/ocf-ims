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

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
)

// TestIncidentGrant_ReporterPerIncidentAccess covers plan 52f: a reporter, who has
// no event-wide incident access, gains read + journal-add on a single incident when a
// writer grants it via the involvement row — and only on that incident.
func TestIncidentGrant_ReporterPerIncidentAccess(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	admin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	writer := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	reporter := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForDave(t, ctx)}

	// A fresh event: Alice is a writer, Dave a reporter.
	eventName := rand.NonCryptoText()
	_, resp := admin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = admin.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = admin.addReporter(ctx, eventName, userDaveHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The writer creates two incidents.
	granted := writer.newIncidentSuccess(ctx, imsjson.Incident{Event: eventName, State: "open", Priority: 3, Summary: new("granted one")})
	other := writer.newIncidentSuccess(ctx, imsjson.Incident{Event: eventName, State: "open", Priority: 3, Summary: new("not granted")})

	// Before any grant the reporter sees no incidents at all.
	_, resp = reporter.getIncident(ctx, eventName, granted)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, resp = reporter.getIncidents(ctx, eventName)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// ...and /auth reports no incident reach for the reporter on this event.
	auth, resp := reporter.getAuth(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.False(t, auth.EventAccess[eventName].ReadIncidents)
	require.False(t, auth.EventAccess[eventName].ReadIncidentsViaGrant)

	// The writer grants the reporter access to one incident via the involvement row.
	resp = writer.attachPersonToIncidentBody(ctx, eventName, granted, userDavePersonID,
		imsjson.IncidentPerson{GrantedAccess: true})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Now the reporter can read that incident and may add journal entries to it.
	got, resp := reporter.getIncident(ctx, eventName, granted)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.True(t, got.ViewerMayAddJournal)

	// The list is filtered to just the granted incident.
	list, resp := reporter.getIncidents(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Len(t, list, 1)
	require.Equal(t, granted, list[0].Number)

	// /auth now reveals the Incidents list via the grant (without event-wide read).
	auth, resp = reporter.getAuth(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.False(t, auth.EventAccess[eventName].ReadIncidents)
	require.True(t, auth.EventAccess[eventName].ReadIncidentsViaGrant)

	// The reporter may append a journal entry...
	resp = reporter.updateIncident(ctx, eventName, granted, imsjson.Incident{
		JournalEntries: []imsjson.JournalEntry{{Text: "reporter follow-up"}},
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// ...but may not edit any other field (here, the state).
	resp = reporter.updateIncident(ctx, eventName, granted, imsjson.Incident{State: "closed"})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The grant is per-incident: the other incident stays forbidden.
	_, resp = reporter.getIncident(ctx, eventName, other)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// From the writer's view, the involved reporter shows granted + lacking event access.
	gotByWriter, resp := writer.getIncident(ctx, eventName, granted)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, gotByWriter.People)
	var dave *imsjson.IncidentPerson
	for i := range *gotByWriter.People {
		if (*gotByWriter.People)[i].PersonID == userDavePersonID {
			dave = &(*gotByWriter.People)[i]
		}
	}
	require.NotNil(t, dave)
	require.True(t, dave.GrantedAccess)
	require.False(t, dave.HasEventAccess)

	// Revoking (re-attach without the grant) takes the access away again.
	resp = writer.attachPersonToIncidentBody(ctx, eventName, granted, userDavePersonID,
		imsjson.IncidentPerson{GrantedAccess: false})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, resp = reporter.getIncident(ctx, eventName, granted)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}
