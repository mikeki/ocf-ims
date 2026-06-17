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
	"net/http"
	"sort"
	"time"

	"github.com/mikeki/ocf-ims/directory"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"golang.org/x/sync/errgroup"
)

// GetMetrics serves the per-event dashboard aggregate (Phase 7). It is read-only
// and admin-gated. The admin check is the single permission seam described in
// docs/plans/70-dashboards.md (D3): when Phase 5 roles grow, only this check
// changes — a future GlobalViewDashboard or per-event read swaps in here and the
// page does not move.
type GetMetrics struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
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

	// Gate on admin BEFORE resolving the event, so the endpoint never reveals
	// whether an event exists to a non-admin (they always get a flat 403).
	jwtCtx, errHTTP := getJwtCtx(req)
	if errHTTP != nil {
		return resp, errHTTP.From("[getJwtCtx]")
	}
	if !jwtCtx.Claims.PersonAdmin() {
		return resp, herr.Forbidden("The dashboard is restricted to administrators", nil)
	}

	event, errHTTP := getEvent(req, req.PathValue("eventName"), action.imsDBQ)
	if errHTTP != nil {
		return resp, errHTTP.From("[getEvent]")
	}

	var (
		incidents  []imsdb.MetricsIncidentsRow
		byCategory []imsdb.MetricsIncidentCountByCategoryRow
		byType     []imsdb.MetricsIncidentCountByTypeRow
		byArea     []imsdb.MetricsIncidentCountByAreaRow
	)
	group, groupCtx := errgroup.WithContext(req.Context())
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
	err := group.Wait()
	if err != nil {
		return resp, herr.AsHTTPError(err)
	}

	resp = buildMetrics(event, incidents, byCategory, byType, byArea)
	return resp, nil
}

// buildMetrics turns the raw query rows into the dashboard payload. The
// state/priority/by-day/time-to-close/follow-up metrics are derived here from the
// per-incident rows; category/type/area come straight from their GROUP BY queries.
func buildMetrics(
	event imsdb.Event,
	incidents []imsdb.MetricsIncidentsRow,
	byCategory []imsdb.MetricsIncidentCountByCategoryRow,
	byType []imsdb.MetricsIncidentCountByTypeRow,
	byArea []imsdb.MetricsIncidentCountByAreaRow,
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

		if inc.Outcome.Valid &&
			inc.Outcome.IncidentOutcome == imsdb.IncidentOutcomeFollowUpRequired &&
			inc.State != imsdb.IncidentStateClosed {
			followUps = append(followUps, imsjson.MetricIncidentRef{
				Number:  inc.Number,
				Summary: inc.Summary.String,
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
	case imsdb.IncidentStateNew:
		return "New"
	case imsdb.IncidentStateOnHold:
		return "On Hold"
	case imsdb.IncidentStateDispatched:
		return "Dispatched"
	case imsdb.IncidentStateOnScene:
		return "On Scene"
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
