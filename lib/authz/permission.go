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

package authz

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

type Role string

const (
	AnyAuthenticatedUser Role = "AnyAuthenticatedUser"
	EventReporter        Role = "EventReporter"
	EventWriter          Role = "EventWriter"
	Administrator        Role = "Administrator"
)

type GlobalPermissionMask uint16
type EventPermissionMask uint16

const (
	EventNoPermissions  EventPermissionMask  = 0
	GlobalNoPermissions GlobalPermissionMask = 0
)

// EventAllPermissions is every event-specific permission bit OR'd together. An
// admin bypasses per-event roles and gets this on any event (plan 52b).
const EventAllPermissions = EventReadIncidents | EventWriteIncidents |
	EventReadAllReports | EventReadOwnReports | EventWriteAllReports | EventWriteOwnReports |
	EventReadEventName | EventReadVisits | EventWriteVisits | EventReadAreas |
	EventInviteReporters

const (
	// Event-specific permissions.

	EventReadIncidents EventPermissionMask = 1 << iota
	EventWriteIncidents
	EventReadAllReports
	EventReadOwnReports
	EventWriteAllReports
	EventWriteOwnReports
	EventReadEventName
	EventReadVisits
	EventWriteVisits
	EventReadAreas
	// EventInviteReporters allows a caller to invite a person to this event as a
	// reporter — create their login and set reporter (or non-access) participation
	// (plan 53a). Held by 'writer' and 'crew_leader' rungs (and admins via bypass).
	// The anti-escalation ceiling (never assign writer/crew_leader) is enforced at
	// the endpoints, not by this bit.
	EventInviteReporters
)

const (
	// Permissions that aren't event-specific.

	GlobalListEvents GlobalPermissionMask = 1 << iota
	GlobalReadIncidentTypes
	GlobalReadPersonnel
	GlobalAdministrateEvents
	GlobalAdministrateIncidentTypes
	GlobalAdministrateDebugging
	// GlobalAdministratePersonnel allows managing people, e.g. setting/resetting a
	// person's password. Held by Administrators today; a future roles model may grant
	// it to non-admin crew leaders without changing the endpoints that check it.
	GlobalAdministratePersonnel
	// GlobalAdministrateAreas allows managing an event's location areas (the
	// per-event AREA table); held by Administrators today.
	GlobalAdministrateAreas
)

var RolesToGlobalPerms = map[Role]GlobalPermissionMask{
	AnyAuthenticatedUser: GlobalListEvents | GlobalReadIncidentTypes | GlobalReadPersonnel,
	Administrator:        GlobalAdministrateEvents | GlobalAdministrateIncidentTypes | GlobalAdministrateDebugging | GlobalAdministratePersonnel | GlobalAdministrateAreas,
}

// RolesToEventPerms maps an access role to the event permissions it grants. Only the
// per-event ladder's top two rungs carry access (plan 52b): EventWriter (full incident
// + report + visit access) and EventReporter (own reports only).
var RolesToEventPerms = map[Role]EventPermissionMask{
	EventReporter: EventReadEventName | EventReadOwnReports | EventWriteOwnReports | EventReadAreas,
	EventWriter:   EventReadEventName | EventReadIncidents | EventWriteIncidents | EventReadAllReports | EventReadOwnReports | EventWriteAllReports | EventWriteOwnReports | EventReadVisits | EventWriteVisits | EventReadAreas | EventInviteReporters,
}

// participationToEventPerms maps a person's per-event participation tier to the
// event permissions it grants (plans 52b, 53a). 'writer' carries full access;
// 'reporter' carries own-reports-only; 'crew_leader' has reporter-level access
// plus the invite-reporters power. volunteer/public/not_present/ejected — and
// any unrecognized value — grant nothing.
func participationToEventPerms(pt imsdb.PersonEventParticipationType) EventPermissionMask {
	switch pt {
	case imsdb.PersonEventParticipationTypeWriter:
		return RolesToEventPerms[EventWriter]
	case imsdb.PersonEventParticipationTypeCrewLeader:
		// reporter-level access plus the ability to invite reporters (plan 53a).
		return RolesToEventPerms[EventReporter] | EventInviteReporters
	case imsdb.PersonEventParticipationTypeReporter:
		return RolesToEventPerms[EventReporter]
	default:
		return EventNoPermissions
	}
}

// EventPermissions computes the caller's permissions. With eventID set it also
// resolves that event's permission mask from the caller's PERSON__EVENT
// participation row (plan 52b: access derives from the per-event role). Admins
// bypass the per-event role entirely (see ManyEventPermissions).
func EventPermissions(
	ctx context.Context,
	eventID *int32, // nil for no event
	imsDBQ *store.DBQ,
	claims IMSClaims,
) (eventPermissions map[int32]EventPermissionMask, globalPermissions GlobalPermissionMask, err error) {
	participationByEvent := make(map[int32]imsdb.PersonEventParticipationType)
	if eventID != nil {
		// Record the event key unconditionally so the result always carries an
		// explicit mask for it: an admin gets the bypass and a non-admin without a
		// participation row gets EventNoPermissions. A group event simply has no
		// PERSON__EVENT rows, so non-admins get nothing there.
		participationByEvent[*eventID] = ""
		pe, err := imsDBQ.PersonEvent(ctx, imsDBQ, imsdb.PersonEventParams{
			PersonID: claims.PersonID(),
			Event:    *eventID,
		})
		switch {
		case errors.Is(err, sql.ErrNoRows):
			// No participation row → no derived access (admin bypass still applies).
		case err != nil:
			return nil, GlobalNoPermissions, fmt.Errorf("[PersonEvent]: %w", err)
		default:
			participationByEvent[*eventID] = pe.ParticipationType
		}
	}
	eventPermissions, globalPermissions = ManyEventPermissions(
		participationByEvent,
		claims.PersonID(),
		claims.PersonAdmin(),
	)
	return eventPermissions, globalPermissions, nil
}

// ManyEventPermissions computes per-event and global permissions from the caller's
// per-event participation tiers (plan 52b). Each event in participationByEvent gets
// the mask its tier grants; admins bypass the tier and get EventAllPermissions on
// every event in the map.
func ManyEventPermissions(
	participationByEvent map[int32]imsdb.PersonEventParticipationType, // eventID as key
	personID int32,
	isAdmin bool,
) (eventPermissions map[int32]EventPermissionMask, globalPermissions GlobalPermissionMask) {
	eventPermissions = make(map[int32]EventPermissionMask)
	globalPermissions = GlobalNoPermissions

	// The person ID is the caller's identity — a zero ID means no authenticated
	// person (fair names are non-unique display values, never identifiers).
	if personID != 0 {
		globalPermissions |= RolesToGlobalPerms[AnyAuthenticatedUser]
	}

	// Admin status is solely the local PERSON.IS_ADMIN flag (carried in the JWT
	// claim). It is deliberately NOT a delegatable GlobalPermissionMask bit:
	// granting an individual global (e.g. GlobalAdministratePersonnel to a future
	// crew leader) must never imply the ability to mint other admins. Endpoints
	// that create/destroy admins gate on this flag directly.
	if isAdmin {
		globalPermissions |= RolesToGlobalPerms[Administrator]
	}

	for eventID, pt := range participationByEvent {
		if isAdmin {
			// Admins bypass per-event roles: full access regardless of their
			// participation tier (they may carry a row, e.g. marked 'writer', but
			// it does not gate them).
			eventPermissions[eventID] = EventAllPermissions
			continue
		}
		eventPermissions[eventID] = participationToEventPerms(pt)
	}
	return eventPermissions, globalPermissions
}
