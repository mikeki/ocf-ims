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

package directory_test

import (
	"testing"
	"time"

	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/lib/testctr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"github.com/stretchr/testify/require"
)

// TestLocalUserStore exercises the local IMS-DB-backed directory: it seeds the
// PERSON/POSITION/TEAM tables and verifies NewLocalUserStore reads them back the
// same way the Clubhouse backend would. See docs/plans/31-local-people-directory.md.
func TestLocalUserStore(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	dbName := "ims-local-test"
	username := "user"
	password := "password"
	_, cleanup, dbHostPort, err := testctr.MariaDBContainer(ctx, dbName, username, password)
	t.Cleanup(cleanup)
	require.NoError(t, err)

	sqlDB, err := store.SqlDB(ctx, conf.DBStore{
		Type: conf.DBStoreTypeMaria,
		MariaDB: conf.DBStoreMaria{
			HostName: "",
			HostPort: dbHostPort,
			Database: dbName,
			Username: username,
			Password: password,
		},
	}, true)
	require.NoError(t, err)

	_, err = sqlDB.ExecContext(ctx, `
		insert into PERSON (ID, HANDLE, EMAIL, PASSWORD, CREATED) values
			(1, 'Alice', 'alice@example.com', 'hashA', 0),
			(2, 'Bob',   'bob@example.com',   'hashB', 0);
		insert into `+"`POSITION`"+` (ID, NAME) values (10, 'Driver'), (11, 'Dancer');
		insert into TEAM (ID, NAME) values (20, 'Green Team');
		insert into PERSON__POSITION (PERSON_ID, POSITION_ID) values (1, 10), (1, 11);
		insert into PERSON__TEAM (PERSON_ID, TEAM_ID) values (2, 20);
	`)
	require.NoError(t, err)

	imsDBQ := store.NewDBQ(sqlDB, imsdb.New())
	us := directory.NewLocalUserStore(imsDBQ, time.Minute)

	users, err := us.GetAllUsers(ctx)
	require.NoError(t, err)
	require.Len(t, users, 2)

	alice := users[1]
	require.NotNil(t, alice)
	require.Equal(t, "Alice", alice.Handle)
	require.Equal(t, "alice@example.com", alice.Email)
	require.Equal(t, "hashA", alice.Password)
	require.ElementsMatch(t, []int64{10, 11}, alice.PositionIDs)
	require.ElementsMatch(t, []string{"Driver", "Dancer"}, alice.PositionNames)
	require.Empty(t, alice.TeamIDs)

	bob := users[2]
	require.NotNil(t, bob)
	require.Equal(t, "Bob", bob.Handle)
	require.ElementsMatch(t, []int64{20}, bob.TeamIDs)
	require.ElementsMatch(t, []string{"Green Team"}, bob.TeamNames)

	positions, teams, err := us.GetPositionsAndTeams(ctx)
	require.NoError(t, err)
	require.Equal(t, map[int64]string{10: "Driver", 11: "Dancer"}, positions)
	require.Equal(t, map[int64]string{20: "Green Team"}, teams)

	people, err := us.GetPeople(ctx)
	require.NoError(t, err)
	require.Len(t, people, 2)
}
