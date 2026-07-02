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

package api

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/mikeki/ocf-ims/directory"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/argon2id"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

const (
	maxHandleLength    = 64
	maxNameLength      = 255
	maxEmailLength     = 128
	maxPhoneLength     = 32
	maxWristbandLength = 32
)

// dupEntryError is the MariaDB error number for a unique-constraint violation.
const dupEntryError = 1062

// CreatePerson adds a new person to the registry. Gating has two tiers:
//   - A personnel admin (GlobalAdministratePersonnel) may create anyone:
//     login-capable, any participation rung, optionally on an event. Minting admins
//     stays separate (SetPersonAdmin).
//   - A non-admin must name an event they may invite reporters to
//     (EventInviteReporters — writers and crew leaders, plan 53b). On that event
//     they too may create a login-capable person (the crew-leader invite), but the
//     participation they assign is ceilinged to reporter / no-access rungs (never
//     writer or crew_leader — see mayAssignParticipation). This path also serves
//     the 5e "name-only field create" (writers registering someone met at an
//     incident/visit), since writers carry the invite bit.
//
// A password is optional (without one the person can't log in until someone sets
// one). The created person is returned as JSON so an inline-create from the attach
// picker can immediately attach the new person.
type CreatePerson struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
}

type CreatePersonRequest struct {
	Handle string `json:"handle"`
	Name   string `json:"name"`
	Email  string `json:"email"`
	// Phone is an optional contact number, collectable even for a login-less person.
	Phone string `json:"phone"`
	// #nosec G117 // Exported secret field
	Password string `json:"password"`
	// Event-scoped participation (all optional). When an event is named a
	// PERSON__EVENT row is written so the new person carries a wristband and
	// classification for that fair. participation_type is honored explicitly only
	// for personnel admins; for field (event-writer) creates it defaults from the
	// wristband (present -> volunteer, absent -> public). See R3 / D-P1.
	Event             string `json:"event"`
	Wristband         string `json:"wristband"`
	ParticipationType string `json:"participation_type"`
}

func (action CreatePerson) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.createPerson(req)
	if errHTTP != nil {
		errHTTP.From("[createPerson]").WriteResponse(w)
		return
	}
	mustWriteJSONStatus(w, req, http.StatusCreated, resp)
}

