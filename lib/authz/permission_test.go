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
	"testing"

	"github.com/mikeki/ocf-ims/store/imsdb"
	"github.com/stretchr/testify/require"
)

const (
	writerPerm             = EventReadEventName | EventReadIncidents | EventWriteIncidents | EventReadAllReports | EventReadOwnReports | EventWriteAllReports | EventWriteOwnReports | EventReadVisits | EventWriteVisits | EventReadAreas | EventInviteReporters
	reporterPerm           = EventReadEventName | EventReadOwnReports | EventWriteOwnReports | EventReadAreas
	crewLeaderPerm         = reporterPerm | EventInviteReporters
	authenticatedUserPerms = GlobalListEvents | GlobalReadIncidentTypes | GlobalReadPersonnel
	adminGlobalPerms       = GlobalAdministrateEvents | GlobalAdministrateIncidentTypes | GlobalAdministrateDebugging | GlobalAdministratePersonnel | GlobalAdministrateAreas
)

// TestManyEventPermissions_participationLadder verifies access is derived from a
// person's per-event participation tier (plan 52b): writer/reporter carry access,
// everything below grants nothing.
func TestManyEventPermissions_participationLadder(t *testing.T) {
	t.Parallel()
	cases := []struct {
		participation imsdb.PersonEventParticipationType
		want          EventPermissionMask
	}{
		{imsdb.PersonEventParticipationTypeWriter, writerPerm},
		{imsdb.PersonEventParticipationTypeCrewLeader, crewLeaderPerm},
		{imsdb.PersonEventParticipationTypeReporter, reporterPerm},
		{imsdb.PersonEventParticipationTypeVolunteer, EventNoPermissions},
		{imsdb.PersonEventParticipationTypePublic, EventNoPermissions},
		{imsdb.PersonEventParticipationTypeNotPresent, EventNoPermissions},
		{imsdb.PersonEventParticipationTypeEjected, EventNoPermissions},
		{imsdb.PersonEventParticipationType(""), EventNoPermissions},
	}
	for _, tc := range cases {
		permissions, globalPermissions := ManyEventPermissions(
			map[int32]imsdb.PersonEventParticipationType{123: tc.participation},
			"SomeHandle",
			false,
		)
		require.Equalf(t, tc.want, permissions[123], "participation %q", tc.participation)
		require.Equal(t, authenticatedUserPerms, globalPermissions)
	}
}

// TestManyEventPermissions_adminBypass verifies a flagged admin gets full access on
// every event regardless of their participation tier (or absence of a row), plus
// the Administrator global perms.
func TestManyEventPermissions_adminBypass(t *testing.T) {
	t.Parallel()
	permissions, globalPermissions := ManyEventPermissions(
		map[int32]imsdb.PersonEventParticipationType{
			123: imsdb.PersonEventParticipationTypePublic,
			999: imsdb.PersonEventParticipationTypeVolunteer,
		},
		"FlaggedAdmin",
		true,
	)
	require.Equal(t, EventAllPermissions, permissions[123])
	require.Equal(t, EventAllPermissions, permissions[999])
	require.Equal(t, authenticatedUserPerms|adminGlobalPerms, globalPermissions)
}

// TestManyEventPermissions_unauthenticated verifies an empty handle grants no global
// permissions (and no per-event ones).
func TestManyEventPermissions_unauthenticated(t *testing.T) {
	t.Parallel()
	permissions, globalPermissions := ManyEventPermissions(
		map[int32]imsdb.PersonEventParticipationType{123: imsdb.PersonEventParticipationTypeWriter},
		"",
		false,
	)
	require.Equal(t, writerPerm, permissions[123])
	require.Equal(t, GlobalNoPermissions, globalPermissions)
}

// TestManyEventPermissions_isAdminRules verifies the local IS_ADMIN flag is what
// grants the Administrator global permissions, and that a non-flagged user does
// not get them.
func TestManyEventPermissions_isAdminRules(t *testing.T) {
	t.Parallel()

	// Flagged local admin → gets admin global perms.
	_, globalPermissions := ManyEventPermissions(
		map[int32]imsdb.PersonEventParticipationType{},
		"LocalAdmin",
		true,
	)
	require.Equal(t, authenticatedUserPerms|adminGlobalPerms, globalPermissions)

	// Same handle without the flag → ordinary authenticated user only.
	_, globalPermissions = ManyEventPermissions(
		map[int32]imsdb.PersonEventParticipationType{},
		"LocalAdmin",
		false,
	)
	require.Equal(t, authenticatedUserPerms, globalPermissions)
}
