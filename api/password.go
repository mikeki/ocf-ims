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
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/mikeki/ocf-ims/directory"
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
	imsDBQ    *store.DBQ
	userStore directory.UserStore
}

type SetPersonPasswordRequest struct {
	// #nosec G117 // Exported secret field
	Password string `json:"password"`
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
	_, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return errHTTP.From("[getGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalAdministratePersonnel == 0 {
		return herr.Forbidden("The requestor does not have GlobalAdministratePersonnel permission", nil)
	}

	handle := req.PathValue("personHandle")
	if handle == "" {
		return herr.BadRequest("Empty person handle", nil)
	}

	body, errHTTP := readBodyAs[SetPersonPasswordRequest](req)
	if errHTTP != nil {
		return errHTTP.From("[readBodyAs]")
	}
	if len(body.Password) < minPasswordLength {
		return herr.BadRequest(fmt.Sprintf("Password must be at least %d characters", minPasswordLength), nil)
	}
	// See the note in postAuth: very long passwords are a hashing-exhaustion vector.
	if len(body.Password) > 256 {
		return herr.BadRequest("Outrageously long passwords are disallowed", ErrLongPassword)
	}

	// Resolve the handle (addressed in the URL path) to a local person_id. Use 404
	// rather than 400 since the handle identifies the resource.
	users, err := action.userStore.GetAllUsers(req.Context())
	if err != nil {
		return herr.InternalServerError("Failed to fetch personnel", err).From("[GetAllUsers]")
	}
	var personID int32
	found := false
	for _, u := range users {
		if strings.EqualFold(u.Handle, handle) {
			personID = int32(u.ID)
			found = true
			break
		}
	}
	if !found {
		return herr.NotFound("Unknown person: "+handle, nil)
	}

	hashed := argon2id.CreateHash(body.Password, argon2id.DefaultParams)
	err = action.imsDBQ.SetPersonPassword(req.Context(), action.imsDBQ, imsdb.SetPersonPasswordParams{
		Password: conv.StringToSql(&hashed, 255),
		ID:       personID,
	})
	if err != nil {
		return herr.InternalServerError("Failed to set password", err).From("[SetPersonPassword]")
	}

	// Login reads users from a cached store, so drop the cache to make the new
	// password effective immediately (and stop the old one from working).
	action.userStore.InvalidateUsers()

	// #nosec G706 // log injection
	slog.Info("Password set for person", "handle", handle)
	return nil
}
