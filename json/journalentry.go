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

type JournalEntry struct {
	ID          int32      `json:"id"`
	Created     time.Time  `json:"created,omitzero"`
	Author      string     `json:"author"`
	SystemEntry bool       `json:"system_entry"`
	Text        string     `json:"text"`
	Stricken    *bool      `json:"stricken"`
	Attachment  Attachment `json:"attachment,omitzero"`

	// Mentions (plan 81). On write, the client sends MentionedPersonIDs — the
	// people picked via the "@" typeahead while composing the entry. On read,
	// Mentions is the resolved list (id + handle/name) for rendering and linking.
	MentionedPersonIDs []int32   `json:"mentioned_person_ids,omitempty"`
	Mentions           []Mention `json:"mentions,omitempty"`

	// "On behalf of" (6m). The entry's Author is the account that wrote it (the
	// submitter); OnBehalfOf is the person it's *about* when filed for someone
	// else (e.g. booth staff taking a report). On write the client sends
	// OnBehalfOfPersonID; on read OnBehalfOf is the resolved person, or nil when
	// the author is reporting for themselves.
	OnBehalfOfPersonID *int32   `json:"on_behalf_of_person_id,omitzero"`
	OnBehalfOf         *Mention `json:"on_behalf_of,omitzero"`
}

// Mention is a person referenced by an "@mention" in a journal entry, resolved
// for display. PersonID is the authoritative registry key; Handle/Name are for
// rendering and may be empty (a login-less person has no handle).
type Mention struct {
	PersonID int32  `json:"person_id"`
	Handle   string `json:"handle,omitempty"`
	Name     string `json:"name,omitempty"`
}

type Attachment struct {
	Name        string `json:"name"`
	Previewable bool   `json:"previewable"`
}