func (action CreatePerson) createPerson(req *http.Request) (imsjson.Person, *herr.HTTPError) {
	var empty imsjson.Person
	jwtCtx, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return empty, errHTTP.From("[getGlobalPermissions]")
	}

	body, errHTTP := readBodyAs[CreatePersonRequest](req)
	if errHTTP != nil {
		return empty, errHTTP.From("[readBodyAs]")
	}

	handle := strings.TrimSpace(body.Handle)
	name := strings.TrimSpace(body.Name)
	email := strings.TrimSpace(body.Email)
	phone := strings.TrimSpace(body.Phone)
	wristband := strings.TrimSpace(body.Wristband)

	// Identity: a registry person needs at least a handle or a name.
	if handle == "" && name == "" {
		return empty, herr.BadRequest("A handle or name is required", nil)
	}
	if len(handle) > maxHandleLength {
		return empty, herr.BadRequest("Handle is too long", nil)
	}
	if len(name) > maxNameLength {
		return empty, herr.BadRequest("Name is too long", nil)
	}
	if len(email) > maxEmailLength {
		return empty, herr.BadRequest("Email is too long", nil)
	}
	if len(phone) > maxPhoneLength {
		return empty, herr.BadRequest("Phone number is too long", nil)
	}
	if len(wristband) > maxWristbandLength {
		return empty, herr.BadRequest("Wristband is too long", nil)
	}

	isPersonnelAdmin := globalPermissions&authz.GlobalAdministratePersonnel != 0

	// Gating tiers. A personnel admin may create anyone — login-capable, any rung,
	// optionally on an event. A non-admin must name an event they may invite
	// reporters to (plan 53b: EventInviteReporters, held by writers and crew
	// leaders); on that event they may create a login-capable person, but the
	// participation they assign is ceilinged (no writer/crew_leader). This subsumes
	// the original 5e "name-only field create" path, since writers carry the bit.
	var eventID int32
	if !isPersonnelAdmin {
		eventID, errHTTP = action.eventForInvite(req, jwtCtx, body.Event)
		if errHTTP != nil {
			return empty, errHTTP
		}
	} else if strings.TrimSpace(body.Event) != "" {
		var event imsdb.Event
		event, errHTTP = getEvent(req, strings.TrimSpace(body.Event), action.imsDBQ)
		if errHTTP != nil {
			return empty, errHTTP.From("[getEvent]")
		}
		eventID = event.ID
	}

	// Per-event participation type: honored explicitly for admins and non-admin
	// inviters alike, but a non-admin is ceilinged to reporter / no-access rungs
	// (never writer or crew_leader). Absent an explicit type, default from the
	// wristband (present -> volunteer, absent -> public).
	participation := defaultParticipation(wristband)
	if ptStr := strings.TrimSpace(body.ParticipationType); ptStr != "" {
		pt, ok := validParticipation(ptStr)
		if !ok {
			return empty, herr.BadRequest("Unknown participation_type: "+ptStr, nil)
		}
		if !mayAssignParticipation(isPersonnelAdmin, pt) {
			return empty, herr.Forbidden("Only an admin may assign the writer or crew_leader role", nil)
		}
		participation = pt
	}

	handleNull := conv.StringToSql(&handle, maxHandleLength) // null when empty
	nameNull := conv.StringToSql(&name, maxNameLength)

	var emailNull sql.NullString
	if email != "" {
		emailNull = conv.StringToSql(&email, maxEmailLength)
	}

	var phoneNull sql.NullString
	if phone != "" {
		phoneNull = conv.StringToSql(&phone, maxPhoneLength)
	}

	// Identity alone (the handle-or-name invariant above) is enough to CREATE a
	// person, but granting IMS access requires a fair name specifically (feedback
	// round 9): a login-capable person must have one. (postAuth still matches the
	// typed identification against HANDLE/EMAIL, never the legal name.)
	if body.Password != "" && handle == "" {
		return empty, herr.BadRequest("A fair name is required to provide IMS access", nil)
	}

	// A password is optional, but if given it must satisfy the same bounds as the
	// reset endpoint (see postAuth re: the long-password hashing-exhaustion vector).
	var passwordNull sql.NullString
	if body.Password != "" {
		if len(body.Password) < minPasswordLength {
			return empty, herr.BadRequest("Password must be at least 8 characters", nil)
		}
		if len(body.Password) > 256 {
			return empty, herr.BadRequest("Outrageously long passwords are disallowed", ErrLongPassword)
		}
		hashed := argon2id.CreateHash(body.Password, argon2id.DefaultParams)
		passwordNull = conv.StringToSql(&hashed, 255)
	}

	// Friendly pre-check on the handle (the unique constraint is the backstop below,
	// and also catches a concurrent insert and the EMAIL uniqueness).
	if handle != "" {
		_, err := action.imsDBQ.PersonByHandle(req.Context(), action.imsDBQ, handleNull)
		if err == nil {
			return empty, herr.Conflict("A person with that handle already exists", nil)
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return empty, herr.InternalServerError("Failed to check handle", err).From("[PersonByHandle]")
		}
	}

	newID, err := action.imsDBQ.CreatePerson(req.Context(), action.imsDBQ, imsdb.CreatePersonParams{
		Handle:   handleNull,
		Name:     nameNull,
		Email:    emailNull,
		Phone:    phoneNull,
		Password: passwordNull,
		Created:  conv.TimeToFloat(time.Now()),
	})
	if err != nil {
		var mysqlErr *mysql.MySQLError
		if errors.As(err, &mysqlErr) && mysqlErr.Number == dupEntryError {
			return empty, herr.Conflict("That handle or email is already in use", nil)
		}
		return empty, herr.InternalServerError("Failed to create person", err).From("[CreatePerson]")
	}

	resp := imsjson.Person{
		PersonID: newID,
		Handle:   handle,
		Name:     name,
		Email:    email,
		Phone:    phone,
	}

	// Write the per-event participation row when an event was named. The person is
	// brand-new, so this is always an insert; a wristband already taken in the event
	// is a conflict (the DB's EVENT,WRISTBAND unique key).
	if eventID != 0 {
		var wristbandNull sql.NullString
		if wristband != "" {
			wristbandNull = conv.StringToSql(&wristband, maxWristbandLength)
		}
		err = action.imsDBQ.InsertPersonEvent(req.Context(), action.imsDBQ, imsdb.InsertPersonEventParams{
			PersonID:          int32(newID),
			Event:             eventID,
			Wristband:         wristbandNull,
			ParticipationType: participation,
		})
		if err != nil {
			return empty, wristbandConflict(err)
		}
		resp.Wristband = wristband
		resp.ParticipationType = string(participation)
	}

	// The directory is cached, so drop it to surface the new person immediately.
	action.userStore.InvalidateUsers()

	// #nosec G706 // log injection
	slog.Info("Created person", "person_id", newID, "handle", handle, "name", name)
	return resp, nil
}

