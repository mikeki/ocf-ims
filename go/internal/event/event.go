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

package event

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"slices"
	"strconv"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/directory"
	resourcesv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/resources/v1"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/internal/server"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// Service is the event domain's Connect surface: it holds the dependencies the
// event RPCs share (the IMS store and the user directory) so each RPC is a method
// rather than a free function with a long, per-call dependency list. api.ImsService
// composes one of these (built once in AddConnectToMux) and delegates to it. This
// mirrors the struct-with-fields idiom the REST handlers already use (EditEvent
// below, NewIncident, …).
type Service struct {
	ImsDBQ    *store.DBQ
	UserStore directory.UserStore
}

// ListEvents is the domain method behind the ListEvents RPC (plan 09h/1c). The
// REST GET /events endpoint was RETIRED with this extraction, not kept as a shim
// (migration decision, plan 09 §Migration strategy) — listing events is
// Connect-only now. It authorizes the caller from the ctx claims (populated by the
// auth interceptor), builds the authorized event list, and returns proto messages
// speaking Connect error codes.
func (s Service) ListEvents(
	ctx context.Context,
	req *rpcv1.ListEventsRequest,
) (*rpcv1.ListEventsResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	// First level of authorization (global). Per-event filtering happens below.
	_, globalPermissions, err := authz.EventPermissions(ctx, nil, s.ImsDBQ, *claims)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to compute permissions: %w", err))
	}
	if globalPermissions&authz.GlobalListEvents == 0 {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have GlobalListEvents permission"))
	}

	allEvents, err := s.ImsDBQ.Events(ctx, s.ImsDBQ)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to get events: %w", err))
	}
	permsByEvent, errHTTP := server.PermissionsByEvent(ctx, server.JWTContext{Claims: claims}, s.ImsDBQ, s.UserStore)
	if errHTTP != nil {
		return nil, connect.NewError(connect.CodeInternal, errHTTP)
	}

	excludeGroups := !req.GetIncludeGroups()
	events := make([]*resourcesv1.Event, 0, len(allEvents))
	for _, eve := range allEvents {
		if eve.Event.IsGroup && excludeGroups {
			continue
		}
		if permsByEvent[eve.Event.ID]&authz.EventReadEventName != 0 ||
			globalPermissions&authz.GlobalAdministrateEvents != 0 {
			events = append(events, eventToProto(eve.Event))
		}
	}
	slices.SortFunc(events, func(a, b *resourcesv1.Event) int {
		return cmp.Compare(a.GetId(), b.GetId())
	})
	return &rpcv1.ListEventsResponse{Events: events}, nil
}

// eventToProto maps a stored event row to its resources/v1.Event proto.
func eventToProto(e imsdb.Event) *resourcesv1.Event {
	return &resourcesv1.Event{
		Id:          e.ID,
		Name:        &e.Name,
		IsGroup:     &e.IsGroup,
		ParentGroup: conv.SqlToInt32(e.ParentGroup),
	}
}

type EditEvent struct {
	ImsDBQ    *store.DBQ
	UserStore directory.UserStore
}

// Require basic cleanliness for EventName, since it's used in IMS URLs
// and in filesystem directory paths.
var allowedEventNames = regexp.MustCompile(`^[\w-]+$`)

