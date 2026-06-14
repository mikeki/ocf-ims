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
	maxWristbandLength = 32
)

// dupEntryError is the MariaDB error number for a unique-constraint violation.
const dupEntryError = 1062

// validPersonStatuses are the PERSON.STATUS values IMS recognizes. Only 'active'
// people appear in the login directory and the attach-person autocompletes; the
// others are inactive/peripheral and are visible only on the admin People page.
var validPersonStatuses = map[string]bool{
	"active":             true,
	"alpha":              true,
	"auditor":            true,
	"inactive":           true,
	"inactive extension": true,
	"prospective":        true,
}

// CreatePerson adds a new person to the registry. Gating has two tiers (D-P1):
//   - A "full" create — anything touching login or profile (handle, email,
//     password, on-site) — requires GlobalAdministratePersonnel, as before
//     (onboarding login-capable people is personnel management, distinct from
//     minting admins, which stays on SetPersonAdmin).
//   - A "minimal" registry create (name, optionally an event + wristband) may be
//     done by an event writer from the field, so people met at an incident/visit
//     can be registered ad-hoc without a personnel admin.
//
// New people are status 'active'. A password is optional (without one the person
// can't log in until an admin sets one). The created person is returned as JSON so
// an inline-create from the attach picker can immediately attach the new person.
type CreatePerson struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
}

