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

package person

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	resourcesv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/resources/v1"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/internal/auth"
	"github.com/mikeki/ocf-ims/internal/server"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/argon2id"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// This file holds the admin personnel-management writes — the RPCs that manage OTHER people
// (create/edit/reset-password/set-admin/set-participation/remove-from-event/delete-picture),
// as opposed to the caller's own self-service writes in connect.go. Each RPC method is a thin
// wrapper (the ImsService delegate shape) over a herr-returning core that ports the retired
// REST handler verbatim and reuses the shared helpers in person.go (applyProfileFields,
// setPersonEvent, defaultParticipation, validParticipation, mayAssignParticipation,
// wristbandConflict, clearProfilePicture); the wrapper maps herr→Connect via server.HerrToConnect.
// The event scope is keyed by id, not name (the contract, and the sibling read RPCs).

// CreatePerson is the domain method behind the CreatePerson RPC (plan 09h/1c), retiring REST
// POST /personnel. Returns the created person so an inline-create from the attach picker can
// immediately attach them.
func (s Service) CreatePerson(
	ctx context.Context,
	req *rpcv1.CreatePersonRequest,
) (*rpcv1.CreatePersonResponse, error) {
	created, errHTTP := s.createPerson(ctx, req)
	if errHTTP != nil {
		return nil, server.HerrToConnect(errHTTP)
	}
	return &rpcv1.CreatePersonResponse{Person: personToProto(created)}, nil
}

// UpdatePerson is the domain method behind the UpdatePerson RPC (plan 09h/1c), retiring REST
// POST /personnel/{personId}. Edits identity/contact fields and, when an event is named, that
// person's per-event participation.
func (s Service) UpdatePerson(
	ctx context.Context,
	req *rpcv1.UpdatePersonRequest,
) (*rpcv1.UpdatePersonResponse, error) {
	errHTTP := s.editPerson(ctx, req)
	if errHTTP != nil {
		return nil, server.HerrToConnect(errHTTP)
	}
	return &rpcv1.UpdatePersonResponse{}, nil
}

// SetPersonPassword is the domain method behind the SetPersonPassword RPC (plan 09h/1c), retiring
// REST POST /personnel/{personId}/password — an admin reset (gated on the delegatable
// GlobalAdministratePersonnel), distinct from the caller's own ChangeOwnPassword.
func (s Service) SetPersonPassword(
	ctx context.Context,
	req *rpcv1.SetPersonPasswordRequest,
) (*rpcv1.SetPersonPasswordResponse, error) {
	errHTTP := s.setPersonPassword(ctx, req.GetPersonId(), req.GetPassword(), req.GetUseDefaultPassword())
	if errHTTP != nil {
		return nil, server.HerrToConnect(errHTTP)
	}
	return &rpcv1.SetPersonPasswordResponse{}, nil
}

// SetPersonAdmin is the domain method behind the SetPersonAdmin RPC (plan 09h/1c), retiring REST
// POST /personnel/{personId}/admin. Unlike the other personnel writes it requires the CALLER to
// themselves be an admin (not the delegatable GlobalAdministratePersonnel): delegating personnel
// management must never implicitly confer the power to mint admins.
func (s Service) SetPersonAdmin(
	ctx context.Context,
	req *rpcv1.SetPersonAdminRequest,
) (*rpcv1.SetPersonAdminResponse, error) {
	errHTTP := s.setPersonAdmin(ctx, req.GetPersonId(), req.GetIsAdmin())
	if errHTTP != nil {
		return nil, server.HerrToConnect(errHTTP)
	}
	return &rpcv1.SetPersonAdminResponse{}, nil
}

