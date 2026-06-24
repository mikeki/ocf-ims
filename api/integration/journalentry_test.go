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

// TestJournalEntryMentions verifies that the @mention person IDs sent on a
// journal entry (plan 81) are persisted and round-trip on read, resolved to the
// mentioned person's handle/name. It also covers the insert-ignore semantics:
// a duplicate person in the list collapses to one mention, and a stale/unknown
// person ID is silently dropped rather than failing the request.
func TestJournalEntryMentions(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Alice creates an incident whose initial journal entry @mentions Bob and
	// Carol (by registry PERSON.ID, as the "@" picker sends). The list also
	// includes Bob twice and one unknown ID, to exercise insert-ignore.
	num := apisAlice.newIncidentSuccess(ctx, imsjson.Incident{
		Event: eventName,
		JournalEntries: []imsjson.JournalEntry{{
			Text:               "Paging @" + userBobHandle + " and @" + userCarolHandle + " to assist.",
			MentionedPersonIDs: []int32{userBobPersonID, userCarolPersonID, userBobPersonID, nonexistentPersonID},
		}},
	})

	retrieved, resp := apisAlice.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Find the user-authored entry (a generated "created" entry may also exist).
	var entry imsjson.JournalEntry
	for _, e := range retrieved.JournalEntries {
		if !e.SystemEntry {
			entry = e
		}
	}
	require.NotZero(t, entry.ID)

	// Exactly two mentions survive: Bob (deduped) and Carol; the unknown ID is
	// dropped by insert-ignore.
	require.Len(t, entry.Mentions, 2)
	byID := map[int32]imsjson.Mention{}
	for _, m := range entry.Mentions {
		byID[m.PersonID] = m
	}
	require.Contains(t, byID, int32(userBobPersonID))
	require.Contains(t, byID, int32(userCarolPersonID))
	require.NotContains(t, byID, int32(nonexistentPersonID))
	require.Equal(t, userBobHandle, byID[userBobPersonID].Handle)
	require.Equal(t, userCarolHandle, byID[userCarolPersonID].Handle)
}

// TestReportJournalEntryMentions is the field-report mirror of
// TestJournalEntryMentions: @mention person IDs on a report journal entry are
// persisted and round-trip on read, with the same insert-ignore dedup/stale-drop
// semantics.
func TestReportJournalEntryMentions(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	summary := "report with mentions"
	num := apisAlice.newReportSuccess(ctx, imsjson.Report{
		Event:   eventName,
		Summary: &summary,
		JournalEntries: []imsjson.JournalEntry{{
			Text:               "Looping in @" + userBobHandle + " and @" + userCarolHandle + ".",
			MentionedPersonIDs: []int32{userBobPersonID, userCarolPersonID, userBobPersonID, nonexistentPersonID},
		}},
	})

	retrieved, resp := apisAlice.getReport(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	var entry imsjson.JournalEntry
	for _, e := range retrieved.JournalEntries {
		if !e.SystemEntry {
			entry = e
		}
	}
	require.NotZero(t, entry.ID)
	require.Len(t, entry.Mentions, 2)
	byID := map[int32]imsjson.Mention{}
	for _, m := range entry.Mentions {
		byID[m.PersonID] = m
	}
	require.Contains(t, byID, int32(userBobPersonID))
	require.Contains(t, byID, int32(userCarolPersonID))
	require.NotContains(t, byID, int32(nonexistentPersonID))
	require.Equal(t, userBobHandle, byID[userBobPersonID].Handle)
}
