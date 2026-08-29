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

// Area is a per-event location. Slug is server-generated from Name at create
// time and immutable thereafter; clients send an empty Slug to create a new
// area and a populated Slug to edit an existing one. ParentSlug is nil for a
// top-level area.
type Area struct {
	Slug       string  `json:"slug,omitempty"`
	Name       *string `json:"name,omitempty"`
	ParentSlug *string `json:"parent_slug,omitempty"`
	SortOrder  *int32  `json:"sort_order,omitempty"`
	// Approved is false while an area is a writer's pending proposal awaiting an
	// admin's review. On a read it is present on every area. On a write, an admin
	// sends approved=true (with a Slug, no other fields) to approve a proposal.
	Approved *bool `json:"approved,omitempty"`
	// Proposer is the person who proposed a still-unapproved area; read-only, and
	// nil for canonical/admin-created/approved areas.
	Proposer *Mention `json:"proposer,omitempty"`
	// DuplicateOf, on a write, marks this area (Slug) a duplicate of the named
	// existing area: an admin action that re-points this area's incidents to the
	// canonical one and then deletes this area.
	DuplicateOf *string `json:"duplicate_of,omitempty"`
}

// Areas is the list of areas for an event.
type Areas []Area
