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

package incident

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/directory"
	commonv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/common/v1"
	resourcesv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/resources/v1"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/internal/server"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"golang.org/x/sync/errgroup"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Service is the incident domain's Connect surface: it holds the dependencies the
// incident RPCs share so each RPC is a method rather than a free function with a long,
// per-call dependency list (the write path alone threads five). api.ImsService composes
// one of these (built once in AddConnectToMux) and delegates to it. A read method uses
// only a subset of the fields (GetIncident ignores Es/Pusher/Metrics); the shape mirrors
// the struct-with-fields idiom the REST handlers already use (NewIncident, the retired
// EditIncident, …). AttachmentsEnabled mirrors cfg.AttachmentsStore.Type != none — it
// gates whether a read surfaces journal-entry attachment metadata.
type Service struct {
	ImsDBQ             *store.DBQ
	UserStore          directory.UserStore
	Es                 *server.EventSourcerer
	Pusher             *server.Pusher
	Metrics            *server.MetricsCache
	AttachmentsEnabled bool
}

// GetIncident is the domain method behind the GetIncident RPC (plan 09h/1c). The
// REST GET /events/{eventName}/incidents/{incidentNumber} endpoint was RETIRED with
// this extraction, not kept as a shim (migration decision, plan 09 §Migration
// strategy) — reading a single incident is Connect-only now. It ports the REST
// getIncident authorization verbatim (event-wide incident read OR a 52f per-incident
// grant; a private incident stays hidden behind a 404, not a 403), keyed off the ctx
// claims the auth interceptor populated rather than the *http.Request, and returns the
// IncidentView proto speaking Connect error codes.
//
// The request keys the event by its numeric id (not the REST path's event name), so
// this resolves the event row up front; a missing event is NotFound before any
// permission check, matching the REST GetEvent behavior.
func (s Service) GetIncident(
	ctx context.Context,
	req *rpcv1.GetIncidentRequest,
) (*rpcv1.GetIncidentResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}

	eventRow, err := s.ImsDBQ.Event(ctx, s.ImsDBQ, req.GetEventId())
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("event not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch event: %w", err))
	}
	event := eventRow.Event

	eventPerms, _, err := authz.EventPermissions(ctx, &event.ID, s.ImsDBQ, *claims)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to compute permissions: %w", err))
	}
	eventPermissions := eventPerms[event.ID]

	incidentNumber := req.GetIncidentNumber()
	hasEventRead := eventPermissions&authz.EventReadIncidents != 0
	viewerPersonID := claims.PersonID()
	viewerIsAdmin := claims.PersonAdmin()

	// 52f: without event-wide incident read, allow only if the caller has a
	// per-incident grant (an involved reporter). Deny before the DB fetch so we
	// don't leak the incident's existence. hasGrant also decides whether the caller
	// may add journal entries (viewer_may_add_journal below).
	hasGrant := false
	if !hasEventRead {
		hasGrant, err = s.ImsDBQ.IncidentPersonHasGrant(ctx, s.ImsDBQ, imsdb.IncidentPersonHasGrantParams{
			Event: event.ID, IncidentNumber: incidentNumber, PersonID: viewerPersonID,
		})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to check incident grant: %w", err))
		}
		if !hasGrant {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("the requestor does not have EventReadIncidents permission on this Event"))
		}
	}

	storedRow, journalEntries, errHTTP := fetchIncident(ctx, s.ImsDBQ, event.ID, incidentNumber, s.AttachmentsEnabled)
	if errHTTP != nil {
		return nil, herrToConnect(errHTTP)
	}

	// A private incident is off-limits to event-wide readers who aren't its creator,
	// an admin, or a grant-holder. If a grant hasn't already been confirmed (i.e. the
	// caller reached here via event-wide read), check for one now; still no access →
	// NotFound so the incident's very existence stays hidden.
	if storedRow.Incident.Private && !hasGrant && !viewerIsAdmin &&
		!(storedRow.Incident.CreatedBy.Valid && storedRow.Incident.CreatedBy.Int32 == viewerPersonID) {
		hasGrant, err = s.ImsDBQ.IncidentPersonHasGrant(ctx, s.ImsDBQ, imsdb.IncidentPersonHasGrantParams{
			Event: event.ID, IncidentNumber: incidentNumber, PersonID: viewerPersonID,
		})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to check incident grant: %w", err))
		}
		if !hasGrant {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("incident not found"))
		}
	}

	permsByEvent, errHTTP := server.PermissionsByEvent(ctx, server.JWTContext{Claims: claims}, s.ImsDBQ, s.UserStore)
	if errHTTP != nil {
		return nil, herrToConnect(errHTTP)
	}

	peopleRows, err := s.ImsDBQ.Incident_People(ctx, s.ImsDBQ, imsdb.Incident_PeopleParams{
		Event:          event.ID,
		IncidentNumber: incidentNumber,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch people: %w", err))
	}
	people := make([]imsjson.IncidentPerson, len(peopleRows))
	for i, row := range peopleRows {
		people[i] = imsjson.IncidentPerson{PersonID: int64(row.IncidentPerson.PersonID), Handle: row.Handle.String, Name: row.Name.String, Involvement: conv.SqlToString(row.IncidentPerson.Involvement), GrantedAccess: row.IncidentPerson.GrantedAccess, HasEventAccess: row.HasEventAccess.Bool}
	}

	linkedIncidents, err := s.ImsDBQ.Incident_LinkedIncidents(ctx, s.ImsDBQ, imsdb.Incident_LinkedIncidentsParams{
		Event1:          event.ID,
		IncidentNumber1: incidentNumber,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch linked incidents: %w", err))
	}
	for i := range linkedIncidents {
		li := linkedIncidents[i]
		noEventRead := permsByEvent[li.LinkedEvent]&authz.EventReadIncidents == 0
		// Withhold a private linked incident's summary from anyone who isn't an admin
		// or its creator. The link's event/number stay visible (a grant-holder can open
		// it directly); only the summary content is hidden here.
		privateHidden := li.LinkedIncidentPrivate && !viewerIsAdmin &&
			!(li.LinkedIncidentCreatedBy.Valid && li.LinkedIncidentCreatedBy.Int32 == viewerPersonID)
		if noEventRead || privateHidden {
			linkedIncidents[i].LinkedIncidentSummary = sql.NullString{}
		}
	}

	// Reuse the REST-era assembly (incidentToJSON), still shared with GetIncidents
	// (plural) and the attachment reads, then bridge the result onto the wire proto.
	// When the rest of the incident surface moves onto Connect this json hop collapses
	// into a direct DB→proto mapping (plan 09 §Migration strategy).
	incJSON, errHTTP := incidentToJSON(storedRow, people, journalEntries, linkedIncidents, event, s.AttachmentsEnabled)
	if errHTTP != nil {
		return nil, herrToConnect(errHTTP)
	}
	// 52f: a writer (or admin) may always add journal entries; an involved reporter
	// may too, but only on incidents they were granted.
	viewerMayAddJournal := eventPermissions&authz.EventWriteIncidents != 0 || hasGrant

	return &rpcv1.GetIncidentResponse{
		Incident: &rpcv1.IncidentView{
			Incident:            incidentJSONToProto(incJSON),
			ViewerMayAddJournal: viewerMayAddJournal,
		},
	}, nil
}

// ListIncidents is the domain method behind the ListIncidents RPC (plan 09h/1c). The
// REST GET /events/{eventName}/incidents endpoint was RETIRED with this extraction, not
// shimmed (migration decision, plan 09 §Migration strategy) — listing incidents is
// Connect-only now. It ports the REST getIncidents authorization and assembly verbatim:
// 52f grants scope which incidents a caller without event-wide read may see and reveal a
// private incident to a granted viewer, and mayViewIncident drops a private incident for
// anyone who isn't its creator, an admin, or a grant-holder. Like GetIncident it reuses
// the shared incidentToJSON assembly and bridges each result onto the wire proto; that
// json hop collapses when the incident write path also moves onto Connect.
//
// Unlike the singular read, the plural computes viewer_may_add_journal per incident (a
// writer/admin may add to any, an involved reporter only to the ones granted). The REST
// list never surfaced that flag, but the IncidentView contract carries it, and the
// grant set is already in hand — so it costs nothing to fill in accurately.
func (s Service) ListIncidents(
	ctx context.Context,
	req *rpcv1.ListIncidentsRequest,
) (*rpcv1.ListIncidentsResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}

	eventRow, err := s.ImsDBQ.Event(ctx, s.ImsDBQ, req.GetEventId())
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("event not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch event: %w", err))
	}
	event := eventRow.Event

	eventPerms, _, err := authz.EventPermissions(ctx, &event.ID, s.ImsDBQ, *claims)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to compute permissions: %w", err))
	}
	eventPermissions := eventPerms[event.ID]
	hasEventRead := eventPermissions&authz.EventReadIncidents != 0
	hasEventWrite := eventPermissions&authz.EventWriteIncidents != 0
	viewerPersonID := claims.PersonID()
	viewerIsAdmin := claims.PersonAdmin()

	// 52f grants scope what a caller without event-wide read may see, and reveal a
	// private incident to a granted viewer. Admins bypass both (mayViewIncident), so
	// skip the query for them. A non-admin with neither the read bit nor any grant is
	// forbidden — volunteer/public access isn't loosened.
	grantedSet := map[int32]bool{}
	if !viewerIsAdmin {
		grantedNums, err := s.ImsDBQ.GrantedIncidentNumbersForPerson(ctx, s.ImsDBQ,
			imsdb.GrantedIncidentNumbersForPersonParams{Event: event.ID, PersonID: viewerPersonID})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch granted incidents: %w", err))
		}
		if !hasEventRead && len(grantedNums) == 0 {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("the requestor does not have EventReadIncidents permission"))
		}
		for _, n := range grantedNums {
			grantedSet[n] = true
		}
	}

	includeSystemEntries := !req.GetExcludeSystemEntries()

	// The incidents, people, and journal-entry queries each pull a lot of data; run
	// them concurrently as the REST handler did.
	group, groupCtx := errgroup.WithContext(ctx)

	entriesByIncident := make(map[int32][]imsjson.JournalEntry)
	group.Go(func() error {
		journalEntries, err := s.ImsDBQ.Incidents_JournalEntries(groupCtx, s.ImsDBQ,
			imsdb.Incidents_JournalEntriesParams{Event: event.ID, Generated: includeSystemEntries})
		if err != nil {
			return connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch incident journal entries: %w", err))
		}
		for _, row := range journalEntries {
			// Incidents don't set "on behalf of" (6m is reports-only for now).
			entriesByIncident[row.IncidentNumber] = append(entriesByIncident[row.IncidentNumber],
				journalEntryToJSON(row.JournalEntry, row.Author.String, nil, s.AttachmentsEnabled))
		}
		return nil
	})

	peopleByIncident := make(map[int32][]imsjson.IncidentPerson)
	group.Go(func() error {
		peopleRows, err := s.ImsDBQ.Incidents_People(groupCtx, s.ImsDBQ, event.ID)
		if err != nil {
			return connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch people: %w", err))
		}
		for _, row := range peopleRows {
			peopleByIncident[row.IncidentPerson.IncidentNumber] = append(peopleByIncident[row.IncidentPerson.IncidentNumber],
				imsjson.IncidentPerson{PersonID: int64(row.IncidentPerson.PersonID), Handle: row.Handle.String, Name: row.Name.String, Involvement: conv.SqlToString(row.IncidentPerson.Involvement), GrantedAccess: row.IncidentPerson.GrantedAccess, HasEventAccess: row.HasEventAccess.Bool})
		}
		return nil
	})

	var incidentsRows []imsdb.IncidentsRow
	group.Go(func() error {
		var err error
		incidentsRows, err = s.ImsDBQ.Incidents(groupCtx, s.ImsDBQ, event.ID)
		if err != nil {
			return connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch incidents: %w", err))
		}
		return nil
	})
	err = group.Wait()
	if err != nil {
		return nil, err
	}

	views := make([]*rpcv1.IncidentView, 0, len(incidentsRows))
	for _, r := range incidentsRows {
		// One check covers both the granted-reporter scope (52f) and the private flag:
		// a private incident is dropped for anyone who isn't its creator, an admin, or a
		// grant-holder; a reporter without event read still sees only granted ones.
		if !mayViewIncident(r.Incident.Private, r.Incident.CreatedBy, viewerPersonID, viewerIsAdmin, hasEventRead, grantedSet[r.Incident.Number]) {
			continue
		}
		// The IncidentsRow → IncidentRow conversion works because the two query row
		// structs currently have the same fields in the same order (as the retired
		// getIncidents noted); if that changes this stops compiling.
		incidentRow := imsdb.IncidentRow(r)
		// The list read doesn't look up linked incidents.
		var emptyLinkedIncidents []imsdb.Incident_LinkedIncidentsRow
		incJSON, errHTTP := incidentToJSON(incidentRow, peopleByIncident[r.Incident.Number], entriesByIncident[r.Incident.Number], emptyLinkedIncidents, event, s.AttachmentsEnabled)
		if errHTTP != nil {
			return nil, herrToConnect(errHTTP)
		}
		views = append(views, &rpcv1.IncidentView{
			Incident:            incidentJSONToProto(incJSON),
			ViewerMayAddJournal: hasEventWrite || grantedSet[r.Incident.Number],
		})
	}

	return &rpcv1.ListIncidentsResponse{Incidents: views}, nil
}

