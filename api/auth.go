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
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/lib/authn"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

type authError string

func (e authError) Error() string {
	return string(e)
}

const (
	ErrLongPassword = authError("rejected very long password")
)

type PostAuth struct {
	imsDBQ               *store.DBQ
	userStore            directory.UserStore
	jwtSecret            string
	accessTokenDuration  time.Duration
	refreshTokenDuration time.Duration
}

type PostAuthRequest struct {
	Identification string `json:"identification"`
	// #nosec G117 // Exported secret field
	Password string `json:"password"`
}
type PostAuthResponse struct {
	Token         string `json:"token"`
	ExpiresUnixMs int64  `json:"expires_unix_ms"`
}

func (action PostAuth) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, cookie, errHTTP := action.postAuth(req)
	if errHTTP != nil {
		errHTTP.From("[postAuth]").WriteResponse(w)
		return
	}
	http.SetCookie(w, cookie)
	mustWriteJSON(w, req, resp)
}
func (action PostAuth) postAuth(req *http.Request) (PostAuthResponse, *http.Cookie, *herr.HTTPError) {
	// This endpoint is unauthenticated (doesn't require an Authorization header)
	// as the point of this is to take a username and password to create a new JWT.
	var empty PostAuthResponse

	vals, errHTTP := readBodyAs[PostAuthRequest](req)
	if errHTTP != nil {
		return empty, nil, errHTTP.From("[readBodyAs]")
	}

	people, err := action.userStore.GetAllUsers(req.Context())
	if err != nil {
		return empty, nil, herr.InternalServerError("Failed to fetch personnel", err).From("[GetPeople]")
	}
	// Login matches EMAIL only. The fair name (handle) is a non-unique display
	// callsign and is never accepted as a login identifier (feedback round 9).
	var matchedPerson *directory.User
	for _, person := range people {
		if person.Email != "" && strings.EqualFold(person.Email, vals.Identification) {
			matchedPerson = person
			break
		}
	}

	// See https://instatunnel.my/blog/the-1mb-password-crashing-backends-via-hashing-exhaustion
	if len(vals.Password) > 256 {
		return empty, nil, herr.BadRequest(
			"Outrageously long passwords are disallowed",
			ErrLongPassword,
		)
	}

	if matchedPerson == nil {
		// Run Verify against some dummy hashed password.
		// We want to avoid timing attacks, where the client could know
		// the username is invalid because the login attempt is fast, so
		// we force a password verification even if no one matched.
		_, _ = authn.Verify(vals.Password, "$argon2id$v=19$m=8192,t=4,p=1$Ke9wio+D+PfBYlVzJ3CTAA$/kNb/yXgSLyFpfmwIfwKwcNnBRRrUqJp8YXPtDKfNTE")
		return empty, nil, herr.Unauthorized(
			"Failed login attempt (bad credentials)",
			fmt.Errorf("login attempt for nonexistent user. Identification: %v", vals.Identification),
		)
	}

	correct, err := authn.Verify(vals.Password, matchedPerson.Password)
	if err != nil {
		return empty, nil, herr.InternalServerError("Invalid stored password. Get in touch with the tech team.", err).From("[Verify]")
	}
	if !correct {
		return empty, nil, herr.Unauthorized(
			"Failed login attempt (bad credentials)",
			fmt.Errorf("bad password for valid user. Identification: %v", vals.Identification),
		)
	}

	slog.Info("Successful login for person", "identification", matchedPerson.Handle)

	accessTokenExpiration := time.Now().Add(action.accessTokenDuration)
	jwt, err := authz.JWTer{SecretKey: action.jwtSecret}.
		CreateAccessToken(
			matchedPerson.Handle,
			matchedPerson.ID,
			matchedPerson.PositionIDs,
			matchedPerson.TeamIDs,
			matchedPerson.IsAdmin,
			matchedPerson.OnDutyPositionID,
			accessTokenExpiration,
		)
	if err != nil {
		return empty, nil, herr.InternalServerError("Failed to create access token", err).From("[CreateAccessToken]")
	}

	suggestedRefreshTime := accessTokenExpiration.Add(authz.SuggestedEarlyAccessTokenRefresh).UnixMilli()
	resp := PostAuthResponse{Token: jwt, ExpiresUnixMs: suggestedRefreshTime}

	// The refresh token should be valid much longer than the access token.
	refreshTokenExpiration := time.Now().Add(action.refreshTokenDuration)
	refreshToken, err := authz.JWTer{SecretKey: action.jwtSecret}.
		CreateRefreshToken(matchedPerson.Handle, matchedPerson.ID, refreshTokenExpiration)
	if err != nil {
		return empty, nil, herr.InternalServerError("Failed to create refresh token", err).From("[CreateRefreshToken]")
	}

	refreshCookie := &http.Cookie{
		Name:     authz.RefreshTokenCookieName,
		Value:    refreshToken,
		Path:     "/",
		MaxAge:   int(action.refreshTokenDuration.Milliseconds() / 1000),
		HttpOnly: true,
		Secure:   true,
		// We only ever read this cookie on POSTs to the refresh endpoint,
		// so strict is fine.
		SameSite: http.SameSiteStrictMode,
	}

	return resp, refreshCookie, nil
}

