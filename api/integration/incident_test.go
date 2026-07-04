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

func sampleIncident1(eventName string) imsjson.Incident {
	return imsjson.Incident{
		Event:    eventName,
		State:    "open",
		Priority: 5,
		Summary:  new("my summary!"),
		Location: imsjson.Location{
			Description: new("unknown"),
		},
		IncidentTypeIDs: &[]int32{1, 2},
		Reports:         &[]int32{},
		Visits:          &[]int32{},
		People:          &[]imsjson.IncidentPerson{{PersonID: userAdminPersonID, Handle: userAdminHandle}, {PersonID: userAlicePersonID, Handle: userAliceHandle}},
		JournalEntries: []imsjson.JournalEntry{
			{Text: "This is some journal text lol"},
			{Text: ""},
		},
		LinkedIncidents: &[]imsjson.LinkedIncident{},
	}
}

func TestIncidentAPIAuthorization(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	adminUser := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	aliceUser := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	notAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}

	// Make an event to which no one has any access
	eventName := rand.NonCryptoText()
	_, resp := adminUser.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Alright, now test hitting all the Incident endpoints

	// For the user who isn't authenticated at all (no JWT)
	_, resp = notAuthenticated.getIncidents(ctx, eventName)
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, resp = notAuthenticated.getIncident(ctx, eventName, 1)
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = notAuthenticated.newIncident(ctx, imsjson.Incident{Event: eventName})
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = notAuthenticated.updateIncident(ctx, eventName, 1, imsjson.Incident{})
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// For a normal user without permissions on the event
	_, resp = aliceUser.getIncidents(ctx, eventName)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, resp = aliceUser.getIncident(ctx, eventName, 1)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = aliceUser.updateIncident(ctx, eventName, 1, imsjson.Incident{})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = aliceUser.newIncident(ctx, imsjson.Incident{Event: eventName})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// An admin bypasses per-event roles (plan 52b): full access on the event with
	// no participation row. Reads succeed (a missing incident is 404, not 403). We
	// only read here to avoid creating an incident that would shift the numbering of
	// the writer-access checks below.
	_, resp = adminUser.getIncidents(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, resp = adminUser.getIncident(ctx, eventName, 1)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// make Alice a writer
	resp = adminUser.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Now Alice get access all the Incidents endpoints for this event
	_, resp = aliceUser.getIncidents(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, resp = aliceUser.getIncident(ctx, eventName, 1)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = aliceUser.newIncident(ctx, imsjson.Incident{Event: eventName})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = aliceUser.updateIncident(ctx, eventName, 1, imsjson.Incident{})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

func TestCreateAndGetIncident(t *testing.T) {
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
	for _, r := range *incidentReq.People {
		resp = apisNonAdmin.attachPersonToIncident(ctx, eventName, num, r.PersonID)
		require.Equal(t, http.StatusNoContent, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
	}

	{
		// Use normal user to fetch that Incident from the API and check it over
		retrievedIncident, resp := apisNonAdmin.getIncident(ctx, eventName, num)
		require.Equal(t, http.StatusOK, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
		require.NotNil(t, retrievedIncident)
		require.WithinDuration(t, time.Now(), retrievedIncident.Created, 5*time.Minute)
		require.WithinDuration(t, time.Now(), retrievedIncident.Started, 5*time.Minute)
		require.WithinDuration(t, time.Now(), retrievedIncident.LastModified, 5*time.Minute)
		require.Len(t, retrievedIncident.JournalEntries, 4)

		// The first journal entry will be the system entry. The second should be the one we sent in the request
		retrievedUserEntry := retrievedIncident.JournalEntries[1]
		retrievedUserEntry.ID = 0
		require.WithinDuration(t, time.Now(), retrievedUserEntry.Created, 5*time.Minute)
		retrievedUserEntry.Created = time.Time{}
		entryReq.Author = userAliceHandle
		entryReq.Stricken = new(false)
		require.Equal(t, entryReq, retrievedUserEntry)
		requireEqualIncident(t, incidentReq, retrievedIncident)
	}

	{
		// Now get the incident via the GetIncidents (plural) endpoint, and repeat the validation
		retrievedIncidents, resp := apisNonAdmin.getIncidents(ctx, eventName)
		require.Equal(t, http.StatusOK, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
		require.Len(t, retrievedIncidents, 1)

		// The first entry will be the system entry. The second should be the one we sent in the request
		retrievedUserEntry := retrievedIncidents[0].JournalEntries[1]
		retrievedUserEntry.ID = 0
		require.WithinDuration(t, time.Now(), retrievedUserEntry.Created, 5*time.Minute)
		retrievedUserEntry.Created = time.Time{}
		entryReq.Author = userAliceHandle
		require.Equal(t, entryReq, retrievedUserEntry)
		requireEqualIncident(t, incidentReq, retrievedIncidents[0])
	}
}

func TestCreateAndUpdateIncident(t *testing.T) {
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

	// Use normal user to create a new Incident.
	incidentReq := sampleIncident1(eventName)
	num := apisNonAdmin.newIncidentSuccess(ctx, incidentReq)
	incidentReq.Number = num

	retrievedNewIncident, resp := apisNonAdmin.getIncident(ctx, eventName, num)
	require.NoError(t, resp.Body.Close())

	// Now let's update the incident. First let's try changing nothing.
	updates := imsjson.Incident{
		Event:  incidentReq.Event,
		Number: num,
	}

	resp = apisNonAdmin.updateIncident(ctx, eventName, num, updates)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	retrievedIncidentAfterUpdate, resp := apisNonAdmin.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	requireEqualIncident(t, retrievedNewIncident, retrievedIncidentAfterUpdate)

	// now let's set all fields to empty
	updates = imsjson.Incident{
		Event:  incidentReq.Event,
		Number: num,
		State:  "closed",
		// need to send some time for this other than zero for the time to update
		Started:  time.UnixMilli(1),
		Priority: 1,
		Summary:  new(""),
		Location: imsjson.Location{
			AreaSlug:    new(""),
			Description: new(""),
		},
		IncidentTypeIDs: &[]int32{},
		Reports:         &[]int32{},
		People:          &[]imsjson.IncidentPerson{},
		JournalEntries:  []imsjson.JournalEntry{},
	}
	resp = apisNonAdmin.updateIncident(ctx, eventName, num, updates)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	// then check the result
	retrievedIncidentAfterUpdate, resp = apisNonAdmin.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	expected := imsjson.Incident{
		Event:           eventName,
		Number:          num,
		State:           "closed",
		Closed:          time.Now(),
		Priority:        1,
		Started:         time.UnixMilli(1),
		Location:        imsjson.Location{},
		IncidentTypeIDs: &[]int32{},
		Reports:         &[]int32{},
		Visits:          &[]int32{},
		People:          &[]imsjson.IncidentPerson{},
		LinkedIncidents: &[]imsjson.LinkedIncident{},
	}
	requireEqualIncident(t, expected, retrievedIncidentAfterUpdate)

	// attach a person
	resp = apisNonAdmin.attachPersonToIncident(ctx, eventName, num, userAlicePersonID)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	retrievedIncidentAfterUpdate, resp = apisNonAdmin.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Len(t, *retrievedIncidentAfterUpdate.People, 1)
	require.Equal(t, userAliceHandle, (*retrievedIncidentAfterUpdate.People)[0].Handle)

	// detach that person
	resp = apisNonAdmin.detachPersonFromIncident(ctx, eventName, num, userAlicePersonID)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	retrievedIncidentAfterUpdate, resp = apisNonAdmin.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Empty(t, *retrievedIncidentAfterUpdate.People)
}

func TestCreateAndAttachFileToIncident(t *testing.T) {
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
	num := apisNonAdmin.newIncidentSuccess(ctx, incidentReq)
	incidentReq.Number = num

	// Now we'll upload an attachment. The "file" will just be this slice of bytes.
	fileBytes := []byte("This is a text file maybe?")
	reID, resp := apisNonAdmin.attachFileToIncident(ctx, eventName, num, fileBytes)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, http.StatusNoContent, resp.StatusCode)

	// Now call to fetch the attachment and check that it's the same as what we sent.
	returnedAttachment, resp := apisNonAdmin.getIncidentAttachment(ctx, eventName, num, reID)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, fileBytes, returnedAttachment)

	// Try to send something too large
	fileBytes = []byte(strings.Repeat("a", int(shared.cfg.Core.MaxRequestBytes+1)))
	_, resp = apisNonAdmin.attachFileToIncident(ctx, eventName, num, fileBytes)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, http.StatusRequestEntityTooLarge, resp.StatusCode)
}

func TestCreateAndLinkIncidents(t *testing.T) {
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

	// Use normal user to create two new Incidents
	incidentReq1 := sampleIncident1(eventName)
	num1 := apisNonAdmin.newIncidentSuccess(ctx, incidentReq1)
	incidentReq1.Number = num1
	incidentReq2 := sampleIncident1(eventName)
	num2 := apisNonAdmin.newIncidentSuccess(ctx, incidentReq2)
	incidentReq2.Number = num2

	// Link one incident to the other
	retrievedNewIncident1, resp := apisNonAdmin.getIncident(ctx, eventName, num1)
	require.NoError(t, resp.Body.Close())
	eventID := retrievedNewIncident1.EventID
	retrievedNewIncident2, resp := apisNonAdmin.getIncident(ctx, eventName, num2)
	require.NoError(t, resp.Body.Close())
	*retrievedNewIncident1.LinkedIncidents = append(*retrievedNewIncident1.LinkedIncidents, imsjson.LinkedIncident{
		EventID: eventID,
		Number:  num2,
	})
	resp = apisNonAdmin.updateIncident(ctx, eventName, num1, retrievedNewIncident1)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Now each incident is linked to the other
	{
		retrievedNewIncident1, resp = apisNonAdmin.getIncident(ctx, eventName, num1)
		require.Equal(t, http.StatusOK, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
		require.Len(t, *retrievedNewIncident1.LinkedIncidents, 1)
		linkedIncident := (*retrievedNewIncident1.LinkedIncidents)[0]
		require.Equal(t, eventID, linkedIncident.EventID)
		require.Equal(t, num2, linkedIncident.Number)
		require.Equal(t, eventName, linkedIncident.EventName)
		require.Equal(t, *retrievedNewIncident2.Summary, linkedIncident.Summary)
	}
	{
		retrievedNewIncident2, resp = apisNonAdmin.getIncident(ctx, eventName, num2)
		require.Equal(t, http.StatusOK, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
		require.Len(t, *retrievedNewIncident2.LinkedIncidents, 1)
		linkedIncident := (*retrievedNewIncident2.LinkedIncidents)[0]
		require.Equal(t, eventID, linkedIncident.EventID)
		require.Equal(t, num1, linkedIncident.Number)
		require.Equal(t, eventName, linkedIncident.EventName)
		require.Equal(t, *retrievedNewIncident1.Summary, linkedIncident.Summary)
	}

	retrievedNewIncident2.LinkedIncidents = &[]imsjson.LinkedIncident{}
	resp = apisNonAdmin.updateIncident(ctx, eventName, num2, retrievedNewIncident2)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	{
		retrievedNewIncident1, resp = apisNonAdmin.getIncident(ctx, eventName, num1)
		require.Equal(t, http.StatusOK, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
		require.Empty(t, *retrievedNewIncident1.LinkedIncidents)
	}
	{
		retrievedNewIncident2, resp = apisNonAdmin.getIncident(ctx, eventName, num2)
		require.Equal(t, http.StatusOK, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
		require.Empty(t, *retrievedNewIncident2.LinkedIncidents)
	}
}

// TestIncidentLocationArea exercises the structured location FK (Phase 4c):
// an incident can reference an AREA in its own event, the freeform detail is
// retained alongside it, and a slug that isn't an area of this event is rejected
// with a 400 (including an area that exists only in another event).
func TestIncidentLocationArea(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	admin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	writer := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	eventName := makeEvent(ctx, t, admin)
	resp := admin.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Admin creates an area in this event; the test uses the returned slug, so its
	// exact value doesn't matter (events start with an inherited area set).
	slug, resp := admin.editArea(ctx, eventName, imsjson.Area{Name: new("Test Area One")})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.NotEmpty(t, slug)

	// Create an incident referencing that area plus a freeform detail.
	num := writer.newIncidentSuccess(ctx, imsjson.Incident{
		Event: eventName,
		Location: imsjson.Location{
			AreaSlug:    new(slug),
			Description: new("by the north gate"),
		},
	})

	got, resp := writer.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, slug, deref(got.Location.AreaSlug))
	require.Equal(t, "by the north gate", deref(got.Location.Description))

	// An unknown slug for this event is a 400.
	resp = writer.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event:    eventName,
		Number:   num,
		Location: imsjson.Location{AreaSlug: new("no-such-area")},
	})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// An area that exists only in another event is also rejected (areas are per-event).
	otherEvent := makeEvent(ctx, t, admin)
	otherSlug, resp := admin.editArea(ctx, otherEvent, imsjson.Area{Name: new("Other Event Spot")})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.NotEmpty(t, otherSlug)
	resp = writer.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event:    eventName,
		Number:   num,
		Location: imsjson.Location{AreaSlug: new(otherSlug)},
	})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The original area survived the rejected updates.
	got, resp = writer.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, slug, deref(got.Location.AreaSlug))

	// Clearing the area (empty slug) leaves the freeform detail intact.
	resp = writer.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event:    eventName,
		Number:   num,
		Location: imsjson.Location{AreaSlug: new("")},
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	got, resp = writer.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Nil(t, got.Location.AreaSlug)
	require.Equal(t, "by the north gate", deref(got.Location.Description))
}

