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
	// Booth is an optional booth number/identifier. Empty string clears it; nil
	// leaves it unchanged on write.
	Booth *string `json:"booth,omitempty"`
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
	JournalEntries  []JournalEntry    `json:"journal_entries"`

	// ViewerMayAddJournal is a read-only, viewer-dependent flag (52f): true when the
	// caller may append journal entries to this incident — either an event writer, or
	// an involved reporter who has been granted per-incident access. The detail page
	// shows the journal-add box when this is set.
	ViewerMayAddJournal bool `json:"viewer_may_add_journal,omitzero"`
}

type IncidentPerson struct {
	PersonID    int64   `json:"person_id,omitempty"`
	FairName    string  `json:"fair_name,omitempty"`
	LegalName   string  `json:"legal_name,omitempty"`
	Involvement *string `json:"involvement,omitempty"`

	// GrantedAccess (52f) records whether this involved person has been granted
	// per-incident access (read + add journal entries) to the incident. Writable on
	// attach (writer-gated, default false); echoed on read.
	GrantedAccess bool `json:"granted_access,omitzero"`
	// HasEventAccess is read-only: the involved person already has event-wide incident
	// access (admin or 'writer' role), so a grant is moot. Drives the People editor's
	// "has access" hint vs the "Grant access" toggle.
	HasEventAccess bool `json:"has_event_access,omitzero"`
}

type LinkedIncident struct {
	EventName string `json:"event_name"`
	EventID   int32  `json:"event_id"`
	Number    int32  `json:"number"`
	Summary   string `json:"summary,omitempty"`
}