// UpdateIncident is the domain method behind the UpdateIncident RPC (plan 09h/1c).
// The REST POST /events/{eventName}/incidents/{incidentNumber} endpoint was RETIRED with
// this extraction, not shimmed (migration decision, plan 09 §Migration strategy) — editing
// an incident is Connect-only now. It ports the REST editIncident authorization verbatim:
// a full edit needs EventWriteIncidents, while a reporter with only a 52f per-incident
// grant may submit a journal-only payload (isJournalOnly). The heavy field-reconciliation
// is the shared updateIncident helper (unchanged); this converts the presence-tracked
// IncidentUpdate onto the imsjson.Incident it consumes, then invalidates the dashboard
// aggregate exactly as REST did.
//
// A 52f denial is PermissionDenied (403), not NotFound: the caller reached the incident by
// its number, so — unlike the single read — existence is not the thing being protected.
func (s Service) UpdateIncident(
	ctx context.Context,
	req *rpcv1.UpdateIncidentRequest,
) (*rpcv1.UpdateIncidentResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}

	eventRow, err := s.ImsDBQ.Event(ctx, s.ImsDBQ, req.GetEventId())
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("event not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch event: %w", err))
	}
	event := eventRow.Event

	eventPerms, _, err := authz.EventPermissions(ctx, &event.ID, s.ImsDBQ, *claims)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to compute permissions: %w", err))
	}
	eventPermissions := eventPerms[event.ID]

	incidentNumber := req.GetIncidentNumber()
	newIncident := incidentUpdateToJSON(req.GetUpdate())
	newIncident.Event = event.Name
	newIncident.EventID = event.ID
	newIncident.Number = incidentNumber

	// 52f: a full edit needs EventWriteIncidents. A reporter granted per-incident access
	// may *only* append journal entries — so without the write bit, require a grant AND a
	// journal-only payload (updateIncident already ignores zero/nil fields, so isJournalOnly
	// is the guard that stops them editing anything else).
	if eventPermissions&authz.EventWriteIncidents == 0 {
		hasGrant, err := s.ImsDBQ.IncidentPersonHasGrant(ctx, s.ImsDBQ, imsdb.IncidentPersonHasGrantParams{
			Event: event.ID, IncidentNumber: incidentNumber, PersonID: claims.PersonID(),
		})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to check incident grant: %w", err))
		}
		if !hasGrant {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("the requestor does not have EventWriteIncidents permission for this Event"))
		}
		if !isJournalOnly(newIncident) {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("a granted reporter may only add journal entries to this incident"))
		}
	}

	errHTTP := updateIncident(ctx, s.ImsDBQ, s.UserStore, s.Es, s.Pusher, newIncident, claims.PersonID(), claims.PersonAdmin())
	if errHTTP != nil {
		return nil, herrToConnect(errHTTP)
	}

	// State / priority / outcome / area edits all feed the dashboard aggregate.
	s.Metrics.InvalidateEvent(event.Name)

	return &rpcv1.UpdateIncidentResponse{}, nil
}

