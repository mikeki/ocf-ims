// SPDX-License-Identifier: Apache-2.0

package json

import "time"

type Reports []Report
type Report struct {
	Event          string         `json:"event"`
	Number         int32          `json:"number"`
	Created        time.Time      `json:"created,omitzero"`
	CreatedBy      *Mention       `json:"created_by,omitzero"`
	Summary        *string        `json:"summary"`
	Incident       *int32         `json:"incident,omitzero"`
	JournalEntries []JournalEntry `json:"journal_entries"`
	// MayEditSummary / MayAddJournalEntry gate the client's edit controls for THIS
	// caller on THIS report (the server is authoritative). Summary edits are limited
	// to the report's creator and admins; journal entries additionally allow the
	// writer role. Read-only: set on serialization, ignored on write.
	MayEditSummary     bool `json:"may_edit_summary"`
	MayAddJournalEntry bool `json:"may_add_journal_entry"`
}
