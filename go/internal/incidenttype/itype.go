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

package incidenttype

import (
	"context"
	"slices"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// The GetIncidentTypes, EditIncidentTypes, and ProposeIncidentType REST handlers (GET+POST
// /incident_types and POST /events/{eventName}/incident_types) were RETIRED in slice 1c and moved
// onto Connect as methods on incidenttype.Service (connect.go); the POST multiplexer was decomposed
// into CreateIncidentType / UpdateIncidentType / ApproveIncidentType / SetIncidentTypeHidden per the
// 0e contract split. The REST routes were deleted, not shimmed (aggressive migration, plan 09 §6).
// loadIncidentTypesJSON (the cache refresher) and groupToString are still used by the Connect read.

// loadIncidentTypesJSON reads the whole incident-type taxonomy and builds the sorted JSON list. It
// is the cache refresher, so the sort happens once per load and cached readers only ever read the
// shared (never mutated) slice.
func loadIncidentTypesJSON(ctx context.Context, imsDBQ *store.DBQ) (imsjson.IncidentTypes, error) {
	typeRows, err := imsDBQ.IncidentTypesWithProposer(ctx, imsDBQ)
	if err != nil {
		return nil, err
	}
	response := make(imsjson.IncidentTypes, 0, len(typeRows))
	for _, t := range typeRows {
		it := imsjson.IncidentType{
			ID:          t.ID,
			Name:        new(t.Name),
			Description: conv.SqlToString(t.Description),
			Hidden:      new(t.Hidden),
			Group:       groupToString(t.Group),
			Approved:    new(t.Approved),
		}
		if t.ProposedByPersonID.Valid {
			it.Proposer = &imsjson.Mention{
				PersonID: t.ProposedByPersonID.Int32,
				Handle:   t.ProposerHandle.String,
				Name:     t.ProposerName.String,
			}
		}
		response = append(response, it)
	}
	slices.SortFunc(response, func(a, b imsjson.IncidentType) int {
		return int(a.ID) - int(b.ID)
	})
	return response, nil
}

// groupToString converts the nullable sqlc group enum to a JSON-friendly *string, returning nil
// when the group is NULL.
func groupToString(group imsdb.NullIncidentTypeGroup) *string {
	if !group.Valid {
		return nil
	}
	return new(string(group.IncidentTypeGroup))
}
