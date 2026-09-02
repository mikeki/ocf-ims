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

// The auth & session HTTP handlers (POST /ims/api/auth login, POST /ims/api/auth/refresh,
// GET /ims/api/auth whoami) were RETIRED in slice 1c when the surface moved onto Connect as
// auth.Service.Login / RefreshToken / GetAuthStatus (connect.go), which the ImsService RPC
// methods delegate to. Their REST routes were deleted, not shimmed (aggressive migration, plan
// 09 §6). The plan-90 login throttle went with Login (the ThrottleLogin middleware retired; the
// limiter now drives the Login domain method).
//
// What remains here is deliberately kept:
//   - ErrLongPassword: the sentinel for an over-long password, also referenced by the person
//     package's password paths.
//   - The request/response DTO structs (PostAuthRequest / PostAuthResponse /
//     RefreshAccessTokenResponse / GetAuthResponse / AccessForEvent): the integration suite
//     still asserts against these shapes, with the test helpers mapping each RPC's proto
//     response back into them — the same bridging role imsjson types play for other resources.

type authError string

func (e authError) Error() string {
	return string(e)
}

const (
	ErrLongPassword = authError("rejected very long password")
)

// PostAuthRequest mirrors the login request body. Identification is matched against
// PERSON.EMAIL (the contract's LoginRequest.email; the fair name/handle is not a login id).
type PostAuthRequest struct {
	Identification string `json:"identification"`
	// #nosec G117 // Exported secret field
	Password string `json:"password"`
}

// PostAuthResponse mirrors the login response body (the contract's LoginResponse).
type PostAuthResponse struct {
	Token         string `json:"token"`
	ExpiresUnixMs int64  `json:"expires_unix_ms"`
}

// GetAuthResponse is the whoami / session status shape (the contract's GetAuthStatusResponse).

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

// RefreshAccessTokenResponse mirrors the refresh response body (the contract's
// RefreshTokenResponse).
type RefreshAccessTokenResponse struct {
	Token         string `json:"token"`
	ExpiresUnixMs int64  `json:"expires_unix_ms"`
}