func (action EditEvent) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	// TODO: make this RESTful. It'd be better to have separate create and update endpoints,
	//  and it'd be good to have a GetEvent (singular) endpoint too.

	newID, errHTTP := action.editEvents(req)
	if errHTTP != nil {
		errHTTP.From("[editEvents]").WriteResponse(w)
		return
	}
	if newID != nil {
		w.Header().Set("IMS-Event-ID", strconv.Itoa(int(*newID)))
	}
	herr.WriteNoContentResponse(w, "Success")
}
func (action EditEvent) editEvents(req *http.Request) (newEventID *int32, errHTTP *herr.HTTPError) {
	_, globalPermissions, errHTTP := server.GetGlobalPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return nil, errHTTP.From("[server.GetGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalAdministrateEvents == 0 {
		return nil, herr.Forbidden("The requestor does not have GlobalAdministrateEvents permission", nil)
	}
	err := req.ParseForm()
	if err != nil {
		return nil, herr.BadRequest("Failed to parse HTTP form", err)
	}
	editRequest, errHTTP := server.ReadBodyAs[imsjson.Event](req)
	if errHTTP != nil {
		return nil, errHTTP.From("[server.ReadBodyAs]")
	}

	if editRequest.ID == 0 {
		// We're making a new Event.
		if editRequest.Name == nil || !allowedEventNames.MatchString(*editRequest.Name) {
			return nil, herr.BadRequest("Event names must match the pattern "+allowedEventNames.String(), fmt.Errorf("invalid event name: '%v'", editRequest.Name))
		}
		createParams := imsdb.CreateEventParams{
			Name: *editRequest.Name,
		}
		id, err := action.ImsDBQ.CreateEvent(req.Context(), action.ImsDBQ, createParams)
		if err != nil {
			return nil, herr.InternalServerError("Failed to create event", err).From("[CreateEvent]")
		}
		// #nosec G706 // log injection
		slog.Info("Created event", "eventName", *editRequest.Name, "id", id)
		newID := conv.MustInt32(id)
		editRequest.ID = newID

		newEventID = &newID
	}

	existingEventRow, err := action.ImsDBQ.Event(req.Context(), action.ImsDBQ, editRequest.ID)
	if err != nil {
		return nil, herr.InternalServerError("Failed to fetch event", err).From("[Event]")
	}

	updateParams := imsdb.UpdateEventParams{
		ID:          editRequest.ID,
		Name:        existingEventRow.Event.Name,
		IsGroup:     existingEventRow.Event.IsGroup,
		ParentGroup: existingEventRow.Event.ParentGroup,
	}

	if editRequest.Name != nil {
		if !allowedEventNames.MatchString(*editRequest.Name) {
			return nil, herr.BadRequest("Event names must match the pattern "+allowedEventNames.String(), fmt.Errorf("invalid event name: '%v'", editRequest.Name))
		}
		updateParams.Name = *editRequest.Name
	}
	if editRequest.IsGroup != nil {
		updateParams.IsGroup = *editRequest.IsGroup
	}
	if editRequest.ParentGroup != nil {
		if *editRequest.ParentGroup == editRequest.ID {
			return nil, herr.BadRequest("Event parent group cannot be the same as the event itself", nil)
		}
		if *editRequest.ParentGroup > 0 {
			targetParentGroup, err := action.ImsDBQ.Event(req.Context(), action.ImsDBQ, *editRequest.ParentGroup)
			if err != nil {
				return nil, herr.InternalServerError("Failed to fetch parent group", err).From("[Event]")
			}
			if !targetParentGroup.Event.IsGroup {
				return nil, herr.BadRequest("Event parent must be an event group", nil)
			}
			updateParams.ParentGroup = sql.NullInt32{Int32: *editRequest.ParentGroup, Valid: true}
		} else {
			updateParams.ParentGroup = sql.NullInt32{}
		}
	}
	if updateParams.IsGroup && updateParams.ParentGroup.Valid {
		return nil, herr.BadRequest("An event group cannot have a parent event group", nil)
	}

	err = action.ImsDBQ.UpdateEvent(req.Context(), action.ImsDBQ, updateParams)
	if err != nil {
		return nil, herr.InternalServerError("Failed to update event", err).From("[UpdateEvent]")
	}

	// A brand-new real event (not an event group) is given a starting area set:
	// the first event ever is seeded from the canonical OCF list, and later
	// events inherit the previous event's areas so admin edits carry forward (see
	// store.PopulateNewEventAreas). Either way production gets real areas with no
	// seed file or manual entry. Event groups are mere containers and hold none.
	if newEventID != nil && !updateParams.IsGroup {
		err = action.ImsDBQ.PopulateNewEventAreas(req.Context(), *newEventID)
		if err != nil {
			return nil, herr.InternalServerError("Failed to populate event areas", err).From("[PopulateNewEventAreas]")
		}
	}

	return newEventID, nil
}
