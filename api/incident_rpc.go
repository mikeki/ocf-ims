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

	"connectrpc.com/connect"
	"github.com/burningmantech/ranger-ims-go/directory"
	imsv1 "github.com/burningmantech/ranger-ims-go/gen/ocf/ims/v1"
	"github.com/burningmantech/ranger-ims-go/gen/ocf/ims/v1/imsv1connect"
	imsjson "github.com/burningmantech/ranger-ims-go/json"
	"github.com/burningmantech/ranger-ims-go/lib/authz"
	"github.com/burningmantech/ranger-ims-go/lib/conv"
	"github.com/burningmantech/ranger-ims-go/store"
	"github.com/burningmantech/ranger-ims-go/store/imsdb"
	"golang.org/x/sync/errgroup"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// IncidentRPC implements the Connect imsv1connect.IncidentServiceHandler. It is
// the proto-native counterpart to the REST GetIncidents/GetIncident handlers,
// reusing the same store, the same authorization (authz.EventPermissions), and
// — via the mux — the same auth/logging/panic-recovery middleware. Connect runs
// alongside the existing REST API (strangler pattern); see
// docs/plans/07-proto-integration.md.
//
// The proto contract already speaks the decided OCF terminology (people_involved,
// reports), so this handler name-maps from the current store types until the
// Phase 2 rename lands.
type IncidentRPC struct {
	imsDBQ             *store.DBQ
	userStore          *directory.UserStore
	imsAdmins          []string
	attachmentsEnabled bool
}

var _ imsv1connect.IncidentServiceHandler = IncidentRPC{}

// ListIncidents returns every incident for one event the caller may read.
func (rpc IncidentRPC) ListIncidents(
	ctx context.Context, req *connect.Request[imsv1.ListIncidentsRequest],
) (*connect.Response[imsv1.ListIncidentsResponse], error) {
	event, _, connErr := rpc.requireEventReadIncidents(ctx, req.Msg.GetEvent())
	if connErr != nil {
		return nil, connErr
	}

	// The Incidents, Rangers, and ReportEntries queries each request a lot of
	// data and can run concurrently. This mirrors the REST getIncidents handler.
	group, groupCtx := errgroup.WithContext(ctx)

	entriesByIncident := make(map[int32][]imsdb.ReportEntry)
	group.Go(func() error {
		rows, err := rpc.imsDBQ.Incidents_ReportEntries(groupCtx, rpc.imsDBQ, imsdb.Incidents_ReportEntriesParams{
			Event:     event.ID,
			Generated: true,
		})
		if err != nil {
			return fmt.Errorf("[Incidents_ReportEntries]: %w", err)
		}
		for _, row := range rows {
			entriesByIncident[row.IncidentNumber] = append(entriesByIncident[row.IncidentNumber], row.ReportEntry)
		}
		return nil
	})

	rangersByIncident := make(map[int32][]imsdb.IncidentRanger)
	group.Go(func() error {
		rows, err := rpc.imsDBQ.Incidents_Rangers(groupCtx, rpc.imsDBQ, event.ID)
		if err != nil {
			return fmt.Errorf("[Incidents_Rangers]: %w", err)
		}
		for _, row := range rows {
			rangersByIncident[row.IncidentRanger.IncidentNumber] = append(rangersByIncident[row.IncidentRanger.IncidentNumber], row.IncidentRanger)
		}
		return nil
	})

	var incidentsRows []imsdb.IncidentsRow
	group.Go(func() error {
		var err error
		incidentsRows, err = rpc.imsDBQ.Incidents(groupCtx, rpc.imsDBQ, event.ID)
		if err != nil {
			return fmt.Errorf("[Incidents]: %w", err)
		}
		return nil
	})
	if err := group.Wait(); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch incidents: %w", err))
	}

	resp := &imsv1.ListIncidentsResponse{Incidents: make([]*imsv1.Incident, 0, len(incidentsRows))}
	for _, r := range incidentsRows {
		// The IncidentsRow -> IncidentRow conversion works because the two query
		// row structs currently share fields and order (see the REST handler note).
		incidentRow := imsdb.IncidentRow(r)
		// As in the REST list handler, we don't resolve linked incidents here.
		inc, err := incidentToProto(incidentRow, rangersByIncident[r.Incident.Number], entriesByIncident[r.Incident.Number], nil, event, rpc.attachmentsEnabled)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("[incidentToProto]: %w", err))
		}
		resp.Incidents = append(resp.Incidents, inc)
	}
	return connect.NewResponse(resp), nil
}