// incidentUpdateToJSON converts the presence-tracked IncidentUpdate write body onto the
// imsjson.Incident that the shared updateIncident helper consumes. imsjson.Incident's
// pointer/zero fields already encode exactly the semantics IncidentUpdate was designed
// around, so the mapping is lossless: an absent proto scalar/list leaves the imsjson field
// nil/zero ("leave unchanged"), while a present-but-empty Int32List/IncidentRefList becomes
// a non-nil empty slice ("clear the list"). It is the write-side mirror of
// incidentJSONToProto and, like it, exists only while updateIncident still speaks json — it
// collapses when the write path maps proto straight to the store (plan 09 §Migration
// strategy). The event/number keys come from the request's path keys, set by the caller.
func incidentUpdateToJSON(u *rpcv1.IncidentUpdate) imsjson.Incident {
	if u == nil {
		return imsjson.Incident{}
	}
	out := imsjson.Incident{
		State:     incidentStateFromProto(u.GetState()),
		Private:   u.Private,
		OutcomeID: u.OutcomeId,
		Priority:  incidentPriorityFromProto(u.GetPriority()),
		Summary:   u.Summary,
	}
	if started := u.GetStarted(); started != nil {
		out.Started = started.AsTime()
	}
	if loc := u.GetLocation(); loc != nil {
		out.Location = imsjson.Location{
			AreaSlug:    loc.AreaSlug,
			Description: loc.Description,
			Booth:       loc.Booth,
		}
	}
	if lst := u.GetIncidentTypeIds(); lst != nil {
		out.IncidentTypeIDs = int32ListToSlicePtr(lst)
	}
	if lst := u.GetReports(); lst != nil {
		out.Reports = int32ListToSlicePtr(lst)
	}
	if lst := u.GetLinkedIncidents(); lst != nil {
		links := make([]imsjson.LinkedIncident, 0, len(lst.GetRefs()))
		for _, r := range lst.GetRefs() {
			// Only the event/number keys are read on write (the display fields are ignored,
			// per the IncidentRefList doc); updateIncident reconciles against the stored set.
			links = append(links, imsjson.LinkedIncident{
				EventID: r.GetEventId(),
				Number:  r.GetIncidentNumber(),
			})
		}
		out.LinkedIncidents = &links
	}
	for _, je := range u.GetJournalEntries() {
		out.JournalEntries = append(out.JournalEntries, imsjson.JournalEntry{
			Text:               je.GetText(),
			MentionedPersonIDs: je.GetMentionedPersonIds(),
		})
	}
	return out
}

