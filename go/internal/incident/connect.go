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
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/go-sql-driver/mysql"
	"github.com/mikeki/ocf-ims/directory"
	commonv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/common/v1"
	resourcesv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/resources/v1"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/internal/notification"
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

// CreateIncident is the domain method behind the CreateIncident RPC (plan 09h/1c). The
// REST POST /events/{eventName}/incidents endpoint was RETIRED with this extraction, not
// shimmed (migration decision, plan 09 §Migration strategy) — creating an incident is
// Connect-only now. It ports the REST newIncident authorization and flow verbatim:
// creating an incident needs EventWriteIncidents — there is no journal-only path (unlike
// UpdateIncident), because a 52f grant is per-incident and can't apply to an incident that
// doesn't exist yet. It reserves the next per-event number, inserts the row with the create
// defaults (state OPEN, priority NORMAL, creator = caller), then applies the presence-tracked
// IncidentUpdate over that fresh row through the shared updateIncident helper (unchanged) —
// so an absent field simply keeps its create default. Finally it invalidates the dashboard
// aggregate exactly as REST did and returns the server-assigned number.
//
// The REST handler also set a Location response header; the contract drops it (the client
// composes the resource path from the returned number), matching CreateIncidentResponse.
func (s Service) CreateIncident(
	ctx context.Context,
	req *rpcv1.CreateIncidentRequest,
) (*rpcv1.CreateIncidentResponse, error) {
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
	if eventPerms[event.ID]&authz.EventWriteIncidents == 0 {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have EventWriteIncidents permission on this Event"))
	}

	authorPersonID := claims.PersonID()

	// Reserve the incident number first, locking in the per-event sequence, then insert
	// the row with the create defaults before applying the caller's fields over it.
	newIncidentNumber, err := s.ImsDBQ.NextIncidentNumber(ctx, s.ImsDBQ, event.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to find next incident number: %w", err))
	}
	now := conv.TimeToFloat(time.Now())
	_, err = s.ImsDBQ.CreateIncident(ctx, s.ImsDBQ, imsdb.CreateIncidentParams{
		Event:     event.ID,
		Number:    newIncidentNumber,
		Created:   now,
		Started:   now,
		Priority:  imsjson.IncidentPriorityNormal,
		State:     imsdb.IncidentStateOpen,
		CreatedBy: sql.NullInt32{Int32: authorPersonID, Valid: true},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create incident: %w", err))
	}

	newIncident := incidentUpdateToJSON(req.GetIncident())
	newIncident.Event = event.Name
	newIncident.EventID = event.ID
	newIncident.Number = newIncidentNumber

	errHTTP := updateIncident(ctx, s.ImsDBQ, s.UserStore, s.Es, s.Pusher, newIncident, authorPersonID, claims.PersonAdmin())
	if errHTTP != nil {
		return nil, herrToConnect(errHTTP)
	}

	// A new incident shifts the dashboard aggregate for this event.
	s.Metrics.InvalidateEvent(event.Name)

	return &rpcv1.CreateIncidentResponse{IncidentNumber: newIncidentNumber}, nil
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

// AttachPersonToIncident is the domain method behind the AttachPersonToIncident RPC (plan 09h/1c).
// The REST POST /events/{eventName}/incidents/{incidentNumber}/people/{personId} endpoint was
// RETIRED with this extraction, not shimmed (migration decision, plan 09 §Migration strategy). It
// ports the REST attachPerson flow verbatim: attaching (or editing the involvement/grant of) a
// person on an incident needs EventWriteIncidents — there is no journal-only grant path, since a
// 52f-granted reporter may only append journal entries, not manage people. The person is resolved
// by the request's person_id (the REST path's {personId}). The write is a detach-then-reattach
// replace run in a retrying transaction (deadlock-resilient), records what actually changed as one
// system journal entry, and — only on a genuine new attach — fires the added-to-incident
// notification (plan 82) and web push (plan 84c).
func (s Service) AttachPersonToIncident(
	ctx context.Context,
	req *rpcv1.AttachPersonToIncidentRequest,
) (*rpcv1.AttachPersonToIncidentResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}

	event, errConn := s.incidentWriteContext(ctx, req.GetEventId(), *claims)
	if errConn != nil {
		return nil, errConn
	}

	incidentNumber := req.GetIncidentNumber()
	person, errHTTP := server.PersonByID(ctx, s.ImsDBQ, req.GetPersonId())
	if errHTTP != nil {
		return nil, herrToConnect(errHTTP)
	}
	personID := person.ID
	actorPersonID := claims.PersonID()
	newInvolvement := conv.StringToSql(req.Involvement, 128)
	grantedAccess := req.GetGrantedAccess()

	// Run the whole change in a retrying transaction: attach is a detach-then-reattach replace
	// and can deadlock against a concurrent attach/detach on the same incident, so a transient
	// deadlock / lock-wait timeout retries the whole transaction (store.RunInTx) instead of
	// erroring. newlyAttached distinguishes a genuine new add (which alone fires the notification
	// and push) from an involvement edit; it is set inside the txn and read after commit.
	var newlyAttached bool
	runErr := s.ImsDBQ.RunInTx(ctx, func(txn *sql.Tx) error {
		// Attach is a detach-then-reattach replace, so we can't tell a new add from an
		// involvement edit afterwards. Read the person's current row up front: its presence
		// distinguishes a genuine new add (which alone fires "added_to_incident", plan 82) from
		// an edit, and its old involvement/grant let the journal record what actually changed.
		var oldInvolvement sql.NullString
		var oldGranted, alreadyAttached bool
		existingPeople, txErr := s.ImsDBQ.Incident_People(ctx, txn, imsdb.Incident_PeopleParams{
			Event:          event.ID,
			IncidentNumber: incidentNumber,
		})
		if txErr != nil {
			return herr.InternalServerError("Failed to fetch incident people", txErr).From("[Incident_People]")
		}
		for _, row := range existingPeople {
			if row.IncidentPerson.PersonID == personID {
				alreadyAttached = true
				oldInvolvement = row.IncidentPerson.Involvement
				oldGranted = row.IncidentPerson.GrantedAccess
				break
			}
		}
		// Reassigned each attempt (RunInTx may retry on deadlock) so it reflects the committed
		// run, not a rolled-back one.
		newlyAttached = !alreadyAttached

		txErr = s.ImsDBQ.DetachPersonFromIncident(ctx, txn, imsdb.DetachPersonFromIncidentParams{
			Event:          event.ID,
			IncidentNumber: incidentNumber,
			PersonID:       personID,
		})
		if txErr != nil {
			return herr.InternalServerError("Failed to detach person from Incident", txErr).From("[DetachPersonFromIncident]")
		}

		txErr = s.ImsDBQ.AttachPersonToIncident(ctx, txn, imsdb.AttachPersonToIncidentParams{
			Event:          event.ID,
			IncidentNumber: incidentNumber,
			PersonID:       personID,
			Involvement:    newInvolvement,
			// 52f: per-incident access grant for an involved reporter (writer-gated here).
			GrantedAccess: grantedAccess,
		})
		if txErr != nil {
			return herr.InternalServerError("Failed to attach person to Incident", txErr).From("[AttachPersonToIncident]")
		}

		// Record what actually changed — the add, and/or the involvement and access-grant edits —
		// as a single system entry. Nothing changed → no entry.
		lines := personChangeLog(server.PersonDisplayName(person), alreadyAttached, oldInvolvement, newInvolvement, oldGranted, grantedAccess)
		if len(lines) > 0 {
			_, errJournal := addIncidentJournalEntry(
				ctx, s.ImsDBQ, txn, event.ID, incidentNumber,
				actorPersonID, strings.Join(lines, "\n"),
				true, "", "", "",
			)
			if errJournal != nil {
				return errJournal.From("[addIncidentJournalEntry]")
			}
		}

		// Notify the person they were added — only on a genuine new attach (plan 82).
		if !alreadyAttached {
			errNotify := notification.GenerateAddedToIncidentNotification(ctx, s.ImsDBQ, txn, event.ID, incidentNumber, personID, actorPersonID)
			if errNotify != nil {
				return errNotify.From("[notification.GenerateAddedToIncidentNotification]")
			}
		}
		return nil
	})
	if runErr != nil {
		return nil, herrToConnect(herr.AsHTTPError(runErr))
	}
	s.Es.NotifyIncidentUpdate(event.ID, incidentNumber)
	// Web push the added person (plan 84c): after commit, off the request path, and only on a
	// genuine new attach — same gate as the in-app notification.
	if newlyAttached {
		s.Pusher.NotifyAddedToIncident(ctx, event.Name, incidentNumber, personID, actorPersonID)
	}

	return &rpcv1.AttachPersonToIncidentResponse{}, nil
}

// DetachPersonFromIncident is the domain method behind the DetachPersonFromIncident RPC (plan
// 09h/1c). The REST DELETE /events/{eventName}/incidents/{incidentNumber}/people/{personId}
// endpoint was RETIRED with this extraction (migration decision, plan 09 §Migration strategy). It
// ports the REST detachPerson flow verbatim: it needs EventWriteIncidents, resolves the person by
// person_id, and removes the membership plus a "Removed person" system journal entry in a retrying
// transaction (deadlock-resilient, like attach).
func (s Service) DetachPersonFromIncident(
	ctx context.Context,
	req *rpcv1.DetachPersonFromIncidentRequest,
) (*rpcv1.DetachPersonFromIncidentResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}

	event, errConn := s.incidentWriteContext(ctx, req.GetEventId(), *claims)
	if errConn != nil {
		return nil, errConn
	}

	incidentNumber := req.GetIncidentNumber()
	person, errHTTP := server.PersonByID(ctx, s.ImsDBQ, req.GetPersonId())
	if errHTTP != nil {
		return nil, herrToConnect(errHTTP)
	}
	personID := person.ID
	actorPersonID := claims.PersonID()

	// Run in a retrying transaction so a transient deadlock / lock-wait timeout against a
	// concurrent attach/detach on the same incident is retried rather than surfaced as an error.
	runErr := s.ImsDBQ.RunInTx(ctx, func(txn *sql.Tx) error {
		txErr := s.ImsDBQ.DetachPersonFromIncident(ctx, txn, imsdb.DetachPersonFromIncidentParams{
			Event:          event.ID,
			IncidentNumber: incidentNumber,
			PersonID:       personID,
		})
		if txErr != nil {
			return herr.InternalServerError("Failed to detach person from Incident", txErr).From("[DetachPersonFromIncident]")
		}
		_, errJournal := addIncidentJournalEntry(
			ctx, s.ImsDBQ, txn, event.ID, incidentNumber,
			actorPersonID, fmt.Sprintf("Removed person: %v", server.PersonDisplayName(person)),
			true, "", "", "",
		)
		if errJournal != nil {
			return errJournal.From("[addIncidentJournalEntry]")
		}
		return nil
	})
	if runErr != nil {
		return nil, herrToConnect(herr.AsHTTPError(runErr))
	}

	s.Es.NotifyIncidentUpdate(event.ID, incidentNumber)
	return &rpcv1.DetachPersonFromIncidentResponse{}, nil
}