// eventForInvite authorizes a non-admin create: the caller must name an event they
// may invite reporters to (EventInviteReporters — writers and crew leaders, plan
// 53b). Returns that event's ID for the PERSON__EVENT row. Both the 5e field create
// (writers registering someone met at an incident/visit) and the crew-leader invite
// take this path.
func (action CreatePerson) eventForInvite(req *http.Request, jwtCtx JWTContext, eventName string) (int32, *herr.HTTPError) {
	eventName = strings.TrimSpace(eventName)
	if eventName == "" {
		return 0, herr.Forbidden("Creating a person requires GlobalAdministratePersonnel, or invite-reporters access on a named event", nil)
	}
	event, errHTTP := getEvent(req, eventName, action.imsDBQ)
	if errHTTP != nil {
		return 0, errHTTP.From("[getEvent]")
	}
	perms, _, err := authz.EventPermissions(req.Context(), &event.ID, action.imsDBQ, *jwtCtx.Claims)
	if err != nil {
		return 0, herr.InternalServerError("Failed to compute permissions", err).From("[EventPermissions]")
	}
	if perms[event.ID]&authz.EventInviteReporters == 0 {
		return 0, herr.Forbidden("You do not have invite-reporters access to that event", nil)
	}
	return event.ID, nil
}

// defaultParticipation classifies a new person from their wristband: someone with
// a wristband is a volunteer; without one, public. Admins can override (e.g. to
// promote a volunteer to reporter/writer on the People page). See R3.
func defaultParticipation(wristband string) imsdb.PersonEventParticipationType {
	if strings.TrimSpace(wristband) != "" {
		return imsdb.PersonEventParticipationTypeVolunteer
	}
	return imsdb.PersonEventParticipationTypePublic
}

// validParticipation validates a participation_type string against the enum.
// validParticipation recognizes every PARTICIPATION_TYPE value (plan 52b's single
// access ladder, extended by 53a): writer/crew_leader/reporter are the
// access-bearing rungs an admin promotes to (crew_leader has reporter-level access
// plus the invite-reporters power); volunteer/public are the no-access roster
// roles; not_present/ejected are the kept-but-inactive states set by the roster's
// "remove" flow (eject / not present), recorded on the row rather than deleting it
// (slice 6j).
func validParticipation(s string) (imsdb.PersonEventParticipationType, bool) {
	switch imsdb.PersonEventParticipationType(s) {
	case imsdb.PersonEventParticipationTypeWriter,
		imsdb.PersonEventParticipationTypeCrewLeader,
		imsdb.PersonEventParticipationTypeReporter,
		imsdb.PersonEventParticipationTypeVolunteer,
		imsdb.PersonEventParticipationTypePublic,
		imsdb.PersonEventParticipationTypeNotPresent,
		imsdb.PersonEventParticipationTypeEjected:
		return imsdb.PersonEventParticipationType(s), true
	}
	return "", false
}

