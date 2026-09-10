// SPDX-License-Identifier: Apache-2.0

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
