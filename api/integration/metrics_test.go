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
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// countFor returns the Count of the bucket with the given key, or -1 if absent.
func countFor(buckets []imsjson.MetricCount, key string) int64 {
	for _, b := range buckets {
		if b.Key == key {
			return b.Count
		}
	}
	return -1
}

// TestMetricsAccess verifies the dashboard gate after plan 52d widened it from
// admin-only to admin-or-per-event-writer: anonymous -> 401, a non-participant or
// a mere reporter -> 403, and both an event writer and an admin -> 200.
func TestMetricsAccess(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	adminUser := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	aliceUser := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	notAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}

	eventName := makeEvent(ctx, t, adminUser)

	// No JWT at all -> 401.
	_, resp := notAuthenticated.getMetrics(ctx, eventName)
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// A non-participant in the event is refused with a flat 403.
	_, resp = aliceUser.getMetrics(ctx, eventName)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// A mere reporter (no incident write) is still refused.
	resp = adminUser.addReporter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, resp = aliceUser.getMetrics(ctx, eventName)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Promoted to writer of the event, she may now open the dashboard (52d).
	resp = adminUser.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, resp = aliceUser.getMetrics(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// An admin succeeds via the admin bypass, without any per-event role.
	_, resp = adminUser.getMetrics(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

func TestMetricsAggregation(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	adminUser := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, adminUser)

	// Being an admin confers only global permissions; event-scoped writes still
	// need an explicit grant, so give the admin write access before seeding.
	resp := adminUser.addWriter(ctx, eventName, userAdminHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// One area, so we can exercise by-area + the Unassigned bucket.
	areaName := "Main Camp"
	areaSlug, resp := adminUser.editArea(ctx, eventName, imsjson.Area{Name: &areaName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Incident A: closed, TWO safety types (Medical=1, Fire=2), in Main Camp,
	// high priority. The two safety types must count A ONCE in the safety category.
	adminUser.newIncidentSuccess(ctx, imsjson.Incident{
		Event:           eventName,
		State:           "closed",
		Priority:        5,
		Summary:         new("closed incident"),
		IncidentTypeIDs: &[]int32{1, 2},
		Location:        imsjson.Location{AreaSlug: &areaSlug},
	})

	// Incident B: new, safety (Medical=1) + conduct (Personal Violation=8), no
	// area (-> Unassigned), normal priority.
	adminUser.newIncidentSuccess(ctx, imsjson.Incident{
		Event:           eventName,
		State:           "new",
		Priority:        3,
		Summary:         new("open incident, two categories"),
		IncidentTypeIDs: &[]int32{1, 8},
	})

	// Incident C: on_scene, operations (Construction Issue=14), in Main Camp,
	// low priority, needs follow-up.
	adminUser.newIncidentSuccess(ctx, imsjson.Incident{
		Event:           eventName,
		State:           "on_scene",
		Priority:        1,
		Summary:         new("follow up please"),
		Outcome:         new("follow_up_required"),
		IncidentTypeIDs: &[]int32{14},
		Location:        imsjson.Location{AreaSlug: &areaSlug},
	})

	m, resp := adminUser.getMetrics(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	assert.Equal(t, eventName, m.Event)

	// Totals.
	assert.Equal(t, int64(3), m.Total)
	assert.Equal(t, int64(1), m.Closed)
	assert.Equal(t, int64(2), m.Open)
	assert.Equal(t, int64(1), m.ClosedCount)
	require.NotNil(t, m.AvgTimeToCloseSeconds)
	assert.GreaterOrEqual(t, *m.AvgTimeToCloseSeconds, 0.0)

	// By state (zero-filled, all five present).
	assert.Len(t, m.ByState, 5)
	assert.Equal(t, int64(1), countFor(m.ByState, "new"))
	assert.Equal(t, int64(1), countFor(m.ByState, "on_scene"))
	assert.Equal(t, int64(1), countFor(m.ByState, "closed"))
	assert.Equal(t, int64(0), countFor(m.ByState, "on_hold"))
	assert.Equal(t, int64(0), countFor(m.ByState, "dispatched"))

	// By priority (three named buckets).
	assert.Equal(t, int64(1), countFor(m.ByPriority, "high"))
	assert.Equal(t, int64(1), countFor(m.ByPriority, "normal"))
	assert.Equal(t, int64(1), countFor(m.ByPriority, "low"))

	// By category — the multi-type semantics:
	//   safety  = 2 (A counted ONCE despite two safety types; plus B)
	//   conduct = 1 (B)
	//   operations = 1 (C)
	// so the categories sum to 4 > 3 total incidents.
	assert.Equal(t, int64(2), countFor(m.ByCategory, "safety"))
	assert.Equal(t, int64(1), countFor(m.ByCategory, "conduct"))
	assert.Equal(t, int64(1), countFor(m.ByCategory, "operations"))
	var categorySum int64
	for _, c := range m.ByCategory {
		categorySum += c.Count
	}
	assert.Equal(t, int64(4), categorySum)
	assert.Greater(t, categorySum, m.Total)

	// By type — distinct incidents per type.
	assert.Equal(t, int64(2), countFor(m.ByType, "1"))  // Medical: A + B
	assert.Equal(t, int64(1), countFor(m.ByType, "2"))  // Fire: A
	assert.Equal(t, int64(1), countFor(m.ByType, "8"))  // Personal Violation: B
	assert.Equal(t, int64(1), countFor(m.ByType, "14")) // Construction Issue: C

	// By area — a clean partition that sums to total; busiest first.
	assert.Equal(t, int64(2), countFor(m.ByArea, areaSlug)) // A + C
	assert.Equal(t, int64(1), countFor(m.ByArea, ""))       // Unassigned: B
	var areaSum int64
	for _, a := range m.ByArea {
		areaSum += a.Count
	}
	assert.Equal(t, m.Total, areaSum)
	require.NotEmpty(t, m.ByArea)
	assert.Equal(t, areaSlug, m.ByArea[0].Key) // busiest first

	// Open follow-ups: only C.
	require.Len(t, m.OpenFollowUps, 1)
	assert.Equal(t, "follow up please", m.OpenFollowUps[0].Summary)

	// By day: all three created today, one bucket.
	require.Len(t, m.ByDay, 1)
	assert.Equal(t, int64(3), m.ByDay[0].Count)

	// By role: the only person on this event's roster is the admin, granted the
	// writer rung above. The breakdown is zero-filled in ladder order (all 7 rungs).
	assert.Len(t, m.ByRole, 7)
	assert.Equal(t, int64(1), countFor(m.ByRole, "writer"))
	assert.Equal(t, int64(0), countFor(m.ByRole, "crew_leader"))
	assert.Equal(t, int64(0), countFor(m.ByRole, "reporter"))
	assert.Equal(t, "writer", m.ByRole[0].Key) // ladder order: writer first
}
