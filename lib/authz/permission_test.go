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

var testAdmins = []string{"AdminCat", "AdminDog"}

const (
	readerPerm             = EventReadEventName | EventReadIncidents | EventReadOwnReports | EventReadAllReports | EventReadVisits | EventReadAreas
	writerPerm             = EventReadEventName | EventReadIncidents | EventWriteIncidents | EventReadAllReports | EventReadOwnReports | EventWriteAllReports | EventWriteOwnReports | EventReadVisits | EventWriteVisits | EventReadAreas
	reporterPerm           = EventReadEventName | EventReadOwnReports | EventWriteOwnReports | EventReadAreas
	visitWriterPerm        = EventReadEventName | EventReadVisits | EventWriteVisits | EventReadAreas
	authenticatedUserPerms = GlobalListEvents | GlobalReadIncidentTypes | GlobalReadPersonnel
	adminGlobalPerms       = GlobalAdministrateEvents | GlobalAdministrateIncidentTypes | GlobalAdministrateDebugging | GlobalAdministratePersonnel | GlobalAdministrateAreas
)

func addPerm(m map[int32][]imsdb.EventAccess, eventID int32, expr string, mode imsdb.EventAccessMode, validity imsdb.EventAccessValidity) {
	m[eventID] = append(m[eventID],
		imsdb.EventAccess{
			Event:      eventID,
			Expression: expr,
			Mode:       mode,
			Validity:   validity,
		},
	)
}

func TestManyEventPermissions_personRules(t *testing.T) {
	t.Parallel()
	accessByEvent := make(map[int32][]imsdb.EventAccess)
	addPerm(accessByEvent, 999, "person:SomeoneElse", modeRead, validityAlways)
	addPerm(accessByEvent, 123, "person:EventReaderGuy", modeRead, validityAlways)
	addPerm(accessByEvent, 123, "person:EventWriterGal", modeWrite, validityAlways)
	addPerm(accessByEvent, 123, "person:EventReporterPerson", modeReport, validityAlways)
	addPerm(accessByEvent, 123, "person:EventVisitWriterPerson", modeWriteVisits, validityAlways)

	permissions, globalPermissions := ManyEventPermissions(
		accessByEvent,
		testAdmins,
		"EventReaderGuy",
		true,
		false,
		[]string{},
		[]string{},
		"",
	)
	require.Equal(t, EventNoPermissions, permissions[999])
	require.Equal(t, readerPerm, permissions[123])
	require.Equal(t, authenticatedUserPerms, globalPermissions)

	permissions, globalPermissions = ManyEventPermissions(
		accessByEvent,
		testAdmins,
		"EventWriterGal",
		true,
		false,
		[]string{},
		[]string{},
		"",
	)
	require.Equal(t, EventNoPermissions, permissions[999])
	require.Equal(t, writerPerm, permissions[123])
	require.Equal(t, authenticatedUserPerms, globalPermissions)

	permissions, globalPermissions = ManyEventPermissions(
		accessByEvent,
		testAdmins,
		"EventReporterPerson",
		true,
		false,
		[]string{},
		[]string{},
		"",
	)
	require.Equal(t, EventNoPermissions, permissions[999])
	require.Equal(t, reporterPerm, permissions[123])
	require.Equal(t, authenticatedUserPerms, globalPermissions)

	permissions, globalPermissions = ManyEventPermissions(
		accessByEvent,
		testAdmins,
		"EventVisitWriterPerson",
		true,
		false,
		[]string{},
		[]string{},
		"",
	)
	require.Equal(t, EventNoPermissions, permissions[999])
	require.Equal(t, visitWriterPerm, permissions[123])
	require.Equal(t, authenticatedUserPerms, globalPermissions)

	permissions, globalPermissions = ManyEventPermissions(
		accessByEvent,
		testAdmins,
		"AdminCat",
		true,
		false,
		[]string{},
		[]string{},
		"",
	)
	require.Equal(t, EventNoPermissions, permissions[999])
	require.Equal(t, EventNoPermissions, permissions[123])
	require.Equal(t, authenticatedUserPerms|adminGlobalPerms, globalPermissions)
}

