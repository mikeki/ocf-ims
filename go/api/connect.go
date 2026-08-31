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
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/authz"
)

// ImsService is the Connect implementation of the ocf.ims.service.v1.ImsService
// contract (plan 09, Phase 1). It sits beside AddToMux in this wiring package
// because — like AddToMux — it aggregates every domain: as each RPC lands in
// slice 1d its method becomes a thin shim over the matching internal/<domain>
// function, the same function its frozen REST handler calls (M13).
//
// SCAFFOLD (removed at the Phase-1 exit gate): the embedded
// UnimplementedImsServiceHandler satisfies the 60-method interface while the
// methods are filled in resource-by-resource across 1c/1d. The gate greps for
// this embedding, so it cannot be left in the shipped server; until then it is
// the idiomatic connect-go way to stand up a partial service. See plan 09g.
type ImsService struct {
	servicev1connect.UnimplementedImsServiceHandler
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
	actionLogger server.ActionLogger,
	userStore directory.UserStore,
) *http.ServeMux {
	if mux == nil {
		mux = http.NewServeMux()
	}
	jwter := authz.JWTer{SecretKey: cfg.Core.JWTSecret}
	interceptors := server.Interceptors(jwter, actionLogger, userStore, server.NewValidateInterceptor())
	path, handler := servicev1connect.NewImsServiceHandler(
		ImsService{},
		connect.WithInterceptors(interceptors...),
	)
	mux.Handle(path, handler)
	return mux
}
