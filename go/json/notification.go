// SPDX-License-Identifier: Apache-2.0

package json

import "time"

// Notification is one in-app notification for the current user (plan 82),
// enriched for display. Type is the trigger ("mentioned", "added_to_incident",
// "report_requested").
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
