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
	"net/http"
	"testing"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
)

func findOutcome(outcomes imsjson.Outcomes, id int32) *imsjson.Outcome {
	for i := range outcomes {
		if outcomes[i].ID == id {
			return &outcomes[i]
		}
	}
	return nil
}

// TestCreateAndHideOutcome exercises admin create + the hide/unhide toggle (slice
// 10a), mirroring the incident-type admin flow. The fourteen seeded dispositions are
// also present, so this asserts on the outcomes it creates rather than the full list.
func TestCreateAndHideOutcome(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apis := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}

	nameA, nameB := rand.NonCryptoText(), rand.NonCryptoText()
	idA, resp := apis.editOutcome(ctx, imsjson.Outcome{Name: &nameA})
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, idA)
	idB, resp := apis.editOutcome(ctx, imsjson.Outcome{Name: &nameB})
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, idB)

	// Both are retrievable, non-hidden, approved.
	outcomes, resp := apis.getOutcomes(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Contains(t, outcomes, imsjson.Outcome{ID: *idA, Name: &nameA, Hidden: new(false), Approved: new(true)})
	require.Contains(t, outcomes, imsjson.Outcome{ID: *idB, Name: &nameB, Hidden: new(false), Approved: new(true)})
	// A seeded disposition is present too.
	require.Condition(t, func() bool {
		for _, o := range outcomes {
			if o.Name != nil && *o.Name == "Follow-Up Required" {
				return true
			}
		}
		return false
	}, "seeded outcomes should be present")

	// Hide one.
	_, resp = apis.editOutcome(ctx, imsjson.Outcome{ID: *idA, Hidden: new(true)})
	require.NoError(t, resp.Body.Close())
	outcomes, resp = apis.getOutcomes(ctx)
	require.NoError(t, resp.Body.Close())
	require.Contains(t, outcomes, imsjson.Outcome{ID: *idA, Name: &nameA, Hidden: new(true), Approved: new(true)})

	// Rename it and unhide it.
	renamed := rand.NonCryptoText()
	_, resp = apis.editOutcome(ctx, imsjson.Outcome{ID: *idA, Name: &renamed, Hidden: new(false)})
	require.NoError(t, resp.Body.Close())
	outcomes, resp = apis.getOutcomes(ctx)
	require.NoError(t, resp.Body.Close())
	require.Contains(t, outcomes, imsjson.Outcome{ID: *idA, Name: &renamed, Hidden: new(false), Approved: new(true)})
}

// TestProposeAndApproveOutcome exercises the propose/approve flow: an event writer
// proposes a new outcome (unapproved, with them as proposer), an admin approves it, a
// duplicate name resolves to the existing outcome, and a reporter is refused.
func TestProposeAndApproveOutcome(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apisAdmin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	apisAlice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	// An event where Alice is a writer.
	eventName := rand.NonCryptoText()
	_, resp := apisAdmin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Alice proposes a new outcome. It's created unapproved with her as proposer.
	name := rand.NonCryptoText()
	id, resp := apisAlice.proposeOutcome(ctx, eventName, imsjson.Outcome{Name: &name})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, id)

	outcomes, resp := apisAdmin.getOutcomes(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	proposed := findOutcome(outcomes, *id)
	require.NotNil(t, proposed)
	require.NotNil(t, proposed.Approved)
	require.False(t, *proposed.Approved)
	require.NotNil(t, proposed.Proposer)
	require.Equal(t, userAliceHandle, proposed.Proposer.Handle)

	// An admin approves it.
	_, resp = apisAdmin.editOutcome(ctx, imsjson.Outcome{ID: *id, Approved: new(true)})
	require.NoError(t, resp.Body.Close())
	outcomes, resp = apisAdmin.getOutcomes(ctx)
	require.NoError(t, resp.Body.Close())
	approved := findOutcome(outcomes, *id)
	require.NotNil(t, approved)
	require.NotNil(t, approved.Approved)
	require.True(t, *approved.Approved)

	// Proposing the same name again resolves to the existing outcome's id.
	dupID, resp := apisAlice.proposeOutcome(ctx, eventName, imsjson.Outcome{Name: &name})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, dupID)
	require.Equal(t, *id, *dupID)

	// A reporter (no incident-write) may not propose: 403.
	reporterEvent := rand.NonCryptoText()
	_, resp = apisAdmin.createEvent(ctx, imsjson.Event{Name: &reporterEvent})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = apisAdmin.addReporter(ctx, reporterEvent, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	otherName := rand.NonCryptoText()
	_, resp = apisAlice.proposeOutcome(ctx, reporterEvent, imsjson.Outcome{Name: &otherName})
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}