// mayAssignParticipation enforces the anti-escalation ceiling (plan 53b). An admin
// (GlobalAdministratePersonnel) may assign any rung. A non-admin inviter
// (EventInviteReporters) may assign only 'reporter' or a no-access rung
// (volunteer/public/not_present/ejected) — NEVER 'writer' or 'crew_leader', so a
// crew leader can't mint other inviters/writers. This is the authoritative
// server-side boundary; the UI restrictions in 53d are convenience only.
func mayAssignParticipation(callerIsAdmin bool, target imsdb.PersonEventParticipationType) bool {
	if callerIsAdmin {
		return true
	}
	switch target {
	case imsdb.PersonEventParticipationTypeWriter, imsdb.PersonEventParticipationTypeCrewLeader:
		return false
	default:
		return true
	}
}

// EditPerson updates a person's editable profile and, when an event is named, that
// person's per-event participation. Gated on GlobalAdministratePersonnel like
// CreatePerson. The handle is now editable (authorization derives from
// PERSON__EVENT + IS_ADMIN, not the handle, since EVENT_ACCESS was retired); the
// password and admin flag are still changed via their own endpoints.
type EditPerson struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
}

// EditPersonRequest carries the profile edit plus an optional per-event update.
// Handle, Name, Email, and Phone are pointers so the field can be distinguished
// from "" (clear): nil leaves the value unchanged, a non-nil pointer sets it (empty
// string clears). Email and Phone are contact fields collectable for login-less
// people too. The per-event block is applied only when Event is named (the admin
// People page scopes it to the selected event); Wristband/ParticipationType then
// upsert that person's PERSON__EVENT row.
type EditPersonRequest struct {
	Handle            *string `json:"handle"`
	Name              *string `json:"name"`
	Email             *string `json:"email"`
	Phone             *string `json:"phone"`
	Event             string  `json:"event"`
	Wristband         string  `json:"wristband"`
	ParticipationType string  `json:"participation_type"`
}

