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

package person

// minPasswordLength is the minimum length for a password set via the personnel/self-service
// endpoints. maxPasswordLength bounds it to avoid a hashing-exhaustion vector (a very long
// password forces an expensive argon2 hash). Seed/demo passwords are inserted via SQL, not these
// endpoints, so these do not constrain them.
const (
	minPasswordLength = 8
	maxPasswordLength = 256
)

// The SetPersonPassword REST handler (POST /personnel/{personId}/password — the admin reset) and
// the self-service SetOwnPassword (POST /auth/password) were RETIRED in slice 1c: the reset moved
// onto Connect as person.Service.SetPersonPassword (connect_admin.go), and the self-service change
// as person.Service.ChangeOwnPassword (connect.go). Both REST routes were deleted, not shimmed
// (aggressive migration, plan 09 §6). The reset stays gated on the delegatable
// GlobalAdministratePersonnel (a future roles model can grant it to crew leaders).

// SetPersonPasswordRequest is kept as the integration-test bridge type: the api/integration
// setPersonPassword / setPersonPasswordDefault helpers still build it and convert it to the proto
// request.
type SetPersonPasswordRequest struct {
	// #nosec G117 // Exported secret field
	Password string `json:"password"`
	// UseDefaultPassword resets the person to the server's shared default password instead of a
	// typed one. When set, Password is ignored; a 400 results if no default is configured.
	UseDefaultPassword bool `json:"use_default_password"`
}
