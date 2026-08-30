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

package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/internal/server"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

type GetOutcomes struct {
	imsDBQ            *store.DBQ
	userStore         directory.UserStore
	cache             *server.OutcomesCache
	cacheControlShort time.Duration
}

func (action GetOutcomes) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.getOutcomes(req)
	if errHTTP != nil {
		errHTTP.From("[getOutcomes]").WriteResponse(w)
		return
	}
	w.Header().Set("Cache-Control", fmt.Sprintf("max-age=%v, private", action.cacheControlShort.Milliseconds()/1000))
	server.MustWriteJSON(w, req, resp)
}
func (action GetOutcomes) getOutcomes(req *http.Request) (imsjson.Outcomes, *herr.HTTPError) {
	_, globalPermissions, errHTTP := server.GetGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return nil, errHTTP.From("[server.GetGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalReadOutcomes == 0 {
		return nil, herr.Forbidden("The requestor does not have GlobalReadOutcomes permission", nil)
	}

	// The taxonomy is global and identical for every reader, so it is served from
	// an in-memory cache (refDataCacheTTL) rather than re-reading the whole table
	// on every form load. Writes invalidate it; see loadOutcomesJSON.
	response, err := action.cache.Get(req.Context(), func(ctx context.Context) (imsjson.Outcomes, error) {
		return loadOutcomesJSON(ctx, action.imsDBQ)
	})
	if err != nil {
		return nil, herr.InternalServerError("Failed to fetch Outcomes", err).From("[cache.get]")
	}
	return response, nil
}

// loadOutcomesJSON reads the whole outcome taxonomy and builds the sorted JSON list.
// It is the cache refresher, so the sort happens once per load and cached readers
// only ever read the shared (never mutated) slice. Outcomes sort alphabetically by
// name (they carry no group/order of their own).
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

type EditOutcomes struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
	outcomes  *server.OutcomesCache
}

func (action EditOutcomes) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	newID, errHTTP := action.editOutcomes(req)
	if errHTTP != nil {
		errHTTP.From("[editOutcomes]").WriteResponse(w)
		return
	}
	// Drop the cached taxonomy so the change shows up on the next form load.
	action.outcomes.Invalidate()
	if newID != nil {
		w.Header().Set("IMS-Outcome-ID", strconv.Itoa(int(*newID)))
	}
	herr.WriteNoContentResponse(w, "Success")
}
func (action EditOutcomes) editOutcomes(req *http.Request) (newOutcomeID *int32, errHTTP *herr.HTTPError) {
	_, globalPermissions, errHTTP := server.GetGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return nil, errHTTP.From("[server.GetGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalAdministrateOutcomes == 0 {
		return nil, herr.Forbidden("The requestor does not have GlobalAdministrateOutcomes permission", nil)
	}
	ctx := req.Context()
	outcomeReq, errHTTP := server.ReadBodyAs[imsjson.Outcome](req)
	if errHTTP != nil {
		return nil, errHTTP.From("[server.ReadBodyAs]")
	}
	if outcomeReq.ID == 0 {
		if outcomeReq.Name == nil {
			return nil, herr.BadRequest("Outcome name is required for a new Outcome", nil)
		}
		id, err := action.imsDBQ.CreateOutcome(ctx, action.imsDBQ,
			imsdb.CreateOutcomeParams{
				Name:   *outcomeReq.Name,
				Hidden: outcomeReq.Hidden != nil && *outcomeReq.Hidden,
				// Admin-created outcomes are approved immediately, with no proposer.
				Approved:           true,
				ProposedByPersonID: sql.NullInt32{},
			},
		)
		if err != nil {
			return nil, herr.InternalServerError("Failed to create Outcome", err).From("[CreateOutcome]")
		}
		newID := conv.MustInt32(id)
		return &newID, nil
	}

	// Approve a writer's proposed outcome: an admin sends approved=true with an id.
	if outcomeReq.Approved != nil && *outcomeReq.Approved {
		err := action.imsDBQ.ApproveOutcome(ctx, action.imsDBQ, outcomeReq.ID)
		if err != nil {
			return nil, herr.InternalServerError("Failed to approve Outcome", err).From("[ApproveOutcome]")
		}
		return nil, nil
	}

	outcomeRow, err := action.imsDBQ.Outcome(ctx, action.imsDBQ, outcomeReq.ID)
	if err != nil {
		return nil, herr.InternalServerError("Failed to fetch Outcome", err).From("[Outcome]")
	}
	if outcomeReq.Name != nil {
		outcomeRow.Outcome.Name = *outcomeReq.Name
	}
	if outcomeReq.Hidden != nil {
		outcomeRow.Outcome.Hidden = *outcomeReq.Hidden
	}
	err = action.imsDBQ.UpdateOutcome(ctx, action.imsDBQ, imsdb.UpdateOutcomeParams{
		Hidden: outcomeRow.Outcome.Hidden,
		Name:   outcomeRow.Outcome.Name,
		ID:     outcomeRow.Outcome.ID,
	})
	if err != nil {
		return nil, herr.InternalServerError("Failed to update Outcome", nil).From("[UpdateOutcome]")
	}

	return nil, nil
}

