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
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/directory"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/authn"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Service is the auth & session domain's Connect surface: it holds the dependencies the
// auth RPCs share so each RPC is a method rather than a free function with a long
// per-call dependency list. It mirrors event.Service / incident.Service / person.Service
// (plan 09h/1c). api.ImsService composes one of these (built once in AddConnectToMux) and
// delegates to it. It carries GetAuthStatus (the whoami / session status) plus the session
// mutations Login and RefreshToken. AttachmentsEnabled / PushVAPIDPublicKey / DefaultPassword
// feed GetAuthStatus's derived flags; JwtSecret / the token durations / LoginLimiter drive
// Login and RefreshToken.
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
	// JwtSecret signs and verifies the access and refresh tokens Login and RefreshToken mint.
	JwtSecret string
	// AccessTokenDuration / RefreshTokenDuration are the token lifetimes (conf Core). The
	// refresh token outlives the access token; the refresh cookie's Max-Age is derived from
	// RefreshTokenDuration.
	AccessTokenDuration  time.Duration
	RefreshTokenDuration time.Duration
	// LoginLimiter throttles failed/excess login attempts (plan 90). Built once in
	// AddConnectToMux; a nil limiter disables throttling (the Allow / Record calls are skipped).
	LoginLimiter *server.LoginRateLimiter
}

const (
	// maxLoginPasswordLen bounds the password we will hash on login. Anything longer is a
	// malformed request, not a credential attempt (an unbounded password is an argon2
	// hash-exhaustion DoS vector — see
	// https://instatunnel.my/blog/the-1mb-password-crashing-backends-via-hashing-exhaustion).
	maxLoginPasswordLen = 256
	// dummyPasswordHash is verified against when no user matches, so a login for a
	// nonexistent account costs the same argon2 time as a real one (no username-enumeration
	// timing side channel). It is not a credential — nothing's password is this hash.
	// #nosec G101 // fixed dummy argon2 hash used only to equalize verify timing
	dummyPasswordHash = "$argon2id$v=19$m=8192,t=4,p=1$Ke9wio+D+PfBYlVzJ3CTAA$/kNb/yXgSLyFpfmwIfwKwcNnBRRrUqJp8YXPtDKfNTE"
)

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

// Login is the domain method behind the Login RPC — it authenticates an email + password
// and issues an access token (in the response) plus a refresh token (returned as the
// HttpOnly cookie the caller sets on the HTTP response). The REST POST /ims/api/auth
// endpoint was RETIRED with this extraction, not shimmed (migration decision, plan 09 §6).
// It ports the REST postAuth verbatim, folding in what the REST ThrottleLogin middleware did:
// the plan-90 rate-limit check runs inline here, before the argon2 verify, keyed on the
// client IP and the lowercased email. clientIP is supplied by the transport (the delegate
// derives it from the forwarded headers / peer) so this method stays HTTP-agnostic. The
// endpoint is unauthenticated: the interceptor spine populates claims when a token is
// present but never rejects, and Login ignores any caller identity.
func (s Service) Login(
	ctx context.Context,
	req *rpcv1.LoginRequest,
	clientIP string,
) (*rpcv1.LoginResponse, *http.Cookie, error) {
	email := req.GetEmail()
	ipKey := "ip:" + clientIP
	idKey := "id:" + strings.ToLower(email)

	// Shed excess/failed attempts before the (expensive, mutex-serialised) argon2 verify
	// runs — the enforcement the REST ThrottleLogin adapter used to do, now inline.
	if s.LoginLimiter != nil {
		for _, key := range []string{ipKey, idKey} {
			if ok, retryAfter := s.LoginLimiter.Allow(key); !ok {
				return nil, nil, loginThrottledError(retryAfter)
			}
		}
	}

	people, err := s.UserStore.GetAllUsers(ctx)
	if err != nil {
		return nil, nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch personnel: %w", err))
	}
	// Login matches EMAIL only (feedback round 9): the fair name (handle) is a non-unique
	// display callsign and is never accepted as a login identifier.
	var matched *directory.User
	for _, person := range people {
		if person.Email != "" && strings.EqualFold(person.Email, email) {
			matched = person
			break
		}
	}

	// Reject an outrageously long password before hashing. This is a malformed request, not
	// a failed credential, so — as under the REST throttle, which only counted 401s — it is
	// NOT recorded against the limiter.
	if len(req.GetPassword()) > maxLoginPasswordLen {
		return nil, nil, connect.NewError(connect.CodeInvalidArgument, ErrLongPassword)
	}

	if matched == nil {
		// Force a verify against a dummy hash so a nonexistent user costs the same time as a
		// real one (defeats username-enumeration timing).
		_, _ = authn.Verify(req.GetPassword(), dummyPasswordHash)
		s.recordLoginFailure(ipKey, idKey)
		return nil, nil, badCredentialsError()
	}

	correct, err := authn.Verify(req.GetPassword(), matched.Password)
	if err != nil {
		return nil, nil, connect.NewError(connect.CodeInternal,
			fmt.Errorf("invalid stored password (get in touch with the tech team): %w", err))
	}
	if !correct {
		s.recordLoginFailure(ipKey, idKey)
		return nil, nil, badCredentialsError()
	}

	// #nosec G706 // log injection
	slog.Info("Successful login for person", "handle", matched.Handle)
	s.recordLoginSuccess(ipKey, idKey)

	jwter := authz.JWTer{SecretKey: s.JwtSecret}
	accessExpiry := time.Now().Add(s.AccessTokenDuration)
	accessToken, err := jwter.CreateAccessToken(
		matched.Handle, matched.ID, matched.PositionIDs, matched.IsAdmin, matched.OnDutyPositionID, accessExpiry)
	if err != nil {
		return nil, nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create access token: %w", err))
	}
	// The refresh token outlives the access token so the client can silently renew.
	refreshToken, err := jwter.CreateRefreshToken(matched.Handle, matched.ID, time.Now().Add(s.RefreshTokenDuration))
	if err != nil {
		return nil, nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create refresh token: %w", err))
	}
	resp := &rpcv1.LoginResponse{
		Token:     accessToken,
		ExpiresAt: timestamppb.New(accessExpiry.Add(authz.SuggestedEarlyAccessTokenRefresh)),
	}
	return resp, newRefreshCookie(refreshToken, s.RefreshTokenDuration), nil
}

