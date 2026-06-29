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
	Summary        *string        `json:"summary"`
	Incident       *int32         `json:"incident,omitzero"`
	JournalEntries []JournalEntry `json:"journal_entries"`

	// Submitter is the account that created the report (audit). Reporter is the
	// person the report is about — it defaults to the submitter but may differ
	// when someone files on another's behalf (6m). Both are read-only output.
	Submitter *ReportPerson `json:"submitter,omitzero"`
	Reporter  *ReportPerson `json:"reporter,omitzero"`

	// ReporterPersonID is write-only: a new Report may name a reporter other than
	// the submitter. Omitted (or zero) means "default the reporter to the
	// submitter" server-side.
	ReporterPersonID *int32 `json:"reporter_person_id,omitzero"`
}

// ReportPerson is a minimal person reference for display (PERSON registry id +
// handle/name), mirroring json.Mention.
type ReportPerson struct {
	PersonID int32  `json:"person_id"`
	Handle   string `json:"handle,omitempty"`
	Name     string `json:"name,omitempty"`
}