// UpdateIncidentJournalEntry is the domain method behind the UpdateIncidentJournalEntry RPC (plan
// 09h/1c). The REST POST /events/{eventName}/incidents/{incidentNumber}/journal_entries/{id}
// endpoint was RETIRED with this extraction (migration decision, plan 09 §Migration strategy). It
// ports the REST editIncidentJournalEntry verbatim: striking is the only field this endpoint can
// change, and — unlike the report counterpart — there is NO per-author check: any caller with
// EventWriteIncidents may strike/unstrike any incident journal entry. An entry with no stricken
// value set is a no-op.
func (s Service) UpdateIncidentJournalEntry(
	ctx context.Context,
	req *rpcv1.UpdateIncidentJournalEntryRequest,
) (*rpcv1.UpdateIncidentJournalEntryResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}

	event, errConn := s.incidentWriteContext(ctx, req.GetEventId(), *claims)
	if errConn != nil {
		return nil, errConn
	}

	incidentNumber := req.GetIncidentNumber()
	journalEntryID := req.GetJournalEntryId()
	authorPersonID := claims.PersonID()

	stricken := req.GetEntry().Stricken
	if stricken == nil {
		// Stricken is the only field this endpoint can modify; nothing to do.
		return &rpcv1.UpdateIncidentJournalEntryResponse{}, nil
	}

	txn, err := s.ImsDBQ.Begin()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to begin transaction: %w", err))
	}
	defer server.Rollback(txn)

	err = s.ImsDBQ.SetIncidentJournalEntryStricken(ctx, txn, imsdb.SetIncidentJournalEntryStrickenParams{
		Stricken: *stricken, Event: event.ID, IncidentNumber: incidentNumber, JournalEntry: journalEntryID,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to set journal entry stricken: %w", err))
	}
	struckVerb := "Struck"
	if !*stricken {
		struckVerb = "Unstruck"
	}
	errConn = s.addGeneratedIncidentEntry(ctx, txn, event.ID, incidentNumber, authorPersonID,
		fmt.Sprintf("%v journalEntry %v", struckVerb, journalEntryID))
	if errConn != nil {
		return nil, errConn
	}
	err = txn.Commit()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to commit transaction: %w", err))
	}

	defer s.Es.NotifyIncidentUpdate(event.ID, incidentNumber)
	return &rpcv1.UpdateIncidentJournalEntryResponse{}, nil
}

