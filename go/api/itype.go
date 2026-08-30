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

type GetIncidentTypes struct {
	imsDBQ            *store.DBQ
	userStore         directory.UserStore
	cache             *server.IncidentTypesCache
	cacheControlShort time.Duration
}

func (action GetIncidentTypes) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.getIncidentTypes(req)
	if errHTTP != nil {
		errHTTP.From("[getIncidentTypes]").WriteResponse(w)
		return
	}
	w.Header().Set("Cache-Control", fmt.Sprintf("max-age=%v, private", action.cacheControlShort.Milliseconds()/1000))
	server.MustWriteJSON(w, req, resp)
}
func (action GetIncidentTypes) getIncidentTypes(req *http.Request) (imsjson.IncidentTypes, *herr.HTTPError) {
	_, globalPermissions, errHTTP := server.GetGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return nil, errHTTP.From("[server.GetGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalReadIncidentTypes == 0 {
		return nil, herr.Forbidden("The requestor does not have GlobalReadIncidentTypes permission", nil)
	}

	// The taxonomy is global and identical for every reader, so it is served from
	// an in-memory cache (refDataCacheTTL) rather than re-reading the whole table
	// on every form load. Writes invalidate it; see loadIncidentTypesJSON.
	response, err := action.cache.Get(req.Context(), func(ctx context.Context) (imsjson.IncidentTypes, error) {
		return loadIncidentTypesJSON(ctx, action.imsDBQ)
	})
	if err != nil {
		return nil, herr.InternalServerError("Failed to fetch Incident Types", err).From("[cache.get]")
	}
	return response, nil
}

// loadIncidentTypesJSON reads the whole incident-type taxonomy and builds the
// sorted JSON list. It is the cache refresher, so the sort happens once per load
// and cached readers only ever read the shared (never mutated) slice.
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

type EditIncidentTypes struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
	metrics   *server.MetricsCache
	types     *server.IncidentTypesCache
}

func (action EditIncidentTypes) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	newID, errHTTP := action.editIncidentTypes(req)
	if errHTTP != nil {
		errHTTP.From("[editIncidentTypes]").WriteResponse(w)
		return
	}
	// Incident types are global reference data the dashboard aggregates across
	// every event (the by-type / by-category breakdown), so a create/rename/hide
	// can shift any event's aggregate — drop them all.
	action.metrics.InvalidateAll()
	// Also drop the cached taxonomy so the change shows up on the next form load.
	action.types.Invalidate()
	if newID != nil {
		w.Header().Set("IMS-Incident-Type-ID", strconv.Itoa(int(*newID)))
	}
	herr.WriteNoContentResponse(w, "Success")
}
func (action EditIncidentTypes) editIncidentTypes(req *http.Request) (newTypeID *int32, errHTTP *herr.HTTPError) {
	_, globalPermissions, errHTTP := server.GetGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return nil, errHTTP.From("[server.GetGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalAdministrateIncidentTypes == 0 {
		return nil, herr.Forbidden("The requestor does not have GlobalAdministrateIncidentTypes permission", nil)
	}
	ctx := req.Context()
	typeReq, errHTTP := server.ReadBodyAs[imsjson.IncidentType](req)
	if errHTTP != nil {
		return nil, errHTTP.From("[server.ReadBodyAs]")
	}
	if typeReq.ID == 0 {
		if typeReq.Name == nil {
			return nil, herr.BadRequest("Incident Type name is required for a new Incident Type", nil)
		}
		group, errHTTP := groupToSQL(typeReq.Group)
		if errHTTP != nil {
			return nil, errHTTP.From("[groupToSQL]")
		}
		id, err := action.imsDBQ.CreateIncidentType(ctx, action.imsDBQ,
			imsdb.CreateIncidentTypeParams{
				Name:   *typeReq.Name,
				Hidden: typeReq.Hidden != nil && *typeReq.Hidden,
				Group:  group,
				// Admin-created types are approved immediately, with no proposer.
				Approved:           true,
				ProposedByPersonID: sql.NullInt32{},
			},
		)
		if err != nil {
			return nil, herr.InternalServerError("Failed to create Incident Type", err).From("[CreateIncidentTypeOrIgnore]")
		}
		newID := conv.MustInt32(id)
		return &newID, nil
	}

	// Approve a writer's proposed type: an admin sends approved=true with an id.
	// Admin-only, already gated above on GlobalAdministrateIncidentTypes.
	if typeReq.Approved != nil && *typeReq.Approved {
		err := action.imsDBQ.ApproveIncidentType(ctx, action.imsDBQ, typeReq.ID)
		if err != nil {
			return nil, herr.InternalServerError("Failed to approve Incident Type", err).From("[ApproveIncidentType]")
		}
		return nil, nil
	}

	typeRow, err := action.imsDBQ.IncidentType(ctx, action.imsDBQ, typeReq.ID)
	if err != nil {
		return nil, herr.InternalServerError("Failed to fetch Incident Type", err).From("[IncidentType]")
	}
	if typeReq.Name != nil {
		typeRow.IncidentType.Name = *typeReq.Name
	}
	if typeReq.Hidden != nil {
		typeRow.IncidentType.Hidden = *typeReq.Hidden
	}
	if typeReq.Description != nil {
		typeRow.IncidentType.Description = conv.StringToSql(typeReq.Description, 1023)
	}
	// A provided group ("" clears it); omitted/null leaves the existing group.
	if typeReq.Group != nil {
		group, errHTTP := groupToSQL(typeReq.Group)
		if errHTTP != nil {
			return nil, errHTTP.From("[groupToSQL]")
		}
		typeRow.IncidentType.Group = group
	}
	err = action.imsDBQ.UpdateIncidentType(ctx, action.imsDBQ, imsdb.UpdateIncidentTypeParams{
		Hidden:      typeRow.IncidentType.Hidden,
		Name:        typeRow.IncidentType.Name,
		ID:          typeRow.IncidentType.ID,
		Description: typeRow.IncidentType.Description,
		Group:       typeRow.IncidentType.Group,
	})
	if err != nil {
		return nil, herr.InternalServerError("Failed to update incident type", nil).From("[UpdateIncidentType]")
	}

	return nil, nil
}