type GetAuth struct {
	imsDBQ             *store.DBQ
	userStore          directory.UserStore
	jwtSecret          string
	attachmentsEnabled bool
	// pushVAPIDPublicKey is the web-push public key (plan 84), surfaced to the
	// client so it can subscribe. Empty ⇒ push is unconfigured and the client
	// hides the feature.
	pushVAPIDPublicKey string
	// defaultPassword is the shared default password (plaintext, conf DefaultPassword),
	// used to flag a user still signed in with it so the client can prompt a change.
	// Empty ⇒ no default configured, so the flag is never set.
	defaultPassword string
}

type GetAuthResponse struct {
	Authenticated bool   `json:"authenticated"`
	User          string `json:"user,omitzero"`
	// PersonID is the signed-in user's own PERSON.ID (the JWT subject). The client
	// uses it to open its own profile card ("Edit Profile") and to decide when a
	// card being viewed is the viewer's own (so it may show self-edit controls).
	PersonID int64 `json:"person_id,omitzero"`
	Admin    bool  `json:"admin"`
	// CanManagePersonnel reports whether the user holds GlobalAdministratePersonnel
	// (e.g. may set/reset another person's password). Drives UI gating; the endpoints
	// themselves remain the authoritative check.
	CanManagePersonnel bool                      `json:"canManagePersonnel"`
	EventAccess        map[string]AccessForEvent `json:"event_access"`
	// PushVAPIDPublicKey is the web-push public key (plan 84). Present only when
	// the server has push configured; the client uses it to subscribe and treats
	// its absence as "push unavailable".
	PushVAPIDPublicKey string `json:"pushVapidPublicKey,omitzero"`
	// UsingDefaultPassword is true when the signed-in user's stored password is
	// still the shared default (IMS_DEFAULT_PASSWORD). The client uses it to
	// prompt them to set their own password. It self-clears once they do.
	UsingDefaultPassword bool `json:"using_default_password"`
}

type AccessForEvent struct {
	EventID        int32 `json:"event_id"`
	ReadIncidents  bool  `json:"readIncidents"`
	WriteIncidents bool  `json:"writeIncidents"`
	WriteReports   bool  `json:"writeReports"`
	ReadVisits     bool  `json:"readVisits"`
	WriteVisits    bool  `json:"writeVisits"`
	AttachFiles    bool  `json:"attachFiles"`
	// ReadAreas is true when the caller may view this event's areas. Held by
	// reporters and up (a rung below incident read), so it gates the read-only
	// Areas nav/page separately from the incident/write flags.
	ReadAreas bool `json:"readAreas"`
	// ReadIncidentsViaGrant (52f) is true when the caller lacks event-wide incident
	// read but has at least one per-incident grant in this event. It reveals the
	// Incidents nav/list (filtered to granted incidents) for an involved reporter,
	// without flipping ReadIncidents (which gates write controls elsewhere).
	ReadIncidentsViaGrant bool `json:"readIncidentsViaGrant"`
	// InviteReporters (53a) is true when the caller may invite reporters to this
	// event — create a login-capable reporter and set reporter participation. Held
	// by writers and crew leaders (and admins). Reveals the People tab + invite UI.
	InviteReporters bool `json:"inviteReporters"`
}