type CreatePersonRequest struct {
	Handle string `json:"handle"`
	Name   string `json:"name"`
	Email  string `json:"email"`
	// #nosec G117 // Exported secret field
	Password string `json:"password"`
	Onsite   bool   `json:"onsite"`
	// Event-scoped participation (all optional). When an event is named a
	// PERSON__EVENT row is written so the new person carries a wristband and
	// classification for that fair. participation_type is honored explicitly only
	// for personnel admins; for field (event-writer) creates it defaults from the
	// wristband (present -> participant, absent -> public). See R3 / D-P1.
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
	w.WriteHeader(http.StatusCreated)
	mustWriteJSON(w, req, resp)
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
	if len(wristband) > maxWristbandLength {
		return empty, herr.BadRequest("Wristband is too long", nil)
	}

	isPersonnelAdmin := globalPermissions&authz.GlobalAdministratePersonnel != 0

	// D-P1 gating. A "full" create touches login/profile fields and stays
	// admin-only; a "minimal" create (name + optional per-event wristband) may be
	// done by a writer on the named event.
	fullCreate := handle != "" || email != "" || body.Password != "" || body.Onsite
	var eventID int32
	if !isPersonnelAdmin {
		if fullCreate {
			return empty, herr.Forbidden("Setting a handle, email, password, or on-site flag requires GlobalAdministratePersonnel", nil)
		}
		eventID, errHTTP = action.eventForFieldCreate(req, jwtCtx, body.Event)
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

	// Per-event participation type: honored explicitly only for personnel admins;
	// otherwise defaulted from the wristband.
	participation := defaultParticipation(wristband)
	if isPersonnelAdmin && strings.TrimSpace(body.ParticipationType) != "" {
		pt, ok := validParticipation(body.ParticipationType)
		if !ok {
			return empty, herr.BadRequest("Unknown participation_type: "+body.ParticipationType, nil)
		}
		participation = pt
	}

	handleNull := conv.StringToSql(&handle, maxHandleLength) // null when empty
	nameNull := conv.StringToSql(&name, maxNameLength)

	var emailNull sql.NullString
	if email != "" {
		emailNull = conv.StringToSql(&email, maxEmailLength)
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
		Status:   "active",
		OnSite:   body.Onsite,
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
		Status:   "active",
		Onsite:   body.Onsite,
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

// eventForFieldCreate authorizes a minimal (event-writer) create: the caller must
// name an event they can write incidents or visits to. Returns that event's ID for
// the PERSON__EVENT row. See D-P1.
func (action CreatePerson) eventForFieldCreate(req *http.Request, jwtCtx JWTContext, eventName string) (int32, *herr.HTTPError) {
	eventName = strings.TrimSpace(eventName)
	if eventName == "" {
		return 0, herr.Forbidden("Creating a person requires GlobalAdministratePersonnel, or an event you can write to", nil)
	}
	event, errHTTP := getEvent(req, eventName, action.imsDBQ)
	if errHTTP != nil {
		return 0, errHTTP.From("[getEvent]")
	}
	perms, _, err := authz.EventPermissions(req.Context(), &event.ID, action.imsDBQ, action.userStore, *jwtCtx.Claims)
	if err != nil {
		return 0, herr.InternalServerError("Failed to compute permissions", err).From("[EventPermissions]")
	}
	if perms[event.ID]&(authz.EventWriteIncidents|authz.EventWriteVisits) == 0 {
		return 0, herr.Forbidden("You do not have write access to that event", nil)
	}
	return event.ID, nil
}

// defaultParticipation classifies a new person from their wristband: someone with
// a wristband is a participant; without one, public. Admins can override and crew
// is set when loading rosters. See R3.
func defaultParticipation(wristband string) imsdb.PersonEventParticipationType {
	if strings.TrimSpace(wristband) != "" {
		return imsdb.PersonEventParticipationTypeParticipant
	}
	return imsdb.PersonEventParticipationTypePublic
}

// validParticipation validates a participation_type string against the enum.
func validParticipation(s string) (imsdb.PersonEventParticipationType, bool) {
	switch imsdb.PersonEventParticipationType(s) {
	case imsdb.PersonEventParticipationTypeCrew,
		imsdb.PersonEventParticipationTypeParticipant,
		imsdb.PersonEventParticipationTypePublic:
		return imsdb.PersonEventParticipationType(s), true
	}
	return "", false
}

// EditPerson updates a person's editable profile and, when an event is named, that
// person's per-event participation. Gated on GlobalAdministratePersonnel like
// CreatePerson. The handle is immutable (it is the identifier in person: access
// expressions); the password and admin flag are changed via their own endpoints.
type EditPerson struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
}

// EditPersonRequest carries the profile edit plus an optional per-event update.
// Name and Email are pointers so the field can be distinguished from "" (clear):
// nil leaves the value unchanged, a non-nil pointer sets it (empty string clears).
// The per-event block is applied only when Event is named (the admin People page
// scopes it to the selected event); Wristband/ParticipationType then upsert that
// person's PERSON__EVENT row.
type EditPersonRequest struct {
	Name              *string `json:"name"`
	Email             *string `json:"email"`
	Status            string  `json:"status"`
	Onsite            bool    `json:"onsite"`
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
	if !validPersonStatuses[body.Status] {
		return herr.BadRequest("Unknown status: "+body.Status, nil)
	}

	// The person is addressed by stable ID in the URL path (any status, so inactive
	// people stay editable; registry people may have no handle since 5e).
	person, errHTTP := personByIDFromPath(req.Context(), action.imsDBQ, req)
	if errHTTP != nil {
		return errHTTP
	}

	// Name/Email default to the stored values; a non-nil pointer overrides (empty
	// clears). Keep the identity invariant: a handle-less registry person must keep
	// a name, else they'd have no human identifier left.
	name := person.Name
	if body.Name != nil {
		trimmed := strings.TrimSpace(*body.Name)
		if len(trimmed) > maxNameLength {
			return herr.BadRequest("Name is too long", nil)
		}
		if trimmed == "" && person.Handle.String == "" {
			return herr.BadRequest("A handle or name is required", nil)
		}
		name = conv.StringToSql(&trimmed, maxNameLength) // null when empty
	}
	email := person.Email
	if body.Email != nil {
		trimmed := strings.TrimSpace(*body.Email)
		if len(trimmed) > maxEmailLength {
			return herr.BadRequest("Email is too long", nil)
		}
		email = conv.StringToSql(&trimmed, maxEmailLength) // null when empty
	}

	err := action.imsDBQ.EditPerson(req.Context(), action.imsDBQ, imsdb.EditPersonParams{
		Name:   name,
		Email:  email,
		Status: body.Status,
		OnSite: body.Onsite,
		ID:     person.ID,
	})
	if err != nil {
		var mysqlErr *mysql.MySQLError
		if errors.As(err, &mysqlErr) && mysqlErr.Number == dupEntryError {
			return herr.Conflict("That email is already in use", nil)
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
	slog.Info("Edited person", "person_id", person.ID, "handle", person.Handle.String, "status", body.Status, "onsite", body.Onsite)
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