// GetReport is the domain method behind the GetReport RPC (plan 09h/1c, reports). The REST
// GET /events/{eventName}/reports/{reportNumber} endpoint was RETIRED with this extraction,
// not shimmed (migration decision, plan 09 §Migration strategy). It ports the REST getReport
// authorization verbatim: reading reports needs one of EventReadAllReports / EventReadOwnReports
// / EventReadCrewReports, and a caller without the "all" bit (limitedAccess) may see a report
// only if they own it (ownsReport — anchored on REPORT.CREATED_BY, journal-authorship as a
// legacy fallback) or, as a crew leader, it belongs to their crew (crewReportNumberSet, 10c).
// Unlike a private incident, an out-of-scope report is PermissionDenied (403), not NotFound —
// the REST handler never hid a report's existence from a report-reader. Like the incident reads
// it reuses the shared reportToJSON assembly and bridges the result onto the wire proto.
func (s Service) GetReport(
	ctx context.Context,
	req *rpcv1.GetReportRequest,
) (*rpcv1.GetReportResponse, error) {
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
	if eventPermissions&(authz.EventReadAllReports|authz.EventReadOwnReports|authz.EventReadCrewReports) == 0 {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have permission to read Reports on this Event"))
	}
	limitedAccess := eventPermissions&authz.EventReadAllReports == 0

	reportNumber := req.GetReportNumber()
	report, journalEntries, errHTTP := fetchReport(ctx, s.ImsDBQ, event.ID, reportNumber, s.AttachmentsEnabled)
	if errHTTP != nil {
		return nil, herrToConnect(errHTTP)
	}
	reportRow := imsdb.ReportsRow(report)

	if limitedAccess {
		callerPersonID := claims.PersonID()
		ownVisible := eventPermissions&authz.EventReadOwnReports != 0 &&
			ownsReport(reportRow.Report, journalEntries, callerPersonID, claims.PersonHandle())
		crewVisible := false
		if !ownVisible && eventPermissions&authz.EventReadCrewReports != 0 {
			crewReportNums, errHTTP := crewReportNumberSet(ctx, s.ImsDBQ, event.ID, callerPersonID)
			if errHTTP != nil {
				return nil, herrToConnect(errHTTP)
			}
			crewVisible = crewReportNums[reportNumber]
		}
		if !ownVisible && !crewVisible {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("the requestor does not have permission to access this particular Report"))
		}
	}

	mayEditSummary, mayAddEntry := reportEditRights(reportRow.Report, claims.PersonID(), claims.PersonAdmin(), eventPermissions)
	reportJSON := reportToJSON(reportRow, journalEntries, event, s.AttachmentsEnabled, mayEditSummary, mayAddEntry)
	return &rpcv1.GetReportResponse{Report: reportViewFromJSON(reportJSON)}, nil
}