// ProposeOutcome lets an event writer propose a new outcome from the incident form
// when the disposition they need doesn't exist yet. The outcome is created unapproved
// with the caller recorded as proposer; an admin approves it later on the Outcomes
// admin page. The route is event-scoped only to authorize the caller as a writer —
// the outcome itself is global. Mirrors ProposeIncidentType.
type ProposeOutcome struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
	outcomes  *server.OutcomesCache
}

func (action ProposeOutcome) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	newID, errHTTP := action.proposeOutcome(req)
	if errHTTP != nil {
		errHTTP.From("[proposeOutcome]").WriteResponse(w)
		return
	}
	action.outcomes.Invalidate()
	w.Header().Set("IMS-Outcome-ID", strconv.Itoa(int(newID)))
	herr.WriteCreatedResponse(w, http.StatusText(http.StatusCreated))
}

func (action ProposeOutcome) proposeOutcome(req *http.Request) (int32, *herr.HTTPError) {
	_, jwtCtx, eventPermissions, errHTTP := server.GetEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return 0, errHTTP.From("[server.GetEventPermissions]")
	}
	if eventPermissions&authz.EventWriteIncidents == 0 {
		return 0, herr.Forbidden("The requestor does not have permission to propose Outcomes on this Event", nil)
	}
	ctx := req.Context()
	outcomeReq, errHTTP := server.ReadBodyAs[imsjson.Outcome](req)
	if errHTTP != nil {
		return 0, errHTTP.From("[server.ReadBodyAs]")
	}
	if outcomeReq.Name == nil || strings.TrimSpace(*outcomeReq.Name) == "" {
		return 0, herr.BadRequest("Outcome name is required", nil)
	}
	name := strings.TrimSpace(*outcomeReq.Name)

	id, err := action.imsDBQ.CreateOutcome(ctx, action.imsDBQ,
		imsdb.CreateOutcomeParams{
			Name:               name,
			Hidden:             false,
			Approved:           false,
			ProposedByPersonID: sql.NullInt32{Int32: jwtCtx.Claims.PersonID(), Valid: true},
		},
	)
	if err != nil {
		// A duplicate NAME means the outcome already exists (seeded, or someone else
		// added/proposed it — NAME is collation-insensitive). Resolve to that
		// outcome's id so the caller just uses it, rather than failing the proposal.
		var mysqlErr *mysql.MySQLError
		const mySQLErDupEntry = 1062
		if errors.As(err, &mysqlErr) && mysqlErr.Number == mySQLErDupEntry {
			existing, lookupErr := action.imsDBQ.OutcomeByName(ctx, action.imsDBQ, name)
			if lookupErr == nil {
				return existing.Outcome.ID, nil
			}
		}
		return 0, herr.InternalServerError("Failed to propose Outcome", err).From("[CreateOutcome]")
	}
	return conv.MustInt32(id), nil
}