func (action EditPerson) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.editPerson(req)
	if errHTTP != nil {
		errHTTP.From("[editPerson]").WriteResponse(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (action EditPerson) editPerson(req *http.Request) *herr.HTTPError {
	_, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return errHTTP.From("[getGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalAdministratePersonnel == 0 {
		return herr.Forbidden("The requestor does not have GlobalAdministratePersonnel permission", nil)
	}

	body, errHTTP := readBodyAs[EditPersonRequest](req)
	if errHTTP != nil {
		return errHTTP.From("[readBodyAs]")
	}

	// The person is addressed by stable ID in the URL path (registry people may have
	// no handle since 5e).
	person, errHTTP := personByIDFromPath(req.Context(), action.imsDBQ, req)
	if errHTTP != nil {
		return errHTTP
	}

	// Handle/Name/Email/Phone default to the stored values; a non-nil pointer
	// overrides (empty clears). Compute handle and name first, then enforce the
	// identity invariant on the *resulting* pair: a person must keep at least a
	// handle or a name, else they'd have no human identifier left.
	handle := person.Handle
	if body.Handle != nil {
		trimmed := strings.TrimSpace(*body.Handle)
		if len(trimmed) > maxHandleLength {
			return herr.BadRequest("Handle is too long", nil)
		}
		handle = conv.StringToSql(&trimmed, maxHandleLength) // null when empty
	}
	name := person.Name
	if body.Name != nil {
		trimmed := strings.TrimSpace(*body.Name)
		if len(trimmed) > maxNameLength {
			return herr.BadRequest("Name is too long", nil)
		}
		name = conv.StringToSql(&trimmed, maxNameLength) // null when empty
	}
	if handle.String == "" && name.String == "" {
		return herr.BadRequest("A handle or name is required", nil)
	}
	email := person.Email
	if body.Email != nil {
		trimmed := strings.TrimSpace(*body.Email)
		if len(trimmed) > maxEmailLength {
			return herr.BadRequest("Email is too long", nil)
		}
		email = conv.StringToSql(&trimmed, maxEmailLength) // null when empty
	}
	phone := person.Phone
	if body.Phone != nil {
		trimmed := strings.TrimSpace(*body.Phone)
		if len(trimmed) > maxPhoneLength {
			return herr.BadRequest("Phone number is too long", nil)
		}
		phone = conv.StringToSql(&trimmed, maxPhoneLength) // null when empty
	}

	err := action.imsDBQ.EditPerson(req.Context(), action.imsDBQ, imsdb.EditPersonParams{
		Handle: handle,
		Name:   name,
		Email:  email,
		Phone:  phone,
		ID:     person.ID,
	})
	if err != nil {
		var mysqlErr *mysql.MySQLError
		if errors.As(err, &mysqlErr) && mysqlErr.Number == dupEntryError {
			return herr.Conflict("That handle or email is already in use", nil)
		}
		return herr.InternalServerError("Failed to edit person", err).From("[EditPerson]")
	}

	// Per-event participation: applied only when an event is named and the admin
	// actually engaged the per-event fields (a wristband or a participation type).
	// This avoids minting a stray 'public' PERSON__EVENT row just for editing a
	// profile while an event happens to be selected.
	errHTTP = action.editParticipation(req, person.ID, body)
	if errHTTP != nil {
		return errHTTP
	}

	action.userStore.InvalidateUsers()

	// #nosec G706 // log injection
	slog.Info("Edited person", "person_id", person.ID, "handle", person.Handle.String)
	return nil
}

// editParticipation upserts the person's PERSON__EVENT row when the edit names an
// event and supplies a wristband or participation type. A blank wristband clears
// that column; an omitted participation type defaults from the wristband.
func (action EditPerson) editParticipation(req *http.Request, personID int32, body EditPersonRequest) *herr.HTTPError {
	if strings.TrimSpace(body.Event) == "" {
		return nil
	}
	wristband := strings.TrimSpace(body.Wristband)
	ptStr := strings.TrimSpace(body.ParticipationType)
	if wristband == "" && ptStr == "" {
		return nil
	}
	if len(wristband) > maxWristbandLength {
		return herr.BadRequest("Wristband is too long", nil)
	}

	participation := defaultParticipation(wristband)
	if ptStr != "" {
		pt, ok := validParticipation(ptStr)
		if !ok {
			return herr.BadRequest("Unknown participation_type: "+ptStr, nil)
		}
		participation = pt
	}

	event, errHTTP := getEvent(req, strings.TrimSpace(body.Event), action.imsDBQ)
	if errHTTP != nil {
		return errHTTP.From("[getEvent]")
	}

	var wristbandNull sql.NullString
	if wristband != "" {
		wristbandNull = conv.StringToSql(&wristband, maxWristbandLength)
	}
	return setPersonEvent(req.Context(), action.imsDBQ, personID, event.ID, wristbandNull, participation)
}

// setPersonEvent creates or updates a person's PERSON__EVENT row, choosing insert vs
// update from whether they already have a row for the event. It deliberately does
// NOT use INSERT ... ON DUPLICATE KEY UPDATE: that fires on either unique key, so a
// wristband already held by a *different* person would silently relabel them instead
// of conflicting. Read-first keeps the (EVENT, WRISTBAND) collision a real 409.
func setPersonEvent(ctx context.Context, dbq *store.DBQ, personID, eventID int32, wristband sql.NullString, participation imsdb.PersonEventParticipationType) *herr.HTTPError {
	_, err := dbq.PersonEvent(ctx, dbq, imsdb.PersonEventParams{PersonID: personID, Event: eventID})
	switch {
	case err == nil:
		err = dbq.UpdatePersonEvent(ctx, dbq, imsdb.UpdatePersonEventParams{
			Wristband:         wristband,
			ParticipationType: participation,
			PersonID:          personID,
			Event:             eventID,
		})
	case errors.Is(err, sql.ErrNoRows):
		err = dbq.InsertPersonEvent(ctx, dbq, imsdb.InsertPersonEventParams{
			PersonID:          personID,
			Event:             eventID,
			Wristband:         wristband,
			ParticipationType: participation,
		})
	default:
		return herr.InternalServerError("Failed to read participation", err).From("[PersonEvent]")
	}
	if err != nil {
		return wristbandConflict(err)
	}
	return nil
}

// wristbandConflict maps a duplicate-key error from a PERSON__EVENT write to a 409
// (a wristband is unique within an event); anything else becomes a 500.
func wristbandConflict(err error) *herr.HTTPError {
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) && mysqlErr.Number == dupEntryError {
		return herr.Conflict("That wristband is already assigned for this event", nil)
	}
	return herr.InternalServerError("Failed to set participation", err).From("[setPersonEvent]")
}

// SetPersonParticipation upserts a person's per-event participation WITHOUT touching
// their global profile (slice 6j). It backs the roster's "add to event" (enroll an
// existing person) and "mark not present / ejected" actions. EditPerson also writes
// participation, but always rewrites the profile (name/email) too, so it's wrong
// for these profile-neutral changes — hence this dedicated endpoint, symmetric with
// the DELETE. The event rides as a ?event= query param (identity is global).
type SetPersonParticipation struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
}

