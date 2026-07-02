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

package integration_test

import (
	"context"
	"github.com/mikeki/ocf-ims/api"
	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/directory"
	_ "github.com/mikeki/ocf-ims/lib/noopdb"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/mikeki/ocf-ims/lib/testctr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/actionlog"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"github.com/testcontainers/testcontainers-go"
	"log"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
)

// mainTestInternal contains fields to be used only within main_test.go.
var mainTestInternal struct {
	dbCtr        testcontainers.Container
	dbCtrCleanup func()
}

// shared contains fields that may be used by any test in the integration package.
// These are fields from the common setup performed in main_test.go.
var shared struct {
	cfg          *conf.IMSConfig
	imsDBQ       *store.DBQ
	userStore    directory.UserStore
	es           *api.EventSourcerer
	testServer   *httptest.Server
	serverURL    *url.URL
	actionLogger *actionlog.Logger
}

// These values must align with those in imsPeopleTestSeed. Person IDs are the URL
// key for personnel endpoints since 5e (registry people may have no fair name).
const (
	userAdminFairName = "AdminTestRanger"
	userAdminEmail    = "admintestranger@example.com"
	userAdminPassword = ")'("
	userAdminPersonID = 6000

	userAliceFairName = "AliceTestRanger"
	userAliceEmail    = "alicetestranger@example.com"
	userAlicePassword = "password"
	userAlicePersonID = 6001

	// Bob is a dedicated non-admin user for the password-reset test, so that test
	// can mutate his password without contaminating other (parallel) tests that log
	// in as Admin/Alice. His seeded hash is Alice's, so his initial password matches.
	userBobFairName        = "BobTestRanger"
	userBobEmail           = "bobtestranger@example.com"
	userBobInitialPassword = "password"
	userBobPersonID        = 6002

	// Carol is dedicated to the IS_ADMIN toggle test, so it can flag/unflag her
	// without touching admins that other parallel tests rely on. She shares Alice's
	// seeded password hash.
	userCarolFairName = "CarolTestRanger"
	userCarolEmail    = "caroltestranger@example.com"
	userCarolPassword = "password"
	userCarolPersonID = 6003

	// Dave is dedicated to the 52f per-incident-grant test: a stable non-admin who is
	// made a reporter in that test's own event, so other parallel tests don't perturb
	// his role/password. He shares Alice's seeded password hash.
	userDaveFairName = "DaveTestRanger"
	userDaveEmail    = "davetestranger@example.com"
	userDavePassword = "password"
	userDavePersonID = 6004

	// Erin is dedicated to the 53b crew-leader invite test: a stable non-admin made a
	// crew_leader in that test's own event, exercising the invite-reporters path
	// without an admin. She shares Alice's seeded password hash.
	userErinFairName = "ErinTestRanger"
	userErinEmail    = "erintestranger@example.com"
	userErinPassword = "password"
	userErinPersonID = 6005

	// A person_id that doesn't exist, for not-found (404) assertions.
	nonexistentPersonID = 999999
)

// imsPeopleTestSeed seeds the local IMS-DB people directory used by the integration
// suite: the two login users (with argon2id password hashes for userAdminPassword /
// userAlicePassword), plus a position and team so the positions/teams paths are
// exercised. The person_id FKs (attachments, journal-entry author) resolve against
// these rows and the author join renders the expected fair name.
const imsPeopleTestSeed = `
insert into PERSON (ID, FAIR_NAME, EMAIL, PASSWORD, CREATED, IS_ADMIN) values
    (6000, 'AdminTestRanger', 'admintestranger@example.com', '$argon2id$v=19$m=1,t=1,p=1$51uXrZoFRb6O4Tw4TsAJVQ$SedDwp+hPpIJc42QcnFJy6EOtE+b5kyYFpnuRHl/5qs', 0, true),
    (6001, 'AliceTestRanger', 'alicetestranger@example.com', '$argon2id$v=19$m=1,t=1,p=1$eg9U8hLotCSmyCph1BQroA$KFfy0uDDpP+cXPnkSQRXt3z0Shd7M39tsrwJZuDrOdU', 0, false),
    (6002, 'BobTestRanger', 'bobtestranger@example.com', '$argon2id$v=19$m=1,t=1,p=1$eg9U8hLotCSmyCph1BQroA$KFfy0uDDpP+cXPnkSQRXt3z0Shd7M39tsrwJZuDrOdU', 0, false),
    (6003, 'CarolTestRanger', 'caroltestranger@example.com', '$argon2id$v=19$m=1,t=1,p=1$eg9U8hLotCSmyCph1BQroA$KFfy0uDDpP+cXPnkSQRXt3z0Shd7M39tsrwJZuDrOdU', 0, false),
    (6004, 'DaveTestRanger', 'davetestranger@example.com', '$argon2id$v=19$m=1,t=1,p=1$eg9U8hLotCSmyCph1BQroA$KFfy0uDDpP+cXPnkSQRXt3z0Shd7M39tsrwJZuDrOdU', 0, false),
    (6005, 'ErinTestRanger', 'erintestranger@example.com', '$argon2id$v=19$m=1,t=1,p=1$eg9U8hLotCSmyCph1BQroA$KFfy0uDDpP+cXPnkSQRXt3z0Shd7M39tsrwJZuDrOdU', 0, false);
insert into ` + "`POSITION`" + ` (ID, NAME) values (7000, 'Nooperator');
insert into TEAM (ID, NAME) values (8000, 'Brown Dot');
insert into PERSON__POSITION (PERSON_ID, POSITION_ID) values (6001, 7000);
insert into PERSON__TEAM (PERSON_ID, TEAM_ID) values (6000, 8000);
`