// int32ListToSlicePtr converts a present Int32List wrapper into the *[]int32 imsjson uses
// for a reconciled list — a non-nil pointer means "set exactly these" (an empty list
// clears). The caller invokes it only when the wrapper itself is present; a nil wrapper
// ("leave unchanged") stays a nil *[]int32 and is handled at the call site.
func int32ListToSlicePtr(lst *rpcv1.Int32List) *[]int32 {
	v := lst.GetValues()
	if v == nil {
		v = []int32{}
	}
	return &v
}

// incidentStateFromProto / incidentPriorityFromProto are the write-side inverses of
// incidentStateToProto / incidentPriorityToProto: UNSPECIFIED maps to the json "no change"
// sentinel ("" / 0) that updateIncident treats as leave-unchanged.
func incidentStateFromProto(s resourcesv1.IncidentState) string {
	switch s {
	case resourcesv1.IncidentState_INCIDENT_STATE_OPEN:
		return string(imsdb.IncidentStateOpen)
	case resourcesv1.IncidentState_INCIDENT_STATE_CLOSED:
		return string(imsdb.IncidentStateClosed)
	default:
		return ""
	}
}

func incidentPriorityFromProto(p resourcesv1.IncidentPriority) int8 {
	switch p {
	case resourcesv1.IncidentPriority_INCIDENT_PRIORITY_HIGH:
		return imsjson.IncidentPriorityHigh
	case resourcesv1.IncidentPriority_INCIDENT_PRIORITY_NORMAL:
		return imsjson.IncidentPriorityNormal
	case resourcesv1.IncidentPriority_INCIDENT_PRIORITY_LOW:
		return imsjson.IncidentPriorityLow
	default:
		return 0
	}
}

