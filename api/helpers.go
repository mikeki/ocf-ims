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
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// personByIDFromPath reads the {personId} path value, validates it, and loads the
// person. Since 5e the web UI addresses people by their stable ID (registry people
// may have no handle), so attach/detach and personnel-edit handlers resolve here.
// The full row is returned so callers can show a display name in logs/journals.
func personByIDFromPath(ctx context.Context, imsDBQ *store.DBQ, req *http.Request) (imsdb.PersonByIDRow, *herr.HTTPError) {
	raw := req.PathValue("personId")
	// ParseInt with bitSize 32 range-checks the value fits int32 (no overflow).
	id, err := strconv.ParseInt(raw, 10, 32)
	if err != nil || id <= 0 {
		return imsdb.PersonByIDRow{}, herr.BadRequest("Invalid person ID: "+raw, nil)
	}
	person, err := imsDBQ.PersonByID(ctx, imsDBQ, int32(id))
	if errors.Is(err, sql.ErrNoRows) {
		return imsdb.PersonByIDRow{}, herr.NotFound("Unknown person", nil)
	}
	if err != nil {
		return imsdb.PersonByIDRow{}, herr.InternalServerError("Failed to look up person", err).From("[PersonByID]")
	}
	return person, nil
}

// personDisplayName resolves a person's display label as COALESCE(NAME, HANDLE) —
// the preferred name if set, otherwise the handle — for logs and journal entries.
func personDisplayName(p imsdb.PersonByIDRow) string {
	if p.Name.Valid && strings.TrimSpace(p.Name.String) != "" {
		return p.Name.String
	}
	return p.Handle.String
}

func readBodyAs[T any](req *http.Request) (T, *herr.HTTPError) {
	empty := *new(T)
	defer shut(req.Body)
	bodyBytes, err := io.ReadAll(req.Body)
	if err != nil {
		return empty, herr.BadRequest("Failed to read request body", err).From("[io.ReadAll]")
	}
	var t T
	err = json.Unmarshal(bodyBytes, &t)
	if err != nil {
		return empty, herr.BadRequest("Failed to unmarshal request body", err).From("[Unmarshal]")
	}
	return t, nil
}

func eventFromFormValue(req *http.Request, imsDBQ *store.DBQ) (imsdb.Event, *herr.HTTPError) {
	empty := imsdb.Event{}
	err := req.ParseForm()
	if err != nil {
		return empty, herr.BadRequest("Failed to parse form", err).From("ParseForm")
	}
	eventName := req.FormValue("event_id")
	if eventName == "" {
		return empty, herr.BadRequest("No event_id was found in the URL", nil)
	}
	eventRow, err := imsDBQ.QueryEventID(req.Context(), imsDBQ, eventName)
	if err != nil {
		return empty, herr.New(http.StatusInternalServerError, "Failed to get event ID", fmt.Errorf("[QueryEventID]: %w", err))
	}
	return eventRow.Event, nil
}

func getEvent(req *http.Request, eventName string, imsDBQ *store.DBQ) (imsdb.Event, *herr.HTTPError) {
	var empty imsdb.Event
	if eventName == "" {
		return empty, herr.BadRequest("No eventName was provided", nil)
	}
	eventRow, err := imsDBQ.QueryEventID(req.Context(), imsDBQ, eventName)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return empty, herr.NotFound("Event not found", err)
		}
		return empty, herr.InternalServerError("Failed to fetch Event", err).From("[QueryEventID]")
	}
	return eventRow.Event, nil
}

func mustWriteJSON(w http.ResponseWriter, req *http.Request, resp any) (success bool) {
	return mustWriteJSONStatus(w, req, http.StatusOK, resp)
}

