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
// because — like AddToMux — it aggregates every domain: each method delegates to
// its internal/<domain> function. As a resource is extracted (1c/1d) its REST
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

	ImsDBQ    *store.DBQ
	UserStore directory.UserStore
	// AttachmentsEnabled mirrors the REST handlers' flag (cfg.AttachmentsStore.Type
	// != none): it gates whether a read surfaces journal-entry attachment metadata.
	AttachmentsEnabled bool
	// Es, Pusher, and Metrics back the incident-mutation RPCs (plan 09h/1c). Es and
	// Metrics are the SAME instances the REST surface uses (SSE subscribers and the
	// dashboard cache are shared state); Pusher is stateless, rebuilt from the same
	// send backend. All three are threaded in via AddConnectToMux.
	Es      *server.EventSourcerer
	Pusher  *server.Pusher
	Metrics *server.MetricsCache
}

// ListEvents is a thin RPC method over the event.ListEvents domain function (plan
// 09h/1c). Its REST predecessor (GET /events) was deleted in the same slice, so
// this is the only transport for listing events. The interceptor spine has already
// populated the caller's claims into ctx, so the method just delegates; the domain
// function already speaks Connect errors, so there is nothing to map.
func (s ImsService) ListEvents(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ListEventsRequest],
) (*connect.Response[servicerpcv1.ListEventsResponse], error) {
	resp, err := event.ListEvents(ctx, s.ImsDBQ, s.UserStore, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// ListIncidents is a thin RPC method over the incident.ListIncidents domain function
// (plan 09h/1c). Its REST predecessor (GET /events/{eventName}/incidents) was deleted in
// the same slice, so this is the only transport for listing an event's incidents. The
// domain function authorizes from ctx claims and speaks Connect errors, so this just
// delegates.
func (s ImsService) ListIncidents(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ListIncidentsRequest],
) (*connect.Response[servicerpcv1.ListIncidentsResponse], error) {
	resp, err := incident.ListIncidents(ctx, s.ImsDBQ, s.AttachmentsEnabled, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// GetIncident is a thin RPC method over the incident.GetIncident domain function
// (plan 09h/1c). Its REST predecessor (GET .../incidents/{n}) was deleted in the same
// slice, so this is the only transport for reading a single incident. The domain
// function already authorizes from ctx claims and speaks Connect errors, so this just
// delegates.
func (s ImsService) GetIncident(
	ctx context.Context,
	req *connect.Request[servicerpcv1.GetIncidentRequest],
) (*connect.Response[servicerpcv1.GetIncidentResponse], error) {
	resp, err := incident.GetIncident(ctx, s.ImsDBQ, s.UserStore, s.AttachmentsEnabled, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// UpdateIncident is a thin RPC method over the incident.UpdateIncident domain function
// (plan 09h/1c). Its REST predecessor (POST .../incidents/{n}) was deleted in the same
// slice. The domain function authorizes from ctx claims and speaks Connect errors, so
// this just delegates; it carries the shared EventSourcerer / Pusher / MetricsCache so
// the write fans out SSE + push and invalidates the dashboard exactly as REST did.
func (s ImsService) UpdateIncident(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UpdateIncidentRequest],
) (*connect.Response[servicerpcv1.UpdateIncidentResponse], error) {
	resp, err := incident.UpdateIncident(ctx, s.ImsDBQ, s.UserStore, s.Es, s.Pusher, s.Metrics, req.Msg)
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
			ImsDBQ:             imsDBQ,
			UserStore:          userStore,
			AttachmentsEnabled: attachmentsEnabled,
			Es:                 es,
			Pusher:             pusher,
			Metrics:            metricsCache,
		},
		connect.WithInterceptors(interceptors...),
	)
	mux.Handle(path, handler)
	return mux
}