// RefreshToken is the domain method behind the RefreshToken RPC — it exchanges a valid
// refresh token for a fresh access token. The REST POST /ims/api/auth/refresh endpoint was
// RETIRED with this extraction, not shimmed (migration decision, plan 09 §6). The token
// rides in the HttpOnly cookie; the transport reads it from the request headers and passes
// its value in (empty ⇒ no cookie present). This ports the REST refreshAccessToken verbatim.
// It performs no persistent state change, which is why the contract marks it NO_SIDE_EFFECTS
// (the action-log interceptor skips it, matching the REST route's LogRequest(false)).
func (s Service) RefreshToken(
	ctx context.Context,
	_ *rpcv1.RefreshTokenRequest,
	refreshToken string,
) (*rpcv1.RefreshTokenResponse, error) {
	if refreshToken == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("no refresh token cookie found"))
	}
	claims, err := authz.JWTer{SecretKey: s.JwtSecret}.AuthenticateRefreshToken(refreshToken)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("failed to authenticate refresh token: %w", err))
	}

	// #nosec G706 // log injection
	slog.Info("Refreshing access token", "handle", claims.PersonHandle())
	people, err := s.UserStore.GetAllUsers(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch personnel: %w", err))
	}
	var matched *directory.User
	for _, person := range people {
		if person.Handle == claims.PersonHandle() && person.ID == int64(claims.PersonID()) {
			matched = person
			break
		}
	}
	if matched == nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("user not found"))
	}

	accessExpiry := time.Now().Add(s.AccessTokenDuration)
	accessToken, err := authz.JWTer{SecretKey: s.JwtSecret}.CreateAccessToken(
		claims.PersonHandle(), matched.ID, matched.PositionIDs, matched.IsAdmin, matched.OnDutyPositionID, accessExpiry)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create access token: %w", err))
	}
	return &rpcv1.RefreshTokenResponse{
		Token:     accessToken,
		ExpiresAt: timestamppb.New(accessExpiry.Add(authz.SuggestedEarlyAccessTokenRefresh)),
	}, nil
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

// recordLoginFailure counts a failed login against both the per-IP and per-account keys, so a
// single host hammering many accounts trips the IP key while a distributed guess against one
// account trips the id key. A nil limiter (throttling disabled) makes this a no-op.
func (s Service) recordLoginFailure(ipKey, idKey string) {
	if s.LoginLimiter == nil {
		return
	}
	s.LoginLimiter.RecordFailure(ipKey)
	s.LoginLimiter.RecordFailure(idKey)
}

// recordLoginSuccess clears the failure history on both keys, so a successful login resets the
// counters immediately. A nil limiter (throttling disabled) makes this a no-op.
func (s Service) recordLoginSuccess(ipKey, idKey string) {
	if s.LoginLimiter == nil {
		return
	}
	s.LoginLimiter.RecordSuccess(ipKey)
	s.LoginLimiter.RecordSuccess(idKey)
}

// badCredentialsError is the single client-facing answer for every failed login (unknown user
// or wrong password) — deliberately identical so the response never reveals which accounts
// exist. The message carries "bad credentials"; the internal reason is not disclosed.
func badCredentialsError() error {
	return connect.NewError(connect.CodeUnauthenticated, errors.New("failed login attempt (bad credentials)"))
}

// loginThrottledError builds the ResourceExhausted error a throttled login returns, carrying a
// Retry-After (whole seconds, minimum 1) in the error metadata so the transport surfaces it as
// the Retry-After response header — the Connect analogue of the REST 429 + Retry-After.
func loginThrottledError(retryAfter time.Duration) error {
	secs := max(int(math.Ceil(retryAfter.Seconds())), 1)
	err := connect.NewError(connect.CodeResourceExhausted,
		errors.New("too many failed login attempts, please wait and try again"))
	err.Meta().Set("Retry-After", strconv.Itoa(secs))
	return err
}

// newRefreshCookie builds the HttpOnly, Secure, SameSite=Strict refresh-token cookie. It is
// read back only on the RefreshToken RPC, so Strict is fine. Max-Age tracks the refresh-token
// lifetime.
func newRefreshCookie(token string, ttl time.Duration) *http.Cookie {
	return &http.Cookie{
		Name:     authz.RefreshTokenCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(ttl.Milliseconds() / 1000),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	}
}
