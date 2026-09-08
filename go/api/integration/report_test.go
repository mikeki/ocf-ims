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
	"strings"
	"testing"
	"time"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
)

func sampleReport1(eventName string) imsjson.Report {
	return imsjson.Report{
		Event:   eventName,
		Summary: new("my summary!"),
		JournalEntries: []imsjson.JournalEntry{
			{Text: "This is some journal text lol"},
			{Text: ""},
		},
	}
}

func TestCreateAndGetReport(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisNonAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	// Use the admin JWT to create a new event,
	// then give the normal user Reporter role on that event
	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addReporter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Use normal user to create a new Report
	reportReq := sampleReport1(eventName)
	entryReq := reportReq.JournalEntries[0]
	num := apisNonAdmin.newReportSuccess(ctx, reportReq)
	reportReq.Number = num

	{
		// Use normal user to fetch that Report from the API and check it over
		retrievedReport, resp := apisNonAdmin.getReport(ctx, eventName, num)
		require.Equal(t, http.StatusOK, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
		require.NotNil(t, retrievedReport)
		requireEqualReport(t, reportReq, retrievedReport)
		require.Len(t, retrievedReport.JournalEntries, 2)

		// The first journal entry will be the system entry. The second should be the one we sent in the request
		retrievedUserEntry := retrievedReport.JournalEntries[1]
		retrievedUserEntry.ID = 0
		require.WithinDuration(t, time.Now(), retrievedUserEntry.Created, 5*time.Minute)
		retrievedUserEntry.Created = time.Time{}
		entryReq.Author = userAliceHandle
		entryReq.Stricken = new(false)
		require.Equal(t, entryReq, retrievedUserEntry)
	}

	{
		// Now get the report via the GetReports (plural) endpoint, and repeat the validation
		retrievedReports, resp := apisNonAdmin.getReports(ctx, eventName)
		require.Equal(t, http.StatusOK, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
		require.NotNil(t, retrievedReports)
		require.Len(t, retrievedReports, 1)
		requireEqualReport(t, reportReq, retrievedReports[0])
		require.Len(t, retrievedReports[0].JournalEntries, 2)

		// The first journal entry will be the system entry. The second should be the one we sent in the request
		retrievedUserEntry := retrievedReports[0].JournalEntries[1]
		retrievedUserEntry.ID = 0
		require.WithinDuration(t, time.Now(), retrievedUserEntry.Created, 5*time.Minute)
		retrievedUserEntry.Created = time.Time{}
		entryReq.Author = userAliceHandle
		require.Equal(t, entryReq, retrievedUserEntry)
	}
}

func TestCreateAndUpdateReport(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	// Use the admin JWT to create a new event,
	// give itself Writer role,
	// then give the normal user Reporter role on that event
	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addWriter(ctx, eventName, userAdminHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addReporter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Use normal user to create a new Report
	reportReq := sampleReport1(eventName)
	num := apisAlice.newReportSuccess(ctx, reportReq)
	reportReq.Number = num

	retrievedNewReport, resp := apisAlice.getReport(ctx, eventName, num)
	require.NoError(t, resp.Body.Close())

	// Update the FR by appending journal entries, without touching the incident link (a nil
	// Incident leaves the link unchanged). The report's summary/link are unchanged afterward.
	updates := imsjson.Report{
		Event:  reportReq.Event,
		Number: num,
		JournalEntries: []imsjson.JournalEntry{
			{
				Text: "new details!",
			},
			{
				Text: "",
			},
		},
	}

	resp = apisAlice.updateReport(ctx, eventName, num, updates)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	retrievedReportAfterUpdate, resp := apisAlice.getReport(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	requireEqualReport(t, retrievedNewReport, retrievedReportAfterUpdate)

	// Linking the report to a nonexistent incident via UpdateReport is a friendly 404: the
	// incident field is now honored (visit-field convention), unlike the retired REST edit path
	// which ignored the body's incident and only linked via a "?action=" form param.
	resp = apisAlice.updateReport(ctx, eventName, num, imsjson.Report{
		Event:    reportReq.Event,
		Number:   num,
		Incident: new(int32(12345)),
	})
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// now let's set all fields to empty
	updates = imsjson.Report{
		Event:          reportReq.Event,
		Number:         num,
		Summary:        new(""),
		Incident:       nil,
		JournalEntries: []imsjson.JournalEntry{},
	}
	resp = apisAlice.updateReport(ctx, eventName, num, updates)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	// then check the result
	retrievedReportAfterUpdate, resp = apisAlice.getReport(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	expected := imsjson.Report{
		Event:    eventName,
		Number:   num,
		Summary:  nil,
		Incident: nil,
	}
	requireEqualReport(t, expected, retrievedReportAfterUpdate)

	// make an incident, then attach to it
	incidentNumber := apisAdmin.newIncidentSuccess(ctx, imsjson.Incident{
		Event: eventName,
	})
	resp = apisAlice.attachReportToIncident(ctx, eventName, num, incidentNumber)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// confirm it worked
	reportAfterAttach, resp := apisAlice.getReport(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, incidentNumber, *reportAfterAttach.Incident)

	// detach again
	resp = apisAlice.detachReportFromIncident(ctx, eventName, num)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// confirm it's detached
	reportAfterDetach, resp := apisAlice.getReport(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Nil(t, reportAfterDetach.Incident)

	// attach again, this time via the incident API
	resp = apisAdmin.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event:   eventName,
		Number:  incidentNumber,
		Reports: &[]int32{num},
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// check it attached
	reportAfterAttach, resp = apisAlice.getReport(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, incidentNumber, *reportAfterAttach.Incident)

	// detach again, this time via the incident API
	resp = apisAdmin.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event:   eventName,
		Number:  incidentNumber,
		Reports: &[]int32{},
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// check it detached
	reportAfterDetach, resp = apisAlice.getReport(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Nil(t, reportAfterDetach.Incident)
}

// TestReportEditSummaryAndEntryAuthz covers the split report edit rules: the summary
// may be edited only by the report's creator and admins; journal entries may be added
// only by the creator, admins, and the writer role. A writer who did not create the
// report may add entries but may NOT rewrite its summary.
func TestReportEditSummaryAndEntryAuthz(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)} // creator (reporter)
	apisDave := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForDave(t, ctx)}   // writer, not creator
	apisErin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForErin(t, ctx)}   // reporter, not creator

	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addReporter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addWriter(ctx, eventName, userDaveHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addReporter(ctx, eventName, userErinHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Alice (a reporter) creates the report, so she is its creator (CREATED_BY).
	num := apisAlice.newReportSuccess(ctx, sampleReport1(eventName))

	summaryEdit := func(summary string) imsjson.Report {
		return imsjson.Report{Event: eventName, Number: num, Summary: new(summary)}
	}
	entryAdd := func(text string) imsjson.Report {
		return imsjson.Report{Event: eventName, Number: num, JournalEntries: []imsjson.JournalEntry{{Text: text}}}
	}
	expect := func(apis ApiHelper, req imsjson.Report, want int) {
		t.Helper()
		r := apis.updateReport(ctx, eventName, num, req)
		require.Equal(t, want, r.StatusCode)
		require.NoError(t, r.Body.Close())
	}

	// Summary: creator and admins only.
	expect(apisAlice, summaryEdit("by creator"), http.StatusNoContent)
	expect(apisAdmin, summaryEdit("by admin"), http.StatusNoContent)
	expect(apisDave, summaryEdit("by writer"), http.StatusForbidden)         // writer, not creator
	expect(apisErin, summaryEdit("by other reporter"), http.StatusForbidden) // reporter, not creator

	// Journal entries: creator, admins, and writers.
	expect(apisAlice, entryAdd("by creator"), http.StatusNoContent)
	expect(apisAdmin, entryAdd("by admin"), http.StatusNoContent)
	expect(apisDave, entryAdd("by writer"), http.StatusNoContent) // writer allowed to add entries
	expect(apisErin, entryAdd("by other reporter"), http.StatusForbidden)

	// The computed rights ride on the report JSON for callers who can read it.
	aliceView, resp := apisAlice.getReport(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.True(t, aliceView.MayEditSummary)     // creator
	require.True(t, aliceView.MayAddJournalEntry) // creator

	daveView, resp := apisDave.getReport(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.False(t, daveView.MayEditSummary)    // writer, not creator → no summary edit
	require.True(t, daveView.MayAddJournalEntry) // writer → may add entries
}

// TestReporterSeesOwnReport verifies own-report visibility is anchored on
// REPORT.CREATED_BY, not journal-entry authorship: a reporter always sees a report
// they created — even a bare one with no journal entry they authored — while a
// different reporter on the same event cannot see it. Regression guard for the
// report-visibility fix: the old journal-authorship heuristic hid a creator's own
// report when it carried no entry they authored.
func TestReporterSeesOwnReport(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)} // creator (reporter)
	apisErin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForErin(t, ctx)}   // other reporter

	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addReporter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addReporter(ctx, eventName, userErinHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Alice creates a bare report: no Summary, no journal entries. She authors no
	// journal entry on it, so only REPORT.CREATED_BY marks it as hers.
	num := apisAlice.newReportSuccess(ctx, imsjson.Report{Event: eventName})

	// The creator can read it directly...
	got, resp := apisAlice.getReport(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, num, got.Number)

	// ...and it shows up in her list of reports.
	list, resp := apisAlice.getReports(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.True(t, containsReport(list, num), "creator's own report must appear in their list")

	// A different reporter on the same event cannot see it (own-reports scope).
	_, resp = apisErin.getReport(ctx, eventName, num)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	erinList, resp := apisErin.getReports(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.False(t, containsReport(erinList, num), "another reporter must not see a report they didn't create")
}

// TestReportReadAuthorization covers the report reads' event-level gate through the Connect
// client. The retired REST GET routes' generic 401/403 sweep used to live in
// permissions_test; now that reading reports is Connect-only (plan 09h/1c), that coverage
// lives here: an unauthenticated caller is rejected (401), and an authenticated user with no
// report-read permission on the event is forbidden (403). The finer own/crew/all scoping is
// covered by TestReporterSeesOwnReport and the crew-leader tests. The event-level gate runs
// before any report lookup, so report #1 need not exist.
func TestReportReadAuthorization(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	notAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}
	aliceNoPerms := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Unauthenticated: both reads are 401.
	_, resp = notAuthenticated.getReports(ctx, eventName)
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, resp = notAuthenticated.getReport(ctx, eventName, 1)
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Authenticated but with no participation row on this event: both reads are 403.
	_, resp = aliceNoPerms.getReports(ctx, eventName)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, resp = aliceNoPerms.getReport(ctx, eventName, 1)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

// TestReportWriteAuthorization covers the coarse write gate the retired REST report-write routes
// used to exercise in the permissions sweep: unauthenticated callers are 401 and callers with no
// participation row on the event are 403, for all three writes (create, update, strike-a-journal-
// entry). The finer per-report edit rules (creator vs writer vs reporter) live in
// TestReportEditSummaryAndEntryAuthz and TestCreateAndUpdateReport.
func TestReportWriteAuthorization(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	notAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}
	aliceNoPerms := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Unauthenticated: all three writes are 401.
	resp = notAuthenticated.newReport(ctx, imsjson.Report{Event: eventName, Summary: new("x")})
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = notAuthenticated.updateReport(ctx, eventName, 1, imsjson.Report{Summary: new("x")})
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = notAuthenticated.updateReportJournalEntry(ctx, eventName, 1, imsjson.JournalEntry{ID: 1, Stricken: new(true)})
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Authenticated but with no participation row on this event: all three writes are 403.
	resp = aliceNoPerms.newReport(ctx, imsjson.Report{Event: eventName, Summary: new("x")})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = aliceNoPerms.updateReport(ctx, eventName, 1, imsjson.Report{Summary: new("x")})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = aliceNoPerms.updateReportJournalEntry(ctx, eventName, 1, imsjson.JournalEntry{ID: 1, Stricken: new(true)})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

func containsReport(reports imsjson.Reports, number int32) bool {
	for _, r := range reports {
		if r.Number == number {
			return true
		}
	}
	return false
}

// TestCreateReportAttachedToIncident covers 10e: a reporter may create a Report
// already attached to an incident, with no Summary yet (an IMS# can be added
// before/without a Summary). A bad incident number is a friendly 404, not a 500.
func TestCreateReportAttachedToIncident(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addWriter(ctx, eventName, userAdminHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addReporter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Admin creates an incident for the reporter to attach to.
	incidentNumber := apisAdmin.newIncidentSuccess(ctx, imsjson.Incident{Event: eventName})

	// The reporter creates a Report already attached to that incident, with no
	// Summary at all (IMS# before/without a Summary).
	num := apisAlice.newReportSuccess(ctx, imsjson.Report{
		Event:    eventName,
		Incident: new(incidentNumber),
	})

	got, resp := apisAlice.getReport(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, got.Incident)
	require.Equal(t, incidentNumber, *got.Incident)
	require.Nil(t, got.Summary)

	// Attaching a new Report to a nonexistent incident is a friendly 404.
	resp = apisAlice.newReport(ctx, imsjson.Report{
		Event:    eventName,
		Incident: new(int32(999999)),
	})
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

func TestCreateAndAttachFileToReport(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisNonAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	// Use the admin JWT to create a new event,
	// then give the normal user Reporter role on that event
	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addReporter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Use normal user to create a new Report
	reportReq := sampleReport1(eventName)
	num := apisNonAdmin.newReportSuccess(ctx, reportReq)
	reportReq.Number = num

	// Now we'll upload an attachment. The "file" will just be this slice of bytes.
	fileBytes := []byte("This is a text file maybe?")
	reID, resp := apisNonAdmin.attachFileToReport(ctx, eventName, num, fileBytes)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, http.StatusNoContent, resp.StatusCode)

	// Now call to fetch the attachment and check that it's the same as what we sent.
	returnedAttachment, resp := apisNonAdmin.getReportAttachment(ctx, eventName, num, reID)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, fileBytes, returnedAttachment)
	// A text file is safe to preview, so it's served inline (plan 90 L4).
	require.Equal(t, "inline", resp.Header.Get("Content-Disposition"))

	// Try to send something too large
	fileBytes = []byte(strings.Repeat("a", int(shared.cfg.Core.MaxRequestBytes+1)))
	_, resp = apisNonAdmin.attachFileToReport(ctx, eventName, num, fileBytes)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, http.StatusRequestEntityTooLarge, resp.StatusCode)
}

// requireEqualIncident is a hacky way of checking two incident responses are the same.
// It does not consider JournalEntries.
func requireEqualReport(t *testing.T, before, after imsjson.Report) {
	t.Helper()

	// These will always be different. Check them separately of this function
	before.JournalEntries, after.JournalEntries = nil, nil

	// If the timestamp field was set before, then check it's the same. Otherwise
	// see if it was set to some reasonable time for when the test was running
	if !before.Created.IsZero() {
		require.Equal(t, before.Created, after.Created)
	} else {
		require.WithinDuration(t, time.Now(), after.Created, 20*time.Minute)
	}
	before.Created, after.Created = time.Time{}, time.Time{}

	// CreatedBy is set by the server; the request won't have it.
	before.CreatedBy, after.CreatedBy = nil, nil

	// MayEditSummary / MayAddJournalEntry are per-caller edit rights the server
	// computes on read; they aren't part of the stored report, so ignore them here.
	before.MayEditSummary, after.MayEditSummary = false, false
	before.MayAddJournalEntry, after.MayAddJournalEntry = false, false

	require.Equal(t, before, after)
}

// TestJournalEntryOnBehalfOf covers 6m (per-entry model): a report journal entry
// can be filed "on behalf of" another person. The entry author is the submitter;
// on_behalf_of is the named person, surfaced on both the report GET and the list
// endpoint (the latter is how the incident merged view loads report entries). A
// bogus on-behalf id is rejected, and generated entries carry no on-behalf.
func TestJournalEntryOnBehalfOf(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addReporter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	const oboText = "walk-up reported something in the dust"

	// Alice files a report whose user entry is on behalf of the admin.
	req := imsjson.Report{
		Event:   eventName,
		Summary: new("on-behalf demo"),
		JournalEntries: []imsjson.JournalEntry{
			{Text: oboText, OnBehalfOfPersonID: new(int32(userAdminPersonID))},
		},
	}
	num := apisAlice.newReportSuccess(ctx, req)

	got, resp := apisAlice.getReport(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	var onBehalf *imsjson.Mention
	for _, e := range got.JournalEntries {
		if e.Text == oboText {
			onBehalf = e.OnBehalfOf
		}
		if e.SystemEntry {
			require.Nil(t, e.OnBehalfOf, "generated entries carry no on-behalf")
		}
	}
	require.NotNil(t, onBehalf, "expected the user entry to carry on_behalf_of")
	require.Equal(t, int32(userAdminPersonID), onBehalf.PersonID)

	// The same entry surfaces with on_behalf via the list endpoint (the incident
	// merged view loads attached-report entries this way).
	reports, resp := apisAlice.getReports(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	foundInList := false
	for _, r := range reports {
		if r.Number != num {
			continue
		}
		for _, e := range r.JournalEntries {
			if e.Text == oboText {
				require.NotNil(t, e.OnBehalfOf)
				require.Equal(t, int32(userAdminPersonID), e.OnBehalfOf.PersonID)
				foundInList = true
			}
		}
	}
	require.True(t, foundInList, "expected the on-behalf entry in the reports list")

	// A bogus on-behalf id is rejected with 400.
	bad := imsjson.Report{
		Event: eventName,
		JournalEntries: []imsjson.JournalEntry{
			{Text: "nope", OnBehalfOfPersonID: new(int32(nonexistentPersonID))},
		},
	}
	resp = apisAlice.newReport(ctx, bad)
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}
