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
	"log/slog"
	"net/http"
	"strings"

	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// SetPersonAdmin sets or clears another person's local IS_ADMIN flag. Like
// SetPersonPassword it is gated on GlobalAdministratePersonnel rather than a
// hardcoded admin check, so a future roles model can grant it to non-admin crew
// leaders without touching this handler. The IMS_ADMINS environment list is a
// separate bootstrap path and is not affected by this endpoint.
type SetPersonAdmin struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
	imsAdmins []string
}

type SetPersonAdminRequest struct {
	IsAdmin bool `json:"is_admin"`
}

func (action SetPersonAdmin) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.setPersonAdmin(req)
	if errHTTP != nil {
		errHTTP.From("[setPersonAdmin]").WriteResponse(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (action SetPersonAdmin) setPersonAdmin(req *http.Request) *herr.HTTPError {
	_, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore, action.imsAdmins)
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

	body, errHTTP := readBodyAs[SetPersonAdminRequest](req)
	if errHTTP != nil {
		return errHTTP.From("[readBodyAs]")
	}

	// Resolve the handle (addressed in the URL path) to a local person. Use 404
	// rather than 400 since the handle identifies the resource.
	users, err := action.userStore.GetAllUsers(req.Context())
	if err != nil {
		return herr.InternalServerError("Failed to fetch personnel", err).From("[GetAllUsers]")
	}
	var target *directory.User
	for _, u := range users {
		if strings.EqualFold(u.Handle, handle) {
			target = u
			break
		}
	}
	if target == nil {
		return herr.NotFound("Unknown person: "+handle, nil)
	}

	// Guard against removing the last flagged administrator, which would leave the
	// instance with no in-app admin (recoverable only via the IMS_ADMINS bootstrap).
	// Clearing a non-admin, or one of several admins, is fine.
	if !body.IsAdmin && target.IsAdmin {
		adminCount, err := action.imsDBQ.CountAdmins(req.Context(), action.imsDBQ)
		if err != nil {
			return herr.InternalServerError("Failed to count administrators", err).From("[CountAdmins]")
		}
		if adminCount <= 1 {
			return herr.Conflict("Cannot remove the last administrator", nil)
		}
	}

	err = action.imsDBQ.SetPersonAdmin(req.Context(), action.imsDBQ, imsdb.SetPersonAdminParams{
		IsAdmin: body.IsAdmin,
		ID:      int32(target.ID),
	})
	if err != nil {
		return herr.InternalServerError("Failed to set admin flag", err).From("[SetPersonAdmin]")
	}

	// Permissions are read from a cached store and baked into access tokens, so
	// drop the cache to make the change effective on the next token refresh.
	action.userStore.InvalidateUsers()

	// #nosec G706 // log injection
	slog.Info("Admin flag set for person", "handle", handle, "is_admin", body.IsAdmin)
	return nil
}