func TestManyEventPermissions_positionRules(t *testing.T) {
	t.Parallel()
	accessByEvent := make(map[int32][]imsdb.EventAccess)
	addPerm(accessByEvent, 123, "person:Running Ranger", modeReport, validityAlways)
	addPerm(accessByEvent, 123, "position:Runner", modeRead, validityAlways)
	addPerm(accessByEvent, 999, "position:Non-Runner", modeRead, validityAlways)

	// this user matches both a person and a position rule on event 123
	permissions, globalPermissions := ManyEventPermissions(
		accessByEvent,
		testAdmins,
		"Running Ranger",
		true,
		false,
		[]string{"Runner", "Swimmer"},
		[]string{},
		"",
	)
	require.Equal(t, EventNoPermissions, permissions[999])
	require.Equal(t, readerPerm|reporterPerm, permissions[123])
	require.Equal(t, authenticatedUserPerms, globalPermissions)
}

func TestManyEventPermissions_teamRules(t *testing.T) {
	t.Parallel()
	accessByEvent := make(map[int32][]imsdb.EventAccess)
	addPerm(accessByEvent, 123, "position:Runner", modeReport, validityAlways)
	addPerm(accessByEvent, 123, "team:Running Squad", modeRead, validityAlways)
	addPerm(accessByEvent, 999, "team:Non-Runner", modeRead, validityAlways)

	// this user matches both a team and position rule on event 123
	permissions, globalPermissions := ManyEventPermissions(
		accessByEvent,
		testAdmins,
		"Running Ranger",
		true,
		false,
		[]string{"Runner", "Swimmer"},
		[]string{"Running Squad", "Swimming Squad"},
		"",
	)
	require.Equal(t, EventNoPermissions, permissions[999])
	require.Equal(t, readerPerm|reporterPerm, permissions[123])
	require.Equal(t, authenticatedUserPerms, globalPermissions)
}

func TestManyEventPermissions_onDutyRules(t *testing.T) {
	t.Parallel()
	accessByEvent := make(map[int32][]imsdb.EventAccess)
	addPerm(accessByEvent, 123, "person:Running Ranger", modeReport, validityAlways)
	addPerm(accessByEvent, 123, "onduty:Runner", modeRead, validityAlways)
	addPerm(accessByEvent, 999, "position:Runner", modeRead, validityAlways)

	// this user matches both a person and an onduty rule on event 123
	permissions, globalPermissions := ManyEventPermissions(
		accessByEvent,
		testAdmins,
		"Running Ranger",
		true,
		false,
		[]string{},
		[]string{},
		"Runner",
	)
	require.Equal(t, EventNoPermissions, permissions[999])
	require.Equal(t, readerPerm|reporterPerm, permissions[123])
	require.Equal(t, authenticatedUserPerms, globalPermissions)
}

func TestManyEventPermissions_wildcardValidity(t *testing.T) {
	t.Parallel()
	accessByEvent := make(map[int32][]imsdb.EventAccess)
	addPerm(accessByEvent, 123, "*", modeReport, validityOnsite)

	permissions, globalPermissions := ManyEventPermissions(
		accessByEvent,
		testAdmins,
		"Onsite Ranger",
		true,
		false,
		[]string{"Runner", "Swimmer"},
		[]string{"Running Squad", "Swimming Squad"},
		"",
	)
	require.Equal(t, reporterPerm, permissions[123])
	require.Equal(t, authenticatedUserPerms, globalPermissions)

	permissions, globalPermissions = ManyEventPermissions(
		accessByEvent,
		testAdmins,
		"Offsite Ranger",
		false,
		false,
		[]string{"Runner", "Swimmer"},
		[]string{"Running Squad", "Swimming Squad"},
		"",
	)
	require.Equal(t, EventNoPermissions, permissions[123])
	require.Equal(t, authenticatedUserPerms, globalPermissions)
}

// TestManyEventPermissions_isAdminRules verifies the local IS_ADMIN flag grants
// the Administrator global permissions even for a handle that is not in the
// IMS_ADMINS bootstrap list, and that a non-flagged, non-env user does not get
// them.
func TestManyEventPermissions_isAdminRules(t *testing.T) {
	t.Parallel()
	accessByEvent := make(map[int32][]imsdb.EventAccess)

	// Flagged local admin, NOT in testAdmins → still gets admin global perms.
	_, globalPermissions := ManyEventPermissions(
		accessByEvent,
		testAdmins,
		"LocalAdmin",
		true,
		true,
		[]string{},
		[]string{},
		"",
	)
	require.Equal(t, authenticatedUserPerms|adminGlobalPerms, globalPermissions)

	// Same handle without the flag → ordinary authenticated user only.
	_, globalPermissions = ManyEventPermissions(
		accessByEvent,
		testAdmins,
		"LocalAdmin",
		true,
		false,
		[]string{},
		[]string{},
		"",
	)
	require.Equal(t, authenticatedUserPerms, globalPermissions)
}
