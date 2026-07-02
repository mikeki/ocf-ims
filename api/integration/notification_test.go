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

// TestNotifications exercises plan 82's in-app notification generation and read
// API end to end: a "mentioned" notification from a journal entry mention, an
// "added_to_incident" notification from the attach-person path, self-notification
// suppression, dedup on involvement re-edit, and mark-all-read.
func TestNotifications(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	admin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	alice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	dave := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForDave(t, ctx)}
	erin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForErin(t, ctx)}

	eventName := rand.NonCryptoText()
	_, resp := admin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = admin.addWriter(ctx, eventName, userAliceFairName)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Alice creates an incident whose journal entry @mentions Dave and herself.
	// Dave should be notified; Alice (the author/actor) should not — self-mentions
	// are suppressed.
	num := alice.newIncidentSuccess(ctx, imsjson.Incident{
		Event: eventName,
		JournalEntries: []imsjson.JournalEntry{{
			Text:               "Paging @" + userDaveFairName + " for this one.",
			MentionedPersonIDs: []int32{userDavePersonID, userAlicePersonID},
		}},
	})

	// Assertions are scoped to THIS test's event: notifications are global per
	// person and these seed users are shared with other parallel tests (e.g. Dave
	// is also attached to an incident in TestIncidentGrant), so a global count
	// would be racy.
	daveForEvent := dave.notificationsForEvent(ctx, eventName)
	require.Len(t, daveForEvent, 1)
	require.Equal(t, "mentioned", daveForEvent[0].Type)
	require.NotNil(t, daveForEvent[0].IncidentNumber)
	require.Equal(t, num, *daveForEvent[0].IncidentNumber)
	require.NotEmpty(t, daveForEvent[0].Actor)
	require.False(t, daveForEvent[0].Read)

	// Alice — the actor — has nothing for this event (self-mention suppressed).
	require.Empty(t, alice.notificationsForEvent(ctx, eventName))

	// Alice adds Erin to the incident's involvement -> Erin is notified.
	resp = alice.attachPersonToIncident(ctx, eventName, num, userErinPersonID)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	erinForEvent := erin.notificationsForEvent(ctx, eventName)
	require.Len(t, erinForEvent, 1)
	require.Equal(t, "added_to_incident", erinForEvent[0].Type)
	require.Equal(t, num, *erinForEvent[0].IncidentNumber)

	// Re-attaching Erin (an involvement edit) must NOT create a second
	// notification — only a genuine new add notifies.
	resp = alice.attachPersonToIncident(ctx, eventName, num, userErinPersonID)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Len(t, erin.notificationsForEvent(ctx, eventName), 1)

	// Dave marks all read: the notification stays but is now read.
	resp = dave.markAllNotificationsRead(ctx)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	daveForEvent = dave.notificationsForEvent(ctx, eventName)
	require.Len(t, daveForEvent, 1)
	require.True(t, daveForEvent[0].Read)
}

// TestReportMentionNotification verifies a "mentioned" notification is generated
// for an @mention in a field-report journal entry, linked to the report (not an
// incident) — the report mirror of the incident-mention path.
//
// The mentioned recipient is the admin user, deliberately disjoint from the
// recipients in TestNotifications (Dave/Erin): notifications are global per
// person, so two parallel tests notifying the same person would clash on count.
// We match this test's own notification by report number rather than asserting
// an exact unread count, for the same reason.
func TestReportMentionNotification(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	admin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	alice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	eventName := rand.NonCryptoText()
	_, resp := admin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = admin.addWriter(ctx, eventName, userAliceFairName)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	summary := "report that mentions someone"
	reportNum := alice.newReportSuccess(ctx, imsjson.Report{
		Event:   eventName,
		Summary: &summary,
		JournalEntries: []imsjson.JournalEntry{{
			Text:               "Hey @" + userAdminFairName + ", please review.",
			MentionedPersonIDs: []int32{userAdminPersonID},
		}},
	})

	forEvent := admin.notificationsForEvent(ctx, eventName)
	require.Len(t, forEvent, 1, "exactly one notification for this event")
	n := forEvent[0]
	require.Equal(t, "mentioned", n.Type)
	require.NotNil(t, n.ReportNumber)
	require.Equal(t, reportNum, *n.ReportNumber)
	require.Nil(t, n.IncidentNumber, "a report mention links to a report, not an incident")
	require.NotEmpty(t, n.Actor)
	require.False(t, n.Read)
}
