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
	"slices"
	"testing"

	"github.com/mikeki/ocf-ims/api"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
)

// findPerson returns the listing entry with the given person_id, failing the test
// if it isn't present.
func findPerson(t *testing.T, people []imsjson.Person, personID int64) imsjson.Person {
	t.Helper()
	i := slices.IndexFunc(people, func(p imsjson.Person) bool { return p.PersonID == personID })
	require.GreaterOrEqual(t, i, 0, "person %d not found in listing", personID)
	return people[i]
}

// TestCreateAndEditPerson exercises in-app person creation: permission gating,
// validation, the duplicate-handle guard, that a created person appears in the
// admin listing and can log in, and the 404 guard on editing an unknown person.
// It uses dedicated handles so it doesn't disturb other parallel tests.
func TestCreateAndEditPerson(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	apisNoAuth := ApiHelper{t: t, serverURL: shared.serverURL}

	const newHandle = "EdithTestRanger"
	const newPassword = "edith-password"

	// A non-admin (no GlobalAdministratePersonnel) cannot create people.
	resp := apisAlice.createPerson(ctx, api.CreatePersonRequest{Handle: newHandle, Password: newPassword})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Validation: empty handle and too-short password are rejected.
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{Handle: ""})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{Handle: newHandle, Email: "shorttest@example.com", Password: "short"})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Granting IMS access (a password) requires a fair name specifically (feedback
	// round 9): the fair name is the identity the UI keys on, so a password without
	// one is rejected — even when an email is present. A name-only person with a
	// password is rejected...
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{Name: "No Login Person", Password: newPassword})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	// ...and so is a legal-name + email person with a password but no fair name.
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{Name: "No Fair Name", Email: "nofairname@example.com", Password: newPassword})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	// The same name-only person without a password is a fine registry entry, though.
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{Name: "No Login Person"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The admin creates the person.
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		Handle:   newHandle,
		Email:    "edithtestranger@example.com",
		Password: newPassword,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	// The 201 must carry an application/json content type, or the browser client's
	// fetchNoThrow won't parse the body (it gates on the exact content type). This
	// guards the slice-6g regression where the header was set after WriteHeader.
	require.Equal(t, "application/json", resp.Header.Get("Content-Type"))
	// Create returns the new person (with its server-assigned person_id), which is
	// the URL key for the edits below.
	var created imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&created))
	require.NoError(t, resp.Body.Close())
	require.Positive(t, created.PersonID)

	// Creating the same handle again is a conflict (a distinct email keeps the handle
	// the sole collision).
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{Handle: newHandle, Email: "edith-dup@example.com", Password: newPassword})
	require.Equal(t, http.StatusConflict, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The new person shows up in the admin listing...
	people, resp := apisAdmin.getAllPersonnel(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.True(t, slices.ContainsFunc(people, func(p imsjson.Person) bool {
		return p.Handle == newHandle
	}), "created person should appear in the admin listing")

	// ...and can log in (by email — the sole login identifier) with the assigned
	// password.
	statusCode, _, token := apisNoAuth.postAuth(ctx, api.PostAuthRequest{
		Identification: "edithtestranger@example.com",
		Password:       newPassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
	require.NotEmpty(t, token)

	// A person who can sign in (has a password) can't have their email cleared —
	// login is by email only, so clearing it would strand the account.
	emptyEmail := ""
	resp = apisAdmin.editPerson(ctx, created.PersonID, api.EditPersonRequest{Email: &emptyEmail})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Granting access needs an email: a password with a fair name but no email is
	// rejected (email is the login identifier).
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{Handle: "NoEmailAccess", Password: newPassword})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Editing an unknown person is a 404.
	resp = apisAdmin.editPerson(ctx, nonexistentPersonID, api.EditPersonRequest{})
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

// TestEditPersonProfileAndParticipation exercises the 5e.4 admin People editor:
// editing name + email (the closed frozen-email gap), the per-event wristband +
// participation-type upsert and its event scoping, the wristband-uniqueness
// conflict, and the identity invariant for a handle-less registry person. It uses
// a dedicated event and dedicated handles so it doesn't disturb parallel tests.
func TestEditPersonProfileAndParticipation(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	// A dedicated event so this test's per-event participation rows don't collide
	// with any other test's wristbands.
	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// A login-capable person to edit.
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		Handle:   "FrankTestRanger",
		Email:    "frank@example.com",
		Password: "frank-password",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var frank imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&frank))
	require.NoError(t, resp.Body.Close())
	frankID := frank.PersonID

	// --- profile edit: name + email both change (the frozen-email gap is closed). ---
	newName := "Franklin Delano"
	newEmail := "franklin@example.com"
	resp = apisAdmin.editPerson(ctx, frankID, api.EditPersonRequest{
		Name: &newName, Email: &newEmail,
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	people, resp := apisAdmin.getAllPersonnelForEvent(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	got := findPerson(t, people, frankID)
	require.Equal(t, newName, got.Name)
	require.Equal(t, newEmail, got.Email)

	// --- per-event participation upsert, with name/email left unchanged (nil). ---
	resp = apisAdmin.editPerson(ctx, frankID, api.EditPersonRequest{
		Event: eventName, Wristband: "Z-9001", ParticipationType: "volunteer",
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	people, resp = apisAdmin.getAllPersonnelForEvent(ctx, eventName)
	require.NoError(t, resp.Body.Close())
	got = findPerson(t, people, frankID)
	require.Equal(t, "Z-9001", got.Wristband)
	require.Equal(t, "volunteer", got.ParticipationType)
	// The nil-pointer name/email were preserved, not cleared.
	require.Equal(t, newName, got.Name)
	require.Equal(t, newEmail, got.Email)

	// The per-event fields are scoped to the event: absent from the unscoped listing.
	peopleNoEvent, resp := apisAdmin.getAllPersonnel(ctx)
	require.NoError(t, resp.Body.Close())
	gotNoEvent := findPerson(t, peopleNoEvent, frankID)
	require.Empty(t, gotNoEvent.Wristband)
	require.Empty(t, gotNoEvent.ParticipationType)

	// --- wristband uniqueness within an event is a conflict. ---
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{Handle: "GraceTestRanger", Email: "grace@example.com", Password: "grace-password"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var grace imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&grace))
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.editPerson(ctx, grace.PersonID, api.EditPersonRequest{
		Event: eventName, Wristband: "Z-9001", ParticipationType: "volunteer",
	})
	require.Equal(t, http.StatusConflict, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// --- identity invariant: a handle-less registry person can't have name cleared. ---
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{Name: "Registry Only", Event: eventName})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var registry imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&registry))
	require.NoError(t, resp.Body.Close())
	emptyName := ""
	resp = apisAdmin.editPerson(ctx, registry.PersonID, api.EditPersonRequest{Name: &emptyName})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// --- gating: a non-admin can't edit a person. ---
	resp = apisAlice.editPerson(ctx, frankID, api.EditPersonRequest{})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

// TestPersonPhoneAndEditableHandle covers the contact-phone field and the
// now-editable handle: a login-less person can carry an email + phone as contact
// info, and an admin can later change the handle, email, and phone (with the handle
// unique key still rejecting a collision).
func TestPersonPhoneAndEditableHandle(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}

	// A login-less contact: just a name, plus phone + email contact info (no handle,
	// no password).
	resp := apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		Name:  "Contact Only Person",
		Email: "contact@example.com",
		Phone: "555-0100",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var contact imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&contact))
	require.NoError(t, resp.Body.Close())

	people, resp := apisAdmin.getAllPersonnel(ctx)
	require.NoError(t, resp.Body.Close())
	got := findPerson(t, people, contact.PersonID)
	require.Equal(t, "contact@example.com", got.Email)
	require.Equal(t, "555-0100", got.Phone)
	require.Empty(t, got.Handle)

	// Give them a handle and change the phone in one edit.
	newHandle := "NowHasAHandle"
	newPhone := "555-0199"
	resp = apisAdmin.editPerson(ctx, contact.PersonID, api.EditPersonRequest{
		Handle: &newHandle, Phone: &newPhone,
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	people, resp = apisAdmin.getAllPersonnel(ctx)
	require.NoError(t, resp.Body.Close())
	got = findPerson(t, people, contact.PersonID)
	require.Equal(t, newHandle, got.Handle)
	require.Equal(t, newPhone, got.Phone)
	require.Equal(t, "contact@example.com", got.Email)

	// A second person can't take the same handle: the unique key surfaces as 409.
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{Handle: "OtherHandle", Email: "otherhandle@example.com", Password: "other-password"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var other imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&other))
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.editPerson(ctx, other.PersonID, api.EditPersonRequest{Handle: &newHandle})
	require.Equal(t, http.StatusConflict, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

// TestEventRosterAddRemove exercises the per-event participation roster (slice 6j):
// enrolling an existing person, the roster-vs-show-all listings, recording an
// ejection (the row is kept and the wristband preserved), deleting a participation
// row ("added by mistake" — the global person and an incident link both survive),
// and the validation + gating on the new participation endpoints.
func TestEventRosterAddRemove(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	// Being an admin confers only global permissions; the event-scoped incident write
	// below still needs an explicit grant.
	resp = apisAdmin.addWriter(ctx, eventName, userAdminHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	makePerson := func(handle string) int64 {
		r := apisAdmin.createPerson(ctx, api.CreatePersonRequest{Handle: handle, Email: handle + "@example.com", Password: handle + "-pw-12345"})
		require.Equal(t, http.StatusCreated, r.StatusCode)
		var p imsjson.Person
		require.NoError(t, json.NewDecoder(r.Body).Decode(&p))
		require.NoError(t, r.Body.Close())
		return p.PersonID
	}
	ivanID := makePerson("IvanRosterTester")
	juliaID := makePerson("JuliaRosterTester")

	containsPerson := func(people []imsjson.Person, id int64) bool {
		return slices.ContainsFunc(people, func(p imsjson.Person) bool { return p.PersonID == id })
	}

	// A fresh event's roster is empty, though both people exist globally.
	roster, resp := apisAdmin.getEventRoster(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.False(t, containsPerson(roster, ivanID))
	require.False(t, containsPerson(roster, juliaID))

	// Enroll Ivan (only) as a volunteer.
	resp = apisAdmin.setParticipation(ctx, ivanID, eventName, api.SetParticipationRequest{ParticipationType: "volunteer"})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	roster, resp = apisAdmin.getEventRoster(ctx, eventName)
	require.NoError(t, resp.Body.Close())
	require.True(t, containsPerson(roster, ivanID))
	require.False(t, containsPerson(roster, juliaID))
	require.Equal(t, "volunteer", findPerson(t, roster, ivanID).ParticipationType)

	// "Show all" lists everyone for the event, enrolled or not.
	all, resp := apisAdmin.getAllPersonnelForEvent(ctx, eventName)
	require.NoError(t, resp.Body.Close())
	require.True(t, containsPerson(all, ivanID))
	require.True(t, containsPerson(all, juliaID))

	// Eject Ivan, resending the wristband so it's preserved on the kept row.
	resp = apisAdmin.setParticipation(ctx, ivanID, eventName, api.SetParticipationRequest{Wristband: "W-1", ParticipationType: "volunteer"})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.setParticipation(ctx, ivanID, eventName, api.SetParticipationRequest{Wristband: "W-1", ParticipationType: "ejected"})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	roster, resp = apisAdmin.getEventRoster(ctx, eventName)
	require.NoError(t, resp.Body.Close())
	ivan := findPerson(t, roster, ivanID)
	require.Equal(t, "ejected", ivan.ParticipationType) // kept, not removed
	require.Equal(t, "W-1", ivan.Wristband)             // preserved, not cleared

	// Attach Ivan to an incident so we can prove removal leaves that link intact.
	num := apisAdmin.newIncidentSuccess(ctx, imsjson.Incident{
		Event: eventName, State: "new", Priority: 3, Summary: new("roster test incident"),
	})
	resp = apisAdmin.attachPersonToIncident(ctx, eventName, num, ivanID)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Remove Ivan's participation ("added by mistake"): gone from the roster, but the
	// global person and his incident link both survive.
	resp = apisAdmin.removeParticipation(ctx, ivanID, eventName)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	roster, resp = apisAdmin.getEventRoster(ctx, eventName)
	require.NoError(t, resp.Body.Close())
	require.False(t, containsPerson(roster, ivanID))

	allGlobal, resp := apisAdmin.getAllPersonnel(ctx)
	require.NoError(t, resp.Body.Close())
	require.True(t, containsPerson(allGlobal, ivanID), "removing participation must not delete the global person")

	incident, resp := apisAdmin.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Len(t, *incident.People, 1, "incident person link must survive participation removal")

	// --- validation + gating ---
	// Unknown participation type is rejected.
	resp = apisAdmin.setParticipation(ctx, juliaID, eventName, api.SetParticipationRequest{ParticipationType: "bogus"})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// A non-admin can neither set nor remove participation.
	resp = apisAlice.setParticipation(ctx, juliaID, eventName, api.SetParticipationRequest{ParticipationType: "volunteer"})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAlice.removeParticipation(ctx, ivanID, eventName)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

// TestPersonProfileCard exercises the by-id lookup that backs the person profile
// card (GET /ims/api/personnel?person_id=&event=). It asserts the role-gated shape:
// identity (fair name + full legal name) and the event's participation go to any
// authenticated viewer, while email/phone are withheld from a non-admin and included
// for a personnel admin. It also covers the not-found and invalid-id guards.
func TestPersonProfileCard(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// A person with a full profile, enrolled in the event as a volunteer with a
	// wristband, so every profile-card field is populated.
	handle := "ProfileCardSubject"
	r := apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		Handle:            handle,
		Name:              "Percy Card",
		Email:             "percy-card@example.com",
		Phone:             "555-0100",
		Password:          handle + "-pw-12345",
		Event:             eventName,
		Wristband:         "WB-42",
		ParticipationType: "volunteer",
	})
	require.Equal(t, http.StatusCreated, r.StatusCode)
	var created imsjson.Person
	require.NoError(t, json.NewDecoder(r.Body).Decode(&created))
	require.NoError(t, r.Body.Close())
	subjectID := created.PersonID

	// Admin sees everything, including contact info + the event's participation.
	people, resp := apisAdmin.getPersonnelByID(ctx, subjectID, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Len(t, people, 1)
	adminView := people[0]
	require.Equal(t, subjectID, adminView.PersonID)
	require.Equal(t, handle, adminView.Handle)
	require.Equal(t, "Percy Card", adminView.Name)
	require.Equal(t, "percy-card@example.com", adminView.Email)
	require.Equal(t, "555-0100", adminView.Phone)
	require.Equal(t, "volunteer", adminView.ParticipationType)
	require.Equal(t, "WB-42", adminView.Wristband)

	// A non-admin viewer sees identity + participation, but NOT contact info.
	people, resp = apisAlice.getPersonnelByID(ctx, subjectID, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Len(t, people, 1)
	aliceView := people[0]
	require.Equal(t, handle, aliceView.Handle)
	require.Equal(t, "Percy Card", aliceView.Name, "full legal name is visible to any viewer")
	require.Equal(t, "volunteer", aliceView.ParticipationType)
	require.Equal(t, "WB-42", aliceView.Wristband)
	require.Empty(t, aliceView.Email, "email is admin-only")
	require.Empty(t, aliceView.Phone, "phone is admin-only")

	// Without an event scope the per-event fields are simply absent.
	people, resp = apisAlice.getPersonnelByID(ctx, subjectID, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Len(t, people, 1)
	require.Empty(t, people[0].ParticipationType)
	require.Empty(t, people[0].Wristband)
	require.Equal(t, handle, people[0].Handle)

	// A nonexistent person id is a 404.
	_, resp = apisAlice.getPersonnelByID(ctx, 999999999, eventName)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// A non-numeric person_id is a 400.
	badPath := shared.serverURL.JoinPath("/ims/api/personnel").String() + "?person_id=notanumber"
	_, resp = apisAlice.imsGet(ctx, badPath, nil)
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}
