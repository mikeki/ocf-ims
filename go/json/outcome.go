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

// Outcome is a disposition an incident can be assigned (feedback item 1 / slice
// 10a). Like IncidentType, it is admin-managed reference data with a propose/approve
// workflow, promoted from the former hardcoded INCIDENT.OUTCOME enum.
type Outcome struct {
	ID   int32   `json:"id"`
	Name *string `json:"name"`
	// Hidden retires an outcome from the incident-form picker without deleting it
	// (historical incidents keep referencing it). Present on every outcome on a read.
	Hidden *bool `json:"hidden"`
	// Approved is false while an outcome is a writer's pending proposal awaiting an
	// admin's review. On a write, an admin sends approved=true (with an id, no other
	// fields) to approve.
	Approved *bool `json:"approved,omitempty"`
	// Proposer is the person who proposed a still-unapproved outcome; read-only, and
	// nil for seeded / admin-created / approved outcomes.
	Proposer *Mention `json:"proposer,omitempty"`
}

type Outcomes []Outcome
