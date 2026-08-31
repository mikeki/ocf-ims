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
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/internal/area"
	"github.com/mikeki/ocf-ims/internal/server"
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
	ImsDBQ            *store.DBQ
	UserStore         directory.UserStore
	Cache             *server.CrewsCache
	CacheControlShort time.Duration
}

func (action GetCrews) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.run(req)
	if errHTTP != nil {
		errHTTP.From("[run]").WriteResponse(w)
		return
	}
	w.Header().Set("Cache-Control", fmt.Sprintf("max-age=%v, private", action.CacheControlShort.Milliseconds()/1000))
	server.MustWriteJSON(w, req, resp)
}

func (action GetCrews) run(req *http.Request) (imsjson.Crews, *herr.HTTPError) {
	ctx := req.Context()
	event, _, _, errHTTP := server.GetEventPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return nil, errHTTP.From("[server.GetEventPermissions]")
	}
	_, globalPermissions, errHTTP := server.GetGlobalPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return nil, errHTTP.From("[server.GetGlobalPermissions]")
	}
	// Crews are admin-managed only — there is no reader/writer view of the roster.
	if globalPermissions&authz.GlobalAdministrateCrews == 0 {
		return nil, herr.Forbidden("The requestor does not have GlobalAdministrateCrews permission", nil)
	}

	resp, err := action.Cache.Get(ctx, req.PathValue("eventName"), func(ctx context.Context) (imsjson.Crews, error) {
		return loadCrewsJSON(ctx, action.ImsDBQ, event.ID)
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
	ImsDBQ    *store.DBQ
	UserStore directory.UserStore
	Crews     *server.CrewsCache
}

func (action EditCrews) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	slug, errHTTP := action.run(req)
	if errHTTP != nil {
		errHTTP.From("[run]").WriteResponse(w)
		return
	}
	// Drop the cached crew list so the change shows on the next read.
	action.Crews.InvalidateEvent(req.PathValue("eventName"))
	if slug != "" {
		w.Header().Set("IMS-Crew-Slug", slug)
	}
	herr.WriteNoContentResponse(w, "Success")
}

