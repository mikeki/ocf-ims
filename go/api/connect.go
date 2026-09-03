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
	"net/http"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/directory"
	servicerpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/gen/ocf/ims/service/v1/servicev1connect"
	"github.com/mikeki/ocf-ims/internal/event"
	"github.com/mikeki/ocf-ims/internal/incident"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/authz"
	pushlib "github.com/mikeki/ocf-ims/lib/push"
	"github.com/mikeki/ocf-ims/store"
)

// ImsService is the Connect implementation of the ocf.ims.service.v1.ImsService
// contract (plan 09, Phase 1). It sits beside AddToMux in this wiring package
// because — like AddToMux — it aggregates every domain: it composes each domain's
// internal/<domain>.Service and every method delegates to it. As a resource is extracted (1c/1d) its REST
// route is DELETED, not shimmed — the aggressive migration path in plan 09 §6, so
// the RPC becomes the sole transport for that resource.
//
// SCAFFOLD (removed at the Phase-1 exit gate): the embedded
// UnimplementedImsServiceHandler satisfies the 60-method interface while the
// methods are filled in resource-by-resource across 1c/1d. The gate greps for
// this embedding, so it cannot be left in the shipped server; until then it is
// the idiomatic connect-go way to stand up a partial service. See plan 09g.
type ImsService struct {
	servicev1connect.UnimplementedImsServiceHandler

	// Each domain package exposes a Service that holds the dependencies its RPCs share;
	// ImsService composes them (each built once in AddConnectToMux) and every RPC method
	// delegates to the matching domain Service. A resource is extracted by adding its
	// domain Service here and wiring it below — that is where the shared, mutable
	// cross-surface state (the SSE EventSourcerer, the dashboard MetricsCache) is threaded
	// in so a Connect write fans out and invalidates exactly as the REST surface does.
	Event    event.Service
	Incident incident.Service
}

