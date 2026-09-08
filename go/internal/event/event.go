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
	"regexp"
	"slices"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/directory"
	resourcesv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/resources/v1"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// Service is the event domain's Connect surface: it holds the dependencies the
// event RPCs share (the IMS store and the user directory) so each RPC is a method
// rather than a free function with a long, per-call dependency list. api.ImsService
// composes one of these (built once in AddConnectToMux) and delegates to it. This
// mirrors the struct-with-fields idiom the REST handlers already use (NewIncident, …).
type Service struct {
	ImsDBQ    *store.DBQ
	UserStore directory.UserStore
}

// Require basic cleanliness for an event name, since it's used in IMS URLs and in
// filesystem directory paths.
var allowedEventNames = regexp.MustCompile(`^[\w-]+$`)

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

// CreateEvent is the domain method behind the CreateEvent RPC (the id==0 branch of the retired REST
// POST /events multiplexer, EditEvent). Admin-only. It creates the event, applies any is_group /
// parent_group the caller sent (the retired handler did this in a single fall-through update), and —
// for a brand-new real event (not a group) — seeds its starting area set. The server-assigned id
// comes back in the response (REST returned it in the IMS-Event-ID header).
func (s Service) CreateEvent(
	ctx context.Context,
	req *rpcv1.CreateEventRequest,
) (*rpcv1.CreateEventResponse, error) {
	err := s.requireEventAdmin(ctx)
	if err != nil {
		return nil, err
	}
	ev := req.GetEvent()
	if ev.Name == nil || !allowedEventNames.MatchString(ev.GetName()) {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("event names must match the pattern %s", allowedEventNames.String()))
	}
	id, err := s.ImsDBQ.CreateEvent(ctx, s.ImsDBQ, imsdb.CreateEventParams{Name: ev.GetName()})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create event: %w", err))
	}
	eventID := conv.MustInt32(id)
	// #nosec G706 // log injection
	slog.Info("Created event", "eventName", ev.GetName(), "id", eventID)

	existing, err := s.ImsDBQ.Event(ctx, s.ImsDBQ, eventID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch event: %w", err))
	}
	params, err := s.applyEventEdits(ctx, existing.Event, ev)
	if err != nil {
		return nil, err
	}
	err = s.ImsDBQ.UpdateEvent(ctx, s.ImsDBQ, params)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to update event: %w", err))
	}
	// A brand-new real event (not an event group) is given a starting area set: the first event ever
	// is seeded from the canonical OCF list, and later events inherit the previous event's areas so
	// admin edits carry forward (store.PopulateNewEventAreas). Either way production gets real areas
	// with no seed file or manual entry. Event groups are mere containers and hold none.
	if !params.IsGroup {
		err = s.ImsDBQ.PopulateNewEventAreas(ctx, eventID)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to populate event areas: %w", err))
		}
	}
	return &rpcv1.CreateEventResponse{EventId: eventID}, nil
}

// UpdateEvent is the domain method behind the UpdateEvent RPC (the update branch of the retired
// EditEvent multiplexer), keyed by the event's id. Admin-only. Each of name / is_group /
// parent_group is applied only when present; absent fields keep the stored value.
func (s Service) UpdateEvent(
	ctx context.Context,
	req *rpcv1.UpdateEventRequest,
) (*rpcv1.UpdateEventResponse, error) {
	err := s.requireEventAdmin(ctx)
	if err != nil {
		return nil, err
	}
	existing, err := s.ImsDBQ.Event(ctx, s.ImsDBQ, req.GetEventId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch event: %w", err))
	}
	params, err := s.applyEventEdits(ctx, existing.Event, req.GetEvent())
	if err != nil {
		return nil, err
	}
	err = s.ImsDBQ.UpdateEvent(ctx, s.ImsDBQ, params)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to update event: %w", err))
	}
	return &rpcv1.UpdateEventResponse{}, nil
}

// requireEventAdmin enforces GlobalAdministrateEvents, the gate the event writes share, resolving the
// caller's claims from the ctx the auth interceptor populated.
func (s Service) requireEventAdmin(ctx context.Context) error {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	_, globalPermissions, err := authz.EventPermissions(ctx, nil, s.ImsDBQ, *claims)
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("failed to compute permissions: %w", err))
	}
	if globalPermissions&authz.GlobalAdministrateEvents == 0 {
		return connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have GlobalAdministrateEvents permission"))
	}
	return nil
}

// applyEventEdits folds the present fields of an incoming event resource onto the stored row's update
// params, applying the same validations the retired REST EditEvent did: the name must match
// allowedEventNames; a parent group cannot be the event itself, must itself be a group, and a value
// <= 0 clears it; an event group cannot have a parent. Absent (nil) fields leave the stored value.
func (s Service) applyEventEdits(
	ctx context.Context,
	existing imsdb.Event,
	ev *resourcesv1.Event,
) (imsdb.UpdateEventParams, error) {
	params := imsdb.UpdateEventParams{
		ID:          existing.ID,
		Name:        existing.Name,
		IsGroup:     existing.IsGroup,
		ParentGroup: existing.ParentGroup,
	}
	if ev.Name != nil {
		if !allowedEventNames.MatchString(ev.GetName()) {
			return params, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("event names must match the pattern %s", allowedEventNames.String()))
		}
		params.Name = ev.GetName()
	}
	if ev.IsGroup != nil {
		params.IsGroup = ev.GetIsGroup()
	}
	if ev.ParentGroup != nil {
		pg := ev.GetParentGroup()
		if pg == existing.ID {
			return params, connect.NewError(connect.CodeInvalidArgument,
				errors.New("event parent group cannot be the same as the event itself"))
		}
		if pg > 0 {
			target, err := s.ImsDBQ.Event(ctx, s.ImsDBQ, pg)
			if err != nil {
				return params, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch parent group: %w", err))
			}
			if !target.Event.IsGroup {
				return params, connect.NewError(connect.CodeInvalidArgument,
					errors.New("event parent must be an event group"))
			}
			params.ParentGroup = sql.NullInt32{Int32: pg, Valid: true}
		} else {
			params.ParentGroup = sql.NullInt32{}
		}
	}
	if params.IsGroup && params.ParentGroup.Valid {
		return params, connect.NewError(connect.CodeInvalidArgument,
			errors.New("an event group cannot have a parent event group"))
	}
	return params, nil
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
