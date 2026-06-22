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

package store

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"log/slog"

	"github.com/mikeki/ocf-ims/conf"
)

// demoSeedSQL is the dev/demo seed data (local people directory + historical
// demo events/incidents/reports/visits). Embedded so the app can load it on
// boot; in dev it is also mounted by docker-compose.dev.yml.
//
//go:embed fakeimsdb/seed.sql
var demoSeedSQL string

// seedSpec describes a seed profile: the SQL to run, and the table whose
// emptiness decides whether the seed still needs loading (the idempotency
// probe). Each profile probes a table it actually populates — e.g. the demo
// fixture probes PERSON; a future secret-free "prod" profile that seeds areas
// (and no people) would probe AREA instead.
type seedSpec struct {
	sql        string
	probeTable string
}

var seedSpecs = map[conf.SeedProfile]seedSpec{
	conf.SeedDemo: {sql: demoSeedSQL, probeTable: "PERSON"},
}

// Seed loads the seed dataset for the given profile into the database, but only
// if it looks empty (the profile's probe table has no rows). It is therefore
// idempotent: safe to call on every boot, and a no-op once the data is present.
// conf.SeedNone (and the empty profile) load nothing.
//
// Seeding is gated by IMS_SEED at the call site; production defaults to
// SeedNone and gets a schema-only database. The emptiness probe is a second line
// of defence: even if a seed were enabled against an already-populated database,
// it would skip rather than duplicate.
func Seed(ctx context.Context, db *sql.DB, profile conf.SeedProfile) error {
	if profile == conf.SeedNone || profile == "" {
		return nil
	}
	spec, ok := seedSpecs[profile]
	if !ok {
		return fmt.Errorf("no seed dataset for profile %q", profile)
	}

	var count int
	query := "select count(*) from `" + spec.probeTable + "`"
	err := db.QueryRowContext(ctx, query).Scan(&count)
	if err != nil {
		return fmt.Errorf("[count %s]: %w", spec.probeTable, err)
	}
	if count > 0 {
		slog.Info("Seed skipped: database is already populated",
			"profile", profile, "probeTable", spec.probeTable, "count", count)
		return nil
	}

	_, err = db.ExecContext(ctx, spec.sql)
	if err != nil {
		return fmt.Errorf("[exec %s seed]: %w", profile, err)
	}
	slog.Info("Loaded seed data into empty database", "profile", profile)
	return nil
}
