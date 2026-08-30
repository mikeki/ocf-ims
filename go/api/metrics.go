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

package api

import (
	"context"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/mikeki/ocf-ims/directory"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/cache"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"golang.org/x/sync/errgroup"
)

// metricsCacheTTL is how long a computed per-event aggregate is reused. The
// dashboard auto-refreshes on roughly this cadence, so several admins watching
// the same event share one set of (heavy GROUP BY) queries per minute rather than
// each request hitting the database.
const metricsCacheTTL = time.Minute

// metricsCache memoizes the dashboard aggregate per event with a short TTL. Each
// event gets its own cache.InMemory, which provides the TTL and single-flight
// (concurrent requests for the same event coalesce onto one refresh) — so a busy
// dashboard can't stampede the database.
type metricsCache struct {
	mu      sync.Mutex
	byEvent map[string]*cache.InMemory[imsjson.Metrics]
}

func newMetricsCache() *metricsCache {
	return &metricsCache{byEvent: map[string]*cache.InMemory[imsjson.Metrics]{}}
}

// InvalidateEvent drops the cached aggregate for one event so the next dashboard
// read recomputes from the database. Called after an event-scoped mutation
// (incident or area change) so the dashboard reflects the write immediately
// instead of waiting out the TTL. A no-op if the event was never cached.
func (c *metricsCache) InvalidateEvent(eventName string) {
	c.mu.Lock()
	entry, ok := c.byEvent[eventName]
	c.mu.Unlock()
	if ok {
		entry.Invalidate()
	}
}

// InvalidateAll drops every event's cached aggregate. Used after a change to
// global reference data that the dashboard aggregates across events (the
// incident-type taxonomy), where a single event key can't target the effect.
func (c *metricsCache) InvalidateAll() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, entry := range c.byEvent {
		entry.Invalidate()
	}
}

// get returns the cached aggregate for eventName, computing it via refresh on a
// miss (or expiry). refresh is only consulted once per TTL per event even under
// concurrent load; errors are not cached.
func (c *metricsCache) get(
	ctx context.Context,
	eventName string,
	refresh func(context.Context) (imsjson.Metrics, error),
) (*imsjson.Metrics, error) {
	c.mu.Lock()
	entry, ok := c.byEvent[eventName]
	if !ok {
		entry = cache.New(metricsCacheTTL, refresh)
		c.byEvent[eventName] = entry
	}
	c.mu.Unlock()
	return entry.Get(ctx)
}

// GetMetrics serves the per-event dashboard aggregate (Phase 7). It is read-only
// and open to admins and per-event writers (plan 52d): writers get
// EventWriteIncidents from their PERSON__EVENT tier and admins get it via the
// admin bypass, so a single write-bit check gates both. This is the single
// permission seam described in docs/plans/70-dashboards.md (D3): when roles grow
// further, only this check changes and the page does not move.
type GetMetrics struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
	cache     *metricsCache
}

func (action GetMetrics) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.getMetrics(req)
	if errHTTP != nil {
		errHTTP.From("[getMetrics]").WriteResponse(w)
		return
	}
	mustWriteJSON(w, req, resp)
}

func (action GetMetrics) getMetrics(req *http.Request) (imsjson.Metrics, *herr.HTTPError) {
	var resp imsjson.Metrics

	// The dashboard opens to admins and per-event writers (plan 52d). Resolving the
	// event here (rather than gating before it, as the admin-only version did) is
	// fine: event names aren't secret — every authenticated user sees them in the
	// nav — and writers get EventWriteIncidents from their tier while admins get it
	// via the bypass, so the one write-bit check covers both.
	event, _, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return resp, errHTTP.From("[getEventPermissions]")
	}
	if eventPermissions&authz.EventWriteIncidents == 0 {
		return resp, herr.Forbidden("The dashboard is restricted to administrators and event writers", nil)
	}

	// The heavy work (event lookup + GROUP BY aggregation) goes through the
	// per-event cache, so repeated dashboard loads within the TTL serve a cached
	// payload without touching the database.
	cached, err := action.cache.get(req.Context(), event.Name,
		func(ctx context.Context) (imsjson.Metrics, error) {
			return action.computeMetrics(ctx, event.Name)
		})
	if err != nil {
		return resp, herr.AsHTTPError(err)
	}
	return *cached, nil
}

