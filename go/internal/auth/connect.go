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

package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/directory"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/authn"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// Service is the auth & session domain's Connect surface: it holds the dependencies the
// auth RPCs share so each RPC is a method rather than a free function with a long
// per-call dependency list. It mirrors event.Service / incident.Service / person.Service
// (plan 09h/1c). api.ImsService composes one of these (built once in AddConnectToMux) and
// delegates to it. This slice moves GetAuthStatus (the whoami / session status) onto the
// Service and completes it (event_access, can_manage_personnel, push_vapid,
// using_default_password); Login and RefreshToken land as further methods on the same
// Service in the following slice. AttachmentsEnabled / PushVAPIDPublicKey / DefaultPassword
// only feed GetAuthStatus's derived flags.
type Service struct {
	ImsDBQ             *store.DBQ
	UserStore          directory.UserStore
	AttachmentsEnabled bool
	// PushVAPIDPublicKey is the web-push public key (plan 84), surfaced so the client can
	// subscribe. Empty ⇒ push unconfigured and the client hides the feature.
	PushVAPIDPublicKey string
	// DefaultPassword is the shared default password (plaintext, conf DefaultPassword), used
	// to flag a user still signed in with it so the client can prompt a change. Empty ⇒ no
	// default configured, so the flag is never set.
	DefaultPassword string
}

// GetAuthStatus is the domain method behind the GetAuthStatus RPC — the whoami / session
// status (plan 09h/1c). The REST GET /ims/api/auth endpoint was RETIRED with this
// extraction, not shimmed (migration decision, plan 09 §6). It ports the REST getAuth
// verbatim: the endpoint tolerates an anonymous caller (returns authenticated:false rather
// than an error — this is how the web client decides whether to show a login form), and for
// a signed-in caller it derives every field from the JWT claims the auth interceptor
// populated plus a permissions round-trip. Unlike the REST version — which took the event as
// a NAME query param and keyed the response by that name — the contract addresses the event
// by numeric id (event_access is keyed by event id), matching the rest of the migration.
func (s Service) GetAuthStatus(
	ctx context.Context,
	req *rpcv1.GetAuthStatusRequest,
) (*rpcv1.GetAuthStatusResponse, error) {
	// Anonymous is a normal answer here, not an error: the endpoint is populate-only auth
	// (server.NewAuthInterceptor never rejects), so a missing/invalid token just means "not
	// signed in".
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return &rpcv1.GetAuthStatusResponse{Authenticated: false}, nil
	}

	// Compute global permissions via the shared path so UI-gating flags stay in step with the
	// authoritative endpoint checks (and with any future non-admin grants).
	_, globalPermissions, err := authz.EventPermissions(ctx, nil, s.ImsDBQ, *claims)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch permissions: %w", err))
	}
	resp := &rpcv1.GetAuthStatusResponse{
		Authenticated:      true,
		User:               claims.PersonHandle(),
		PersonId:           claims.PersonID(),
		Admin:              claims.PersonAdmin(),
		CanManagePersonnel: globalPermissions&authz.GlobalAdministratePersonnel != 0,
		PushVapidPublicKey: s.PushVAPIDPublicKey,
	}

	usingDefault, err := s.usingDefaultPassword(ctx, *claims)
	if err != nil {
		return nil, err
	}
	resp.UsingDefaultPassword = usingDefault

	if req.EventId != nil {
		access, err := s.accessForEvent(ctx, *claims, req.GetEventId())
		if err != nil {
			return nil, err
		}
		resp.EventAccess = map[int32]*rpcv1.AccessForEvent{req.GetEventId(): access}
	}
	return resp, nil
}

// usingDefaultPassword reports whether the caller is still signed in with the shared default
// password, so the client can prompt them to change it. Ported verbatim from REST getAuth: to
// keep it cheap, the argon2 verify runs only for a user whose PASSWORD_CHANGED flag is still
// false ("may be on the default"); a user known to be off it is skipped, so it costs at most
// one argon2 per user, not one per call. When the check finds a user is actually off the
// default it records that (best-effort) so it never verifies them again. Only meaningful when a
// default is configured.
func (s Service) usingDefaultPassword(ctx context.Context, claims authz.IMSClaims) (bool, error) {
	if s.DefaultPassword == "" {
		return false, nil
	}
	people, err := s.UserStore.GetAllUsers(ctx)
	if err != nil {
		return false, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch personnel: %w", err))
	}
	person, ok := people[int64(claims.PersonID())]
	if !ok || person.PasswordChanged || person.Password == "" {
		return false, nil
	}
	// Verify the configured default against the user's stored hash — so it catches every user
	// on the default regardless of how their hash was salted. A malformed/incompatible hash
	// simply isn't the default (false).
	match, _ := authn.Verify(s.DefaultPassword, person.Password)
	if match {
		return true, nil
	}
	// Off the default but not yet recorded (a pre-existing row, or a password set outside the
	// tracked paths). Persist it so we never verify this user again. Best-effort: a failure just
	// re-verifies next time, so don't fail the auth check over it.
	err = s.ImsDBQ.MarkPasswordChanged(ctx, s.ImsDBQ, claims.PersonID())
	if err != nil {
		// #nosec G706 // log injection
		slog.Warn("Failed to record password-changed flag", "person_id", claims.PersonID(), "err", err)
	} else {
		s.UserStore.InvalidateUsers()
	}
	return false, nil
}

// accessForEvent computes the caller's per-event permission set for one event id. Ported from
// REST getAuth's event branch: a non-existent event is deliberately NOT a 404 — the REST
// endpoint returned an all-false entry so the caller can't distinguish "no such event" from "no
// access", and this preserves that (an all-false AccessForEvent with the requested id).
func (s Service) accessForEvent(ctx context.Context, claims authz.IMSClaims, eventID int32) (*rpcv1.AccessForEvent, error) {
	eventRow, err := s.ImsDBQ.Event(ctx, s.ImsDBQ, eventID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// Look like the event might exist, but that the caller has no access. Mirror REST
			// exactly: an all-false entry with no event id (0), not the requested id echoed back.
			return &rpcv1.AccessForEvent{}, nil
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch event: %w", err))
	}
	event := eventRow.Event

	eventPerms, _, err := authz.EventPermissions(ctx, &event.ID, s.ImsDBQ, claims)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch event permissions: %w", err))
	}
	perms := eventPerms[event.ID]

	readIncidents := perms&authz.EventReadIncidents != 0
	// 52f: surface "can reach the Incidents list via per-incident grants" only when the caller
	// doesn't already have event-wide incident read.
	readIncidentsViaGrant := false
	if !readIncidents {
		readIncidentsViaGrant, err = s.ImsDBQ.PersonHasAnyGrantInEvent(ctx, s.ImsDBQ,
			imsdb.PersonHasAnyGrantInEventParams{Event: event.ID, PersonID: claims.PersonID()})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to check incident grants: %w", err))
		}
	}

	return &rpcv1.AccessForEvent{
		EventId:               event.ID,
		ReadIncidents:         readIncidents,
		WriteIncidents:        perms&authz.EventWriteIncidents != 0,
		WriteReports:          perms&(authz.EventWriteOwnReports|authz.EventWriteAllReports) != 0,
		ReadVisits:            perms&authz.EventReadVisits != 0,
		WriteVisits:           perms&authz.EventWriteVisits != 0,
		AttachFiles:           s.AttachmentsEnabled,
		ReadAreas:             perms&authz.EventReadAreas != 0,
		ReadIncidentsViaGrant: readIncidentsViaGrant,
		InviteReporters:       perms&authz.EventInviteReporters != 0,
	}, nil
}
