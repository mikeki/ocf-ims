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

type IncidentType struct {
	ID          int32   `json:"id"`
	Name        *string `json:"name"`
	Description *string `json:"description,omitempty"`
	Hidden      *bool   `json:"hidden"`
	// Group is the OCF category an incident type belongs to (Phase 4a):
	// "safety", "conduct", "operations", or "compliance". Nil when ungrouped.
	Group *string `json:"group,omitempty"`
	// Approved is false while a type is a writer's pending proposal awaiting an
	// admin's review (round-7 item 2). Present on every type on a read. On a write,
	// an admin sends approved=true (with an id, no other fields) to approve.
	Approved *bool `json:"approved,omitempty"`
	// Proposer is the person who proposed a still-unapproved type; read-only, and
	// nil for seeded / admin-created / approved types.
	Proposer *Mention `json:"proposer,omitempty"`
}

type IncidentTypes []IncidentType
