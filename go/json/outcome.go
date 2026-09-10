// SPDX-License-Identifier: Apache-2.0

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
