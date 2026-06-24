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

package json

// Metrics is the dashboard aggregate for a single event (Phase 7). Every number
// is for the event named in the request path. See docs/plans/70-dashboards.md.
type Metrics struct {
	Event   string `json:"event"`
	EventID int32  `json:"event_id"`

	// Total is the number of incidents in the event; Open + Closed == Total.
	Total  int64 `json:"total"`
	Open   int64 `json:"open"`
	Closed int64 `json:"closed"`

	ByState    []MetricCount `json:"by_state"`
	ByPriority []MetricCount `json:"by_priority"`

	// ByCategory and ByType can sum to MORE than Total: an incident may carry
	// several types spanning several categories, so it is counted once per
	// distinct category/type. Read these as "incidents with a type in this
	// category/type", not as a partition of the incidents.
	ByCategory []MetricCount `json:"by_category"`
	ByType     []MetricCount `json:"by_type"`

	// ByRole is the event roster broken down by participation rung (writer,
	// crew_leader, reporter, participant, public, not_present, ejected), in ladder
	// order and zero-filled, so the chart has a stable shape. Each person has at most
	// one rung per event, so these partition the roster.
	ByRole []MetricCount `json:"by_role"`

	// ByArea is a clean partition — each incident has at most one area, so these
	// sum to Total (incidents with no area land in the "Unassigned" bucket). It is
	// ordered busiest-first, so it doubles as the repeat-locations ranking.
	ByArea []MetricCount `json:"by_area"`

	// ByDay is the count of incidents created on each calendar day, keyed
	// YYYY-MM-DD in the server's local time zone (the zone the UI displays in).
	ByDay []MetricDay `json:"by_day"`

	// OpenFollowUps lists incidents still needing follow-up (OUTCOME =
	// follow_up_required and STATE != closed), each as a link target.
	OpenFollowUps []MetricIncidentRef `json:"open_follow_ups"`

	// AvgTimeToCloseSeconds is the mean CLOSED-CREATED over the ClosedCount closed
	// incidents; nil when none are closed (no meaningful average).
	AvgTimeToCloseSeconds *float64 `json:"avg_time_to_close_seconds"`
	ClosedCount           int64    `json:"closed_count"`

	// GeneratedAtMS is the Unix-millis time the aggregate was computed on the
	// server. Because the endpoint caches per event (see api/metrics.go), a
	// response may be served from a recent cache entry, so this reflects the true
	// age of the data — the dashboard shows it as "last updated".
	GeneratedAtMS int64 `json:"generated_at_ms"`
}

// MetricCount is one labelled bucket. Key is a stable identifier (an enum value,
// incident-type id, or area slug) suitable for client logic; Label is the
// human-facing name to render.
type MetricCount struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Count int64  `json:"count"`
}

// MetricDay is the number of incidents created on one calendar day, keyed
// YYYY-MM-DD (server-local time).
type MetricDay struct {
	Date  string `json:"date"`
	Count int64  `json:"count"`
}

// MetricIncidentRef is a minimal pointer to an incident, used for the
// open-follow-ups list so the dashboard can link each row to its incident page.
type MetricIncidentRef struct {
	Number  int32  `json:"number"`
	Summary string `json:"summary"`
}