// ListEvents is a thin RPC method over the event.ListEvents domain method (plan
// 09h/1c). Its REST predecessor (GET /events) was deleted in the same slice, so
// this is the only transport for listing events. The interceptor spine has already
// populated the caller's claims into ctx, so the method just delegates; the domain
// function already speaks Connect errors, so there is nothing to map.
func (s ImsService) ListEvents(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ListEventsRequest],
) (*connect.Response[servicerpcv1.ListEventsResponse], error) {
	resp, err := s.Event.ListEvents(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// ListIncidents is a thin RPC method over the incident.ListIncidents domain method
// (plan 09h/1c). Its REST predecessor (GET /events/{eventName}/incidents) was deleted in
// the same slice, so this is the only transport for listing an event's incidents. The
// domain method authorizes from ctx claims and speaks Connect errors, so this just
// delegates.
func (s ImsService) ListIncidents(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ListIncidentsRequest],
) (*connect.Response[servicerpcv1.ListIncidentsResponse], error) {
	resp, err := s.Incident.ListIncidents(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// GetIncident is a thin RPC method over the incident.GetIncident domain method
// (plan 09h/1c). Its REST predecessor (GET .../incidents/{n}) was deleted in the same
// slice, so this is the only transport for reading a single incident. The domain
// function already authorizes from ctx claims and speaks Connect errors, so this just
// delegates.
func (s ImsService) GetIncident(
	ctx context.Context,
	req *connect.Request[servicerpcv1.GetIncidentRequest],
) (*connect.Response[servicerpcv1.GetIncidentResponse], error) {
	resp, err := s.Incident.GetIncident(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// CreateIncident is a thin RPC method over the incident.CreateIncident domain method
// (plan 09h/1c). Its REST predecessor (POST .../incidents) was deleted in the same slice,
// so this is the only transport for creating an incident. The domain method authorizes
// from ctx claims and speaks Connect errors, so this just delegates; it carries the shared
// EventSourcerer / Pusher / MetricsCache so the create fans out SSE + push and invalidates
// the dashboard exactly as REST did.
func (s ImsService) CreateIncident(
	ctx context.Context,
	req *connect.Request[servicerpcv1.CreateIncidentRequest],
) (*connect.Response[servicerpcv1.CreateIncidentResponse], error) {
	resp, err := s.Incident.CreateIncident(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// UpdateIncident is a thin RPC method over the incident.UpdateIncident domain method
// (plan 09h/1c). Its REST predecessor (POST .../incidents/{n}) was deleted in the same
// slice. The domain method authorizes from ctx claims and speaks Connect errors, so
// this just delegates; it carries the shared EventSourcerer / Pusher / MetricsCache so
// the write fans out SSE + push and invalidates the dashboard exactly as REST did.
func (s ImsService) UpdateIncident(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UpdateIncidentRequest],
) (*connect.Response[servicerpcv1.UpdateIncidentResponse], error) {
	resp, err := s.Incident.UpdateIncident(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// GetReport is a thin RPC method over the incident.GetReport domain method (plan 09h/1c,
// reports). Its REST predecessor (GET .../reports/{n}) was deleted in the same slice, so this
// is the only transport for reading a single field report. The domain method authorizes from
// ctx claims and speaks Connect errors, so this just delegates.
func (s ImsService) GetReport(
	ctx context.Context,
	req *connect.Request[servicerpcv1.GetReportRequest],
) (*connect.Response[servicerpcv1.GetReportResponse], error) {
	resp, err := s.Incident.GetReport(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// ListReports is a thin RPC method over the incident.ListReports domain method (plan 09h/1c,
// reports). Its REST predecessor (GET .../reports) was deleted in the same slice, so this is
// the only transport for listing an event's field reports. The domain method authorizes from
// ctx claims and speaks Connect errors, so this just delegates.
func (s ImsService) ListReports(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ListReportsRequest],
) (*connect.Response[servicerpcv1.ListReportsResponse], error) {
	resp, err := s.Incident.ListReports(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// CreateReport is a thin RPC method over the incident.CreateReport domain method (plan 09h/1c,
// reports). Its REST predecessor (POST .../reports) was deleted in the same slice, so this is the
// only transport for creating a field report. The domain method authorizes from ctx claims and
// speaks Connect errors, so this just delegates.
func (s ImsService) CreateReport(
	ctx context.Context,
	req *connect.Request[servicerpcv1.CreateReportRequest],
) (*connect.Response[servicerpcv1.CreateReportResponse], error) {
	resp, err := s.Incident.CreateReport(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// UpdateReport is a thin RPC method over the incident.UpdateReport domain method (plan 09h/1c,
// reports). Its REST predecessor (POST .../reports/{n}) was deleted in the same slice, so this is
// the only transport for editing a field report's summary, journal, and incident link. The domain
// method authorizes from ctx claims and speaks Connect errors, so this just delegates.
func (s ImsService) UpdateReport(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UpdateReportRequest],
) (*connect.Response[servicerpcv1.UpdateReportResponse], error) {
	resp, err := s.Incident.UpdateReport(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// UpdateReportJournalEntry is a thin RPC method over the incident.UpdateReportJournalEntry domain
// method (plan 09h/1c, reports). Its REST predecessor (POST .../reports/{n}/journal_entries/{id})
// was deleted in the same slice, so this is the only transport for striking a report's journal
// entry. The domain method authorizes from ctx claims and speaks Connect errors, so this just
// delegates.
func (s ImsService) UpdateReportJournalEntry(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UpdateReportJournalEntryRequest],
) (*connect.Response[servicerpcv1.UpdateReportJournalEntryResponse], error) {
	resp, err := s.Incident.UpdateReportJournalEntry(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// AttachPersonToIncident is a thin RPC method over the incident.AttachPersonToIncident domain
// method (plan 09h/1c). Its REST predecessor (POST .../incidents/{n}/people/{personId}) was deleted
// in the same slice, so this is the only transport for attaching a person to an incident (or
// editing their involvement / access grant). The domain method authorizes from ctx claims and
// speaks Connect errors, so this just delegates; it carries the shared EventSourcerer / Pusher so
// the write fans out SSE + push exactly as REST did.
func (s ImsService) AttachPersonToIncident(
	ctx context.Context,
	req *connect.Request[servicerpcv1.AttachPersonToIncidentRequest],
) (*connect.Response[servicerpcv1.AttachPersonToIncidentResponse], error) {
	resp, err := s.Incident.AttachPersonToIncident(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// DetachPersonFromIncident is a thin RPC method over the incident.DetachPersonFromIncident domain
// method (plan 09h/1c). Its REST predecessor (DELETE .../incidents/{n}/people/{personId}) was
// deleted in the same slice, so this is the only transport for removing a person from an incident.
// The domain method authorizes from ctx claims and speaks Connect errors, so this just delegates.
func (s ImsService) DetachPersonFromIncident(
	ctx context.Context,
	req *connect.Request[servicerpcv1.DetachPersonFromIncidentRequest],
) (*connect.Response[servicerpcv1.DetachPersonFromIncidentResponse], error) {
	resp, err := s.Incident.DetachPersonFromIncident(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// UpdateIncidentJournalEntry is a thin RPC method over the incident.UpdateIncidentJournalEntry
// domain method (plan 09h/1c). Its REST predecessor (POST
// .../incidents/{n}/journal_entries/{id}) was deleted in the same slice, so this is the only
// transport for striking an incident's journal entry. The domain method authorizes from ctx claims
// and speaks Connect errors, so this just delegates.
func (s ImsService) UpdateIncidentJournalEntry(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UpdateIncidentJournalEntryRequest],
) (*connect.Response[servicerpcv1.UpdateIncidentJournalEntryResponse], error) {
	resp, err := s.Incident.UpdateIncidentJournalEntry(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// GetAuthStatus is the one RPC implemented end-to-end in slice 1b, to prove the
// interceptor spine through the generated client. It answers the identity subset
// of the whoami purely from the caller's JWT claims, which the auth interceptor
// (server.NewAuthInterceptor) populated into the context — so a green test here
// proves auth plumbs through Connect exactly as OptionalAuthN does over REST.
//
// The viewer-derived remainder — can_manage_personnel, per-event event_access,
// push_vapid_public_key, using_default_password — needs the config and a DB
// round-trip and lands with the rest of the auth domain in slice 1d; it is
// deliberately left zero-valued here, not forgotten.
func (ImsService) GetAuthStatus(
	ctx context.Context,
	_ *connect.Request[servicerpcv1.GetAuthStatusRequest],
) (*connect.Response[servicerpcv1.GetAuthStatusResponse], error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return connect.NewResponse(&servicerpcv1.GetAuthStatusResponse{Authenticated: false}), nil
	}
	return connect.NewResponse(&servicerpcv1.GetAuthStatusResponse{
		Authenticated: true,
		User:          claims.PersonHandle(),
		PersonId:      claims.PersonID(),
		Admin:         claims.PersonAdmin(),
	}), nil
}

// AddConnectToMux registers the ImsService Connect handler on the shared mux
// next to AddToMux (plan 09g). connect handlers are plain http.Handlers mounted
// at a path prefix, so the RPC surface coexists with the REST/web routes on one
// http.ServeMux with no second server (proven in the 1a Step-0 spike). The whole
// cross-cutting chain (server.Interceptors) is attached once here and applies to
// every RPC — request id, auth, slog, action log, protovalidate — so unlike the
// per-route REST middleware there is no flag to omit (M9).
func AddConnectToMux(
	mux *http.ServeMux,
	cfg *conf.IMSConfig,
	imsDBQ *store.DBQ,
	actionLogger server.ActionLogger,
	userStore directory.UserStore,
	es *server.EventSourcerer,
	metricsCache *server.MetricsCache,
	pushSender pushlib.Sender,
) *http.ServeMux {
	if mux == nil {
		mux = http.NewServeMux()
	}
	jwter := authz.JWTer{SecretKey: cfg.Core.JWTSecret}
	interceptors := server.Interceptors(jwter, actionLogger, userStore, server.NewValidateInterceptor())
	attachmentsEnabled := cfg.AttachmentsStore.Type != conf.AttachmentsStoreNone
	// Pusher is stateless (store + send backend), so a Connect-side instance built from
	// the same sender fans out identically to the REST one; a nil sender is the no-op
	// backend (push unconfigured), matching AddToMux.
	if pushSender == nil {
		pushSender = pushlib.NoopSender{}
	}
	pusher := server.NewPusher(imsDBQ, pushSender)
	path, handler := servicev1connect.NewImsServiceHandler(
		ImsService{
			Event: event.Service{ImsDBQ: imsDBQ, UserStore: userStore},
			Incident: incident.Service{
				ImsDBQ:             imsDBQ,
				UserStore:          userStore,
				Es:                 es,
				Pusher:             pusher,
				Metrics:            metricsCache,
				AttachmentsEnabled: attachmentsEnabled,
			},
		},
		connect.WithInterceptors(interceptors...),
	)
	mux.Handle(path, handler)
	return mux
}
