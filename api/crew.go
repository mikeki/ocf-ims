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
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/mikeki/ocf-ims/directory"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// mySQLErNoReferencedRow is the MySQL error for a failed foreign-key insert
// (referenced row missing) — e.g. adding a member with a non-existent person id.
const mySQLErNoReferencedRow = 1452

type GetCrews struct {
	imsDBQ            *store.DBQ
	userStore         directory.UserStore
	cache             *crewsCache
	cacheControlShort time.Duration
}

func (action GetCrews) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.run(req)
	if errHTTP != nil {
		errHTTP.From("[run]").WriteResponse(w)
		return
	}
	w.Header().Set("Cache-Control", fmt.Sprintf("max-age=%v, private", action.cacheControlShort.Milliseconds()/1000))
	mustWriteJSON(w, req, resp)
}

func (action GetCrews) run(req *http.Request) (imsjson.Crews, *herr.HTTPError) {
	ctx := req.Context()
	event, _, _, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return nil, errHTTP.From("[getEventPermissions]")
	}
	_, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return nil, errHTTP.From("[getGlobalPermissions]")
	}
	// Crews are admin-managed only — there is no reader/writer view of the roster.
	if globalPermissions&authz.GlobalAdministrateCrews == 0 {
		return nil, herr.Forbidden("The requestor does not have GlobalAdministrateCrews permission", nil)
	}

	resp, err := action.cache.get(ctx, req.PathValue("eventName"), func(ctx context.Context) (imsjson.Crews, error) {
		return loadCrewsJSON(ctx, action.imsDBQ, event.ID)
	})
	if err != nil {
		return nil, herr.InternalServerError("Failed to fetch Crews", err).From("[cache.get]")
	}
	return resp, nil
}

// loadCrewsJSON reads one event's crews and each crew's membership, building the
// JSON list. It is the crews cache refresher, so cached readers only ever read the
// shared (never mutated) slice.
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

type EditCrews struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
	crews     *crewsCache
}

func (action EditCrews) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	slug, errHTTP := action.run(req)
	if errHTTP != nil {
		errHTTP.From("[run]").WriteResponse(w)
		return
	}
	// Drop the cached crew list so the change shows on the next read.
	action.crews.InvalidateEvent(req.PathValue("eventName"))
	if slug != "" {
		w.Header().Set("IMS-Crew-Slug", slug)
	}
	herr.WriteNoContentResponse(w, "Success")
}

func (action EditCrews) run(req *http.Request) (newSlug string, errHTTP *herr.HTTPError) {
	ctx := req.Context()
	event, _, _, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return "", errHTTP.From("[getEventPermissions]")
	}
	_, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return "", errHTTP.From("[getGlobalPermissions]")
	}
	// Every crew write — create, rename/reorder, delete, membership — is admin-only.
	if globalPermissions&authz.GlobalAdministrateCrews == 0 {
		return "", herr.Forbidden("The requestor does not have GlobalAdministrateCrews permission", nil)
	}
	crewReq, errHTTP := readBodyAs[imsjson.Crew](req)
	if errHTTP != nil {
		return "", errHTTP.From("[readBodyAs]")
	}

	if crewReq.Slug == "" {
		return action.create(ctx, event.ID, crewReq)
	}
	switch {
	case crewReq.Delete:
		return "", action.delete(ctx, event.ID, crewReq.Slug)
	case crewReq.Member != nil:
		return "", action.editMember(ctx, event.ID, crewReq.Slug, *crewReq.Member)
	default:
		return "", action.update(ctx, event.ID, crewReq)
	}
}

func (action EditCrews) create(ctx context.Context, eventID int32, crewReq imsjson.Crew) (string, *herr.HTTPError) {
	if crewReq.Name == nil || strings.TrimSpace(*crewReq.Name) == "" {
		return "", herr.BadRequest("Crew name is required for a new Crew", nil)
	}
	existing, err := action.imsDBQ.Crews(ctx, action.imsDBQ, eventID)
	if err != nil {
		return "", herr.InternalServerError("Failed to fetch Crews", err).From("[Crews]")
	}
	taken := make([]string, 0, len(existing))
	for _, c := range existing {
		taken = append(taken, c.Slug)
	}

	slug := uniqueSlug(*crewReq.Name, taken)
	err = action.imsDBQ.CreateCrew(ctx, action.imsDBQ, imsdb.CreateCrewParams{
		Event:     eventID,
		Slug:      slug,
		Name:      strings.TrimSpace(*crewReq.Name),
		SortOrder: derefInt32(crewReq.SortOrder, 0),
	})
	if err != nil {
		return "", herr.InternalServerError("Failed to create Crew", err).From("[CreateCrew]")
	}
	return slug, nil
}