// ListReports is the domain method behind the ListReports RPC (plan 09h/1c, reports). The
// REST GET /events/{eventName}/reports endpoint was RETIRED with this extraction (migration
// decision, plan 09 §Migration strategy). It ports the REST getReports authorization and
// assembly verbatim: the same read-permission gate as GetReport, and for a limitedAccess
// caller the returned list is scoped to the reports they own plus — for a crew leader — their
// crew's reports. Like ListIncidents it computes the per-report edit flags and reuses the
// shared reportToJSON assembly, bridging each result onto the wire proto.
//
// exclude_system_entries mirrors the retired REST query param the RPC can't read off the URL
// (default false = include system journal entries), the same move ListIncidents made.
func (s Service) ListReports(
	ctx context.Context,
	req *rpcv1.ListReportsRequest,
) (*rpcv1.ListReportsResponse, error) {
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
	if eventPermissions&(authz.EventReadAllReports|authz.EventReadOwnReports|authz.EventReadCrewReports) == 0 {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have permission to read Reports on this Event"))
	}
	limitedAccess := eventPermissions&authz.EventReadAllReports == 0

	includeSystemEntries := !req.GetExcludeSystemEntries()
	journalEntryRows, err := s.ImsDBQ.Reports_JournalEntries(ctx, s.ImsDBQ, imsdb.Reports_JournalEntriesParams{
		Event: event.ID, Generated: includeSystemEntries,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to get report journal entries: %w", err))
	}
	entriesByReport := make(map[int32][]imsjson.JournalEntry)
	for _, row := range journalEntryRows {
		entriesByReport[row.ReportNumber] = append(entriesByReport[row.ReportNumber],
			journalEntryToJSON(row.JournalEntry, row.Author.String,
				onBehalfOfJSON(row.JournalEntry.OnBehalfOfPersonID, row.OnBehalfOfHandle, row.OnBehalfOfName),
				s.AttachmentsEnabled))
	}

	storedReports, err := s.ImsDBQ.Reports(ctx, s.ImsDBQ, event.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch reports: %w", err))
	}

	callerPersonID := claims.PersonID()
	callerHandle := claims.PersonHandle()
	callerIsAdmin := claims.PersonAdmin()

	var authorizedReports []imsdb.ReportsRow
	if limitedAccess {
		hasOwn := eventPermissions&authz.EventReadOwnReports != 0
		crewReportNums := map[int32]bool{}
		if eventPermissions&authz.EventReadCrewReports != 0 {
			set, errHTTP := crewReportNumberSet(ctx, s.ImsDBQ, event.ID, callerPersonID)
			if errHTTP != nil {
				return nil, herrToConnect(errHTTP)
			}
			crewReportNums = set
		}
		for _, storedReport := range storedReports {
			entries := entriesByReport[storedReport.Report.Number]
			ownVisible := hasOwn && ownsReport(storedReport.Report, entries, callerPersonID, callerHandle)
			if ownVisible || crewReportNums[storedReport.Report.Number] {
				authorizedReports = append(authorizedReports, storedReport)
			}
		}
	} else {
		authorizedReports = storedReports
	}

	reports := make([]*rpcv1.ReportView, 0, len(authorizedReports))
	for _, report := range authorizedReports {
		mayEditSummary, mayAddEntry := reportEditRights(report.Report, callerPersonID, callerIsAdmin, eventPermissions)
		reportJSON := reportToJSON(report, entriesByReport[report.Report.Number], event, s.AttachmentsEnabled, mayEditSummary, mayAddEntry)
		reports = append(reports, reportViewFromJSON(reportJSON))
	}
	return &rpcv1.ListReportsResponse{Reports: reports}, nil
}

// CreateReport is the domain method behind the CreateReport RPC (plan 09h/1c, reports). The
// REST POST /events/{eventName}/reports endpoint was RETIRED with this extraction, not shimmed
// (migration decision, plan 09 §Migration strategy). It ports the REST newReport flow verbatim:
// writing a report needs EventWriteAllReports or EventWriteOwnReports; the report may be created
// already linked to an incident (10e — the reporter enters the IMS# before/without a summary),
// which trips a friendly NotFound if that incident doesn't exist. The incident link follows the
// visit-field convention (a present, positive report.incident links; absent or non-positive
// leaves it unlinked), replacing the REST create's "any non-nil incident" read. It reserves the
// next per-event number, inserts the row, then writes the summary/link/journal-entry records in a
// transaction, generating @mention notifications and web-push exactly as REST did.
func (s Service) CreateReport(
	ctx context.Context,
	req *rpcv1.CreateReportRequest,
) (*rpcv1.CreateReportResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}

	event, _, errConn := s.reportWriteContext(ctx, req.GetEventId(), *claims)
	if errConn != nil {
		return nil, errConn
	}

	report := reportWriteToJSON(req.GetReport())
	authorPersonID := claims.PersonID()

	var incidentNumber sql.NullInt32
	if report.Incident != nil && *report.Incident > 0 {
		incidentNumber = sql.NullInt32{Int32: *report.Incident, Valid: true}
	}

	newReportNum, err := s.ImsDBQ.NextReportNumber(ctx, s.ImsDBQ, event.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to find next report number: %w", err))
	}
	report.Number = newReportNum

	err = s.ImsDBQ.CreateReport(ctx, s.ImsDBQ, imsdb.CreateReportParams{
		Event:          event.ID,
		Number:         newReportNum,
		Created:        conv.TimeToFloat(time.Now()),
		Summary:        conv.StringToSql(report.Summary, 0),
		IncidentNumber: incidentNumber,
		CreatedBy:      sql.NullInt32{Int32: authorPersonID, Valid: true},
	})
	if err != nil {
		if isNoReferencedRow(err) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("no such Incident"))
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create report: %w", err))
	}

	txn, err := s.ImsDBQ.Begin()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to begin transaction: %w", err))
	}
	defer server.Rollback(txn)

	if report.Summary != nil {
		errConn := s.addGeneratedReportEntry(ctx, txn, event.ID, report.Number, authorPersonID,
			"Changed summary to: "+*report.Summary)
		if errConn != nil {
			return nil, errConn
		}
	}
	if incidentNumber.Valid {
		errConn := s.addGeneratedReportEntry(ctx, txn, event.ID, report.Number, authorPersonID,
			fmt.Sprintf("Attached to incident: %v", incidentNumber.Int32))
		if errConn != nil {
			return nil, errConn
		}
		// Mirror the link onto the incident's journal too, so it shows on both timelines.
		errConn = s.addGeneratedIncidentEntry(ctx, txn, event.ID, incidentNumber.Int32, authorPersonID,
			fmt.Sprintf("Report added: %v", report.Number))
		if errConn != nil {
			return nil, errConn
		}
	}

	mentionedPersonIDs, errConn := s.applyReportJournalEntries(ctx, txn, event.ID, report.Number, authorPersonID, report.JournalEntries)
	if errConn != nil {
		return nil, errConn
	}

	err = txn.Commit()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to commit transaction: %w", err))
	}

	defer s.Es.NotifyReportUpdate(event.ID, report.Number)
	if incidentNumber.Valid {
		// The incident just gained a report; refresh its subscribers too (0 = no
		// previous incident, mirroring an attach from unattached).
		defer s.Es.NotifyIncidentUpdates(event.ID, 0, incidentNumber.Int32)
	}
	s.Pusher.NotifyMentionedInReport(ctx, event.Name, report.Number, mentionedPersonIDs, authorPersonID)
	return &rpcv1.CreateReportResponse{ReportNumber: report.Number}, nil
}