// TestIncidentLocationBooth exercises the optional booth field (Phase 6/6b):
// it round-trips on create, can be updated, an empty string clears it, and a nil
// booth on an unrelated edit leaves the existing value intact.
func TestIncidentLocationBooth(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	admin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	writer := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	eventName := makeEvent(ctx, t, admin)
	resp := admin.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Create an incident with a booth number.
	num := writer.newIncidentSuccess(ctx, imsjson.Incident{
		Event: eventName,
		Location: imsjson.Location{
			Booth: new("B12"),
		},
	})

	got, resp := writer.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, "B12", deref(got.Location.Booth))

	// Update the booth, leaving everything else unset (nil) — booth changes,
	// nothing else is disturbed.
	resp = writer.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event:    eventName,
		Number:   num,
		Location: imsjson.Location{Booth: new("B34")},
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	got, resp = writer.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, "B34", deref(got.Location.Booth))

	// An edit with a nil booth (here, editing only the summary) leaves the
	// existing booth intact.
	resp = writer.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event:   eventName,
		Number:  num,
		Summary: new("a summary"),
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	got, resp = writer.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, "B34", deref(got.Location.Booth))

	// An empty-string booth clears it back to unset (nil on read).
	resp = writer.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event:    eventName,
		Number:   num,
		Location: imsjson.Location{Booth: new("")},
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	got, resp = writer.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Nil(t, got.Location.Booth)
}

