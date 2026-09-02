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

package metrics

import (
	"sort"
	"time"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// The GetMetrics REST handler (GET /events/{eventName}/metrics) was RETIRED in slice 1c and moved
// onto Connect as metrics.Service.GetMetrics (connect.go). Its REST route was deleted, not shimmed
// (aggressive migration, plan 09 §6). What remains here is the aggregation core — buildMetrics and
// its helpers — which the Connect read reuses (computeMetrics, now a Service method, calls it).

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
