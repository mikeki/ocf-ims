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

package outcome

import (
	"context"
	"slices"
	"strings"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/store"
)

// The GetOutcomes, EditOutcomes, and ProposeOutcome REST handlers (GET+POST /outcomes and POST
// /events/{eventName}/outcomes) were RETIRED in slice 1c and moved onto Connect as methods on
// outcome.Service (connect.go); the POST multiplexer was decomposed into CreateOutcome /
// UpdateOutcome / ApproveOutcome / SetOutcomeHidden per the 0e contract split. The REST routes were
// deleted, not shimmed (aggressive migration, plan 09 §6). loadOutcomesJSON (the cache refresher) is
// still used by the Connect read.

// loadOutcomesJSON reads the whole outcome taxonomy and builds the sorted JSON list. It is the cache
// refresher, so the sort happens once per load and cached readers only ever read the shared (never
// mutated) slice. Outcomes sort alphabetically by name (they carry no group/order of their own).
func loadOutcomesJSON(ctx context.Context, imsDBQ *store.DBQ) (imsjson.Outcomes, error) {
	rows, err := imsDBQ.OutcomesWithProposer(ctx, imsDBQ)
	if err != nil {
		return nil, err
	}
	response := make(imsjson.Outcomes, 0, len(rows))
	for _, o := range rows {
		out := imsjson.Outcome{
			ID:       o.ID,
			Name:     new(o.Name),
			Hidden:   new(o.Hidden),
			Approved: new(o.Approved),
		}
		if o.ProposedByPersonID.Valid {
			out.Proposer = &imsjson.Mention{
				PersonID: o.ProposedByPersonID.Int32,
				Handle:   o.ProposerHandle.String,
				Name:     o.ProposerName.String,
			}
		}
		response = append(response, out)
	}
	slices.SortFunc(response, func(a, b imsjson.Outcome) int {
		an, bn := "", ""
		if a.Name != nil {
			an = strings.ToLower(*a.Name)
		}
		if b.Name != nil {
			bn = strings.ToLower(*b.Name)
		}
		return strings.Compare(an, bn)
	})
	return response, nil
}