// herrToConnect maps an herr.HTTPError from the reused REST-era helpers
// (fetchIncident, PermissionsByEvent) onto the equivalent Connect error code, so the
// extracted domain function speaks Connect codes end to end. Only the client-facing
// ResponseMessage crosses the boundary; the internal error detail stays server-side.
func herrToConnect(e *herr.HTTPError) error {
	code := connect.CodeInternal
	switch e.Code {
	case http.StatusBadRequest:
		code = connect.CodeInvalidArgument
	case http.StatusUnauthorized:
		code = connect.CodeUnauthenticated
	case http.StatusForbidden:
		code = connect.CodePermissionDenied
	case http.StatusNotFound:
		code = connect.CodeNotFound
	}
	return connect.NewError(code, errors.New(e.ResponseMessage))
}

// incidentJSONToProto maps the assembled imsjson.Incident — still the shared read/
// write shape while the incident write path is REST (plan 09 §Migration strategy) —
// onto the resources/v1.Incident proto. It is the throwaway bridge from the condemned
// json layer to the wire; when the rest of the incident surface moves onto Connect it
// collapses into a direct DB→proto mapping. Visits (json.Incident.Visits) are
// intentionally dropped: the contract excludes the visits subsystem (09e).
func incidentJSONToProto(inc imsjson.Incident) *resourcesv1.Incident {
	out := &resourcesv1.Incident{
		Event:        inc.Event,
		EventId:      inc.EventID,
		Number:       inc.Number,
		Created:      timestamppb.New(inc.Created),
		LastModified: timestamppb.New(inc.LastModified),
		CreatedBy:    mentionToPersonRef(inc.CreatedBy),
		State:        incidentStateToProto(inc.State),
		Private:      inc.Private,
		OutcomeId:    inc.OutcomeID,
		Started:      timestamppb.New(inc.Started),
		Priority:     incidentPriorityToProto(inc.Priority),
		Summary:      inc.Summary,
		Location: &resourcesv1.IncidentLocation{
			AreaSlug:    inc.Location.AreaSlug,
			Description: inc.Location.Description,
			Booth:       inc.Location.Booth,
		},
	}
	if !inc.Closed.IsZero() {
		out.Closed = timestamppb.New(inc.Closed)
	}
	if inc.IncidentTypeIDs != nil {
		out.IncidentTypeIds = *inc.IncidentTypeIDs
	}
	if inc.Reports != nil {
		out.Reports = *inc.Reports
	}
	if inc.People != nil {
		out.People = make([]*resourcesv1.IncidentPerson, 0, len(*inc.People))
		for _, p := range *inc.People {
			out.People = append(out.People, incidentPersonToProto(p))
		}
	}
	if inc.LinkedIncidents != nil {
		out.LinkedIncidents = make([]*commonv1.IncidentRef, 0, len(*inc.LinkedIncidents))
		for _, li := range *inc.LinkedIncidents {
			out.LinkedIncidents = append(out.LinkedIncidents, &commonv1.IncidentRef{
				EventName:      li.EventName,
				EventId:        li.EventID,
				IncidentNumber: li.Number,
				Summary:        li.Summary,
			})
		}
	}
	out.JournalEntries = make([]*resourcesv1.JournalEntry, 0, len(inc.JournalEntries))
	for _, je := range inc.JournalEntries {
		out.JournalEntries = append(out.JournalEntries, journalEntryToProto(je))
	}
	return out
}

