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
	"database/sql"
	"errors"
	"log/slog"
	"net/http"

	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/directory"
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
// self-service analogue of personByIDFromPath (which addresses a person by URL id).
func resolveSelf(req *http.Request, imsDBQ *store.DBQ) (imsdb.PersonByIDRow, *herr.HTTPError) {
	jwtCtx, errHTTP := getJwtCtx(req)
	if errHTTP != nil {
		return imsdb.PersonByIDRow{}, errHTTP.From("[getJwtCtx]")
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

// SetOwnProfileRequest carries the caller's editable identity/contact fields. As with
// EditPersonRequest, each is a pointer so nil ("field omitted, leave unchanged") is
// distinct from "" (clear). Participation, the admin flag, and the password are not
// here — they are not self-editable.
type SetOwnProfileRequest struct {
	Handle *string `json:"handle"`
	Name   *string `json:"name"`
	Email  *string `json:"email"`
	Phone  *string `json:"phone"`
}

// SetOwnProfile lets an authenticated user change THEIR OWN identity/contact fields.
// Resolved from the JWT, no admin permission required (RequireAuthN gates the route).
type SetOwnProfile struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
}

func (action SetOwnProfile) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.setOwnProfile(req)
	if errHTTP != nil {
		errHTTP.From("[setOwnProfile]").WriteResponse(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (action SetOwnProfile) setOwnProfile(req *http.Request) *herr.HTTPError {
	person, errHTTP := resolveSelf(req, action.imsDBQ)
	if errHTTP != nil {
		return errHTTP
	}

	body, errHTTP := readBodyAs[SetOwnProfileRequest](req)
	if errHTTP != nil {
		return errHTTP.From("[readBodyAs]")
	}

	// Same validation and write as the admin path (identity invariant, "email required
	// if you can sign in", length caps, dup-entry conflict) — just no participation.
	errHTTP = applyProfileFields(req.Context(), action.imsDBQ, person,
		body.Handle, body.Name, body.Email, body.Phone)
	if errHTTP != nil {
		return errHTTP
	}

	action.userStore.InvalidateUsers()

	slog.Info("Profile edited by self", "person_id", person.ID)
	return nil
}

// SetOwnProfilePicture lets an authenticated user upload/replace THEIR OWN profile
// picture. Resolved from the JWT; no admin permission required.
type SetOwnProfilePicture struct {
	imsDBQ           *store.DBQ
	attachmentsStore conf.AttachmentsStore
	s3Client         *attachment.S3Client
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
	person, errHTTP := resolveSelf(req, action.imsDBQ)
	if errHTTP != nil {
		return errHTTP
	}
	// #nosec G706 // handle is not logged here; PersonHandle is a display handle
	return storeProfilePicture(req.Context(), action.attachmentsStore, action.s3Client,
		action.imsDBQ, req, person.ID, person.ProfilePicture.String, person.Handle.String)
}

// DeleteOwnProfilePicture lets an authenticated user remove THEIR OWN profile picture.
type DeleteOwnProfilePicture struct {
	imsDBQ           *store.DBQ
	attachmentsStore conf.AttachmentsStore
	s3Client         *attachment.S3Client
}

func (action DeleteOwnProfilePicture) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.deleteOwnProfilePicture(req)
	if errHTTP != nil {
		errHTTP.From("[deleteOwnProfilePicture]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Removed profile picture")
}

func (action DeleteOwnProfilePicture) deleteOwnProfilePicture(req *http.Request) *herr.HTTPError {
	person, errHTTP := resolveSelf(req, action.imsDBQ)
	if errHTTP != nil {
		return errHTTP
	}
	return clearProfilePicture(req.Context(), action.attachmentsStore, action.s3Client,
		action.imsDBQ, person.ID, person.ProfilePicture.String)
}