// computeMetrics resolves the event and runs the aggregate queries. It is the
// cache's refresher, so it runs at most once per TTL per event.
func (action GetMetrics) computeMetrics(ctx context.Context, eventName string) (imsjson.Metrics, error) {
	var resp imsjson.Metrics

	event, errHTTP := getEventCtx(ctx, eventName, action.imsDBQ)
	if errHTTP != nil {
		return resp, errHTTP.From("[getEvent]")
	}

	var (
		incidents  []imsdb.MetricsIncidentsRow
		byCategory []imsdb.MetricsIncidentCountByCategoryRow
		byType     []imsdb.MetricsIncidentCountByTypeRow
		byArea     []imsdb.MetricsIncidentCountByAreaRow
		byRole     []imsdb.MetricsParticipationCountByEventRow
	)
	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error {
		var err error
		incidents, err = action.imsDBQ.MetricsIncidents(groupCtx, action.imsDBQ, event.ID)
		if err != nil {
			return herr.InternalServerError("Failed to fetch incidents", err).From("[MetricsIncidents]")
		}
		return nil
	})
	group.Go(func() error {
		var err error
		byCategory, err = action.imsDBQ.MetricsIncidentCountByCategory(groupCtx, action.imsDBQ, event.ID)
		if err != nil {
			return herr.InternalServerError("Failed to fetch category counts", err).From("[MetricsIncidentCountByCategory]")
		}
		return nil
	})
	group.Go(func() error {
		var err error
		byType, err = action.imsDBQ.MetricsIncidentCountByType(groupCtx, action.imsDBQ, event.ID)
		if err != nil {
			return herr.InternalServerError("Failed to fetch type counts", err).From("[MetricsIncidentCountByType]")
		}
		return nil
	})
	group.Go(func() error {
		var err error
		byArea, err = action.imsDBQ.MetricsIncidentCountByArea(groupCtx, action.imsDBQ, event.ID)
		if err != nil {
			return herr.InternalServerError("Failed to fetch area counts", err).From("[MetricsIncidentCountByArea]")
		}
		return nil
	})
	group.Go(func() error {
		var err error
		byRole, err = action.imsDBQ.MetricsParticipationCountByEvent(groupCtx, action.imsDBQ, event.ID)
		if err != nil {
			return herr.InternalServerError("Failed to fetch role counts", err).From("[MetricsParticipationCountByEvent]")
		}
		return nil
	})
	err := group.Wait()
	if err != nil {
		return resp, err
	}

	resp = buildMetrics(event, incidents, byCategory, byType, byArea, byRole)
	resp.GeneratedAtMS = time.Now().UnixMilli()
	return resp, nil
}

// outcomeFollowUpRequired is the OUTCOME.NAME the dashboard treats as "needs
// follow-up" when listing still-open incidents. It matches the seeded outcome row
// (migration 00019); if an admin renames that outcome, update this to match.
const outcomeFollowUpRequired = "Follow-Up Required"

// buildMetrics turns the raw query rows into the dashboard payload. The
// state/priority/by-day/time-to-close/follow-up metrics are derived here from the
// per-incident rows; category/type/area come straight from their GROUP BY queries.
func buildMetrics(
	event imsdb.Event,
	incidents []imsdb.MetricsIncidentsRow,
	byCategory []imsdb.MetricsIncidentCountByCategoryRow,
	byType []imsdb.MetricsIncidentCountByTypeRow,
	byArea []imsdb.MetricsIncidentCountByAreaRow,
	byRole []imsdb.MetricsParticipationCountByEventRow,
) imsjson.Metrics {
	resp := imsjson.Metrics{
		Event:   event.Name,
		EventID: event.ID,
		Total:   int64(len(incidents)),
	}

	stateCounts := make(map[imsdb.IncidentState]int64)
	priorityCounts := make(map[string]int64)
	dayCounts := make(map[string]int64)
	var closeSum float64
	var followUps []imsjson.MetricIncidentRef

	for _, inc := range incidents {
		stateCounts[inc.State]++
		if inc.State == imsdb.IncidentStateClosed {
			resp.Closed++
		}
		priorityCounts[priorityKey(inc.Priority)]++

		// By-day buckets to the server's local calendar day, intentionally — the
		// dashboard reports in the server's zone (the zone the UI displays in) and
		// SQL tz functions aren't portable. See docs/plans/70-dashboards.md (D4/§4).
		day := conv.FloatToTime(inc.Created).In(time.Local).Format("2006-01-02") //nolint:gosmopolitan
		dayCounts[day]++

		if inc.Closed.Valid {
			resp.ClosedCount++
			closeSum += inc.Closed.Float64 - inc.Created
		}

		if inc.OutcomeName.Valid &&
			inc.OutcomeName.String == outcomeFollowUpRequired &&
			inc.State != imsdb.IncidentStateClosed {
			// A private incident still contributes to the counts and appears in the
			// follow-ups list (by number/state/priority), but its brief summary is
			// private, so withhold it — the dashboard is cached per-event, not tailored
			// per-viewer, and a writer must not see private summary text here.
			summary := inc.Summary.String
			if inc.Private {
				summary = ""
			}
			followUps = append(followUps, imsjson.MetricIncidentRef{
				Number:  inc.Number,
				Summary: summary,
			})
		}
	}
	resp.Open = resp.Total - resp.Closed

	// by-state: every state, in canonical order, zero-filled so the status chart
	// has a stable shape.
	resp.ByState = make([]imsjson.MetricCount, 0, len(imsdb.AllIncidentStateValues()))
	for _, st := range imsdb.AllIncidentStateValues() {
		resp.ByState = append(resp.ByState, imsjson.MetricCount{
			Key:   string(st),
			Label: stateLabel(st),
			Count: stateCounts[st],
		})
	}

	// by-priority: the three named buckets, always present and high→low.
	resp.ByPriority = make([]imsjson.MetricCount, 0, 3)
	for _, p := range []struct{ key, label string }{
		{"high", "High"}, {"normal", "Normal"}, {"low", "Low"},
	} {
		resp.ByPriority = append(resp.ByPriority, imsjson.MetricCount{
			Key:   p.key,
			Label: p.label,
			Count: priorityCounts[p.key],
		})
	}

	resp.ByCategory = make([]imsjson.MetricCount, 0, len(byCategory))
	for _, row := range byCategory {
		key, label := categoryKeyLabel(row.Category)
		resp.ByCategory = append(resp.ByCategory, imsjson.MetricCount{
			Key:   key,
			Label: label,
			Count: row.Count,
		})
	}

	resp.ByType = make([]imsjson.MetricCount, 0, len(byType))
	for _, row := range byType {
		resp.ByType = append(resp.ByType, imsjson.MetricCount{
			Key:   conv.FormatInt(row.TypeID),
			Label: row.TypeName,
			Count: row.Count,
		})
	}

	resp.ByArea = make([]imsjson.MetricCount, 0, len(byArea))
	for _, row := range byArea {
		key := row.AreaSlug.String
		label := row.AreaName.String
		if !row.AreaSlug.Valid {
			// Incidents with no area: keep a stable key and a human label.
			key = ""
			label = "Unassigned"
		}
		resp.ByArea = append(resp.ByArea, imsjson.MetricCount{
			Key:   key,
			Label: label,
			Count: row.Count,
		})
	}

	// by-role: the event roster grouped by participation rung, in ladder order and
	// zero-filled so the chart shape is stable across refreshes.
	roleCounts := make(map[imsdb.PersonEventParticipationType]int64, len(byRole))
	for _, row := range byRole {
		roleCounts[row.Participation] = row.Count
	}
	resp.ByRole = make([]imsjson.MetricCount, 0, len(participationLadder))
	for _, rung := range participationLadder {
		resp.ByRole = append(resp.ByRole, imsjson.MetricCount{
			Key:   string(rung.rung),
			Label: rung.label,
			Count: roleCounts[rung.rung],
		})
	}

	// by-day: sorted ascending by date so the line chart reads left-to-right.
	resp.ByDay = make([]imsjson.MetricDay, 0, len(dayCounts))
	for day, count := range dayCounts {
		resp.ByDay = append(resp.ByDay, imsjson.MetricDay{Date: day, Count: count})
	}
	sort.Slice(resp.ByDay, func(i, j int) bool { return resp.ByDay[i].Date < resp.ByDay[j].Date })

	resp.OpenFollowUps = followUps
	if resp.OpenFollowUps == nil {
		resp.OpenFollowUps = []imsjson.MetricIncidentRef{}
	}

	if resp.ClosedCount > 0 {
		avg := closeSum / float64(resp.ClosedCount)
		resp.AvgTimeToCloseSeconds = &avg
	}

	return resp
}

