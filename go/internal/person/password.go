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

import (
	"fmt"
	"log/slog"
	"net/http"

	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/internal/auth"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/argon2id"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// minPasswordLength is the minimum length for a password set via this endpoint.
// (The maximum is bounded in postAuth to avoid hashing-exhaustion.) Seed/demo
// passwords are inserted via SQL, not this endpoint, so this does not constrain them.
const minPasswordLength = 8

// SetPersonPassword sets (resets) another person's password. It is gated on the
// GlobalAdministratePersonnel permission rather than a hardcoded admin check: admins
// hold that permission today, and a future roles model can grant it to non-admin crew
// leaders without changing this handler. There is no self-service emailed reset yet —
// a locked-out user asks a crew leader or an admin to reset their password.
type SetPersonPassword struct {
	ImsDBQ    *store.DBQ
	UserStore directory.UserStore
	// defaultPassword is the optional shared default password (plaintext, from
	// conf.ConfigCore.DefaultPassword), used when a request opts into it
	// (UseDefaultPassword) to reset a person to the shared default (hashed per
	// user). Empty ⇒ unavailable.
	DefaultPassword string
}

type SetPersonPasswordRequest struct {
	// #nosec G117 // Exported secret field
	Password string `json:"password"`
	// UseDefaultPassword resets the person to the server's shared default password
	// (conf DefaultPassword) instead of a typed one. When set, Password is
	// ignored; a 400 results if no default is configured.
	UseDefaultPassword bool `json:"use_default_password"`
}

func (action SetPersonPassword) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.setPersonPassword(req)
	if errHTTP != nil {
		errHTTP.From("[setPersonPassword]").WriteResponse(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (action SetPersonPassword) setPersonPassword(req *http.Request) *herr.HTTPError {
	_, globalPermissions, errHTTP := server.GetGlobalPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return errHTTP.From("[server.GetGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalAdministratePersonnel == 0 {
		return herr.Forbidden("The requestor does not have GlobalAdministratePersonnel permission", nil)
	}

	body, errHTTP := server.ReadBodyAs[SetPersonPasswordRequest](req)
	if errHTTP != nil {
		return errHTTP.From("[server.ReadBodyAs]")
	}
	// Two paths: reset to the shared default or set a specific typed password. Either
	// way it is hashed per user below; validate the typed one against the same bounds
	// as the create/auth endpoints (see postAuth re: the hashing-exhaustion vector).
	if body.UseDefaultPassword {
		if action.DefaultPassword == "" {
			return herr.BadRequest("No default password is configured on this server; set a specific password instead", nil)
		}
	} else {
		if len(body.Password) < minPasswordLength {
			return herr.BadRequest(fmt.Sprintf("Password must be at least %d characters", minPasswordLength), nil)
		}
		if len(body.Password) > 256 {
			return herr.BadRequest("Outrageously long passwords are disallowed", auth.ErrLongPassword)
		}
	}

	// The person is addressed by stable ID in the URL path (registry people may
	// have no handle since 5e).
	person, errHTTP := server.PersonByIDFromPath(req.Context(), action.ImsDBQ, req)
	if errHTTP != nil {
		return errHTTP
	}

	// Login matches EMAIL only, so a password is useless without one. Refuse to set a
	// password for a person with no email — the email must be added first, otherwise
	// we'd store a credential the person could never actually use to sign in.
	if person.Email.String == "" {
		return herr.BadRequest("This person has no email; an email is the login identifier, so add one before setting a password", nil)
	}

	password := action.DefaultPassword
	if !body.UseDefaultPassword {
		password = body.Password
	}
	hashed := argon2id.CreateHash(password, argon2id.DefaultParams)
	// Record whether the new password is off the shared default, so GET /auth's
	// change-prompt can skip re-verifying this person (see MarkPasswordChanged).
	err := action.ImsDBQ.SetPersonPassword(req.Context(), action.ImsDBQ, imsdb.SetPersonPasswordParams{
		Password:        conv.StringToSql(&hashed, 255),
		PasswordChanged: action.DefaultPassword == "" || password != action.DefaultPassword,
		ID:              person.ID,
	})
	if err != nil {
		return herr.InternalServerError("Failed to set password", err).From("[SetPersonPassword]")
	}

	// Login reads users from a cached store, so drop the cache to make the new
	// password effective immediately (and stop the old one from working).
	action.UserStore.InvalidateUsers()

	// #nosec G706 // log injection
	slog.Info("Password set for person", "person_id", person.ID, "handle", person.Handle.String)
	return nil
}

// SetOwnPassword (REST POST /ims/api/auth/password — the self-service password change) was
// RETIRED in slice 1c when it moved onto Connect as person.ChangeOwnPassword (connect.go), which
// the ImsService.ChangeOwnPassword RPC delegates to. The REST route was deleted, not shimmed
// (aggressive migration, plan 09 §6). The admin SetPersonPassword handler below stays REST until
// the personnel slice.