func journalEntryToProto(je imsjson.JournalEntry) *resourcesv1.JournalEntry {
	out := &resourcesv1.JournalEntry{
		Id:          je.ID,
		Created:     timestamppb.New(je.Created),
		Author:      je.Author,
		SystemEntry: je.SystemEntry,
		Text:        je.Text,
		Stricken:    je.Stricken,
		OnBehalfOf:  mentionToPersonRef(je.OnBehalfOf),
	}
	if je.Attachment.Name != "" {
		out.Attachment = &resourcesv1.Attachment{
			Id:          je.Attachment.Name,
			Previewable: je.Attachment.Previewable,
		}
	}
	for _, m := range je.Mentions {
		out.Mentions = append(out.Mentions, &commonv1.PersonRef{
			PersonId: m.PersonID,
			Handle:   strPtrIfNonEmpty(m.Handle),
			Name:     strPtrIfNonEmpty(m.Name),
		})
	}
	return out
}

func incidentPersonToProto(p imsjson.IncidentPerson) *resourcesv1.IncidentPerson {
	return &resourcesv1.IncidentPerson{
		Person: &commonv1.PersonRef{
			PersonId: int32(p.PersonID),
			Handle:   strPtrIfNonEmpty(p.Handle),
			Name:     strPtrIfNonEmpty(p.Name),
		},
		Involvement:    p.Involvement,
		GrantedAccess:  p.GrantedAccess,
		HasEventAccess: p.HasEventAccess,
	}
}