// UpdateReport is the domain method behind the UpdateReport RPC (plan 09h/1c, reports). The
// REST POST /events/{eventName}/reports/{reportNumber} endpoint was RETIRED with this extraction
// (migration decision, plan 09 §Migration strategy). It ports the REST editReport authorization
// verbatim: the write gate (EventWriteAllReports / EventWriteOwnReports) plus an ownership floor
// (write-all, or the report's creator, or a previous journal-entry author) that a limited caller
// must clear, and the stricter per-action gates from reportEditRights (only the creator/admin may
// edit the summary; the writer role may additionally add entries).
//
// The one deliberate behavior change: the REST handler linked/unlinked a report to an incident
// through a "?action=attach|detach" form param and IGNORED the body's incident field; the RPC
// takes a plain Report, so the incident link is now reconciled from report.incident following the
// visit-field convention (present & >0 links, present & ≤0 detaches, absent leaves it unchanged),
// and only when it actually changes — so an edit that carries the current link writes no spurious
// journal entry. This retires the legacy action framework the REST TODO called out.
func (s Service) UpdateReport(
	ctx context.Context,
	req *rpcv1.UpdateReportRequest,
) (*rpcv1.UpdateReportResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}

	event, eventPermissions, errConn := s.reportWriteContext(ctx, req.GetEventId(), *claims)
	if errConn != nil {
		return nil, errConn
	}

	reportNumber := req.GetReportNumber()
	report := reportWriteToJSON(req.GetReport())
	authorPersonID := claims.PersonID()

	reportRow, err := s.ImsDBQ.Report(ctx, s.ImsDBQ, imsdb.ReportParams{Event: event.ID, Number: reportNumber})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("report does not exist"))
	}
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch report: %w", err))
	}
	storedReport := reportRow.Report

	// Ownership floor (governs the link action and is the baseline for the edits): a caller
	// with EventWriteAllReports always qualifies; a limited caller must be the creator or a
	// previous author of one of the report's journal entries.
	hasWriteAll := eventPermissions&authz.EventWriteAllReports != 0
	isCreator := storedReport.CreatedBy.Valid && storedReport.CreatedBy.Int32 == authorPersonID
	if !hasWriteAll && !isCreator {
		isPrevAuthor, errConn := s.isPreviousReportAuthor(ctx, event.ID, reportNumber, claims.PersonHandle())
		if errConn != nil {
			return nil, errConn
		}
		if !isPrevAuthor {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("the requestor does not have permission to edit this Report"))
		}
	}

	errConn = s.reconcileReportLink(ctx, storedReport, event, report.Incident, authorPersonID)
	if errConn != nil {
		return nil, errConn
	}

	editsSummary := report.Summary != nil
	addsEntry := false
	for _, entry := range report.JournalEntries {
		if entry.Text != "" {
			addsEntry = true
			break
		}
	}
	if !editsSummary && !addsEntry {
		// Link-only (or no-op) request: the link reconciliation above is all there was.
		return &rpcv1.UpdateReportResponse{}, nil
	}

	// Per-action authorization: editing the summary is limited to the creator and admins;
	// adding journal entries additionally allows the writer role.
	mayEditSummary, mayAddEntry := reportEditRights(storedReport, authorPersonID, claims.PersonAdmin(), eventPermissions)
	if editsSummary && !mayEditSummary {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("only the report's creator or an admin may edit the summary"))
	}
	if addsEntry && !mayAddEntry {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("only the report's creator, a writer, or an admin may add journal entries"))
	}

	txn, err := s.ImsDBQ.Begin()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to begin transaction: %w", err))
	}
	defer server.Rollback(txn)

	if editsSummary {
		storedReport.Summary = conv.StringToSql(report.Summary, 0)
		errConn := s.addGeneratedReportEntry(ctx, txn, event.ID, storedReport.Number, authorPersonID,
			"Changed summary to: "+*report.Summary)
		if errConn != nil {
			return nil, errConn
		}
	}
	err = s.ImsDBQ.UpdateReport(ctx, txn, imsdb.UpdateReportParams{
		Event:          storedReport.Event,
		Number:         storedReport.Number,
		Summary:        storedReport.Summary,
		IncidentNumber: storedReport.IncidentNumber,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to update report: %w", err))
	}

	mentionedPersonIDs, errConn := s.applyReportJournalEntries(ctx, txn, event.ID, storedReport.Number, authorPersonID, report.JournalEntries)
	if errConn != nil {
		return nil, errConn
	}

	err = txn.Commit()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to commit transaction: %w", err))
	}

	defer s.Es.NotifyReportUpdate(event.ID, storedReport.Number)
	s.Pusher.NotifyMentionedInReport(ctx, event.Name, storedReport.Number, mentionedPersonIDs, authorPersonID)
	return &rpcv1.UpdateReportResponse{}, nil
}

