// SPDX-License-Identifier: Apache-2.0

package json

// Crew is a per-event crew. Slug is server-generated from Name at create time and
// immutable thereafter; clients send an empty Slug to create a new crew and a
// populated Slug to edit an existing one. Members is populated on reads and
// ignored on writes — membership is changed one person at a time via Member.
type Crew struct {
	Slug      string  `json:"slug,omitempty"`
	Name      *string `json:"name,omitempty"`
	SortOrder *int32  `json:"sort_order,omitempty"`
	// Members is the crew's roster, present on reads. Read-only.
	Members []CrewMember `json:"members,omitempty"`
	// Delete, on a write with a Slug set, removes the crew (and all its
	// membership rows). Mutually exclusive with Member and the rename fields.
	Delete bool `json:"delete,omitempty"`
	// Member, on a write with a Slug set, adds/updates/removes a single person's
	// membership in this crew. Mutually exclusive with Delete.
	Member *CrewMemberEdit `json:"member,omitempty"`
}

// CrewMember is one person's membership in a crew, as returned on a read. Handle
// and Name are the person's display fields; IsLeader marks a crew leader.
type CrewMember struct {
	PersonID int32  `json:"person_id"`
	Handle   string `json:"handle,omitempty"`
	Name     string `json:"name,omitempty"`
	IsLeader bool   `json:"is_leader"`
}

// CrewMemberEdit is a single membership mutation on a crew (write only). Remove
// deletes the membership; otherwise the person is added (or left in place) with
// their leader flag set to IsLeader.
type CrewMemberEdit struct {
	PersonID int32 `json:"person_id"`
	Remove   bool  `json:"remove,omitempty"`
	IsLeader bool  `json:"is_leader,omitempty"`
}

// Crews is the list of crews for an event.
type Crews []Crew
