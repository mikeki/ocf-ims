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

// TestReportJournalEntryStrikeOwnership verifies the per-entry ownership limit on
// the report journal-entry strike endpoint (plan 90 finding M1): a reporter (who
// has EventWriteOwnReports but not EventWriteAllReports) may strike only the entries
// they authored themselves. A report is a collection of entries owned by their
// individual authors, so the limit is per-entry — a reporter can't strike another
// person's entry even on a report they contributed to. Writers/admins strike any.
func TestReportJournalEntryStrikeOwnership(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	apisDave := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForDave(t, ctx)}

	// Alice gets writer (can author + read all reports); Dave gets reporter
	// (own-reports only). Participation is per-event, so this doesn't perturb the
	// users' roles in other parallel tests.
	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addReporter(ctx, eventName, userDaveHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Alice authors a report; Dave has never contributed to it.
	aliceReport := apisAlice.newReportSuccess(ctx, sampleReport1(eventName))
	retrieved, resp := apisAdmin.getReport(ctx, eventName, aliceReport)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Len(t, retrieved.JournalEntries, 2)
	aliceEntry := retrieved.JournalEntries[1]

	// Dave (reporter) tries to strike an entry on Alice's report → forbidden.
	aliceEntry.Stricken = new(true)
	resp = apisDave.updateReportJournalEntry(ctx, eventName, aliceReport, aliceEntry)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The entry is untouched.
	retrieved, resp = apisAdmin.getReport(ctx, eventName, aliceReport)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.False(t, *retrieved.JournalEntries[1].Stricken)

	// But Dave may strike an entry he authored himself — the limit is per-entry
	// ownership, not a blanket block on reporters.
	daveReport := apisDave.newReportSuccess(ctx, sampleReport1(eventName))
	own, resp := apisDave.getReport(ctx, eventName, daveReport)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	daveEntry := own.JournalEntries[1]
	require.Equal(t, userDaveHandle, daveEntry.Author)
	daveEntry.Stricken = new(true)
	resp = apisDave.updateReportJournalEntry(ctx, eventName, daveReport, daveEntry)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	own, resp = apisDave.getReport(ctx, eventName, daveReport)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.True(t, *own.JournalEntries[1].Stricken)

	// The decisive per-entry case: Alice (writer) adds an entry to DAVE'S report,
	// so Dave's own report now contains an entry authored by Alice. Dave may not
	// strike that entry — ownership is per-entry, not per-report. (Under a coarse
	// per-report rule Dave would wrongly be allowed, since he authored the report.)
	resp = apisAlice.updateReport(ctx, eventName, daveReport, imsjson.Report{
		Number:         daveReport,
		JournalEntries: []imsjson.JournalEntry{{Text: "writer note on Dave's report"}},
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	withAlice, resp := apisAdmin.getReport(ctx, eventName, daveReport)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	var aliceOnDave imsjson.JournalEntry
	for _, e := range withAlice.JournalEntries {
		if e.Author == userAliceHandle {
			aliceOnDave = e
		}
	}
	require.NotZero(t, aliceOnDave.ID, "Alice's entry should be present on Dave's report")

	aliceOnDave.Stricken = new(true)
	resp = apisDave.updateReportJournalEntry(ctx, eventName, daveReport, aliceOnDave)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
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

// TestJournalEntryTypedMentions verifies the backend safety net: when an author
// types "@handle" but does NOT pick from the "@" typeahead (so the client sends
// no MentionedPersonIDs), the server still resolves the handle from the directory
// and records the mention. Without this, a fat-fingered or pasted mention would
// notify nobody.
func TestJournalEntryTypedMentions(t *testing.T) {
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

	// The entry mentions Bob purely as typed text — no MentionedPersonIDs at all.
	num := apisAlice.newIncidentSuccess(ctx, imsjson.Incident{
		Event: eventName,
		JournalEntries: []imsjson.JournalEntry{{
			Text: "Please page @" + userBobHandle + " right away.",
		}},
	})

	retrieved, resp := apisAlice.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	var entry imsjson.JournalEntry
	for _, e := range retrieved.JournalEntries {
		if !e.SystemEntry {
			entry = e
		}
	}
	require.NotZero(t, entry.ID)

	// Bob's mention is resolved from the typed handle even though the client sent
	// no person IDs.
	require.Len(t, entry.Mentions, 1)
	require.Equal(t, int32(userBobPersonID), entry.Mentions[0].PersonID)
	require.Equal(t, userBobHandle, entry.Mentions[0].Handle)
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
