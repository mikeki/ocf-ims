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

import (
	"time"
)

type Incidents []Incident

type Location struct {
	// Various fields here are nilable, because client can set them empty, and the server must be able
	// to distinguish empty from unset.

	// AreaSlug references an AREA(EVENT, SLUG) in the incident's event. Empty
	// string clears the area (back to unset); nil leaves it unchanged on write.
	AreaSlug *string `json:"area_slug,omitempty"`
	// Description is the freeform "place / details" box retained alongside the
	// structured area.
	Description *string `json:"description,omitempty"`
}

const (
	IncidentPriorityHigh   = 5
	IncidentPriorityNormal = 3
	IncidentPriorityLow    = 1
)

type Incident struct {
	Event           string            `json:"event"`
	EventID         int32             `json:"event_id"`
	Number          int32             `json:"number"`
	Created         time.Time         `json:"created,omitzero"`
	LastModified    time.Time         `json:"last_modified,omitzero"`
	State           string            `json:"state"`
	Outcome         *string           `json:"outcome"`
	Started         time.Time         `json:"started,omitzero"`
	Closed          time.Time         `json:"closed,omitzero"`
	Priority        int8              `json:"priority"`
	Summary         *string           `json:"summary"`
	Location        Location          `json:"location"`
	IncidentTypeIDs *[]int32          `json:"incident_type_ids"`
	Reports         *[]int32          `json:"reports"`
	Visits          *[]int32          `json:"visits"`
	People          *[]IncidentPerson `json:"people"`
	LinkedIncidents *[]LinkedIncident `json:"linked_incidents,omitzero"`
	ReportEntries   []ReportEntry     `json:"report_entries"`
}

type IncidentPerson struct {
	Handle      string  `json:"handle,omitempty"`
	Involvement *string `json:"involvement,omitempty"`
}

type LinkedIncident struct {
	EventName string `json:"event_name"`
	EventID   int32  `json:"event_id"`
	Number    int32  `json:"number"`
	Summary   string `json:"summary,omitempty"`
}