func (action GetAuth) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.getAuth(req)
	if errHTTP != nil {
		errHTTP.From("[getAuth]").WriteResponse(w)
		return
	}
	mustWriteJSON(w, req, resp)
}
func (action GetAuth) getAuth(req *http.Request) (GetAuthResponse, *herr.HTTPError) {
	resp := GetAuthResponse{}

	// This endpoint is unauthenticated (doesn't require an Authorization header).
	jwtCtx, found := req.Context().Value(JWTContextKey).(JWTContext)
	if !found || jwtCtx.Error != nil || jwtCtx.Claims == nil {
		resp = GetAuthResponse{
			Authenticated: false,
		}
		return resp, nil //lint:ignore nilerr since the jwtCtx.Error is irrelevant
	}
	claims := jwtCtx.Claims
	handle := claims.PersonHandle()
	// Compute global permissions via the shared path so UI-gating flags stay in step
	// with the authoritative endpoint checks (and with any future non-admin grants).
	_, globalPermissions, err := authz.EventPermissions(req.Context(), nil, action.imsDBQ, *claims)
	if err != nil {
		return resp, herr.InternalServerError("Failed to fetch permissions", err).From("[EventPermissions]")
	}
	resp = GetAuthResponse{
		Authenticated:      true,
		User:               handle,
		PersonID:           int64(claims.PersonID()),
		Admin:              claims.PersonAdmin(),
		CanManagePersonnel: globalPermissions&authz.GlobalAdministratePersonnel != 0,
		PushVAPIDPublicKey: action.pushVAPIDPublicKey,
	}
	// Flag a user still signed in with the shared default password so the client can
	// prompt them to change it. To keep this cheap, we only run the argon2 verify for
	// a user whose PASSWORD_CHANGED flag is still false ("may be on the default"); once
	// a user is known to be off it (either a password write recorded it, or the check
	// below records it the first time), we skip the verify entirely. So it costs at
	// most one argon2 per user, not one per page load. Only meaningful when a default
	// is configured.
	if action.defaultPassword != "" {
		// GetAllUsers returns the cached directory map keyed by PERSON.ID, so index
		// the caller directly by id rather than scanning every user.
		people, err := action.userStore.GetAllUsers(req.Context())
		if err != nil {
			return resp, herr.InternalServerError("Failed to fetch personnel", err).From("[GetAllUsers]")
		}
		if person, ok := people[int64(claims.PersonID())]; ok && !person.PasswordChanged && person.Password != "" {
			// Verify the configured default against the user's stored hash — so it
			// catches every user on the default regardless of how their hash was
			// salted. A malformed/incompatible hash simply isn't the default (false).
			match, _ := authn.Verify(action.defaultPassword, person.Password)
			resp.UsingDefaultPassword = match
			if !match {
				// Off the default but not yet recorded (a pre-existing row, or a
				// password set outside the tracked paths). Persist it so we never
				// verify this user again. Best-effort: a failure just re-verifies next
				// time, so don't fail the auth check over it.
				err := action.imsDBQ.MarkPasswordChanged(req.Context(), action.imsDBQ, claims.PersonID())
				if err != nil {
					// #nosec G706 // log injection
					slog.Warn("Failed to record password-changed flag", "person_id", claims.PersonID(), "err", err)
				} else {
					action.userStore.InvalidateUsers()
				}
			}
		}
	}
	// event_id is an optional query param for this endpoint
	eventName := req.FormValue("event_id")
	if eventName != "" {
		event, errHTTP := getEvent(req, eventName, action.imsDBQ)
		if errHTTP != nil {
			if errHTTP.Code != http.StatusNotFound {
				return resp, errHTTP.From("[getEvent]")
			} else {
				// We don't want to return a 404 if the event doesn't exist.
				// Just make it look like the event might exist, but that the
				// user has no access.
				resp.EventAccess = map[string]AccessForEvent{
					eventName: {
						ReadIncidents:  false,
						WriteIncidents: false,
						WriteReports:   false,
						ReadVisits:     false,
						WriteVisits:    false,
						AttachFiles:    false,
					},
				}
				return resp, nil
			}
		}

		eventPermissions, _, err := authz.EventPermissions(req.Context(), &event.ID, action.imsDBQ, *claims)
		if err != nil {
			return resp, herr.InternalServerError("Failed to fetch event permissions", err).From("[EventPermissions]")
		}

		readIncidents := eventPermissions[event.ID]&authz.EventReadIncidents != 0
		// 52f: surface "can reach the Incidents list via per-incident grants" only when
		// the caller doesn't already have event-wide incident read.
		readIncidentsViaGrant := false
		if !readIncidents {
			readIncidentsViaGrant, err = action.imsDBQ.PersonHasAnyGrantInEvent(req.Context(), action.imsDBQ,
				imsdb.PersonHasAnyGrantInEventParams{Event: event.ID, PersonID: claims.PersonID()})
			if err != nil {
				return resp, herr.InternalServerError("Failed to check incident grants", err).From("[PersonHasAnyGrantInEvent]")
			}
		}

		resp.EventAccess = map[string]AccessForEvent{
			eventName: {
				EventID:               event.ID,
				ReadIncidents:         readIncidents,
				WriteIncidents:        eventPermissions[event.ID]&authz.EventWriteIncidents != 0,
				WriteReports:          eventPermissions[event.ID]&(authz.EventWriteOwnReports|authz.EventWriteAllReports) != 0,
				ReadVisits:            eventPermissions[event.ID]&authz.EventReadVisits != 0,
				WriteVisits:           eventPermissions[event.ID]&authz.EventWriteVisits != 0,
				AttachFiles:           action.attachmentsEnabled,
				ReadAreas:             eventPermissions[event.ID]&authz.EventReadAreas != 0,
				ReadIncidentsViaGrant: readIncidentsViaGrant,
				InviteReporters:       eventPermissions[event.ID]&authz.EventInviteReporters != 0,
			},
		}
	}
	return resp, nil
}