// mustWriteJSONStatus writes resp as JSON with an explicit status code. The
// Content-Type header MUST be set before WriteHeader — a header write after the
// status line is committed is a silent no-op in net/http, which would emit the
// body without an application/json content type and break clients that only
// parse JSON responses. Callers that need a non-200 status (e.g. 201 Created)
// must use this rather than WriteHeader-then-mustWriteJSON.
func mustWriteJSONStatus(w http.ResponseWriter, req *http.Request, code int, resp any) (success bool) {
	marshalled, err := json.Marshal(resp)
	if err != nil {
		herr.InternalServerError("Failed to marshal JSON", err).From("[Marshal]").WriteResponse(w)
		return false
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	// #nosec G705 // XSS via taint analysis
	_, err = w.Write(marshalled)
	if err != nil {
		herr.InternalServerError("Failed to write JSON", err).From("[Write]").WriteResponse(w)
		return false
	}
	return true
}

func getJwtCtx(req *http.Request) (JWTContext, *herr.HTTPError) {
	jwtCtx, found := req.Context().Value(JWTContextKey).(JWTContext)
	if !found {
		return JWTContext{}, herr.InternalServerError("This endpoint has been misconfigured", nil)
	}
	return jwtCtx, nil
}

func getEventPermissions(req *http.Request, imsDBQ *store.DBQ, userStore directory.UserStore) (
	imsdb.Event, JWTContext, authz.EventPermissionMask, *herr.HTTPError,
) {
	event, errHTTP := getEvent(req, req.PathValue("eventName"), imsDBQ)
	if errHTTP != nil {
		return imsdb.Event{}, JWTContext{}, 0, errHTTP.From("[getEvent]")
	}
	jwtCtx, errHTTP := getJwtCtx(req)
	if errHTTP != nil {
		return imsdb.Event{}, JWTContext{}, 0, errHTTP.From("[getJwtCtx]")
	}
	eventPermissions, _, err := authz.EventPermissions(req.Context(), &event.ID, imsDBQ, userStore, *jwtCtx.Claims)
	if err != nil {
		return imsdb.Event{}, JWTContext{}, 0, herr.InternalServerError("Failed to compute permissions", err).From("[EventPermissions]")
	}
	return event, jwtCtx, eventPermissions[event.ID], nil
}

func getGlobalPermissions(req *http.Request, imsDBQ *store.DBQ, userStore directory.UserStore) (
	JWTContext, authz.GlobalPermissionMask, *herr.HTTPError,
) {
	empty := JWTContext{}
	jwtCtx, errHTTP := getJwtCtx(req)
	if errHTTP != nil {
		return empty, 0, errHTTP.From("[getJwtCtx]")
	}
	_, globalPermissions, err := authz.EventPermissions(req.Context(), nil, imsDBQ, userStore, *jwtCtx.Claims)
	if err != nil {
		return empty, 0, herr.InternalServerError("Failed to compute permissions", err).From("[EventPermissions]")
	}
	return jwtCtx, globalPermissions, nil
}

func permissionsByEvent(ctx context.Context, jwtCtx JWTContext, imsDBQ *store.DBQ, userStore directory.UserStore) (
	map[int32]authz.EventPermissionMask, *herr.HTTPError,
) {
	// This query doesn't know about parent groups. We'll start by accumulating EventAccesses directly referencing
	// events, then worry about parent groups below.
	accessRows, err := imsDBQ.EventAccessAll(ctx, imsDBQ)
	if err != nil {
		return nil, herr.InternalServerError("Failed to fetch event access", err).From("[EventAccessAll]")
	}
	accessRowByEventID := make(map[int32][]imsdb.EventAccess)
	for _, ar := range accessRows {
		accessRowByEventID[ar.EventAccess.Event] = append(accessRowByEventID[ar.EventAccess.Event], ar.EventAccess)
	}

	// Now add in parent group EventAccesses.
	events, err := imsDBQ.Events(ctx, imsDBQ)
	if err != nil {
		return nil, herr.InternalServerError("Failed to fetch Events", err).From("[Events]")
	}
	for _, e := range events {
		child := e.Event
		// No parent, nothing to do
		if !child.ParentGroup.Valid {
			continue
		}
		// Has a parent. Add in all the EventAccesses from the parent.
		for _, ar := range accessRowByEventID[child.ParentGroup.Int32] {
			accessRowByEventID[child.ID] = append(accessRowByEventID[child.ID], ar)
		}
	}

	allPositions, allTeams, err := userStore.GetPositionsAndTeams(ctx)
	if err != nil {
		return nil, herr.InternalServerError("Failed to fetch positions and teams", err).From("[GetPositionsAndTeams]")
	}
	userPosIDs := jwtCtx.Claims.PersonPositions()
	userPosNames := make([]string, 0, len(userPosIDs))
	for _, userPosID := range userPosIDs {
		userPosNames = append(userPosNames, allPositions[userPosID])
	}
	userTeamIDs := jwtCtx.Claims.PersonTeams()
	userTeamNames := make([]string, 0, len(userTeamIDs))
	for _, userTeamID := range userTeamIDs {
		userTeamNames = append(userTeamNames, allTeams[userTeamID])
	}
	onDutyPosition := ""
	onDutyPositionID := jwtCtx.Claims.PersonOnDutyPosition()
	if onDutyPositionID != nil {
		onDutyPosition = allPositions[*onDutyPositionID]
	}

	permissionsByEvent, _ := authz.ManyEventPermissions(
		accessRowByEventID,
		jwtCtx.Claims.PersonHandle(),
		jwtCtx.Claims.PersonOnSite(),
		jwtCtx.Claims.PersonAdmin(),
		userPosNames,
		userTeamNames,
		onDutyPosition,
	)
	return permissionsByEvent, nil
}

func rollback(txn *sql.Tx) {
	err := txn.Rollback()
	if err != nil && !errors.Is(err, sql.ErrTxDone) {
		slog.Error("Failed to rollback transaction", "error", err)
	}
}

func shut(c io.Closer) {
	err := c.Close()
	if err != nil {
		slog.Error("Failed to close Closer", "error", err)
	}
}
