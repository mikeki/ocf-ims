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

package crew

import (
	"context"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// The GetCrews / EditCrews / MyCrews / EditMyCrew REST handlers (GET+POST /events/{eventName}/crews and
// .../crews/mine) were RETIRED in slice 1c and moved onto Connect as methods on crew.Service
// (connect.go); the POST multiplexer was decomposed into CreateCrew / UpdateCrew / DeleteCrew /
// SetCrewMembership, and the crew-leader self-service pair into ListMyCrews / SetMyCrewMembership, per
// the 0c contract split. The REST routes were deleted, not shimmed (aggressive migration, plan 09 §6).
// What remains here is the read builders (loadCrewsJSON / loadLedCrewsJSON) the Connect reads reuse.

// mySQLErNoReferencedRow is the MySQL error for a failed foreign-key insert (referenced row missing) —
// e.g. adding a member with a non-existent person id. Used by the membership-edit cores in connect.go.
const mySQLErNoReferencedRow = 1452

// loadCrewsJSON reads one event's crews and each crew's membership, building the JSON list. It is the
// crews cache refresher, so cached readers only ever read the shared (never mutated) slice.
func loadCrewsJSON(ctx context.Context, imsDBQ *store.DBQ, eventID int32) (imsjson.Crews, error) {
	crewRows, err := imsDBQ.Crews(ctx, imsDBQ, eventID)
	if err != nil {
		return nil, err
	}
	resp := make(imsjson.Crews, 0, len(crewRows))
	for _, c := range crewRows {
		memberRows, err := imsDBQ.CrewMembers(ctx, imsDBQ, imsdb.CrewMembersParams{
			Event:    eventID,
			CrewSlug: c.Slug,
		})
		if err != nil {
			return nil, err
		}
		members := make([]imsjson.CrewMember, 0, len(memberRows))
		for _, m := range memberRows {
			members = append(members, imsjson.CrewMember{
				PersonID: m.PersonID,
				Handle:   m.MemberHandle.String,
				Name:     m.MemberName.String,
				IsLeader: m.IsLeader,
			})
		}
		resp = append(resp, imsjson.Crew{
			Slug:      c.Slug,
			Name:      new(c.Name),
			SortOrder: new(c.SortOrder),
			Members:   members,
		})
	}
	return resp, nil
}

// loadLedCrewsJSON returns the crews (with members) that leaderPersonID leads for an event. It reuses
// loadCrewsJSON and filters to the led set, so the JSON shape matches the admin crews list exactly.
func loadLedCrewsJSON(ctx context.Context, imsDBQ *store.DBQ, eventID, leaderPersonID int32) (imsjson.Crews, error) {
	ledSlugs, err := imsDBQ.CrewsLedByPerson(ctx, imsDBQ, imsdb.CrewsLedByPersonParams{
		Event:    eventID,
		PersonID: leaderPersonID,
	})
	if err != nil {
		return nil, err
	}
	if len(ledSlugs) == 0 {
		return imsjson.Crews{}, nil
	}
	led := make(map[string]bool, len(ledSlugs))
	for _, s := range ledSlugs {
		led[s] = true
	}
	all, err := loadCrewsJSON(ctx, imsDBQ, eventID)
	if err != nil {
		return nil, err
	}
	resp := make(imsjson.Crews, 0, len(led))
	for _, c := range all {
		if led[c.Slug] {
			resp = append(resp, c)
		}
	}
	return resp, nil
}