// UpdateReportJournalEntry is the domain method behind the UpdateReportJournalEntry RPC (plan
// 09h/1c, reports). The REST POST /events/{eventName}/reports/{reportNumber}/journal_entries/{id}
// endpoint was RETIRED with this extraction (migration decision, plan 09 §Migration strategy).
// It ports the REST editReportJournalEntry verbatim: striking is the only field this endpoint can
// change, and a caller with only EventWriteOwnReports (a reporter) may strike/unstrike only the
// entries they authored — writers/admins (EventWriteAllReports) may strike any (plan 90 M1). An
// entry with no stricken value set is a no-op.
func (s Service) UpdateReportJournalEntry(
	ctx context.Context,
	req *rpcv1.UpdateReportJournalEntryRequest,
) (*rpcv1.UpdateReportJournalEntryResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}

	event, eventPermissions, errConn := s.reportWriteContext(ctx, req.GetEventId(), *claims)
	if errConn != nil {
		return nil, errConn
	}

	reportNumber := req.GetReportNumber()
	journalEntryID := req.GetJournalEntryId()
	authorPersonID := claims.PersonID()

	_, err := s.ImsDBQ.Report(ctx, s.ImsDBQ, imsdb.ReportParams{Event: event.ID, Number: reportNumber})
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("there is no Report for the provided ID"))
	}

	stricken := req.GetEntry().Stricken
	if stricken == nil {
		// Stricken is the only field this endpoint can modify; nothing to do.
		return &rpcv1.UpdateReportJournalEntryResponse{}, nil
	}

	// A reporter (EventWriteOwnReports only) may strike only their own entries.
	if eventPermissions&authz.EventWriteAllReports == 0 {
		author, err := s.ImsDBQ.ReportJournalEntryAuthor(ctx, s.ImsDBQ, imsdb.ReportJournalEntryAuthorParams{
			Event: event.ID, ReportNumber: reportNumber, JournalEntry: journalEntryID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("there is no such JournalEntry on this Report"))
		}
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch journal entry author: %w", err))
		}
		if author.String != claims.PersonHandle() {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("the requestor may only strike their own journal entries"))
		}
	}

	txn, err := s.ImsDBQ.Begin()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to begin transaction: %w", err))
	}
	defer server.Rollback(txn)

	err = s.ImsDBQ.SetReportJournalEntryStricken(ctx, txn, imsdb.SetReportJournalEntryStrickenParams{
		Stricken: *stricken, Event: event.ID, ReportNumber: reportNumber, JournalEntry: journalEntryID,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to set journal entry stricken: %w", err))
	}
	struckVerb := "Struck"
	if !*stricken {
		struckVerb = "Unstruck"
	}
	errConn = s.addGeneratedReportEntry(ctx, txn, event.ID, reportNumber, authorPersonID,
		fmt.Sprintf("%v journalEntry %v", struckVerb, journalEntryID))
	if errConn != nil {
		return nil, errConn
	}
	err = txn.Commit()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to commit transaction: %w", err))
	}

	defer s.Es.NotifyReportUpdate(event.ID, reportNumber)
	return &rpcv1.UpdateReportJournalEntryResponse{}, nil
}

// reportWriteContext resolves the event and the caller's permissions for a report-write RPC and
// enforces the shared write gate (EventWriteAllReports or EventWriteOwnReports). A missing event
// is NotFound; a caller without either write bit is PermissionDenied. It factors out the identical
// preamble the three report-write methods share.
func (s Service) reportWriteContext(
	ctx context.Context, eventID int32, claims authz.IMSClaims,
) (imsdb.Event, authz.EventPermissionMask, error) {
	eventRow, err := s.ImsDBQ.Event(ctx, s.ImsDBQ, eventID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return imsdb.Event{}, 0, connect.NewError(connect.CodeNotFound, errors.New("event not found"))
		}
		return imsdb.Event{}, 0, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch event: %w", err))
	}
	event := eventRow.Event

	eventPerms, _, err := authz.EventPermissions(ctx, &event.ID, s.ImsDBQ, claims)
	if err != nil {
		return imsdb.Event{}, 0, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to compute permissions: %w", err))
	}
	eventPermissions := eventPerms[event.ID]
	if eventPermissions&(authz.EventWriteAllReports|authz.EventWriteOwnReports) == 0 {
		return imsdb.Event{}, 0, connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have permission to write Reports on this Event"))
	}
	return event, eventPermissions, nil
}

