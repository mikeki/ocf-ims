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
// validation, the email-required-for-password guard, email uniqueness (fair
// names are deliberately non-unique), that a created person appears in the
// admin listing and can log in by email, and the 404 guard on editing an
// unknown person. It uses dedicated fair names/emails so it doesn't disturb
// other parallel tests.
func TestCreateAndEditPerson(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	apisNoAuth := ApiHelper{t: t, serverURL: shared.serverURL}

	const newFairName = "EdithTestRanger"
	const newPassword = "edith-password"

	// A non-admin (no GlobalAdministratePersonnel) cannot create people.
	resp := apisAlice.createPerson(ctx, api.CreatePersonRequest{FairName: newFairName, Password: newPassword})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Validation: empty fair name and too-short password are rejected.
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{FairName: ""})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		FairName: newFairName, Email: "edithtestranger@example.com", Password: "short",
	})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// A password without an email is rejected: email is the sole login
	// identifier, so a person with a password but no email could never sign in.
	// Don't mint that unusable login — not even with a fair name present.
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{LegalName: "No Login Person", Password: newPassword})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{FairName: "NoEmailPerson", Password: newPassword})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	// The same name-only person without a password is a fine registry entry, though.
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{LegalName: "No Login Person"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The admin creates the person.
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		FairName: newFairName,
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

	// Fair names are not unique — a second person may go by the same one (email
	// is the identifier)...
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		FairName: newFairName, Email: "edithtestranger2@example.com", Password: newPassword,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	// ...but reusing an email is a conflict (EMAIL carries the unique key).
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		FairName: "SomeoneElseEntirely", Email: "edithtestranger@example.com", Password: newPassword,
	})
	require.Equal(t, http.StatusConflict, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The new person shows up in the admin listing...
	people, resp := apisAdmin.getAllPersonnel(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.True(t, slices.ContainsFunc(people, func(p imsjson.Person) bool {
		return p.FairName == newFairName
	}), "created person should appear in the admin listing")

	// ...and can log in with their email and the assigned password. The fair
	// name is not a login identifier (it isn't unique).
	statusCode, _, token := apisNoAuth.postAuth(ctx, api.PostAuthRequest{
		Identification: "edithtestranger@example.com",
		Password:       newPassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
	require.NotEmpty(t, token)
	statusCode, _, _ = apisNoAuth.postAuth(ctx, api.PostAuthRequest{
		Identification: newFairName,
		Password:       newPassword,
	})
	require.Equal(t, http.StatusUnauthorized, statusCode)

	// Editing an unknown person is a 404.
	resp = apisAdmin.editPerson(ctx, nonexistentPersonID, api.EditPersonRequest{})
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

// TestEditPersonProfileAndParticipation exercises the 5e.4 admin People editor:
// editing name + email (the closed frozen-email gap), the per-event wristband +
// participation-type upsert and its event scoping, the wristband-uniqueness
// conflict, and the identity invariant for a fair-name-less registry person. It uses
// a dedicated event and dedicated fair names so it doesn't disturb parallel tests.
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
		FairName: "FrankTestRanger",
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
		LegalName: &newName, Email: &newEmail,
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	people, resp := apisAdmin.getAllPersonnelForEvent(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	got := findPerson(t, people, frankID)
	require.Equal(t, newName, got.LegalName)
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
	require.Equal(t, newName, got.LegalName)
	require.Equal(t, newEmail, got.Email)

	// The per-event fields are scoped to the event: absent from the unscoped listing.
	peopleNoEvent, resp := apisAdmin.getAllPersonnel(ctx)
	require.NoError(t, resp.Body.Close())
	gotNoEvent := findPerson(t, peopleNoEvent, frankID)
	require.Empty(t, gotNoEvent.Wristband)
	require.Empty(t, gotNoEvent.ParticipationType)

	// --- wristband uniqueness within an event is a conflict. ---
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		FairName: "GraceTestRanger", Email: "grace@example.com", Password: "grace-password",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var grace imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&grace))
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.editPerson(ctx, grace.PersonID, api.EditPersonRequest{
		Event: eventName, Wristband: "Z-9001", ParticipationType: "volunteer",
	})
	require.Equal(t, http.StatusConflict, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// --- identity invariant: a fair-name-less registry person can't have name cleared. ---
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{LegalName: "Registry Only", Event: eventName})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var registry imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&registry))
	require.NoError(t, resp.Body.Close())
	emptyName := ""
	resp = apisAdmin.editPerson(ctx, registry.PersonID, api.EditPersonRequest{LegalName: &emptyName})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// --- gating: a non-admin can't edit a person. ---
	resp = apisAlice.editPerson(ctx, frankID, api.EditPersonRequest{})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

// TestPersonPhoneAndEditableFairName covers the contact-phone field and the
// now-editable fair name: a login-less person can carry an email + phone as contact
// info, and an admin can later change the fair name, email, and phone (with the fair name
// unique key still rejecting a collision).
func TestPersonPhoneAndEditableFairName(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}

	// A login-less contact: just a name, plus phone + email contact info (no fair name,
	// no password).
	resp := apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		LegalName: "Contact Only Person",
		Email:     "contact@example.com",
		Phone:     "555-0100",
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
	require.Empty(t, got.FairName)

	// Give them a fair name and change the phone in one edit.
	newFairName := "NowHasAFairName"
	newPhone := "555-0199"
	resp = apisAdmin.editPerson(ctx, contact.PersonID, api.EditPersonRequest{
		FairName: &newFairName, Phone: &newPhone,
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	people, resp = apisAdmin.getAllPersonnel(ctx)
	require.NoError(t, resp.Body.Close())
	got = findPerson(t, people, contact.PersonID)
	require.Equal(t, newFairName, got.FairName)
	require.Equal(t, newPhone, got.Phone)
	require.Equal(t, "contact@example.com", got.Email)

	// Fair names are not unique, so a second person may be edited onto the same
	// one — but reusing another person's email is a conflict (EMAIL is the login
	// identifier and carries the unique key).
	resp = apisAdmin.createPerson(ctx, api.CreatePersonRequest{
		FairName: "OtherFairName", Email: "other@example.com", Password: "other-password",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var other imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&other))
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.editPerson(ctx, other.PersonID, api.EditPersonRequest{FairName: &newFairName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	contactEmail := "contact@example.com"
	resp = apisAdmin.editPerson(ctx, other.PersonID, api.EditPersonRequest{Email: &contactEmail})
	require.Equal(t, http.StatusConflict, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// A person with a password logs in by email, so their email can't be cleared
	// out from under them — clear the password first.
	emptyEmail := ""
	resp = apisAdmin.editPerson(ctx, other.PersonID, api.EditPersonRequest{Email: &emptyEmail})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
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
	resp = apisAdmin.addWriter(ctx, eventName, userAdminFairName)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	makePerson := func(fairName string) int64 {
		r := apisAdmin.createPerson(ctx, api.CreatePersonRequest{
			FairName: fairName, Email: fairName + "@example.com", Password: fairName + "-pw-12345",
		})
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
