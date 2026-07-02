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
	"encoding/json"
	"net/http"
	"testing"

	"github.com/mikeki/ocf-ims/api"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
)

// TestCrewLeaderInvite exercises plan 53b: a non-admin holding the invite-reporters
// power (a crew leader or a writer) may create a login-capable reporter and set
// reporter participation on their event, but the anti-escalation ceiling is enforced
// server-side — they can never assign (or modify a target who already holds) the
// writer or crew_leader rung, and they have no power on an event they lack the bit
// on. The admin path stays unrestricted. Uses a dedicated event + handles so it
// doesn't disturb other parallel tests.
func TestCrewLeaderInvite(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisErin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForErin(t, ctx)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	apisNoAuth := ApiHelper{t: t, serverURL: shared.serverURL}

	// The crew leader's event, plus a second event she has no role on.
	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	otherEvent := rand.NonCryptoText()
	_, resp = apisAdmin.createEvent(ctx, imsjson.Event{Name: &otherEvent})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Make Erin a crew leader on eventName (an admin-only act).
	resp = apisAdmin.addCrewLeader(ctx, eventName, userErinHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// uniq builds a per-test-unique handle so the global PERSON.HANDLE unique key
	// never collides with another parallel test.
	uniq := func(prefix string) string { return prefix + rand.NonCryptoText() }

	// --- 1) The crew leader invites a login-capable reporter on her event. ---
	inviteeHandle := uniq("Invitee")
	const inviteePassword = "invitee-password-123"
	resp = apisErin.createPerson(ctx, api.CreatePersonRequest{
		FairName:          inviteeHandle,
		Email:             inviteeHandle + "@example.com",
		Password:          inviteePassword,
		Event:             eventName,
		ParticipationType: "reporter",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var invitee imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&invitee))
	require.NoError(t, resp.Body.Close())
	require.Positive(t, invitee.PersonID)
	require.Equal(t, "reporter", invitee.ParticipationType)

	// The invitee can actually log in with the initial password they were given.
	statusCode, _, token := apisNoAuth.postAuth(ctx, api.PostAuthRequest{
		Identification: inviteeHandle,
		Password:       inviteePassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
	require.NotEmpty(t, token)

	// The invitee shows up as a reporter on the event roster (read as admin, since the
	// full listing is GlobalAdministratePersonnel-gated).
	roster, resp := apisAdmin.getEventRoster(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, "reporter", findPerson(t, roster, invitee.PersonID).ParticipationType)

	// --- 2) Anti-escalation: she cannot mint a writer or another crew leader. ---
	for _, rung := range []string{"writer", "crew_leader"} {
		resp = apisErin.createPerson(ctx, api.CreatePersonRequest{
			FairName:          uniq("Escalate"),
			Password:          "escalate-password-123",
			Event:             eventName,
			ParticipationType: rung,
		})
		require.Equalf(t, http.StatusForbidden, resp.StatusCode, "crew leader must not create a %s", rung)
		require.NoError(t, resp.Body.Close())
	}

	// --- 3) She has no invite power on an event she lacks the bit on. ---
	resp = apisErin.createPerson(ctx, api.CreatePersonRequest{
		FairName:          uniq("Wrongevent"),
		Password:          "wrongevent-password-123",
		Event:             otherEvent,
		ParticipationType: "reporter",
	})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// --- 4) A plain non-participant (Alice, no role on eventName) cannot invite. ---
	resp = apisAlice.createPerson(ctx, api.CreatePersonRequest{
		FairName:          uniq("Alicemade"),
		Password:          "alicemade-password-123",
		Event:             eventName,
		ParticipationType: "reporter",
	})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// --- SetPersonParticipation path (enroll an existing person). ---
	// An existing registry person with no event role, created by the admin.
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{FairName: uniq("Target"), Password: "target-password-123"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var target imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&target))
	require.NoError(t, resp.Body.Close())

	// The crew leader can set them to reporter on her event.
	resp = apisErin.setParticipation(ctx, target.PersonID, eventName, api.SetParticipationRequest{ParticipationType: "reporter"})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// But not to writer or crew_leader (the value ceiling).
	for _, rung := range []string{"writer", "crew_leader"} {
		resp = apisErin.setParticipation(ctx, target.PersonID, eventName, api.SetParticipationRequest{ParticipationType: rung})
		require.Equalf(t, http.StatusForbidden, resp.StatusCode, "crew leader must not assign %s", rung)
		require.NoError(t, resp.Body.Close())
	}

	// Nor act on an event she lacks the bit on.
	resp = apisErin.setParticipation(ctx, target.PersonID, otherEvent, api.SetParticipationRequest{ParticipationType: "reporter"})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// --- 5) She cannot modify a target who already outranks her ceiling. ---
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{FairName: uniq("Bigshot"), Password: "bigshot-password-123"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var bigshot imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&bigshot))
	require.NoError(t, resp.Body.Close())
	// Admin makes bigshot a writer on the event.
	resp = apisAdmin.setParticipation(ctx, bigshot.PersonID, eventName, api.SetParticipationRequest{ParticipationType: "writer"})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	// The crew leader cannot demote (or otherwise touch) a writer.
	resp = apisErin.setParticipation(ctx, bigshot.PersonID, eventName, api.SetParticipationRequest{ParticipationType: "reporter"})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// --- 6) A writer also carries the invite power (not just crew leaders). ---
	writerEvent := rand.NonCryptoText()
	_, resp = apisAdmin.createEvent(ctx, imsjson.Event{Name: &writerEvent})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addWriter(ctx, writerEvent, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAlice.createPerson(ctx, api.CreatePersonRequest{
		FairName:          uniq("Writermade"),
		Password:          "writermade-password-123",
		Event:             writerEvent,
		ParticipationType: "reporter",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// --- 7) The admin path is unchanged: an admin may still mint a writer. ---
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		FairName:          uniq("Adminmade"),
		Password:          "adminmade-password-123",
		Event:             eventName,
		ParticipationType: "writer",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

// TestInviterRosterRead covers the 53d read-gating change: a non-admin inviter may
// read the People roster for an event they hold the invite bit on (so the People tab
// works for them), but the global / "show all" listings stay admin-only, and the
// roster they get back withholds the admin-only email + admin-flag columns.
func TestInviterRosterRead(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisErin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForErin(t, ctx)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addCrewLeader(ctx, eventName, userErinHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Put a login-capable person (with an email) on the roster.
	memberHandle := "RosterMember" + rand.NonCryptoText()
	memberEmail := memberHandle + "@example.com"
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		FairName:          memberHandle,
		Email:             memberEmail,
		Password:          "rostermember-password-123",
		Event:             eventName,
		ParticipationType: "reporter",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var member imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&member))
	require.NoError(t, resp.Body.Close())

	// The crew leader can read the event roster...
	roster, resp := apisErin.getEventRoster(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	got := findPerson(t, roster, member.PersonID)
	require.Equal(t, "reporter", got.ParticipationType)
	// ...but the admin-only columns are withheld from a non-admin viewer.
	require.Empty(t, got.Email, "inviter roster must not leak email")
	require.False(t, got.IsAdmin, "inviter roster must not leak admin flag")

	// The admin's view of the same roster DOES carry the email.
	adminRoster, resp := apisAdmin.getEventRoster(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, memberEmail, findPerson(t, adminRoster, member.PersonID).Email)

	// "Show all people" (the full per-event listing) stays admin-only.
	_, resp = apisErin.getAllPersonnelForEvent(ctx, eventName)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The global (no-event) listing stays admin-only.
	_, resp = apisErin.getAllPersonnel(ctx)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// A non-admin without the invite bit on the event can't read its roster either.
	_, resp = apisAlice.getEventRoster(ctx, eventName)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}