func mentionToPersonRef(m *imsjson.Mention) *commonv1.PersonRef {
	if m == nil {
		return nil
	}
	return &commonv1.PersonRef{
		PersonId: m.PersonID,
		Handle:   strPtrIfNonEmpty(m.Handle),
		Name:     strPtrIfNonEmpty(m.Name),
	}
}

func incidentStateToProto(s string) resourcesv1.IncidentState {
	switch imsdb.IncidentState(s) {
	case imsdb.IncidentStateOpen:
		return resourcesv1.IncidentState_INCIDENT_STATE_OPEN
	case imsdb.IncidentStateClosed:
		return resourcesv1.IncidentState_INCIDENT_STATE_CLOSED
	default:
		return resourcesv1.IncidentState_INCIDENT_STATE_UNSPECIFIED
	}
}

func incidentPriorityToProto(p int8) resourcesv1.IncidentPriority {
	switch p {
	case imsjson.IncidentPriorityHigh:
		return resourcesv1.IncidentPriority_INCIDENT_PRIORITY_HIGH
	case imsjson.IncidentPriorityNormal:
		return resourcesv1.IncidentPriority_INCIDENT_PRIORITY_NORMAL
	case imsjson.IncidentPriorityLow:
		return resourcesv1.IncidentPriority_INCIDENT_PRIORITY_LOW
	default:
		return resourcesv1.IncidentPriority_INCIDENT_PRIORITY_UNSPECIFIED
	}
}

// strPtrIfNonEmpty returns nil for an empty string so an absent handle/name maps to an
// unset optional proto field (and round-trips back to "" on the read side), matching
// the PersonRef contract's "unset for a login-less person who has none".
func strPtrIfNonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
