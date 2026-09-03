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
	"database/sql"
	"errors"
	"net/http"

	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/attachment"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// This file holds the self-service profile endpoints under /ims/api/auth/*: an
// authenticated user editing their OWN profile and profile picture. They mirror the
// self-service password change (SetOwnPassword): the target is resolved from the
// caller's JWT rather than a path id, and no admin permission is required — you may
// always edit yourself. Per-event participation and the admin flag are deliberately
// NOT self-editable (participation tier drives permissions); those stay on the
// admin-only EditPerson / personnel endpoints.

// resolveSelf loads the caller's own PERSON row from their JWT subject. It is the
// self-service analogue of server.PersonByIDFromPath (which addresses a person by URL id).
func resolveSelf(req *http.Request, imsDBQ *store.DBQ) (imsdb.PersonByIDRow, *herr.HTTPError) {
	jwtCtx, errHTTP := server.GetJwtCtx(req)
	if errHTTP != nil {
		return imsdb.PersonByIDRow{}, errHTTP.From("[server.GetJwtCtx]")
	}
	personID := jwtCtx.Claims.PersonID()
	person, err := imsDBQ.PersonByID(req.Context(), imsDBQ, personID)
	if errors.Is(err, sql.ErrNoRows) {
		return imsdb.PersonByIDRow{}, herr.NotFound("Unknown person", nil)
	}
	if err != nil {
		return imsdb.PersonByIDRow{}, herr.InternalServerError("Failed to load person", err).From("[PersonByID]")
	}
	return person, nil
}

// SetOwnProfile (REST POST /ims/api/auth/profile — the self-service identity/contact edit) and
// DeleteOwnProfilePicture (REST DELETE /ims/api/auth/picture) were RETIRED in slice 1c when they
// moved onto Connect as person.UpdateOwnProfile / person.DeleteOwnProfilePicture (connect.go),
// which the matching ImsService RPCs delegate to. Their REST routes were deleted, not shimmed
// (aggressive migration, plan 09 §6). The shared resolveSelf, applyProfileFields, and
// clearProfilePicture helpers are unchanged and still used from there. Only the picture *upload*
// (SetOwnProfilePicture, multipart) stays REST below.

// SetOwnProfilePicture lets an authenticated user upload/replace THEIR OWN profile
// picture. Resolved from the JWT; no admin permission required.
type SetOwnProfilePicture struct {
	ImsDBQ           *store.DBQ
	AttachmentsStore conf.AttachmentsStore
	S3Client         *attachment.S3Client
}

func (action SetOwnProfilePicture) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.setOwnProfilePicture(req)
	if errHTTP != nil {
		errHTTP.From("[setOwnProfilePicture]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Saved profile picture")
}

func (action SetOwnProfilePicture) setOwnProfilePicture(req *http.Request) *herr.HTTPError {
	person, errHTTP := resolveSelf(req, action.ImsDBQ)
	if errHTTP != nil {
		return errHTTP
	}
	// #nosec G706 // handle is not logged here; PersonHandle is a display handle
	return storeProfilePicture(req.Context(), action.AttachmentsStore, action.S3Client,
		action.ImsDBQ, req, person.ID, person.ProfilePicture.String, person.Handle.String)
}

// DeleteOwnProfilePicture (self-service picture remove) moved onto Connect in slice 1c — see the
// retirement note at the top of this file.