// TestMain does the common setup and teardown for all tests in this package.
// It's slow to start up a MariaDB container, so we want to only have to do
// that once for the whole suite of test files.
func TestMain(m *testing.M) {
	ctx := context.Background()
	tempDir, err := os.MkdirTemp("", "imstest-*")
	must(err)
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Recovered from panic: %v", r)
			shutdown(ctx, tempDir)
			os.Exit(1)
		}
	}()
	setup(ctx, tempDir)
	code := m.Run()
	shutdown(ctx, tempDir)
	os.Exit(code)
}

func setup(ctx context.Context, tempDir string) {
	tempRoot, err := os.OpenRoot(tempDir)
	must(err)

	shared.cfg = conf.DefaultIMS()
	shared.cfg.Core.JWTSecret = "jwtsecret-" + rand.NonCryptoText()
	// AdminTestRanger's admin status comes from the IS_ADMIN flag set in
	// imsPeopleTestSeed (there is no IMS_ADMINS env list anymore).
	// 100 KiB, much lower than we'd use outside tests, since we want to test error cases
	// when requests are too large.
	shared.cfg.Core.MaxRequestBytes = 100 << 10
	shared.cfg.AttachmentsStore.Type = conf.AttachmentsStoreLocal
	shared.cfg.AttachmentsStore.Local = conf.LocalAttachments{
		Dir: tempRoot,
	}
	shared.cfg.Store.Type = conf.DBStoreTypeMaria
	shared.cfg.Store.MariaDB.Database = "ims-" + rand.NonCryptoText()
	shared.cfg.Store.MariaDB.Username = "rangers-" + rand.NonCryptoText()
	shared.cfg.Store.MariaDB.Password = "password-" + rand.NonCryptoText()
	// The shared suite runs many parallel tests that intentionally fail logins from
	// the same loopback address; leave the login throttle off here so they don't
	// trip each other. The throttle itself is covered on a dedicated server in
	// ratelimit_test.go.
	shared.cfg.Core.LoginRateLimitEnabled = false
	must(shared.cfg.Validate())
	shared.es = api.NewEventSourcerer()

	// The user directory and the incident store share a single IMS database.
	ctr, cleanup, dbHostPort, err := testctr.MariaDBContainer(
		ctx,
		shared.cfg.Store.MariaDB.Database,
		shared.cfg.Store.MariaDB.Username,
		shared.cfg.Store.MariaDB.Password,
	)
	must(err)
	mainTestInternal.dbCtr = ctr
	mainTestInternal.dbCtrCleanup = cleanup
	shared.cfg.Store.MariaDB.HostPort = dbHostPort
	db, err := store.SqlDB(ctx, shared.cfg.Store, true)
	must(err)
	// Seed the local people directory (login users, position, team) before any
	// request can run. See docs/plans/32-retire-clubhouse.md.
	_, err = db.ExecContext(ctx, imsPeopleTestSeed)
	must(err)
	shared.imsDBQ = store.NewDBQ(db, imsdb.New())
	shared.userStore = directory.NewLocalUserStore(shared.imsDBQ, shared.cfg.Directory.InMemoryCacheTTL)

	shared.actionLogger = actionlog.NewLogger(ctx, shared.imsDBQ, shared.cfg.Core.ActionLogEnabled, true)
	shared.testServer = httptest.NewServer(
		// nil push sender → the no-op backend, so the shared suite does no push work;
		// the push fan-out is exercised on its own server in push_test.go.
		api.AddToMux(nil, shared.es, shared.cfg, shared.imsDBQ, shared.userStore, nil, shared.actionLogger, nil),
	)
	shared.serverURL, err = url.Parse(shared.testServer.URL)
	must(err)
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func shutdown(ctx context.Context, tempDir string) {
	_ = os.RemoveAll(tempDir)
	if shared.testServer != nil {
		shared.testServer.Close()
	}
	if shared.imsDBQ != nil {
		_ = shared.imsDBQ.Close()
	}
	if mainTestInternal.dbCtrCleanup != nil {
		mainTestInternal.dbCtrCleanup()
	}
}
