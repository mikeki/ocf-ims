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