// GetIncident returns a single incident by its per-event number.
func (rpc IncidentRPC) GetIncident(
	ctx context.Context, req *connect.Request[imsv1.GetIncidentRequest],
) (*connect.Response[imsv1.GetIncidentResponse], error) {
	event, jwtCtx, connErr := rpc.requireEventReadIncidents(ctx, req.Msg.GetEvent())
	if connErr != nil {
		return nil, connErr
	}
	incidentNumber := req.Msg.GetNumber()

	storedRow, reportEntries, errHTTP := fetchIncident(ctx, rpc.imsDBQ, event.ID, incidentNumber)
	if errHTTP != nil {
		// fetchIncident returns NotFound for a missing incident; map status faithfully.
		if errHTTP.Code == http.StatusNotFound {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("incident not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("[fetchIncident]: %w", errHTTP))
	}

	permsByEvent, errHTTP := permissionsByEvent(ctx, jwtCtx, rpc.imsDBQ, rpc.userStore, rpc.imsAdmins)
	if errHTTP != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("[permissionsByEvent]: %w", errHTTP))
	}

	rangersRows, err := rpc.imsDBQ.Incident_Rangers(ctx, rpc.imsDBQ, imsdb.Incident_RangersParams{
		Event:          event.ID,
		IncidentNumber: incidentNumber,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("[Incident_Rangers]: %w", err))
	}
	rangers := make([]imsdb.IncidentRanger, len(rangersRows))
	for i, row := range rangersRows {
		rangers[i] = row.IncidentRanger
	}

	linkedIncidents, err := rpc.imsDBQ.Incident_LinkedIncidents(ctx, rpc.imsDBQ, imsdb.Incident_LinkedIncidentsParams{
		Event1:          event.ID,
		IncidentNumber1: incidentNumber,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("[Incident_LinkedIncidents]: %w", err))
	}
	// Redact summaries of linked incidents in events the caller can't read,
	// matching the REST handler.
	for i := range linkedIncidents {
		if permsByEvent[linkedIncidents[i].LinkedEvent]&authz.EventReadIncidents == 0 {
			linkedIncidents[i].LinkedIncidentSummary = sql.NullString{}
		}
	}

	inc, err := incidentToProto(storedRow, rangers, reportEntries, linkedIncidents, event, rpc.attachmentsEnabled)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("[incidentToProto]: %w", err))
	}
	return connect.NewResponse(&imsv1.GetIncidentResponse{Incident: inc}), nil
}

// requireEventReadIncidents resolves the event by name, reads the caller's JWT
// claims from the context (placed there by the RequireAuthN middleware that
// wraps the Connect handler), and verifies EventReadIncidents permission. It is
// the Connect/context-based analog of getEventPermissions, which is *http.Request
// based and so can't be reused directly here.
func (rpc IncidentRPC) requireEventReadIncidents(ctx context.Context, eventName string) (imsdb.Event, JWTContext, *connect.Error) {
	if eventName == "" {
		return imsdb.Event{}, JWTContext{}, connect.NewError(connect.CodeInvalidArgument, errors.New("no event was provided"))
	}
	eventRow, err := rpc.imsDBQ.QueryEventID(ctx, rpc.imsDBQ, eventName)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return imsdb.Event{}, JWTContext{}, connect.NewError(connect.CodeNotFound, errors.New("event not found"))
		}
		return imsdb.Event{}, JWTContext{}, connect.NewError(connect.CodeInternal, fmt.Errorf("[QueryEventID]: %w", err))
	}
	event := eventRow.Event

	jwtCtx, ok := ctx.Value(JWTContextKey).(JWTContext)
	if !ok || jwtCtx.Claims == nil {
		return imsdb.Event{}, JWTContext{}, connect.NewError(connect.CodeUnauthenticated, errors.New("not authenticated"))
	}

	eventPermissions, _, err := authz.EventPermissions(ctx, &event.ID, rpc.imsDBQ, rpc.userStore, rpc.imsAdmins, *jwtCtx.Claims)
	if err != nil {
		return imsdb.Event{}, JWTContext{}, connect.NewError(connect.CodeInternal, fmt.Errorf("[EventPermissions]: %w", err))
	}
	if eventPermissions[event.ID]&authz.EventReadIncidents == 0 {
		return imsdb.Event{}, JWTContext{}, connect.NewError(connect.CodePermissionDenied, errors.New("the requestor does not have EventReadIncidents permission on this Event"))
	}
	return event, jwtCtx, nil
}