func (action EditCrews) run(req *http.Request) (newSlug string, errHTTP *herr.HTTPError) {
	ctx := req.Context()
	event, _, _, errHTTP := server.GetEventPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return "", errHTTP.From("[server.GetEventPermissions]")
	}
	_, globalPermissions, errHTTP := server.GetGlobalPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return "", errHTTP.From("[server.GetGlobalPermissions]")
	}
	// Every crew write — create, rename/reorder, delete, membership — is admin-only.
	if globalPermissions&authz.GlobalAdministrateCrews == 0 {
		return "", herr.Forbidden("The requestor does not have GlobalAdministrateCrews permission", nil)
	}
	crewReq, errHTTP := server.ReadBodyAs[imsjson.Crew](req)
	if errHTTP != nil {
		return "", errHTTP.From("[server.ReadBodyAs]")
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
	existing, err := action.ImsDBQ.Crews(ctx, action.ImsDBQ, eventID)
	if err != nil {
		return "", herr.InternalServerError("Failed to fetch Crews", err).From("[Crews]")
	}
	taken := make([]string, 0, len(existing))
	for _, c := range existing {
		taken = append(taken, c.Slug)
	}

	slug := area.UniqueSlug(*crewReq.Name, taken)
	err = action.ImsDBQ.CreateCrew(ctx, action.ImsDBQ, imsdb.CreateCrewParams{
		Event:     eventID,
		Slug:      slug,
		Name:      strings.TrimSpace(*crewReq.Name),
		SortOrder: area.DerefInt32(crewReq.SortOrder, 0),
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

	err := action.ImsDBQ.UpdateCrew(ctx, action.ImsDBQ, imsdb.UpdateCrewParams{
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
	runErr := action.ImsDBQ.RunInTx(ctx, func(tx *sql.Tx) error {
		txErr := action.ImsDBQ.RemoveAllCrewMembers(ctx, tx, imsdb.RemoveAllCrewMembersParams{
			Event:    eventID,
			CrewSlug: slug,
		})
		if txErr != nil {
			return herr.InternalServerError("Failed to clear crew membership", txErr).From("[RemoveAllCrewMembers]")
		}
		txErr = action.ImsDBQ.DeleteCrew(ctx, tx, imsdb.DeleteCrewParams{Event: eventID, Slug: slug})
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
		err := action.ImsDBQ.RemoveCrewMember(ctx, action.ImsDBQ, imsdb.RemoveCrewMemberParams{
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
	err := action.ImsDBQ.AddCrewMember(ctx, action.ImsDBQ, imsdb.AddCrewMemberParams{
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
	existing, err := action.ImsDBQ.Crews(ctx, action.ImsDBQ, eventID)
	if err != nil {
		return imsdb.Crew{}, herr.InternalServerError("Failed to fetch Crews", err).From("[Crews]")
	}
	idx := slices.IndexFunc(existing, func(c imsdb.Crew) bool { return c.Slug == slug })
	if idx < 0 {
		return imsdb.Crew{}, herr.NotFound("No such Crew", nil)
	}
	return existing[idx], nil
}

// MyCrews serves the crews the caller leads for an event, each with its membership.
// Unlike GetCrews (the admin roster of *all* crews) it is not admin-gated: any
// authenticated user may read it and the result is naturally scoped to the crews they
// lead — empty when they lead none. It backs the crew-leader "My Crew" self-service
// section on the People page (slice 10c).
type MyCrews struct {
	ImsDBQ    *store.DBQ
	UserStore directory.UserStore
}

func (action MyCrews) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.run(req)
	if errHTTP != nil {
		errHTTP.From("[run]").WriteResponse(w)
		return
	}
	// The result is which crews *you* lead, so it isn't shareable — don't cache it.
	w.Header().Set("Cache-Control", "no-store")
	server.MustWriteJSON(w, req, resp)
}

func (action MyCrews) run(req *http.Request) (imsjson.Crews, *herr.HTTPError) {
	ctx := req.Context()
	event, jwtCtx, _, errHTTP := server.GetEventPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return nil, errHTTP.From("[server.GetEventPermissions]")
	}
	resp, err := loadLedCrewsJSON(ctx, action.ImsDBQ, event.ID, jwtCtx.Claims.PersonID())
	if err != nil {
		return nil, herr.InternalServerError("Failed to fetch crews", err).From("[loadLedCrewsJSON]")
	}
	return resp, nil
}

// loadLedCrewsJSON returns the crews (with members) that leaderPersonID leads for an
// event. It reuses loadCrewsJSON and filters to the led set, so the JSON shape matches
// the admin crews list exactly.
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

// EditMyCrew lets a crew leader add or remove members of a crew they lead (slice
// 10c) — the self-service counterpart to the admin-only EditCrews. The caller must
// lead the named crew, and the only mutations allowed are adding a plain member or
// removing a non-leader member. Everything else — creating/renaming/deleting a crew
// and assigning or removing leaders — stays admin-only on the Crews page. On success
// it invalidates the admin crews cache so that page reflects the change.
type EditMyCrew struct {
	ImsDBQ    *store.DBQ
	UserStore directory.UserStore
	Crews     *server.CrewsCache
}

func (action EditMyCrew) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.run(req)
	if errHTTP != nil {
		errHTTP.From("[run]").WriteResponse(w)
		return
	}
	action.Crews.InvalidateEvent(req.PathValue("eventName"))
	herr.WriteNoContentResponse(w, "Success")
}

func (action EditMyCrew) run(req *http.Request) *herr.HTTPError {
	ctx := req.Context()
	event, jwtCtx, _, errHTTP := server.GetEventPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return errHTTP.From("[server.GetEventPermissions]")
	}
	crewReq, errHTTP := server.ReadBodyAs[imsjson.Crew](req)
	if errHTTP != nil {
		return errHTTP.From("[server.ReadBodyAs]")
	}
	if crewReq.Slug == "" {
		return herr.BadRequest("A crew slug is required", nil)
	}
	if crewReq.Member == nil {
		return herr.BadRequest("Only member changes are allowed here", nil)
	}

	// Authz: the caller must lead this crew. Checking membership-as-leader also
	// confirms the crew exists in the event — a slug they do not lead (including a
	// nonexistent one) is forbidden rather than 404, so we don't leak which crews exist.
	leaderID := jwtCtx.Claims.PersonID()
	ledSlugs, err := action.ImsDBQ.CrewsLedByPerson(ctx, action.ImsDBQ, imsdb.CrewsLedByPersonParams{
		Event:    event.ID,
		PersonID: leaderID,
	})
	if err != nil {
		return herr.InternalServerError("Failed to check crew leadership", err).From("[CrewsLedByPerson]")
	}
	if !slices.Contains(ledSlugs, crewReq.Slug) {
		return herr.Forbidden("You do not lead this crew", nil)
	}

	return action.editMember(ctx, event.ID, crewReq.Slug, *crewReq.Member)
}

// editMember adds a plain member or removes a non-leader member. Leader flags are
// never touched here: an add never promotes (nor demotes an existing member), and a
// fellow leader may not be removed — that stays an admin act on the Crews page.
func (action EditMyCrew) editMember(ctx context.Context, eventID int32, slug string, edit imsjson.CrewMemberEdit) *herr.HTTPError {
	if edit.PersonID == 0 {
		return herr.BadRequest("A person id is required to change crew membership", nil)
	}

	if edit.Remove {
		isLeader, err := action.ImsDBQ.CrewMembership(ctx, action.ImsDBQ, imsdb.CrewMembershipParams{
			Event:    eventID,
			CrewSlug: slug,
			PersonID: edit.PersonID,
		})
		switch {
		case errors.Is(err, sql.ErrNoRows):
			// Already not a member — nothing to do (idempotent).
			return nil
		case err != nil:
			return herr.InternalServerError("Failed to look up crew member", err).From("[CrewMembership]")
		}
		if isLeader {
			return herr.Forbidden("Crew leaders are managed by an admin and can't be removed here", nil)
		}
		err = action.ImsDBQ.RemoveCrewMember(ctx, action.ImsDBQ, imsdb.RemoveCrewMemberParams{
			Event:    eventID,
			CrewSlug: slug,
			PersonID: edit.PersonID,
		})
		if err != nil {
			return herr.InternalServerError("Failed to remove crew member", err).From("[RemoveCrewMember]")
		}
		return nil
	}

	// Add as a plain member without disturbing an existing membership's leader flag
	// (AddCrewMemberIfAbsent no-ops on an existing row). A missing person surfaces as
	// the FK violation → 404, like the admin path.
	err := action.ImsDBQ.AddCrewMemberIfAbsent(ctx, action.ImsDBQ, imsdb.AddCrewMemberIfAbsentParams{
		Event:    eventID,
		CrewSlug: slug,
		PersonID: edit.PersonID,
	})
	if err != nil {
		var mysqlErr *mysql.MySQLError
		if errors.As(err, &mysqlErr) && mysqlErr.Number == mySQLErNoReferencedRow {
			return herr.NotFound("No such person", err)
		}
		return herr.InternalServerError("Failed to add crew member", err).From("[AddCrewMemberIfAbsent]")
	}
	return nil
}