// incidentWriteContext resolves the event and enforces the EventWriteIncidents gate the incident
// sub-resource writes share (attach/detach a person, strike a journal entry). A missing event is
// NotFound; a caller without the write bit is PermissionDenied. Unlike UpdateIncident there is no
// journal-only grant path here: a 52f-granted reporter manages no people and strikes no entries —
// those actions have always required the full write bit. It returns only the event (none of the
// three needs the permission mask past the gate).
func (s Service) incidentWriteContext(
	ctx context.Context, eventID int32, claims authz.IMSClaims,
) (imsdb.Event, error) {
	eventRow, err := s.ImsDBQ.Event(ctx, s.ImsDBQ, eventID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return imsdb.Event{}, connect.NewError(connect.CodeNotFound, errors.New("event not found"))
		}
		return imsdb.Event{}, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch event: %w", err))
	}
	event := eventRow.Event

	eventPerms, _, err := authz.EventPermissions(ctx, &event.ID, s.ImsDBQ, claims)
	if err != nil {
		return imsdb.Event{}, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to compute permissions: %w", err))
	}
	if eventPerms[event.ID]&authz.EventWriteIncidents == 0 {
		return imsdb.Event{}, connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have EventWriteIncidents permission for this Event"))
	}
	return event, nil
}

// isPreviousReportAuthor reports whether the caller authored any of the report's journal entries
// — the legacy fallback in the edit-path ownership floor (see ownsReport / EditReport).
func (s Service) isPreviousReportAuthor(ctx context.Context, eventID, reportNumber int32, handle string) (bool, error) {
	entries, err := s.ImsDBQ.Report_JournalEntries(ctx, s.ImsDBQ, imsdb.Report_JournalEntriesParams{
		Event: eventID, ReportNumber: reportNumber,
	})
	if err != nil {
		return false, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch report journal entries: %w", err))
	}
	for _, entry := range entries {
		if entry.Author.String == handle {
			return true, nil
		}
	}
	return false, nil
}

// reconcileReportLink applies the incident link requested on a report update, following the
// visit-field convention: a nil desired (report.incident absent) leaves the link untouched; a
// positive value links the report to that incident; a non-positive value detaches it. It acts
// only when the target differs from the stored link, so a no-op edit writes no journal entry, and
// mirrors the change onto both the report's and the incident's timelines (as REST's
// handleLinkToIncident did). An unknown target incident trips a friendly NotFound.
func (s Service) reconcileReportLink(
	ctx context.Context, storedReport imsdb.Report, event imsdb.Event, desired *int32, actorPersonID int32,
) error {
	if desired == nil {
		return nil
	}
	previous := storedReport.IncidentNumber
	reportNumber := storedReport.Number

	var target sql.NullInt32
	if *desired > 0 {
		target = sql.NullInt32{Int32: *desired, Valid: true}
	}
	if target.Valid == previous.Valid && target.Int32 == previous.Int32 {
		// No change to the link.
		return nil
	}

	var reportEntryText, incidentEntryText string
	var incidentForJournal sql.NullInt32
	if target.Valid {
		reportEntryText = fmt.Sprintf("Attached to incident: %v", target.Int32)
		incidentForJournal = target
		incidentEntryText = fmt.Sprintf("Report added: %v", reportNumber)
	} else {
		reportEntryText = fmt.Sprintf("Detached from incident: %v", previous.Int32)
		// Mirror onto the previous incident — valid only if it was actually attached.
		incidentForJournal = previous
		incidentEntryText = fmt.Sprintf("Report removed: %v", reportNumber)
	}

	err := s.ImsDBQ.AttachReportToIncident(ctx, s.ImsDBQ, imsdb.AttachReportToIncidentParams{
		IncidentNumber: target, Event: event.ID, Number: reportNumber,
	})
	if err != nil {
		if isNoReferencedRow(err) {
			return connect.NewError(connect.CodeNotFound, errors.New("no such Incident"))
		}
		return connect.NewError(connect.CodeInternal, fmt.Errorf("failed to attach report to incident: %w", err))
	}
	errConn := s.addGeneratedReportEntry(ctx, s.ImsDBQ, event.ID, reportNumber, actorPersonID, reportEntryText)
	if errConn != nil {
		return errConn
	}
	if incidentForJournal.Valid {
		errConn = s.addGeneratedIncidentEntry(ctx, s.ImsDBQ, event.ID, incidentForJournal.Int32, actorPersonID, incidentEntryText)
		if errConn != nil {
			return errConn
		}
	}
	s.Es.NotifyReportUpdate(event.ID, reportNumber)
	s.Es.NotifyIncidentUpdates(event.ID, previous.Int32, target.Int32)
	return nil
}

// applyReportJournalEntries writes the non-empty journal entries from a report write body,
// attaching their @mentions and generating the mention notifications, and returns the set of
// mentioned people to web-push after commit. Shared by CreateReport and UpdateReport (the REST
// newReport/editReport ran the identical loop).
func (s Service) applyReportJournalEntries(
	ctx context.Context, txn imsdb.DBTX, eventID, reportNumber, authorPersonID int32, entries []imsjson.JournalEntry,
) ([]int32, error) {
	var mentionedPersonIDs []int32
	for _, entry := range entries {
		if entry.Text == "" {
			continue
		}
		entryID, errHTTP := addJournalEntry(ctx, s.ImsDBQ, txn, eventID, reportNumber, authorPersonID,
			entry.Text, false, "", "", "", onBehalfOfParam(entry.OnBehalfOfPersonID))
		if errHTTP != nil {
			return nil, herrToConnect(errHTTP)
		}
		errHTTP = addJournalEntryMentions(ctx, s.ImsDBQ, s.UserStore, txn, entryID, entry.Text, entry.MentionedPersonIDs)
		if errHTTP != nil {
			return nil, herrToConnect(errHTTP)
		}
		recipients, errHTTP := notification.GenerateReportMentionNotifications(ctx, s.ImsDBQ, txn, eventID, reportNumber, entryID, authorPersonID)
		if errHTTP != nil {
			return nil, herrToConnect(errHTTP)
		}
		mentionedPersonIDs = append(mentionedPersonIDs, recipients...)
	}
	return mentionedPersonIDs, nil
}