// SetPersonParticipation is the domain method behind the SetPersonParticipation RPC (plan 09h/1c),
// retiring REST POST /personnel/{personId}/participation. It upserts a person's per-event
// participation WITHOUT touching their global profile (the roster's enroll / mark-not-present /
// eject).
func (s Service) SetPersonParticipation(
	ctx context.Context,
	req *rpcv1.SetPersonParticipationRequest,
) (*rpcv1.SetPersonParticipationResponse, error) {
	errHTTP := s.setParticipation(ctx, req)
	if errHTTP != nil {
		return nil, server.HerrToConnect(errHTTP)
	}
	return &rpcv1.SetPersonParticipationResponse{}, nil
}

// RemovePersonFromEvent is the domain method behind the RemovePersonFromEvent RPC (plan 09h/1c),
// retiring REST DELETE /personnel/{personId}/participation — the "added by mistake" removal that
// deletes the PERSON__EVENT row (the person stays in the registry).
func (s Service) RemovePersonFromEvent(
	ctx context.Context,
	req *rpcv1.RemovePersonFromEventRequest,
) (*rpcv1.RemovePersonFromEventResponse, error) {
	errHTTP := s.removePersonEvent(ctx, req.GetPersonId(), req.GetEventId())
	if errHTTP != nil {
		return nil, server.HerrToConnect(errHTTP)
	}
	return &rpcv1.RemovePersonFromEventResponse{}, nil
}

// DeletePersonProfilePicture is the domain method behind the DeletePersonProfilePicture RPC (plan
// 09h/1c), retiring REST DELETE /personnel/{personId}/picture. The picture *upload* (POST) and
// *serve* (GET) are multipart/binary and stay REST (M8); only the delete is an RPC.
func (s Service) DeletePersonProfilePicture(
	ctx context.Context,
	req *rpcv1.DeletePersonProfilePictureRequest,
) (*rpcv1.DeletePersonProfilePictureResponse, error) {
	errHTTP := s.deletePersonProfilePicture(ctx, req.GetPersonId())
	if errHTTP != nil {
		return nil, server.HerrToConnect(errHTTP)
	}
	return &rpcv1.DeletePersonProfilePictureResponse{}, nil
}

// personnelGlobals resolves the caller's claims + global permission mask from the ctx the auth
// interceptor populated — the Connect analogue of the REST server.GetGlobalPermissions. A missing
// claims context is Unauthorized (mapped to Unauthenticated); a permission-computation failure is a
// 500.
func (s Service) personnelGlobals(ctx context.Context) (*authz.IMSClaims, authz.GlobalPermissionMask, *herr.HTTPError) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, 0, herr.Unauthorized("Authentication required", nil)
	}
	_, globalPermissions, err := authz.EventPermissions(ctx, nil, s.ImsDBQ, *claims)
	if err != nil {
		return nil, 0, herr.InternalServerError("Failed to compute permissions", err).From("[EventPermissions]")
	}
	return claims, globalPermissions, nil
}