// priorityKey buckets an incident's numeric priority into the three named tiers.
// Priority runs High=5 .. Low=1 (see json.IncidentPriority*); 4-5 are High, 3 is
// Normal, and 1-2 are Low.
// participationLadder is the per-event rung order (most → least privileged) with
// display labels, used to render the dashboard's by-role breakdown in a stable,
// zero-filled order (plan 53 ladder).
var participationLadder = []struct {
	rung  imsdb.PersonEventParticipationType
	label string
}{
	{imsdb.PersonEventParticipationTypeWriter, "FC/BUM"},
	{imsdb.PersonEventParticipationTypeCrewLeader, "Crew leader"},
	{imsdb.PersonEventParticipationTypeReporter, "Reporter"},
	{imsdb.PersonEventParticipationTypeVolunteer, "Volunteer"},
	{imsdb.PersonEventParticipationTypePublic, "Public"},
	{imsdb.PersonEventParticipationTypeNotPresent, "Not present"},
	{imsdb.PersonEventParticipationTypeEjected, "Booted"},
}

func priorityKey(priority int8) string {
	switch {
	case priority >= 4:
		return "high"
	case priority <= 2:
		return "low"
	default:
		return "normal"
	}
}

func stateLabel(state imsdb.IncidentState) string {
	switch state {
	case imsdb.IncidentStateOpen:
		return "Open"
	case imsdb.IncidentStateClosed:
		return "Closed"
	default:
		return string(state)
	}
}

// categoryKeyLabel maps an INCIDENT_TYPE.GROUP value to a (key, label) pair. A
// null group (an ungrouped type, e.g. "Other") becomes the "Ungrouped" bucket.
func categoryKeyLabel(group imsdb.NullIncidentTypeGroup) (key, label string) {
	if !group.Valid {
		return "", "Ungrouped"
	}
	switch group.IncidentTypeGroup {
	case imsdb.IncidentTypeGroupSafety:
		return "safety", "Safety"
	case imsdb.IncidentTypeGroupConduct:
		return "conduct", "Conduct"
	case imsdb.IncidentTypeGroupOperations:
		return "operations", "Operations"
	case imsdb.IncidentTypeGroupCompliance:
		return "compliance", "Compliance"
	default:
		return string(group.IncidentTypeGroup), string(group.IncidentTypeGroup)
	}
}
