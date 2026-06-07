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

func TestEditIncidentJournalEntry(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisNonAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	// Use the admin JWT to create a new event,
	// then give the normal user Writer role on that event
	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Use normal user to create a new Incident
	incidentReq := sampleIncident1(eventName)
	entryReq := incidentReq.JournalEntries[0]
	num := apisNonAdmin.newIncidentSuccess(ctx, incidentReq)
	incidentReq.Number = num

	// Use normal user to fetch that Incident from the API
	retrievedIncident, resp := apisNonAdmin.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, retrievedIncident)
	require.Len(t, retrievedIncident.JournalEntries, 2)
	journalEntry := retrievedIncident.JournalEntries[1]
	require.Equal(t, entryReq.Text, journalEntry.Text)

	// Strike that journal entry
	journalEntry.Stricken = new(true)
	resp = apisNonAdmin.updateIncidentJournalEntry(ctx, eventName, num, journalEntry)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Check that the striking worked
	retrievedIncident, resp = apisNonAdmin.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, retrievedIncident)
	journalEntry = retrievedIncident.JournalEntries[1]
	require.True(t, *journalEntry.Stricken)

	// Unstrike that journal entry
	journalEntry.Stricken = new(false)
	resp = apisNonAdmin.updateIncidentJournalEntry(ctx, eventName, num, journalEntry)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Check that the unstriking worked
	retrievedIncident, resp = apisNonAdmin.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, retrievedIncident)
	journalEntry = retrievedIncident.JournalEntries[1]
	require.False(t, *journalEntry.Stricken)

	// If no Stricken value is provided, nothing happens
	journalEntry.Stricken = nil
	resp = apisNonAdmin.updateIncidentJournalEntry(ctx, eventName, num, journalEntry)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

func TestEditReportJournalEntry(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisNonAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	// Use the admin JWT to create a new event,
	// then give the normal user Writer role on that event
	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Use normal user to create a new FR
	reportReq := sampleReport1(eventName)
	entryReq := reportReq.JournalEntries[0]
	num := apisNonAdmin.newReportSuccess(ctx, reportReq)
	reportReq.Number = num

	// Use normal user to fetch that FR from the API
	retrievedFR, resp := apisNonAdmin.getReport(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, retrievedFR)
	require.Len(t, retrievedFR.JournalEntries, 2)
	journalEntry := retrievedFR.JournalEntries[1]
	require.Equal(t, entryReq.Text, journalEntry.Text)

	// Strike that journal entry
	journalEntry.Stricken = new(true)
	resp = apisNonAdmin.updateReportJournalEntry(ctx, eventName, num, journalEntry)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Check that the striking worked
	retrievedFR, resp = apisNonAdmin.getReport(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, retrievedFR)
	journalEntry = retrievedFR.JournalEntries[1]
	require.True(t, *journalEntry.Stricken)

	// Unstrike that journal entry
	journalEntry.Stricken = new(false)
	resp = apisNonAdmin.updateReportJournalEntry(ctx, eventName, num, journalEntry)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Check that the unstriking worked
	retrievedFR, resp = apisNonAdmin.getReport(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, retrievedFR)
	journalEntry = retrievedFR.JournalEntries[1]
	require.False(t, *journalEntry.Stricken)

	// If no Stricken value is provided, nothing happens
	journalEntry.Stricken = nil
	resp = apisNonAdmin.updateReportJournalEntry(ctx, eventName, num, journalEntry)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}
