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
	"strings"

	"github.com/go-sql-driver/mysql"
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

// DupEntryError is the MariaDB error number for a unique-constraint violation.
const DupEntryError = 1062

// The CreatePerson, EditPerson, SetPersonParticipation, and RemovePersonEvent REST handlers
// (POST /personnel, POST /personnel/{personId}, POST+DELETE /personnel/{personId}/participation)
// were RETIRED in slice 1c and moved onto Connect as methods on person.Service (connect_admin.go).
// The REST routes were deleted, not shimmed (aggressive migration, plan 09 §6). Their request DTOs
// stay below as integration-test bridge types, and the shared helpers below are still used by the
// Connect handlers (and, for applyProfileFields, by the self-service UpdateOwnProfile in connect.go).

// CreatePersonRequest is the integration-test bridge for the create helper.
type CreatePersonRequest struct {
	Handle string `json:"handle"`
	Name   string `json:"name"`
	Email  string `json:"email"`
	// Phone is an optional contact number, collectable even for a login-less person.
	Phone string `json:"phone"`
	// #nosec G117 // Exported secret field
	Password string `json:"password"`
	// UseDefaultPassword grants IMS access with the server's shared default password instead of a
	// typed one; honored only when Password is empty.
	UseDefaultPassword bool `json:"use_default_password"`
	// Event-scoped participation (all optional). When an event is named a PERSON__EVENT row is
	// written so the new person carries a wristband and classification for that fair.
	Event             string `json:"event"`
	Wristband         string `json:"wristband"`
	ParticipationType string `json:"participation_type"`
}

// EditPersonRequest is the integration-test bridge for the edit helper. Handle/Name/Email/Phone are
// pointers so a field can be distinguished from "" (clear): nil leaves the value unchanged, a
// non-nil pointer sets it. The per-event block is applied only when Event is named.
type EditPersonRequest struct {
	Handle            *string `json:"handle"`
	Name              *string `json:"name"`
	Email             *string `json:"email"`
	Phone             *string `json:"phone"`
	Event             string  `json:"event"`
	Wristband         string  `json:"wristband"`
	ParticipationType string  `json:"participation_type"`
}

// SetParticipationRequest is the integration-test bridge for the set-participation helper. A blank
// participation_type defaults from the wristband (present -> volunteer, absent -> public); a blank
// wristband clears it.
type SetParticipationRequest struct {
	Wristband         string `json:"wristband"`
	ParticipationType string `json:"participation_type"`
}

// defaultParticipation classifies a new person from their wristband: someone with a wristband is a
// volunteer; without one, public. Admins can override (e.g. to promote a volunteer to
// reporter/writer on the People page). See R3.
func defaultParticipation(wristband string) imsdb.PersonEventParticipationType {
	if strings.TrimSpace(wristband) != "" {
		return imsdb.PersonEventParticipationTypeVolunteer
	}
	return imsdb.PersonEventParticipationTypePublic
}

// mayAssignParticipation enforces the anti-escalation ceiling (plan 53b). An admin
// (GlobalAdministratePersonnel) may assign any rung. A non-admin inviter (EventInviteReporters) may
// assign only 'reporter' or a no-access rung (volunteer/public/not_present/ejected) — NEVER
// 'writer' or 'crew_leader', so a crew leader can't mint other inviters/writers. This is the
// authoritative server-side boundary; the UI restrictions in 53d are convenience only.
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

// applyProfileFields validates the handle/name/email/phone deltas of a profile edit against the
// stored person and writes them. It is the shared core of the admin UpdatePerson path (which also
// applies per-event participation) and the self-service UpdateOwnProfile path. Each field pointer
// is nil to leave the value unchanged, non-nil to set it (empty string clears). The caller is
// responsible for InvalidateUsers.
func applyProfileFields(
	ctx context.Context, imsDBQ *store.DBQ, person imsdb.PersonByIDRow,
	bodyHandle, bodyName, bodyEmail, bodyPhone *string,
) *herr.HTTPError {
	// Handle/Name/Email/Phone default to the stored values; a non-nil pointer overrides (empty
	// clears). Compute handle and name first, then enforce the identity invariant on the *resulting*
	// pair: a person must keep at least a handle or a name, else they'd have no human identifier left.
	handle := person.Handle
	if bodyHandle != nil {
		trimmed := strings.TrimSpace(*bodyHandle)
		if len(trimmed) > maxHandleLength {
			return herr.BadRequest("Handle is too long", nil)
		}
		handle = conv.StringToSql(&trimmed, maxHandleLength) // null when empty
	}
	name := person.Name
	if bodyName != nil {
		trimmed := strings.TrimSpace(*bodyName)
		if len(trimmed) > maxNameLength {
			return herr.BadRequest("Name is too long", nil)
		}
		name = conv.StringToSql(&trimmed, maxNameLength) // null when empty
	}
	if handle.String == "" && name.String == "" {
		return herr.BadRequest("A fair name or full legal name is required", nil)
	}
	email := person.Email
	if bodyEmail != nil {
		trimmed := strings.TrimSpace(*bodyEmail)
		if len(trimmed) > maxEmailLength {
			return herr.BadRequest("Email is too long", nil)
		}
		email = conv.StringToSql(&trimmed, maxEmailLength) // null when empty
	}
	// A person who can sign in (has a password) must keep an email, since login now matches EMAIL
	// only — clearing it would strand the account. There's no way to drop a password through this
	// endpoint, so this can't be circumvented by clearing both.
	if person.HasPassword && email.String == "" {
		return herr.BadRequest("This person can sign in, so an email is required and cannot be cleared", nil)
	}
	phone := person.Phone
	if bodyPhone != nil {
		trimmed := strings.TrimSpace(*bodyPhone)
		if len(trimmed) > maxPhoneLength {
			return herr.BadRequest("Phone number is too long", nil)
		}
		phone = conv.StringToSql(&trimmed, maxPhoneLength) // null when empty
	}

	err := imsDBQ.EditPerson(ctx, imsDBQ, imsdb.EditPersonParams{
		Handle: handle,
		Name:   name,
		Email:  email,
		Phone:  phone,
		ID:     person.ID,
	})
	if err != nil {
		var mysqlErr *mysql.MySQLError
		if errors.As(err, &mysqlErr) && mysqlErr.Number == DupEntryError {
			return herr.Conflict("That handle or email is already in use", nil)
		}
		return herr.InternalServerError("Failed to edit person", err).From("[EditPerson]")
	}
	return nil
}

// setPersonEvent creates or updates a person's PERSON__EVENT row, choosing insert vs update from
// whether they already have a row for the event. It deliberately does NOT use INSERT ... ON
// DUPLICATE KEY UPDATE: that fires on either unique key, so a wristband already held by a
// *different* person would silently relabel them instead of conflicting. Read-first keeps the
// (EVENT, WRISTBAND) collision a real 409.
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

// wristbandConflict maps a duplicate-key error from a PERSON__EVENT write to a 409 (a wristband is
// unique within an event); anything else becomes a 500.
func wristbandConflict(err error) *herr.HTTPError {
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) && mysqlErr.Number == DupEntryError {
		return herr.Conflict("That wristband is already assigned for this event", nil)
	}
	return herr.InternalServerError("Failed to set participation", err).From("[setPersonEvent]")
}
