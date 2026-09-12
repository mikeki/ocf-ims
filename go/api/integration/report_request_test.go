// SPDX-License-Identifier: Apache-2.0

package integration_test

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/mikeki/ocf-ims/api"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/push"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRequestReport covers plan 09t's "request a report" (3b.3a): the ask lands on the
// involvement row with a grant, a system entry, a report_requested notification and a push;
// the reporter's filed report shows up as delivered; a repeat re-notifies; an involvement edit
// keeps the ask; the gate and privacy rules match every other incident write.
func TestRequestReport(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	// A dedicated server with a capturing push sender (see TestPushFanoutDelivery).
	spy := &capturingSender{}
	mux := api.AddToMux(nil, shared.es, shared.cfg, shared.imsDBQ, shared.userStore, nil, shared.actionLogger)
	api.AddConnectToMux(mux, shared.cfg, shared.imsDBQ, shared.actionLogger, shared.userStore, shared.es, shared.watchHub, shared.metricsCache, spy, nil)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	srvURL, err := url.Parse(srv.URL)
	require.NoError(t, err)

	admin := ApiHelper{t: t, serverURL: srvURL, jwt: jwtForAdmin(ctx, t)}
	alice := ApiHelper{t: t, serverURL: srvURL, jwt: jwtForAlice(t, ctx)} // writer, creator
	erin := ApiHelper{t: t, serverURL: srvURL, jwt: jwtForErin(t, ctx)}   // writer
	dave := ApiHelper{t: t, serverURL: srvURL, jwt: jwtForDave(t, ctx)}   // reporter

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

	// Dave's device, keyed by a unique endpoint so other tests' devices don't matter.
	endpoint := "https://push.test/" + rand.NonCryptoText()
	require.NoError(t, shared.imsDBQ.InsertPushSubscription(ctx, shared.imsDBQ, imsdb.InsertPushSubscriptionParams{
		PersonID: userDavePersonID,
		Endpoint: endpoint,
		Kind:     string(push.KindWeb),
		P256dh:   sql.NullString{String: "p256dh-dave", Valid: true},
		Auth:     sql.NullString{String: "auth-dave", Valid: true},
		Created:  1,
	}))

	num := alice.newIncidentSuccess(ctx, imsjson.Incident{Event: eventName, Summary: new("needs accounts")})

	// The gate: a reporter may not ask; an unknown person is not found.
	resp = dave.requestReport(ctx, eventName, num, userErinPersonID)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = alice.requestReport(ctx, eventName, num, 1<<30)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = alice.requestReport(ctx, eventName, num+1000, userDavePersonID)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Before the ask Dave cannot read the incident at all.
	_, resp = dave.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The ask.
	before := time.Now().Add(-time.Second)
	resp = alice.requestReport(ctx, eventName, num, userDavePersonID)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	incident, resp := alice.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	daveRow := personRow(t, incident, userDavePersonID)
	require.True(t, daveRow.GrantedAccess, "a request grants per-incident access")
	require.NotNil(t, daveRow.ReportRequested)
	require.True(t, daveRow.ReportRequested.After(before))
	require.Nil(t, daveRow.ReportNumber, "nothing delivered yet")
	firstAsk := *daveRow.ReportRequested
	require.True(t, hasSystemEntry(incident, "Report requested from"), "the ask is on the timeline")
	require.True(t, hasSystemEntry(incident, "Added person:"), "the person was attached by the ask")

	// Granted, Dave reads the incident and sees his own state.
	got, resp := dave.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, personRow(t, got, userDavePersonID).ReportRequested)

	// The notification and the push.
	notes := dave.notificationsForEvent(ctx, eventName)
	require.Len(t, notes, 1)
	require.Equal(t, "report_requested", notes[0].Type)
	require.NotNil(t, notes[0].IncidentNumber)
	require.Equal(t, num, *notes[0].IncidentNumber)
	require.NotEmpty(t, notes[0].Actor)
	require.False(t, notes[0].Read)

	require.EventuallyWithT(t, func(c *assert.CollectT) {
		assert.Len(c, spy.sendsTo(endpoint), 1)
	}, 5*time.Second, 20*time.Millisecond)
	msg := spy.sendsTo(endpoint)[0]
	assert.Equal(t, "OCF IMS", msg.Title)
	assert.Equal(t, userAliceHandle+" asked for your report on incident #"+strconv.Itoa(int(num)), msg.Body)
	assert.Equal(t, "/ims/app/events/"+eventName+"/reports/new?incident="+strconv.Itoa(int(num)), msg.URL)

	// Dave delivers: a report linked to the incident shows on his row.
	reportNum := dave.newReportSuccess(ctx, imsjson.Report{
		Event:          eventName,
		Summary:        new("my account"),
		Incident:       &num,
		JournalEntries: []imsjson.JournalEntry{{Text: "I saw it happen."}},
	})
	incident, resp = alice.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	daveRow = personRow(t, incident, userDavePersonID)
	require.NotNil(t, daveRow.ReportNumber)
	require.Equal(t, reportNum, *daveRow.ReportNumber)

	// The list read carries the same two fields.
	incidents, resp := alice.getIncidents(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	var listed *imsjson.Incident
	for i := range incidents {
		if incidents[i].Number == num {
			listed = &incidents[i]
		}
	}
	require.NotNil(t, listed)
	listedRow := personRow(t, *listed, userDavePersonID)
	require.NotNil(t, listedRow.ReportRequested)
	require.NotNil(t, listedRow.ReportNumber)
	require.Equal(t, reportNum, *listedRow.ReportNumber)

	// A repeat request re-stamps and re-notifies.
	time.Sleep(5 * time.Millisecond)
	resp = erin.requestReport(ctx, eventName, num, userDavePersonID)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	incident, resp = alice.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	daveRow = personRow(t, incident, userDavePersonID)
	require.NotNil(t, daveRow.ReportRequested)
	require.True(t, daveRow.ReportRequested.After(firstAsk))
	require.Len(t, dave.notificationsForEvent(ctx, eventName), 2)

	// An involvement edit keeps the ask.
	resp = alice.attachPersonToIncidentBody(ctx, eventName, num, userDavePersonID,
		imsjson.IncidentPerson{Involvement: new("witness"), GrantedAccess: true})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	incident, resp = alice.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	daveRow = personRow(t, incident, userDavePersonID)
	require.NotNil(t, daveRow.ReportRequested)
	require.NotNil(t, daveRow.Involvement)
	require.Equal(t, "witness", *daveRow.Involvement)

	// Privacy: a writer who may not view a private incident cannot ask on it (404,
	// existence hidden); its creator can, and the grant then opens it to the reporter.
	private := alice.newIncidentSuccess(ctx, imsjson.Incident{Event: eventName, Summary: new("quiet")})
	resp = alice.updateIncident(ctx, eventName, private, imsjson.Incident{Event: eventName, Number: private, Private: new(true)})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = erin.requestReport(ctx, eventName, private, userDavePersonID)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = alice.requestReport(ctx, eventName, private, userDavePersonID)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, resp = dave.getIncident(ctx, eventName, private)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

func personRow(t *testing.T, incident imsjson.Incident, personID int64) imsjson.IncidentPerson {
	t.Helper()
	require.NotNil(t, incident.People)
	for _, p := range *incident.People {
		if p.PersonID == personID {
			return p
		}
	}
	require.Failf(t, "person not on incident", "person %d is not attached to incident %d", personID, incident.Number)
	return imsjson.IncidentPerson{}
}

func hasSystemEntry(incident imsjson.Incident, text string) bool {
	for _, e := range incident.JournalEntries {
		if e.SystemEntry && strings.Contains(e.Text, text) {
			return true
		}
	}
	return false
}
