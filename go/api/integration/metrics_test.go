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

	resourcesv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/resources/v1"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// countFor returns the Count of the bucket with the given key, or -1 if absent.
func countFor(buckets []*resourcesv1.MetricCount, key string) int64 {
	for _, b := range buckets {
		if b.GetKey() == key {
			return b.GetCount()
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

	// Incident B: open, safety (Medical=1) + conduct (Personal Violation=8), no
	// area (-> Unassigned), normal priority.
	adminUser.newIncidentSuccess(ctx, imsjson.Incident{
		Event:           eventName,
		State:           "open",
		Priority:        3,
		Summary:         new("open incident, two categories"),
		IncidentTypeIDs: &[]int32{1, 8},
	})

	// Incident C: open, operations (Construction Issue=14), in Main Camp,
	// low priority, needs follow-up. Outcome is data-driven now (slice 10a).
	followUp := adminUser.outcomeIDByName(ctx, "Follow-Up Required")
	adminUser.newIncidentSuccess(ctx, imsjson.Incident{
		Event:           eventName,
		State:           "open",
		Priority:        1,
		Summary:         new("follow up please"),
		OutcomeID:       &followUp,
		IncidentTypeIDs: &[]int32{14},
		Location:        imsjson.Location{AreaSlug: &areaSlug},
	})

	m, resp := adminUser.getMetrics(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	assert.Equal(t, eventName, m.GetEvent())

	// Totals.
	assert.Equal(t, int64(3), m.GetTotal())
	assert.Equal(t, int64(1), m.GetClosed())
	assert.Equal(t, int64(2), m.GetOpen())
	assert.Equal(t, int64(1), m.GetClosedCount())
	require.NotNil(t, m.AvgTimeToCloseSeconds)
	assert.GreaterOrEqual(t, m.GetAvgTimeToCloseSeconds(), 0.0)

	// By state (zero-filled, both present). B and C are open, A is closed.
	assert.Len(t, m.GetByState(), 2)
	assert.Equal(t, int64(2), countFor(m.GetByState(), "open"))
	assert.Equal(t, int64(1), countFor(m.GetByState(), "closed"))

	// By priority (three named buckets).
	assert.Equal(t, int64(1), countFor(m.GetByPriority(), "high"))
	assert.Equal(t, int64(1), countFor(m.GetByPriority(), "normal"))
	assert.Equal(t, int64(1), countFor(m.GetByPriority(), "low"))

	// By category — the multi-type semantics:
	//   safety  = 2 (A counted ONCE despite two safety types; plus B)
	//   conduct = 1 (B)
	//   operations = 1 (C)
	// so the categories sum to 4 > 3 total incidents.
	assert.Equal(t, int64(2), countFor(m.GetByCategory(), "safety"))
	assert.Equal(t, int64(1), countFor(m.GetByCategory(), "conduct"))
	assert.Equal(t, int64(1), countFor(m.GetByCategory(), "operations"))
	var categorySum int64
	for _, c := range m.GetByCategory() {
		categorySum += c.GetCount()
	}
	assert.Equal(t, int64(4), categorySum)
	assert.Greater(t, categorySum, m.GetTotal())

	// By type — distinct incidents per type.
	assert.Equal(t, int64(2), countFor(m.GetByType(), "1"))  // Medical: A + B
	assert.Equal(t, int64(1), countFor(m.GetByType(), "2"))  // Fire: A
	assert.Equal(t, int64(1), countFor(m.GetByType(), "8"))  // Personal Violation: B
	assert.Equal(t, int64(1), countFor(m.GetByType(), "14")) // Construction Issue: C

	// By area — a clean partition that sums to total; busiest first.
	assert.Equal(t, int64(2), countFor(m.GetByArea(), areaSlug)) // A + C
	assert.Equal(t, int64(1), countFor(m.GetByArea(), ""))       // Unassigned: B
	var areaSum int64
	for _, a := range m.GetByArea() {
		areaSum += a.GetCount()
	}
	assert.Equal(t, m.GetTotal(), areaSum)
	require.NotEmpty(t, m.GetByArea())
	assert.Equal(t, areaSlug, m.GetByArea()[0].GetKey()) // busiest first

	// Open follow-ups: only C.
	require.Len(t, m.GetOpenFollowUps(), 1)
	assert.Equal(t, "follow up please", m.GetOpenFollowUps()[0].GetSummary())

	// By day: all three created today, one bucket.
	require.Len(t, m.GetByDay(), 1)
	assert.Equal(t, int64(3), m.GetByDay()[0].GetCount())

	// By role: the only person on this event's roster is the admin, granted the
	// writer rung above. The breakdown is zero-filled in ladder order (all 7 rungs).
	assert.Len(t, m.GetByRole(), 7)
	assert.Equal(t, int64(1), countFor(m.GetByRole(), "writer"))
	assert.Equal(t, int64(0), countFor(m.GetByRole(), "crew_leader"))
	assert.Equal(t, int64(0), countFor(m.GetByRole(), "reporter"))
	assert.Equal(t, "writer", m.GetByRole()[0].GetKey()) // ladder order: writer first
}

// TestMetricsCacheInvalidation verifies that a write invalidates the per-event
// dashboard cache immediately, rather than serving a stale aggregate until the
// TTL expires. The cache TTL is a minute, so within a single test tick a second
// read would return the primed value unless the write cleared the entry.
func TestMetricsCacheInvalidation(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	admin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	eventName := makeEvent(ctx, t, admin)
	resp := admin.addWriter(ctx, eventName, userAdminHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Prime the cache on the empty event.
	m, resp := admin.getMetrics(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, int64(0), m.GetTotal())

	// Creating an incident must be reflected on the very next read.
	num := admin.newIncidentSuccess(ctx, imsjson.Incident{
		Event:   eventName,
		State:   "open",
		Summary: new("cache buster"),
	})
	m, resp = admin.getMetrics(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, int64(1), m.GetTotal(), "incident create should invalidate the dashboard cache")
	assert.Equal(t, int64(1), countFor(m.GetByState(), "open"))

	// Editing that incident (closing it) must also invalidate immediately.
	resp = admin.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event:  eventName,
		Number: num,
		State:  "closed",
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	m, resp = admin.getMetrics(ctx, eventName)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	assert.Equal(t, int64(1), m.GetClosed(), "incident edit should invalidate the dashboard cache")
}
