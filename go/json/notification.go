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

import "time"

// Notification is one in-app notification for the current user (plan 82),
// enriched for display. Type is the trigger ("mentioned", "added_to_incident").
type Notification struct {
	ID              int32     `json:"id"`
	Type            string    `json:"type"`
	Event           string    `json:"event"`
	IncidentNumber  *int32    `json:"incident_number,omitempty"`
	IncidentSummary string    `json:"incident_summary,omitempty"`
	ReportNumber    *int32    `json:"report_number,omitempty"`
	ReportSummary   string    `json:"report_summary,omitempty"`
	JournalEntryID  *int32    `json:"journal_entry_id,omitempty"`
	Actor           string    `json:"actor,omitempty"`
	Created         time.Time `json:"created,omitzero"`
	Read            bool      `json:"read"`
}

// NotificationList is the payload of GET /ims/api/notifications: the current
// user's recent notifications plus their unread count (so the nav badge and the
// list come from one request).
type NotificationList struct {
	Notifications []Notification `json:"notifications"`
	Unread        int64          `json:"unread"`
}