func TestIncidentOutcome(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	admin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	writer := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	eventName := makeEvent(ctx, t, admin)
	resp := admin.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Outcomes are data-driven now (slice 10a); resolve seeded dispositions by name.
	resolvedOnScene := writer.outcomeIDByName(ctx, "Resolved On Scene")
	transported := writer.outcomeIDByName(ctx, "Transported in Ambulance")

	// Create an incident carrying a disposition.
	num := writer.newIncidentSuccess(ctx, imsjson.Incident{
		Event:     eventName,
		OutcomeID: &resolvedOnScene,
	})

	got, resp := writer.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, resolvedOnScene, deref(got.OutcomeID))

	// Outcome is orthogonal to state: it survives a state change.
	resp = writer.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event:  eventName,
		Number: num,
		State:  "closed",
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	got, resp = writer.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, resolvedOnScene, deref(got.OutcomeID))

	// An OCF-specific disposition (seeded in migration 00019) is accepted.
	resp = writer.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event:     eventName,
		Number:    num,
		OutcomeID: &transported,
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	got, resp = writer.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, transported, deref(got.OutcomeID))

	// An outcome id referencing no OUTCOME row is rejected with 400 (stricter than
	// STATE's silent ignore).
	bogus := int32(9999999)
	resp = writer.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event:     eventName,
		Number:    num,
		OutcomeID: &bogus,
	})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The prior outcome survived the rejected update.
	got, resp = writer.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, transported, deref(got.OutcomeID))

	// outcome_id=0 clears the outcome back to unset (null).
	clearOutcome := int32(0)
	resp = writer.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event:     eventName,
		Number:    num,
		OutcomeID: &clearOutcome,
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	got, resp = writer.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Nil(t, got.OutcomeID)
}