// createPerson ports the retired REST CreatePerson handler to ctx + proto inputs. The per-field
// length-400s are gone (protovalidate enforces the max_len constraints before the handler); the
// cross-field identity invariant and the password/access rules stay handler checks.
func (s Service) createPerson(ctx context.Context, req *rpcv1.CreatePersonRequest) (imsjson.Person, *herr.HTTPError) {
	var empty imsjson.Person
	claims, globalPermissions, errHTTP := s.personnelGlobals(ctx)
	if errHTTP != nil {
		return empty, errHTTP
	}

	handle := strings.TrimSpace(req.GetHandle())
	name := strings.TrimSpace(req.GetName())
	email := strings.TrimSpace(req.GetEmail())
	phone := strings.TrimSpace(req.GetPhone())
	wristband := strings.TrimSpace(req.GetWristband())

	// Identity: a registry person needs at least a fair name or a full legal name (a cross-field
	// OR that protovalidate can't express, so it stays a handler check).
	if handle == "" && name == "" {
		return empty, herr.BadRequest("A fair name or full legal name is required", nil)
	}

	isPersonnelAdmin := globalPermissions&authz.GlobalAdministratePersonnel != 0

	// Gating tiers (plan 53b). An admin may create anyone, optionally on an event. A non-admin must
	// name an event they may invite reporters to; the ceiling on the rung they assign is enforced
	// below via mayAssignParticipation.
	var eventID int32
	if !isPersonnelAdmin {
		eventID, errHTTP = s.eventForInvite(ctx, claims, req.GetEventId())
		if errHTTP != nil {
			return empty, errHTTP
		}
	} else if req.GetEventId() != 0 {
		errHTTP = s.requireEvent(ctx, req.GetEventId())
		if errHTTP != nil {
			return empty, errHTTP
		}
		eventID = req.GetEventId()
	}

	// Per-event participation: honored explicitly for admins and inviters alike, ceilinged for a
	// non-admin (never writer/crew_leader). Absent an explicit type, default from the wristband. The
	// REST "unknown participation_type" 400 has no analogue — the proto enum is defined_only.
	participation := defaultParticipation(wristband)
	if pt := req.GetParticipationType(); pt != resourcesv1.ParticipationType_PARTICIPATION_TYPE_UNSPECIFIED {
		mapped := participationTypeFromProto(pt)
		if !mayAssignParticipation(isPersonnelAdmin, mapped) {
			return empty, herr.Forbidden("Only an admin may assign the writer or crew_leader role", nil)
		}
		participation = mapped
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

	// Access can be granted two ways: a specific typed password, or the shared default. Granting
	// access requires BOTH a fair name and an email (login matches email only).
	grantAccess := req.GetPassword() != "" || req.GetUseDefaultPassword()
	if grantAccess && handle == "" {
		return empty, herr.BadRequest("A fair name is required to provide IMS access", nil)
	}
	if grantAccess && email == "" {
		return empty, herr.BadRequest("An email is required to provide IMS access (it is the login identifier)", nil)
	}

	// A password is optional; whether specific or the shared default it is hashed per user. A
	// specific one must satisfy the same bounds as the reset endpoint (the password field carries no
	// proto max_len, so these stay handler checks). passwordChanged records whether the stored value
	// differs from the shared default.
	var passwordNull sql.NullString
	passwordChanged := false
	switch {
	case req.GetPassword() != "":
		if len(req.GetPassword()) < minPasswordLength {
			return empty, herr.BadRequest("Password must be at least 8 characters", nil)
		}
		if len(req.GetPassword()) > maxPasswordLength {
			return empty, herr.BadRequest("Outrageously long passwords are disallowed", auth.ErrLongPassword)
		}
		hashed := argon2id.CreateHash(req.GetPassword(), argon2id.DefaultParams)
		passwordNull = conv.StringToSql(&hashed, 255)
		passwordChanged = req.GetPassword() != s.DefaultPassword
	case req.GetUseDefaultPassword():
		if s.DefaultPassword == "" {
			return empty, herr.BadRequest("No default password is configured on this server; set a specific password instead", nil)
		}
		hashed := argon2id.CreateHash(s.DefaultPassword, argon2id.DefaultParams)
		passwordNull = conv.StringToSql(&hashed, 255)
	}

	// Friendly pre-check on the handle (the unique constraint is the backstop below).
	if handle != "" {
		_, err := s.ImsDBQ.PersonByHandle(ctx, s.ImsDBQ, handleNull)
		if err == nil {
			return empty, herr.Conflict("A person with that handle already exists", nil)
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return empty, herr.InternalServerError("Failed to check handle", err).From("[PersonByHandle]")
		}
	}

	newID, err := s.ImsDBQ.CreatePerson(ctx, s.ImsDBQ, imsdb.CreatePersonParams{
		Handle:          handleNull,
		Name:            nameNull,
		Email:           emailNull,
		Phone:           phoneNull,
		Password:        passwordNull,
		Created:         conv.TimeToFloat(time.Now()),
		PasswordChanged: passwordChanged,
	})
	if err != nil {
		var mysqlErr *mysql.MySQLError
		if errors.As(err, &mysqlErr) && mysqlErr.Number == DupEntryError {
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

	// Write the per-event participation row when an event was named. The person is brand-new, so
	// this is always an insert; a wristband already taken in the event is a 409.
	if eventID != 0 {
		var wristbandNull sql.NullString
		if wristband != "" {
			wristbandNull = conv.StringToSql(&wristband, maxWristbandLength)
		}
		err = s.ImsDBQ.InsertPersonEvent(ctx, s.ImsDBQ, imsdb.InsertPersonEventParams{
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

	s.UserStore.InvalidateUsers()
	// #nosec G706 // log injection
	slog.Info("Created person", "person_id", newID, "handle", handle, "name", name)
	return resp, nil
}

// eventForInvite authorizes a non-admin create: the caller must name an event (by id) they may
// invite reporters to (EventInviteReporters — writers and crew leaders, plan 53b). Returns that
// event's id for the PERSON__EVENT row.
func (s Service) eventForInvite(ctx context.Context, claims *authz.IMSClaims, eventID int32) (int32, *herr.HTTPError) {
	if eventID == 0 {
		return 0, herr.Forbidden("Creating a person requires GlobalAdministratePersonnel, or invite-reporters access on a named event", nil)
	}
	errHTTP := s.requireEvent(ctx, eventID)
	if errHTTP != nil {
		return 0, errHTTP
	}
	perms, _, err := authz.EventPermissions(ctx, &eventID, s.ImsDBQ, *claims)
	if err != nil {
		return 0, herr.InternalServerError("Failed to compute permissions", err).From("[EventPermissions]")
	}
	if perms[eventID]&authz.EventInviteReporters == 0 {
		return 0, herr.Forbidden("You do not have invite-reporters access to that event", nil)
	}
	return eventID, nil
}

// editPerson ports the retired REST EditPerson handler to ctx + proto inputs.
func (s Service) editPerson(ctx context.Context, req *rpcv1.UpdatePersonRequest) *herr.HTTPError {
	_, globalPermissions, errHTTP := s.personnelGlobals(ctx)
	if errHTTP != nil {
		return errHTTP
	}
	if globalPermissions&authz.GlobalAdministratePersonnel == 0 {
		return herr.Forbidden("The requestor does not have GlobalAdministratePersonnel permission", nil)
	}

	person, errHTTP := server.PersonByID(ctx, s.ImsDBQ, req.GetPersonId())
	if errHTTP != nil {
		return errHTTP
	}

	// applyProfileFields wants presence pointers (nil = leave unchanged); the optional proto fields
	// carry exactly that. They are gathered in a keyed composite literal to preserve the *string
	// presence (and because protogetter exempts an optional field from the getter rule only inside a
	// keyed literal — the #217 profile gotcha).
	patch := struct{ handle, name, email, phone *string }{
		handle: req.Handle, name: req.Name, email: req.Email, phone: req.Phone,
	}
	errHTTP = applyProfileFields(ctx, s.ImsDBQ, person, patch.handle, patch.name, patch.email, patch.phone)
	if errHTTP != nil {
		return errHTTP
	}

	// Per-event participation: applied only when an event is named AND a wristband or participation
	// type is supplied (else editing a profile while an event is selected would mint a stray 'public'
	// row).
	errHTTP = s.editParticipation(ctx, req)
	if errHTTP != nil {
		return errHTTP
	}

	s.UserStore.InvalidateUsers()
	// #nosec G706 // log injection
	slog.Info("Edited person", "person_id", person.ID, "handle", person.Handle.String)
	return nil
}

// editParticipation upserts the person's PERSON__EVENT row when the update names an event (by id)
// and supplies a wristband or participation type — the ctx/proto port of EditPerson.editParticipation.
func (s Service) editParticipation(ctx context.Context, req *rpcv1.UpdatePersonRequest) *herr.HTTPError {
	eventID := req.GetEventId()
	if eventID == 0 {
		return nil
	}
	wristband := strings.TrimSpace(req.GetWristband())
	ptSet := req.GetParticipationType() != resourcesv1.ParticipationType_PARTICIPATION_TYPE_UNSPECIFIED
	if wristband == "" && !ptSet {
		return nil
	}

	participation := defaultParticipation(wristband)
	if ptSet {
		participation = participationTypeFromProto(req.GetParticipationType())
	}

	errHTTP := s.requireEvent(ctx, eventID)
	if errHTTP != nil {
		return errHTTP
	}
	var wristbandNull sql.NullString
	if wristband != "" {
		wristbandNull = conv.StringToSql(&wristband, maxWristbandLength)
	}
	return setPersonEvent(ctx, s.ImsDBQ, req.GetPersonId(), eventID, wristbandNull, participation)
}

// setPersonPassword ports the retired REST SetPersonPassword handler (admin reset) to ctx inputs.
func (s Service) setPersonPassword(ctx context.Context, personID int32, password string, useDefault bool) *herr.HTTPError {
	_, globalPermissions, errHTTP := s.personnelGlobals(ctx)
	if errHTTP != nil {
		return errHTTP
	}
	if globalPermissions&authz.GlobalAdministratePersonnel == 0 {
		return herr.Forbidden("The requestor does not have GlobalAdministratePersonnel permission", nil)
	}

	// Two paths: reset to the shared default, or set a specific typed password (same bounds as the
	// create/auth endpoints — the hashing-exhaustion vector).
	if useDefault {
		if s.DefaultPassword == "" {
			return herr.BadRequest("No default password is configured on this server; set a specific password instead", nil)
		}
	} else {
		if len(password) < minPasswordLength {
			return herr.BadRequest("Password must be at least 8 characters", nil)
		}
		if len(password) > maxPasswordLength {
			return herr.BadRequest("Outrageously long passwords are disallowed", auth.ErrLongPassword)
		}
	}

	person, errHTTP := server.PersonByID(ctx, s.ImsDBQ, personID)
	if errHTTP != nil {
		return errHTTP
	}
	// Login matches EMAIL only, so a password is useless without one.
	if person.Email.String == "" {
		return herr.BadRequest("This person has no email; an email is the login identifier, so add one before setting a password", nil)
	}

	pw := s.DefaultPassword
	if !useDefault {
		pw = password
	}
	hashed := argon2id.CreateHash(pw, argon2id.DefaultParams)
	err := s.ImsDBQ.SetPersonPassword(ctx, s.ImsDBQ, imsdb.SetPersonPasswordParams{
		Password:        conv.StringToSql(&hashed, 255),
		PasswordChanged: s.DefaultPassword == "" || pw != s.DefaultPassword,
		ID:              person.ID,
	})
	if err != nil {
		return herr.InternalServerError("Failed to set password", err).From("[SetPersonPassword]")
	}

	s.UserStore.InvalidateUsers()
	// #nosec G706 // log injection
	slog.Info("Password set for person", "person_id", person.ID, "handle", person.Handle.String)
	return nil
}

// setPersonAdmin ports the retired REST SetPersonAdmin handler. It is gated on the CALLER being an
// admin (not the delegatable GlobalAdministratePersonnel) and refuses to clear the last admin.
func (s Service) setPersonAdmin(ctx context.Context, personID int32, isAdmin bool) *herr.HTTPError {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return herr.Unauthorized("Authentication required", nil)
	}
	// Only an administrator may change administrator status — gate on the caller's own IS_ADMIN, not
	// a delegatable permission, so delegating personnel management never implies minting admins.
	if !claims.PersonAdmin() {
		return herr.Forbidden("Only administrators may change administrator status", nil)
	}

	target, errHTTP := server.PersonByID(ctx, s.ImsDBQ, personID)
	if errHTTP != nil {
		return errHTTP
	}

	// Guard against removing the last flagged administrator (recoverable only by a direct DB write).
	if !isAdmin && target.IsAdmin {
		adminCount, err := s.ImsDBQ.CountAdmins(ctx, s.ImsDBQ)
		if err != nil {
			return herr.InternalServerError("Failed to count administrators", err).From("[CountAdmins]")
		}
		if adminCount <= 1 {
			return herr.Conflict("Cannot remove the last administrator", nil)
		}
	}

	err := s.ImsDBQ.SetPersonAdmin(ctx, s.ImsDBQ, imsdb.SetPersonAdminParams{
		IsAdmin: isAdmin,
		ID:      target.ID,
	})
	if err != nil {
		return herr.InternalServerError("Failed to set admin flag", err).From("[SetPersonAdmin]")
	}

	// Permissions are cached and baked into access tokens, so drop the cache to make the change
	// effective on the next token refresh.
	s.UserStore.InvalidateUsers()
	// #nosec G706 // log injection
	slog.Info("Admin flag set for person", "person_id", target.ID, "handle", target.Handle.String, "is_admin", isAdmin)
	return nil
}

// setParticipation ports the retired REST SetPersonParticipation handler — the roster's
// profile-neutral per-event upsert (enroll / mark not-present / eject).
func (s Service) setParticipation(ctx context.Context, req *rpcv1.SetPersonParticipationRequest) *herr.HTTPError {
	claims, globalPermissions, errHTTP := s.personnelGlobals(ctx)
	if errHTTP != nil {
		return errHTTP
	}
	isPersonnelAdmin := globalPermissions&authz.GlobalAdministratePersonnel != 0

	person, errHTTP := server.PersonByID(ctx, s.ImsDBQ, req.GetPersonId())
	if errHTTP != nil {
		return errHTTP
	}
	eventID := req.GetEventId()
	errHTTP = s.requireEvent(ctx, eventID)
	if errHTTP != nil {
		return errHTTP
	}

	// Authorization (plan 53b): an admin may set any participation; a non-admin needs the
	// invite-reporters bit on THIS event.
	if !isPersonnelAdmin {
		perms, _, err := authz.EventPermissions(ctx, &eventID, s.ImsDBQ, *claims)
		if err != nil {
			return herr.InternalServerError("Failed to compute permissions", err).From("[EventPermissions]")
		}
		if perms[eventID]&authz.EventInviteReporters == 0 {
			return herr.Forbidden("Setting participation requires GlobalAdministratePersonnel or invite-reporters access for this event", nil)
		}
	}

	wristband := strings.TrimSpace(req.GetWristband())
	participation := defaultParticipation(wristband)
	if pt := req.GetParticipationType(); pt != resourcesv1.ParticipationType_PARTICIPATION_TYPE_UNSPECIFIED {
		participation = participationTypeFromProto(pt)
	}

	// Anti-escalation ceiling for a non-admin inviter: they may assign only reporter / no-access
	// rungs, and may not touch a person who is already a writer or crew_leader on the event.
	if !isPersonnelAdmin {
		if !mayAssignParticipation(false, participation) {
			return herr.Forbidden("Only an admin may assign the writer or crew_leader role", nil)
		}
		current, err := s.ImsDBQ.PersonEvent(ctx, s.ImsDBQ, imsdb.PersonEventParams{
			PersonID: person.ID,
			Event:    eventID,
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
	errHTTP = setPersonEvent(ctx, s.ImsDBQ, person.ID, eventID, wristbandNull, participation)
	if errHTTP != nil {
		return errHTTP
	}

	s.UserStore.InvalidateUsers()
	// #nosec G706 // log injection
	slog.Info("Set participation", "person_id", person.ID, "handle", person.Handle.String, "event_id", eventID, "participation", string(participation))
	return nil
}

// removePersonEvent ports the retired REST RemovePersonEvent handler — deletes the PERSON__EVENT
// row (the person stays in the registry).
func (s Service) removePersonEvent(ctx context.Context, personID, eventID int32) *herr.HTTPError {
	_, globalPermissions, errHTTP := s.personnelGlobals(ctx)
	if errHTTP != nil {
		return errHTTP
	}
	if globalPermissions&authz.GlobalAdministratePersonnel == 0 {
		return herr.Forbidden("The requestor does not have GlobalAdministratePersonnel permission", nil)
	}

	person, errHTTP := server.PersonByID(ctx, s.ImsDBQ, personID)
	if errHTTP != nil {
		return errHTTP
	}
	errHTTP = s.requireEvent(ctx, eventID)
	if errHTTP != nil {
		return errHTTP
	}

	err := s.ImsDBQ.DeletePersonEvent(ctx, s.ImsDBQ, imsdb.DeletePersonEventParams{
		PersonID: person.ID,
		Event:    eventID,
	})
	if err != nil {
		return herr.InternalServerError("Failed to remove participation", err).From("[DeletePersonEvent]")
	}

	s.UserStore.InvalidateUsers()
	// #nosec G706 // log injection
	slog.Info("Removed person from event", "person_id", person.ID, "handle", person.Handle.String, "event_id", eventID)
	return nil
}

// deletePersonProfilePicture ports the retired REST DeletePersonProfilePicture handler — the
// admin remove, sharing clearProfilePicture with the self-service DeleteOwnProfilePicture.
func (s Service) deletePersonProfilePicture(ctx context.Context, personID int32) *herr.HTTPError {
	_, globalPermissions, errHTTP := s.personnelGlobals(ctx)
	if errHTTP != nil {
		return errHTTP
	}
	if globalPermissions&authz.GlobalAdministratePersonnel == 0 {
		return herr.Forbidden("The requestor does not have GlobalAdministratePersonnel permission", nil)
	}

	person, errHTTP := server.PersonByID(ctx, s.ImsDBQ, personID)
	if errHTTP != nil {
		return errHTTP
	}
	return clearProfilePicture(ctx, s.AttachmentsStore, s.S3Client, s.ImsDBQ, person.ID, person.ProfilePicture.String)
}

// participationTypeFromProto maps the proto ParticipationType enum onto the stored PERSON__EVENT
// participation string — the inverse of participationTypeToProto (connect.go). It is only called
// for a non-UNSPECIFIED value (the enum is defined_only, so every case is a known imsdb value);
// UNSPECIFIED collapses to "" for completeness.
func participationTypeFromProto(pt resourcesv1.ParticipationType) imsdb.PersonEventParticipationType {
	switch pt {
	case resourcesv1.ParticipationType_PARTICIPATION_TYPE_WRITER:
		return imsdb.PersonEventParticipationTypeWriter
	case resourcesv1.ParticipationType_PARTICIPATION_TYPE_CREW_LEADER:
		return imsdb.PersonEventParticipationTypeCrewLeader
	case resourcesv1.ParticipationType_PARTICIPATION_TYPE_REPORTER:
		return imsdb.PersonEventParticipationTypeReporter
	case resourcesv1.ParticipationType_PARTICIPATION_TYPE_VOLUNTEER:
		return imsdb.PersonEventParticipationTypeVolunteer
	case resourcesv1.ParticipationType_PARTICIPATION_TYPE_PUBLIC:
		return imsdb.PersonEventParticipationTypePublic
	case resourcesv1.ParticipationType_PARTICIPATION_TYPE_NOT_PRESENT:
		return imsdb.PersonEventParticipationTypeNotPresent
	case resourcesv1.ParticipationType_PARTICIPATION_TYPE_EJECTED:
		return imsdb.PersonEventParticipationTypeEjected
	case resourcesv1.ParticipationType_PARTICIPATION_TYPE_UNSPECIFIED:
		return ""
	default:
		return ""
	}
}