// SetParticipationRequest carries only the per-event fields. A blank
// participation_type defaults from the wristband (present -> volunteer, absent ->
// public); a blank wristband clears it (so callers preserving a wristband — e.g. on
// eject — resend the current value).
type SetParticipationRequest struct {
	Wristband         string `json:"wristband"`
	ParticipationType string `json:"participation_type"`
}

func (action SetPersonParticipation) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.setParticipation(req)
	if errHTTP != nil {
		errHTTP.From("[setParticipation]").WriteResponse(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (action SetPersonParticipation) setParticipation(req *http.Request) *herr.HTTPError {
	jwtCtx, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return errHTTP.From("[getGlobalPermissions]")
	}
	isPersonnelAdmin := globalPermissions&authz.GlobalAdministratePersonnel != 0

	person, errHTTP := personByIDFromPath(req.Context(), action.imsDBQ, req)
	if errHTTP != nil {
		return errHTTP
	}

	eventName := strings.TrimSpace(req.FormValue("event"))
	if eventName == "" {
		return herr.BadRequest("An event is required", nil)
	}
	event, errHTTP := getEvent(req, eventName, action.imsDBQ)
	if errHTTP != nil {
		return errHTTP.From("[getEvent]")
	}

	// Authorization (plan 53b). A personnel admin may set any participation. A
	// non-admin needs the invite-reporters bit on THIS event (writer / crew leader).
	if !isPersonnelAdmin {
		perms, _, err := authz.EventPermissions(req.Context(), &event.ID, action.imsDBQ, *jwtCtx.Claims)
		if err != nil {
			return herr.InternalServerError("Failed to compute permissions", err).From("[EventPermissions]")
		}
		if perms[event.ID]&authz.EventInviteReporters == 0 {
			return herr.Forbidden("Setting participation requires GlobalAdministratePersonnel or invite-reporters access for this event", nil)
		}
	}

	body, errHTTP := readBodyAs[SetParticipationRequest](req)
	if errHTTP != nil {
		return errHTTP.From("[readBodyAs]")
	}
	wristband := strings.TrimSpace(body.Wristband)
	if len(wristband) > maxWristbandLength {
		return herr.BadRequest("Wristband is too long", nil)
	}
	participation := defaultParticipation(wristband)
	if ptStr := strings.TrimSpace(body.ParticipationType); ptStr != "" {
		pt, ok := validParticipation(ptStr)
		if !ok {
			return herr.BadRequest("Unknown participation_type: "+ptStr, nil)
		}
		participation = pt
	}

	// Anti-escalation ceiling for a non-admin inviter: they may assign only
	// reporter / no-access rungs, and may not touch a person who is already a writer
	// or crew_leader on the event (acting only on reporter-or-below targets).
	if !isPersonnelAdmin {
		if !mayAssignParticipation(false, participation) {
			return herr.Forbidden("Only an admin may assign the writer or crew_leader role", nil)
		}
		current, err := action.imsDBQ.PersonEvent(req.Context(), action.imsDBQ, imsdb.PersonEventParams{
			PersonID: person.ID,
			Event:    event.ID,
		})
		switch {
		case errors.Is(err, sql.ErrNoRows):
			// No participation row yet — enrolling a new volunteer is allowed.
		case err != nil:
			return herr.InternalServerError("Failed to read participation", err).From("[PersonEvent]")
		default:
			if !mayAssignParticipation(false, current.ParticipationType) {
				return herr.Forbidden("You may not modify a writer or crew leader", nil)
			}
		}
	}

	var wristbandNull sql.NullString
	if wristband != "" {
		wristbandNull = conv.StringToSql(&wristband, maxWristbandLength)
	}
	errHTTP = setPersonEvent(req.Context(), action.imsDBQ, person.ID, event.ID, wristbandNull, participation)
	if errHTTP != nil {
		return errHTTP
	}

	action.userStore.InvalidateUsers()

	// #nosec G706 // log injection
	slog.Info("Set participation", "person_id", person.ID, "handle", person.Handle.String, "event", eventName, "participation", string(participation))
	return nil
}

// RemovePersonEvent deletes a person's participation row for an event — the "added
// by mistake" removal (slice 6j). The global PERSON and any incident/visit links
// are on independent tables and untouched, so the person stays in the registry and
// can be re-added later. To instead record an ejection (kept for the record), the
// client sets PARTICIPATION_TYPE to 'ejected'/'not_present' via EditPerson and the
// row is kept. The event rides as a ?event= query param (identity is global, so the
// personnel API stays global and is decorated per-event rather than nested).
type RemovePersonEvent struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
}

