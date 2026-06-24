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
	resp = admin.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Alice creates an incident whose journal entry @mentions Dave and herself.
	// Dave should be notified; Alice (the author/actor) should not — self-mentions
	// are suppressed.
	num := alice.newIncidentSuccess(ctx, imsjson.Incident{
		Event: eventName,
		JournalEntries: []imsjson.JournalEntry{{
			Text:               "Paging @" + userDaveHandle + " for this one.",
			MentionedPersonIDs: []int32{userDavePersonID, userAlicePersonID},
		}},
	})

	// Dave has one unread "mentioned" notification pointing at the incident.
	daveNotifs, resp := dave.getNotifications(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, int64(1), daveNotifs.Unread)
	require.Len(t, daveNotifs.Notifications, 1)
	require.Equal(t, "mentioned", daveNotifs.Notifications[0].Type)
	require.Equal(t, eventName, daveNotifs.Notifications[0].Event)
	require.NotNil(t, daveNotifs.Notifications[0].IncidentNumber)
	require.Equal(t, num, *daveNotifs.Notifications[0].IncidentNumber)
	require.NotEmpty(t, daveNotifs.Notifications[0].Actor)
	require.False(t, daveNotifs.Notifications[0].Read)

	// Alice — the actor — has nothing (self-mention suppressed).
	aliceNotifs, resp := alice.getNotifications(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, int64(0), aliceNotifs.Unread)
	require.Empty(t, aliceNotifs.Notifications)

	// Alice adds Erin to the incident's involvement -> Erin is notified.
	resp = alice.attachPersonToIncident(ctx, eventName, num, userErinPersonID)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	erinNotifs, resp := erin.getNotifications(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, int64(1), erinNotifs.Unread)
	require.Len(t, erinNotifs.Notifications, 1)
	require.Equal(t, "added_to_incident", erinNotifs.Notifications[0].Type)
	require.Equal(t, num, *erinNotifs.Notifications[0].IncidentNumber)

	// Re-attaching Erin (an involvement edit) must NOT create a second
	// notification — only a genuine new add notifies.
	resp = alice.attachPersonToIncident(ctx, eventName, num, userErinPersonID)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	erinNotifs, resp = erin.getNotifications(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, int64(1), erinNotifs.Unread)
	require.Len(t, erinNotifs.Notifications, 1)

	// Dave marks all read: the notification stays but its unread count drops.
	resp = dave.markAllNotificationsRead(ctx)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	daveNotifs, resp = dave.getNotifications(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, int64(0), daveNotifs.Unread)
	require.Len(t, daveNotifs.Notifications, 1)
	require.True(t, daveNotifs.Notifications[0].Read)
}
