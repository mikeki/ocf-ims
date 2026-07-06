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
	EventInviteReporters | EventReadCrewReports

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
	// EventReadCrewReports lets a crew leader read the reports of their crew's
	// members (slice 10c). Unlike EventReadAllReports it is not a blanket grant — the
	// report handler scopes the visible set to reports whose creator is a member of a
	// crew the caller leads (CREW_MEMBERSHIP). Held by the derived crew-leader role.
	EventReadCrewReports
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
	// GlobalReadOutcomes allows reading the outcome (disposition) taxonomy — the
	// global OUTCOME table (slice 10a). Held by every authenticated user, like
	// GlobalReadIncidentTypes.
	GlobalReadOutcomes
	// GlobalAdministrateOutcomes allows managing the OUTCOME table (create / rename /
	// hide / approve proposals); held by Administrators today. Mirrors
	// GlobalAdministrateIncidentTypes.
	GlobalAdministrateOutcomes
	// GlobalAdministrateCrews allows managing an event's crews and their membership
	// (the per-event CREW / CREW_MEMBERSHIP tables, slice 10c). Held only by
	// Administrators — unlike Areas there is no writer propose/approve flow, so crews
	// are admin-only end to end.
	GlobalAdministrateCrews
)

var RolesToGlobalPerms = map[Role]GlobalPermissionMask{
	AnyAuthenticatedUser: GlobalListEvents | GlobalReadIncidentTypes | GlobalReadPersonnel | GlobalReadOutcomes,
	Administrator:        GlobalAdministrateEvents | GlobalAdministrateIncidentTypes | GlobalAdministrateDebugging | GlobalAdministratePersonnel | GlobalAdministrateAreas | GlobalAdministrateOutcomes | GlobalAdministrateCrews,
}

// RolesToEventPerms maps an access role to the event permissions it grants. Only the
// per-event ladder's top two rungs carry access (plan 52b): EventWriter (full incident
// + report + visit access) and EventReporter (own reports only).
var RolesToEventPerms = map[Role]EventPermissionMask{
	EventReporter: EventReadEventName | EventReadOwnReports | EventWriteOwnReports | EventReadAreas,
	EventWriter:   EventReadEventName | EventReadIncidents | EventWriteIncidents | EventReadAllReports | EventReadOwnReports | EventWriteAllReports | EventWriteOwnReports | EventReadVisits | EventWriteVisits | EventReadAreas | EventInviteReporters,
}

// crewLeaderMask is the access a crew leader holds (plan 53a + slice 10c):
// reporter-level access (own reports read/write), the invite-reporters power,
// read-only visibility into incidents (view but not edit — no EventWriteIncidents,
// so no journal entries either), and their crew's reports (EventReadCrewReports,
// scoped in the report handler). This is the original plan-53 crew_leader grant
// plus the 10c crew-report read — it is NOT a stripped-down read-only role.
const crewLeaderMask = EventReadEventName | EventReadOwnReports | EventWriteOwnReports |
	EventReadAreas | EventInviteReporters | EventReadIncidents | EventReadCrewReports

// participationToEventPerms maps a person's per-event participation tier to the
// event permissions it grants (plans 52b, 53a; slice 10c). 'writer' carries full
// access; 'reporter' carries own-reports-only; 'crew_leader' carries reporter-level
// access plus invite, read-only incident visibility, and crew-report read. The
// crew-leader role is normally *derived* from crew leadership (see EventPermissions);
// this rung also keeps any hand-assigned/legacy 'crew_leader' PERSON__EVENT row
// working. volunteer/public/not_present/ejected — and any unrecognized value —
// grant nothing.
func participationToEventPerms(pt imsdb.PersonEventParticipationType) EventPermissionMask {
	switch pt {
	case imsdb.PersonEventParticipationTypeWriter:
		return RolesToEventPerms[EventWriter]
	case imsdb.PersonEventParticipationTypeCrewLeader:
		return crewLeaderMask
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
		claims.PersonHandle(),
		claims.PersonAdmin(),
	)

	// Derive the crew-leader role (slice 10c): a non-admin who leads at least one
	// crew for this event gains the crew-leader access, unless a higher role already
	// grants it. "Unless higher" falls out of the mask OR — a writer (or someone who
	// already holds the crew_leader rung) already has EventReadIncidents, so we skip
	// the lookup for them; admins bypass per-event roles entirely. This adds one small
	// CREW_MEMBERSHIP query per request only for callers who aren't already incident
	// readers (reporters/volunteers/etc.).
	if eventID != nil && !claims.PersonAdmin() && eventPermissions[*eventID]&EventReadIncidents == 0 {
		ledCrews, err := imsDBQ.CrewsLedByPerson(ctx, imsDBQ, imsdb.CrewsLedByPersonParams{
			Event:    *eventID,
			PersonID: claims.PersonID(),
		})
		if err != nil {
			return nil, GlobalNoPermissions, fmt.Errorf("[CrewsLedByPerson]: %w", err)
		}
		if len(ledCrews) > 0 {
			eventPermissions[*eventID] |= crewLeaderMask
		}
	}
	return eventPermissions, globalPermissions, nil
}

// ManyEventPermissions computes per-event and global permissions from the caller's
// per-event participation tiers (plan 52b). Each event in participationByEvent gets
// the mask its tier grants; admins bypass the tier and get EventAllPermissions on
// every event in the map.
func ManyEventPermissions(
	participationByEvent map[int32]imsdb.PersonEventParticipationType, // eventID as key
	handle string,
	isAdmin bool,
) (eventPermissions map[int32]EventPermissionMask, globalPermissions GlobalPermissionMask) {
	eventPermissions = make(map[int32]EventPermissionMask)
	globalPermissions = GlobalNoPermissions

	if handle != "" {
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