type RefreshAccessToken struct {
	imsDBQ              *store.DBQ
	userStore           directory.UserStore
	jwtSecret           string
	accessTokenDuration time.Duration
}

type RefreshAccessTokenResponse struct {
	Token         string `json:"token"`
	ExpiresUnixMs int64  `json:"expires_unix_ms"`
}

func (action RefreshAccessToken) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.refreshAccessToken(req)
	if errHTTP != nil {
		errHTTP.From("[refreshAccessToken]").WriteResponse(w)
		return
	}
	mustWriteJSON(w, req, resp)
}
func (action RefreshAccessToken) refreshAccessToken(req *http.Request) (RefreshAccessTokenResponse, *herr.HTTPError) {
	var empty RefreshAccessTokenResponse
	refreshCookie, err := req.Cookie(authz.RefreshTokenCookieName)
	if errors.Is(err, http.ErrNoCookie) {
		return empty, herr.Unauthorized("No refresh token cookie found", err).SetExpectedError().From("[Cookie]")
	}
	if err != nil {
		return empty, herr.Unauthorized("Bad refresh token cookie found", err).From("[Cookie]")
	}
	jwt, err := authz.JWTer{SecretKey: action.jwtSecret}.AuthenticateRefreshToken(refreshCookie.Value)
	if err != nil {
		return empty, herr.Unauthorized("Failed to authenticate refresh token", err).From("[AuthenticateRefreshToken]")
	}

	// #nosec G706 // log injection
	slog.Info("Refreshing access token", "person", jwt.PersonHandle())
	people, err := action.userStore.GetAllUsers(req.Context())
	if err != nil {
		return empty, herr.InternalServerError("Failed to fetch personnel", err).From("[GetPeople]")
	}
	var matchedPerson *directory.User
	for _, person := range people {
		if person.Handle == jwt.PersonHandle() && person.ID == int64(jwt.PersonID()) {
			matchedPerson = person
			break
		}
	}
	if matchedPerson == nil {
		return empty, herr.Unauthorized("User not found", nil)
	}
	accessTokenExpiration := time.Now().Add(action.accessTokenDuration)
	accessToken, err := authz.JWTer{SecretKey: action.jwtSecret}.
		CreateAccessToken(
			jwt.PersonHandle(),
			matchedPerson.ID,
			matchedPerson.PositionIDs,
			matchedPerson.TeamIDs,
			matchedPerson.IsAdmin,
			matchedPerson.OnDutyPositionID,
			accessTokenExpiration,
		)
	if err != nil {
		return empty, herr.InternalServerError("Failed to create access token", err).From("[CreateAccessToken]")
	}
	resp := RefreshAccessTokenResponse{
		Token:         accessToken,
		ExpiresUnixMs: accessTokenExpiration.Add(authz.SuggestedEarlyAccessTokenRefresh).UnixMilli(),
	}
	return resp, nil
}