func (action EditCrews) update(ctx context.Context, eventID int32, crewReq imsjson.Crew) *herr.HTTPError {
	row, errHTTP := action.mustFindCrew(ctx, eventID, crewReq.Slug)
	if errHTTP != nil {
		return errHTTP
	}

	name := row.Name
	if crewReq.Name != nil {
		if strings.TrimSpace(*crewReq.Name) == "" {
			return herr.BadRequest("Crew name may not be blank", nil)
		}
		name = strings.TrimSpace(*crewReq.Name)
	}
	sortOrder := row.SortOrder
	if crewReq.SortOrder != nil {
		sortOrder = *crewReq.SortOrder
	}

	err := action.imsDBQ.UpdateCrew(ctx, action.imsDBQ, imsdb.UpdateCrewParams{
		Name:      name,
		SortOrder: sortOrder,
		Event:     eventID,
		Slug:      crewReq.Slug,
	})
	if err != nil {
		return herr.InternalServerError("Failed to update Crew", err).From("[UpdateCrew]")
	}
	return nil
}

// delete removes a crew and all of its membership rows in one transaction (the
// CREW_MEMBERSHIP FK references CREW, so members must go first).
func (action EditCrews) delete(ctx context.Context, eventID int32, slug string) *herr.HTTPError {
	_, errHTTP := action.mustFindCrew(ctx, eventID, slug)
	if errHTTP != nil {
		return errHTTP
	}
	runErr := action.imsDBQ.RunInTx(ctx, func(tx *sql.Tx) error {
		txErr := action.imsDBQ.RemoveAllCrewMembers(ctx, tx, imsdb.RemoveAllCrewMembersParams{
			Event:    eventID,
			CrewSlug: slug,
		})
		if txErr != nil {
			return herr.InternalServerError("Failed to clear crew membership", txErr).From("[RemoveAllCrewMembers]")
		}
		txErr = action.imsDBQ.DeleteCrew(ctx, tx, imsdb.DeleteCrewParams{Event: eventID, Slug: slug})
		if txErr != nil {
			return herr.InternalServerError("Failed to delete Crew", txErr).From("[DeleteCrew]")
		}
		return nil
	})
	if runErr != nil {
		return herr.AsHTTPError(runErr).From("[RunInTx]")
	}
	return nil
}

// editMember adds, updates, or removes one person's membership in a crew.
func (action EditCrews) editMember(ctx context.Context, eventID int32, slug string, edit imsjson.CrewMemberEdit) *herr.HTTPError {
	_, errHTTP := action.mustFindCrew(ctx, eventID, slug)
	if errHTTP != nil {
		return errHTTP
	}
	if edit.PersonID == 0 {
		return herr.BadRequest("A person id is required to change crew membership", nil)
	}

	if edit.Remove {
		err := action.imsDBQ.RemoveCrewMember(ctx, action.imsDBQ, imsdb.RemoveCrewMemberParams{
			Event:    eventID,
			CrewSlug: slug,
			PersonID: edit.PersonID,
		})
		if err != nil {
			return herr.InternalServerError("Failed to remove crew member", err).From("[RemoveCrewMember]")
		}
		return nil
	}

	// AddCrewMember upserts: it adds the person if new and (re)sets their leader
	// flag, so the same call covers "add member" and "toggle leader".
	err := action.imsDBQ.AddCrewMember(ctx, action.imsDBQ, imsdb.AddCrewMemberParams{
		Event:    eventID,
		CrewSlug: slug,
		PersonID: edit.PersonID,
		IsLeader: edit.IsLeader,
	})
	if err != nil {
		var mysqlErr *mysql.MySQLError
		if errors.As(err, &mysqlErr) && mysqlErr.Number == mySQLErNoReferencedRow {
			return herr.NotFound("No such person", err)
		}
		return herr.InternalServerError("Failed to add crew member", err).From("[AddCrewMember]")
	}
	return nil
}

// mustFindCrew returns the crew row or a 404 when it does not exist in the event.
func (action EditCrews) mustFindCrew(ctx context.Context, eventID int32, slug string) (imsdb.Crew, *herr.HTTPError) {
	existing, err := action.imsDBQ.Crews(ctx, action.imsDBQ, eventID)
	if err != nil {
		return imsdb.Crew{}, herr.InternalServerError("Failed to fetch Crews", err).From("[Crews]")
	}
	idx := slices.IndexFunc(existing, func(c imsdb.Crew) bool { return c.Slug == slug })
	if idx < 0 {
		return imsdb.Crew{}, herr.NotFound("No such Crew", nil)
	}
	return existing[idx], nil
}