func deref[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}

// requireEqualIncident is a hacky way of checking two incident responses are the same.
// It does not consider JournalEntries.
func requireEqualIncident(t *testing.T, before, after imsjson.Incident) {
	t.Helper()

	// This field isn't in use in the client yet
	// require.Equal(t, before.EventID, after.EventID)
	require.Equal(t, before.Event, after.Event)
	require.Equal(t, before.Number, after.Number)

	// If the timestamp field was set before, then check it's the same. Otherwise
	// see if it was set to some reasonable time for when the test was running
	if !before.Created.IsZero() {
		require.Equal(t, before.Created, after.Created)
	} else {
		require.WithinDuration(t, time.Now(), after.Created, 20*time.Minute)
	}
	if !before.Started.IsZero() {
		require.WithinDuration(t, before.Started, after.Started, 1*time.Millisecond)
	} else {
		require.WithinDuration(t, time.Now(), after.Started, 20*time.Minute)
	}
	require.WithinDuration(t, before.Closed, after.Closed, 1*time.Minute)

	before.EventID, after.EventID = 0, 0
	before.Created, after.Created = time.Time{}, time.Time{}
	before.Started, after.Started = time.Time{}, time.Time{}
	before.Closed, after.Closed = time.Time{}, time.Time{}
	before.LastModified, after.LastModified = time.Time{}, time.Time{}
	before.JournalEntries, after.JournalEntries = nil, nil
	// ViewerMayAddJournal and IncidentPerson.{GrantedAccess,HasEventAccess} are
	// server-computed view fields (52f), not part of a create/update request, so
	// normalize them out of this request-vs-retrieved comparison. Dedicated 52f tests
	// cover their values.
	before.ViewerMayAddJournal, after.ViewerMayAddJournal = false, false
	before.CreatedBy, after.CreatedBy = nil, nil
	for _, ppl := range []*[]imsjson.IncidentPerson{before.People, after.People} {
		if ppl == nil {
			continue
		}
		for i := range *ppl {
			(*ppl)[i].GrantedAccess = false
			(*ppl)[i].HasEventAccess = false
		}
	}

	require.Equal(t, before, after)
}