func (action RemovePersonEvent) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.removePersonEvent(req)
	if errHTTP != nil {
		errHTTP.From("[removePersonEvent]").WriteResponse(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (action RemovePersonEvent) removePersonEvent(req *http.Request) *herr.HTTPError {
	_, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return errHTTP.From("[getGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalAdministratePersonnel == 0 {
		return herr.Forbidden("The requestor does not have GlobalAdministratePersonnel permission", nil)
	}

	person, errHTTP := personByIDFromPath(req.Context(), action.imsDBQ, req)
	if errHTTP != nil {
		return errHTTP
	}

	eventName := strings.TrimSpace(req.FormValue("event"))
	if eventName == "" {
		return herr.BadRequest("An event is required", nil)
	}
	event, errHTTP := getEvent(req, eventName, action.imsDBQ)
	if errHTTP != nil {
		return errHTTP.From("[getEvent]")
	}

	err := action.imsDBQ.DeletePersonEvent(req.Context(), action.imsDBQ, imsdb.DeletePersonEventParams{
		PersonID: person.ID,
		Event:    event.ID,
	})
	if err != nil {
		return herr.InternalServerError("Failed to remove participation", err).From("[DeletePersonEvent]")
	}

	action.userStore.InvalidateUsers()

	// #nosec G706 // log injection
	slog.Info("Removed person from event", "person_id", person.ID, "handle", person.Handle.String, "event", eventName)
	return nil
}
