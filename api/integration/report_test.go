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
	resp = apisAdmin.addReporter(ctx, eventName, userAliceFairName)
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
		entryReq.Author = userAliceFairName
		entryReq.AuthorPersonID = userAlicePersonID
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
		entryReq.Author = userAliceFairName
		entryReq.AuthorPersonID = userAlicePersonID
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
	resp = apisAdmin.addWriter(ctx, eventName, userAdminFairName)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addReporter(ctx, eventName, userAliceFairName)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Use normal user to create a new Report
	reportReq := sampleReport1(eventName)
	num := apisAlice.newReportSuccess(ctx, reportReq)
	reportReq.Number = num

	retrievedNewReport, resp := apisAlice.getReport(ctx, eventName, num)
	require.NoError(t, resp.Body.Close())

	// Now let's update the FR. First let's try just adding an incident number.
	updates := imsjson.Report{
		Event:    reportReq.Event,
		Number:   num,
		Incident: new(int32(12345)),
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
	resp = apisAdmin.addReporter(ctx, eventName, userAliceFairName)
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
	resp = apisAdmin.addReporter(ctx, eventName, userAliceFairName)
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