// ProposeIncidentType lets an event writer propose a new incident type from the
// incident form when the one they need doesn't exist yet (round-7 item 2). The
// type is created unapproved with the caller recorded as proposer; an admin
// approves it later on the Incident Types admin page. The route is event-scoped
// only to authorize the caller as a writer — the incident type itself is global.
type ProposeIncidentType struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
	metrics   *server.MetricsCache
	types     *server.IncidentTypesCache
}

func (action ProposeIncidentType) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	newID, errHTTP := action.proposeIncidentType(req)
	if errHTTP != nil {
		errHTTP.From("[proposeIncidentType]").WriteResponse(w)
		return
	}
	// A new type shifts the dashboard's by-type / by-category aggregation, which
	// spans every event, so drop all cached metrics.
	action.metrics.InvalidateAll()
	// And drop the cached taxonomy so the proposed type appears on the next load.
	action.types.Invalidate()
	w.Header().Set("IMS-Incident-Type-ID", strconv.Itoa(int(newID)))
	herr.WriteCreatedResponse(w, http.StatusText(http.StatusCreated))
}

func (action ProposeIncidentType) proposeIncidentType(req *http.Request) (int32, *herr.HTTPError) {
	_, jwtCtx, eventPermissions, errHTTP := server.GetEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return 0, errHTTP.From("[server.GetEventPermissions]")
	}
	if eventPermissions&authz.EventWriteIncidents == 0 {
		return 0, herr.Forbidden("The requestor does not have permission to propose Incident Types on this Event", nil)
	}
	ctx := req.Context()
	typeReq, errHTTP := server.ReadBodyAs[imsjson.IncidentType](req)
	if errHTTP != nil {
		return 0, errHTTP.From("[server.ReadBodyAs]")
	}
	if typeReq.Name == nil || strings.TrimSpace(*typeReq.Name) == "" {
		return 0, herr.BadRequest("Incident Type name is required", nil)
	}
	name := strings.TrimSpace(*typeReq.Name)

	id, err := action.imsDBQ.CreateIncidentType(ctx, action.imsDBQ,
		imsdb.CreateIncidentTypeParams{
			Name:   name,
			Hidden: false,
			// An admin categorises the proposal into a group on approval.
			Group:              imsdb.NullIncidentTypeGroup{},
			Approved:           false,
			ProposedByPersonID: sql.NullInt32{Int32: jwtCtx.Claims.PersonID(), Valid: true},
		},
	)
	if err != nil {
		// A duplicate NAME means the type already exists (seeded, or someone else
		// added/proposed it — NAME is collation-insensitive, so "theft" collides
		// with "Theft"). Resolve to that type's id so the caller just attaches it,
		// rather than failing the proposal.
		var mysqlErr *mysql.MySQLError
		const mySQLErDupEntry = 1062
		if errors.As(err, &mysqlErr) && mysqlErr.Number == mySQLErDupEntry {
			existing, lookupErr := action.imsDBQ.IncidentTypeByName(ctx, action.imsDBQ, name)
			if lookupErr == nil {
				return existing.IncidentType.ID, nil
			}
		}
		return 0, herr.InternalServerError("Failed to propose Incident Type", err).From("[CreateIncidentType]")
	}
	return conv.MustInt32(id), nil
}

// groupToSQL validates an optional incident-type group string and converts it to
// the nullable sqlc enum. A nil or empty pointer means "ungrouped" (NULL); an
// unrecognized value is rejected with 400.
func groupToSQL(group *string) (imsdb.NullIncidentTypeGroup, *herr.HTTPError) {
	if group == nil || *group == "" {
		return imsdb.NullIncidentTypeGroup{}, nil
	}
	g := imsdb.IncidentTypeGroup(*group)
	if !g.Valid() {
		return imsdb.NullIncidentTypeGroup{}, herr.BadRequest(
			fmt.Sprintf("Invalid incident type group: %q", *group), nil)
	}
	return imsdb.NullIncidentTypeGroup{IncidentTypeGroup: g, Valid: true}, nil
}

// groupToString converts the nullable sqlc group enum to a JSON-friendly
// *string, returning nil when the group is NULL.
func groupToString(group imsdb.NullIncidentTypeGroup) *string {
	if !group.Valid {
		return nil
	}
	return new(string(group.IncidentTypeGroup))
}
