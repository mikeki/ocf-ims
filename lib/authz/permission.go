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
	"slices"
	"strings"
	"time"

	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

type Role string

// validity* are retained for PersonMatches, which still backs the (now
// authz-ignored) EVENT_ACCESS admin UI until that table is retired in 52c.
const (
	validityAlways = imsdb.EventAccessValidityAlways
	validityOnsite = imsdb.EventAccessValidityOnsite
)

const (
	AnyAuthenticatedUser Role = "AnyAuthenticatedUser"
	EventReporter        Role = "EventReporter"
	EventReader          Role = "EventReader"
	EventWriter          Role = "EventWriter"
	EventVisitWriter     Role = "EventVisitWriter"
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
	EventReadEventName | EventReadVisits | EventWriteVisits | EventReadAreas

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

// RolesToEventPerms maps an access role to the event permissions it grants. As of
// plan 52b only EventWriter and EventReporter are reachable (the per-event ladder's
// top two rungs); EventReader and EventVisitWriter are kept for the EVENT_ACCESS
// admin UI's role labels until that table is retired in 52c.
var RolesToEventPerms = map[Role]EventPermissionMask{
	EventReporter:    EventReadEventName | EventReadOwnReports | EventWriteOwnReports | EventReadAreas,
	EventReader:      EventReadEventName | EventReadIncidents | EventReadOwnReports | EventReadAllReports | EventReadVisits | EventReadAreas,
	EventWriter:      EventReadEventName | EventReadIncidents | EventWriteIncidents | EventReadAllReports | EventReadOwnReports | EventWriteAllReports | EventWriteOwnReports | EventReadVisits | EventWriteVisits | EventReadAreas,
	EventVisitWriter: EventReadEventName | EventReadVisits | EventWriteVisits | EventReadAreas,
}

// participationToEventPerms maps a person's per-event participation tier to the
// event permissions it grants (plan 52b). Only the top two rungs carry access;
// participant/public/not_present/ejected — and any unrecognized value — grant
// nothing.
func participationToEventPerms(pt imsdb.PersonEventParticipationType) EventPermissionMask {
	switch pt {
	case imsdb.PersonEventParticipationTypeWriter:
		return RolesToEventPerms[EventWriter]
	case imsdb.PersonEventParticipationTypeReporter:
		return RolesToEventPerms[EventReporter]
	default:
		return EventNoPermissions
	}
}

// EventPermissions computes the caller's permissions. With eventID set it also
// resolves that event's permission mask from the caller's PERSON__EVENT
// participation row (plan 52b: access derives from the per-event role, not from
// EVENT_ACCESS). Admins bypass the per-event role entirely (see ManyEventPermissions).
// userStore is retained in the signature pending the broader EVENT_ACCESS cleanup
// (52c); it is no longer consulted here.
func EventPermissions(
	ctx context.Context,
	eventID *int32, // nil for no event
	imsDBQ *store.DBQ,
	_ directory.UserStore,
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

func PersonMatches(
	ea imsdb.EventAccess,
	handle string,
	positions []string,
	teams []string,
	onsite bool,
	onDutyPosition string,
) bool {
	if ea.Expires.Valid && conv.FloatToTime(ea.Expires.Float64).Before(time.Now()) {
		return false
	}
	matchExpr := false
	if ea.Expression == "*" {
		matchExpr = true
	}
	if strings.HasPrefix(ea.Expression, "person:") &&
		strings.TrimPrefix(ea.Expression, "person:") == handle {
		matchExpr = true
	}
	if strings.HasPrefix(ea.Expression, "position:") &&
		slices.Contains(positions, strings.TrimPrefix(ea.Expression, "position:")) {
		matchExpr = true
	}
	if strings.HasPrefix(ea.Expression, "onduty:") &&
		onDutyPosition == strings.TrimPrefix(ea.Expression, "onduty:") {
		matchExpr = true
	}
	if strings.HasPrefix(ea.Expression, "team:") &&
		slices.Contains(teams, strings.TrimPrefix(ea.Expression, "team:")) {
		matchExpr = true
	}
	matchValidity := false
	if ea.Validity == validityAlways {
		matchValidity = true
	}
	if ea.Validity == validityOnsite && onsite {
		matchValidity = true
	}
	return matchExpr && matchValidity
}