// addGeneratedReportEntry writes a server-generated ("system") journal entry onto a report — the
// change records the report writes emit (summary changes, link changes, strikes) — mapping the
// shared helper's herr onto a Connect error. dbtx is the transaction (or the plain *store.DBQ for
// the non-transactional link reconciliation).
func (s Service) addGeneratedReportEntry(
	ctx context.Context, dbtx imsdb.DBTX, eventID, reportNumber, authorPersonID int32, text string,
) error {
	_, errHTTP := addJournalEntry(ctx, s.ImsDBQ, dbtx, eventID, reportNumber, authorPersonID, text, true, "", "", "", sql.NullInt32{})
	if errHTTP != nil {
		return herrToConnect(errHTTP)
	}
	return nil
}

// addGeneratedIncidentEntry is the incident-side counterpart of addGeneratedReportEntry, used to
// mirror a report↔incident link change onto the incident's timeline.
func (s Service) addGeneratedIncidentEntry(
	ctx context.Context, dbtx imsdb.DBTX, eventID, incidentNumber, authorPersonID int32, text string,
) error {
	_, errHTTP := addIncidentJournalEntry(ctx, s.ImsDBQ, dbtx, eventID, incidentNumber, authorPersonID, text, true, "", "", "")
	if errHTTP != nil {
		return herrToConnect(errHTTP)
	}
	return nil
}

// isNoReferencedRow reports whether err is the MySQL "cannot add or update a child row: a
// foreign key constraint fails" error (1452) — a bad incident number tripping the composite
// (EVENT, INCIDENT_NUMBER) FK on a report link. Callers surface it as a friendly NotFound.
func isNoReferencedRow(err error) bool {
	var mysqlErr *mysql.MySQLError
	const mySQLErNoReferencedRow2 = 1452
	return errors.As(err, &mysqlErr) && mysqlErr.Number == mySQLErNoReferencedRow2
}

// reportWriteToJSON converts the plain Report resource a report-write RPC carries onto the
// imsjson.Report the shared write helpers consume. Only the write-input fields are read: the
// summary and incident-link presence pointers pass straight through (imsjson already uses the
// same *string / *int32 shapes), and each journal entry contributes its text plus the write-side
// person id lists the proto collapsed into resolved PersonRefs (on_behalf_of.person_id and
// mentions[].person_id). It is the report-side mirror of incidentUpdateToJSON and, like it, a
// throwaway bridge that collapses when the write path maps proto straight to the store.
func reportWriteToJSON(r *resourcesv1.Report) imsjson.Report {
	if r == nil {
		return imsjson.Report{}
	}
	out := imsjson.Report{
		Summary:  r.Summary,
		Incident: r.Incident,
	}
	for _, je := range r.GetJournalEntries() {
		entry := imsjson.JournalEntry{
			Text:               je.GetText(),
			MentionedPersonIDs: personRefsToIDs(je.GetMentions()),
		}
		if ob := je.GetOnBehalfOf(); ob != nil {
			id := ob.GetPersonId()
			entry.OnBehalfOfPersonID = &id
		}
		out.JournalEntries = append(out.JournalEntries, entry)
	}
	return out
}

// personRefsToIDs extracts the person ids from a write body's PersonRef list (the mentions on a
// new journal entry), dropping the handle/name the server resolves itself.
func personRefsToIDs(refs []*commonv1.PersonRef) []int32 {
	if len(refs) == 0 {
		return nil
	}
	ids := make([]int32, 0, len(refs))
	for _, r := range refs {
		ids = append(ids, r.GetPersonId())
	}
	return ids
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

// reportViewFromJSON wraps an assembled imsjson.Report as the ReportView the report read
// RPCs return: the resource proto (reportJSONToProto) plus the caller-dependent edit flags
// that json.Report carried inline (may_edit_summary / may_add_journal_entry live on the
// wrapper, not the resource — 0e).
func reportViewFromJSON(r imsjson.Report) *rpcv1.ReportView {
	return &rpcv1.ReportView{
		Report:             reportJSONToProto(r),
		MayEditSummary:     r.MayEditSummary,
		MayAddJournalEntry: r.MayAddJournalEntry,
	}
}

// reportJSONToProto maps the assembled imsjson.Report onto the resources/v1.Report proto —
// the report-side mirror of incidentJSONToProto and, like it, a throwaway bridge from the
// condemned json layer to the wire that collapses into a direct DB→proto mapping when the
// report read path is rebuilt. The viewer-dependent edit flags ride on ReportView (see
// reportViewFromJSON), not the resource, so they are not set here.
func reportJSONToProto(r imsjson.Report) *resourcesv1.Report {
	out := &resourcesv1.Report{
		Event:     r.Event,
		Number:    r.Number,
		Created:   timestamppb.New(r.Created),
		CreatedBy: mentionToPersonRef(r.CreatedBy),
		Summary:   r.Summary,
		Incident:  r.Incident,
	}
	out.JournalEntries = make([]*resourcesv1.JournalEntry, 0, len(r.JournalEntries))
	for _, je := range r.JournalEntries {
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