// incidentToProto maps the stored incident (and its related rows) to the proto
// Incident. It is the proto analog of incidentToJSON and intentionally keeps the
// same shape/derivations (e.g. last_modified = max of created and entry times).
func incidentToProto(
	storedRow imsdb.IncidentRow, incidentRangers []imsdb.IncidentRanger,
	reportEntries []imsdb.ReportEntry, linkedIncidents []imsdb.Incident_LinkedIncidentsRow,
	event imsdb.Event, attachmentsEnabled bool,
) (*imsv1.Incident, error) {
	entries := make([]*imsv1.ReportEntry, len(reportEntries))
	for i, re := range reportEntries {
		entries[i] = reportEntryToProto(re, attachmentsEnabled)
	}

	people := make([]*imsv1.PersonInvolvement, len(incidentRangers))
	for i, ir := range incidentRangers {
		// person_id is not available until the Phase 2 Person/People rename lands
		// (the store still keys involvement on the handle string), so leave it 0
		// and carry the handle as the nickname and ROLE as involvement.
		people[i] = &imsv1.PersonInvolvement{
			PersonId:    0,
			Nickname:    ir.RangerHandle,
			Involvement: conv.SqlToString(ir.Role),
		}
	}

	linked := make([]*imsv1.LinkedIncident, len(linkedIncidents))
	for i, li := range linkedIncidents {
		linked[i] = &imsv1.LinkedIncident{
			Event:   li.LinkedEventName,
			EventId: li.LinkedEvent,
			Number:  li.LinkedIncident,
			Summary: li.LinkedIncidentSummary.String,
		}
	}

	incidentTypeIDs, fieldReportNumbers, visitNumbers, err := readExtraIncidentRowFields(storedRow)
	if err != nil {
		return nil, fmt.Errorf("[readExtraIncidentRowFields]: %w", err)
	}

	lastModified := conv.FloatToTime(storedRow.Incident.Created)
	for _, re := range reportEntries {
		if t := conv.FloatToTime(re.Created); t.After(lastModified) {
			lastModified = t
		}
	}

	var closed *timestamppb.Timestamp
	if storedRow.Incident.Closed.Valid {
		closed = timestamppb.New(conv.NullFloatToTime(storedRow.Incident.Closed))
	}

	return &imsv1.Incident{
		Event:        event.Name,
		EventId:      event.ID,
		Number:       storedRow.Incident.Number,
		Created:      timestamppb.New(conv.FloatToTime(storedRow.Incident.Created)),
		LastModified: timestamppb.New(lastModified),
		State:        incidentStateToProto(storedRow.Incident.State),
		Started:      timestamppb.New(conv.FloatToTime(storedRow.Incident.Started)),
		Closed:       closed,
		Priority:     incidentPriorityToProto(storedRow.Incident.Priority),
		Summary:      conv.SqlToString(storedRow.Incident.Summary),
		Location: &imsv1.Location{
			Name:        conv.SqlToString(storedRow.Incident.LocationName),
			Address:     conv.SqlToString(storedRow.Incident.LocationAddress),
			Description: conv.SqlToString(storedRow.Incident.LocationDescription),
		},
		IncidentTypeIds: incidentTypeIDs,
		Reports:         fieldReportNumbers,
		Visits:          visitNumbers,
		PeopleInvolved:  people,
		LinkedIncidents: linked,
		ReportEntries:   entries,
	}, nil
}

func reportEntryToProto(re imsdb.ReportEntry, attachmentsEnabled bool) *imsv1.ReportEntry {
	var attachment *imsv1.Attachment
	if attachmentsEnabled && re.AttachedFileOriginalName.Valid {
		attachment = &imsv1.Attachment{
			Name:        re.AttachedFileOriginalName.String,
			Previewable: previewableContentType(re.AttachedFileMediaType.String),
		}
	}
	stricken := re.Stricken
	return &imsv1.ReportEntry{
		Id:             re.ID,
		Created:        timestamppb.New(conv.FloatToTime(re.Created)),
		AuthorNickname: re.Author,
		SystemEntry:    re.Generated,
		Text:           re.Text,
		Stricken:       &stricken,
		Attachment:     attachment,
	}
}

func incidentStateToProto(s imsdb.IncidentState) imsv1.IncidentState {
	switch s {
	case imsdb.IncidentStateNew:
		return imsv1.IncidentState_INCIDENT_STATE_NEW
	case imsdb.IncidentStateOnHold:
		return imsv1.IncidentState_INCIDENT_STATE_ON_HOLD
	case imsdb.IncidentStateDispatched:
		return imsv1.IncidentState_INCIDENT_STATE_DISPATCHED
	case imsdb.IncidentStateOnScene:
		return imsv1.IncidentState_INCIDENT_STATE_ON_SCENE
	case imsdb.IncidentStateClosed:
		return imsv1.IncidentState_INCIDENT_STATE_CLOSED
	}
	return imsv1.IncidentState_INCIDENT_STATE_UNSPECIFIED
}

// incidentPriorityToProto collapses the legacy 1..5 priority scale (ascending:
// 1=low, 3=normal, 5=high) into the proto's three buckets, mapping the unused
// in-between values (2, 4) to the nearest documented bucket.
func incidentPriorityToProto(p int8) imsv1.IncidentPriority {
	switch {
	case p >= imsjson.IncidentPriorityNormal+1: // 4, 5
		return imsv1.IncidentPriority_INCIDENT_PRIORITY_HIGH
	case p <= imsjson.IncidentPriorityNormal-1: // 1, 2
		return imsv1.IncidentPriority_INCIDENT_PRIORITY_LOW
	case p == imsjson.IncidentPriorityNormal: // 3
		return imsv1.IncidentPriority_INCIDENT_PRIORITY_NORMAL
	}
	return imsv1.IncidentPriority_INCIDENT_PRIORITY_UNSPECIFIED
}
