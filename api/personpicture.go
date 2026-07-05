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
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"image"
	"image/color"
	_ "image/gif" // register GIF decoder for image.Decode
	"image/jpeg"  // JPEG decoder + encoder (resize output)
	_ "image/png" // register PNG decoder for image.Decode
	"io"
	"log/slog"
	"mime"
	"net/http"
	"slices"
	"time"

	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/lib/attachment"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/format"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
	xdraw "golang.org/x/image/draw"
)

// personProfilePictureURL is the serve endpoint for a person's profile picture. It's
// stored on the JSON person payload (personnelByID) so the client knows both that a
// picture exists and where to fetch it.
func personProfilePictureURL(personID int32) string {
	return fmt.Sprintf("/ims/api/personnel/%d/picture", personID)
}

// profilePictureMediaTypes is the set of content types accepted for a profile
// picture: the image subset of the attachment safe-preview allow-list
// (safeToPreviewMediaTypes). SVG is deliberately excluded — it can carry script and
// the picture is previewed inline in our origin (the same XSS reasoning as
// safeToPreviewContentType).
var profilePictureMediaTypes = []string{
	"image/gif",
	"image/heic",
	"image/jpeg",
	"image/png",
	"image/tiff",
	"image/webp",
}

// maxProfilePictureEdge bounds the longest side of a stored profile picture (px). A
// profile card renders at ~12rem; 512 leaves headroom for high-DPI without storing
// full-resolution photos.
const maxProfilePictureEdge = 512

// resizeProfilePicture decodes an image and, when it exceeds maxEdge on either side,
// returns JPEG bytes scaled to fit within maxEdge (aspect preserved). It returns
// ok=false — after rewinding fi to the start so the original can be stored unchanged —
// when the image is already within bounds or can't be decoded here. Only the standard
// library's JPEG/PNG/GIF decoders are registered: WebP/TIFF (whose x/image decoders
// carry known CVEs) and HEIC (no cgo-free decoder) are left to the browser-side
// downscale, which re-encodes them to JPEG before upload — so the bytes that reach
// this backstop for those formats are already JPEG (or stored as-is on a client that
// couldn't process them).
func resizeProfilePicture(fi io.ReadSeeker, maxEdge int) ([]byte, bool) {
	rewind := func() { _, _ = fi.Seek(0, io.SeekStart) }
	rewind()
	img, _, err := image.Decode(fi)
	if err != nil {
		rewind()
		return nil, false
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= maxEdge && h <= maxEdge {
		rewind()
		return nil, false
	}
	var nw, nh int
	if w >= h {
		nw, nh = maxEdge, max(1, h*maxEdge/w)
	} else {
		nw, nh = max(1, w*maxEdge/h), maxEdge
	}
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	// White backdrop so a source with transparency doesn't flatten to black in JPEG.
	xdraw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, xdraw.Src)
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, b, xdraw.Over, nil)
	var buf bytes.Buffer
	err = jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 85})
	if err != nil {
		rewind()
		return nil, false
	}
	return buf.Bytes(), true
}

type SetPersonProfilePicture struct {
	imsDBQ           *store.DBQ
	userStore        directory.UserStore
	attachmentsStore conf.AttachmentsStore
	s3Client         *attachment.S3Client
}

type GetPersonProfilePicture struct {
	imsDBQ           *store.DBQ
	userStore        directory.UserStore
	attachmentsStore conf.AttachmentsStore
	s3Client         *attachment.S3Client
}

type DeletePersonProfilePicture struct {
	imsDBQ           *store.DBQ
	userStore        directory.UserStore
	attachmentsStore conf.AttachmentsStore
	s3Client         *attachment.S3Client
}

func (action SetPersonProfilePicture) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.setPersonProfilePicture(req)
	if errHTTP != nil {
		errHTTP.From("[setPersonProfilePicture]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Saved profile picture")
}

func (action SetPersonProfilePicture) setPersonProfilePicture(req *http.Request) *herr.HTTPError {
	// Upload rights mirror the person-edit endpoint exactly: admin-only
	// (GlobalAdministratePersonnel). Changing someone's picture is changing their
	// profile, and profile edits are admin-only (EditPerson).
	jwtCtx, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return errHTTP.From("[getGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalAdministratePersonnel == 0 {
		return herr.Forbidden("The requestor does not have GlobalAdministratePersonnel permission", nil)
	}
	ctx := req.Context()

	person, errHTTP := personByIDFromPath(ctx, action.imsDBQ, req)
	if errHTTP != nil {
		return errHTTP
	}

	return storeProfilePicture(ctx, action.attachmentsStore, action.s3Client, action.imsDBQ,
		req, person.ID, jwtCtx.Claims.PersonHandle())
}

// storeProfilePicture parses the uploaded multipart image, validates it against the
// profile-picture allow-list, saves the bytes to the attachments backend, and points
// the person at the new file. It is the shared core of the admin upload
// (SetPersonProfilePicture, path-addressed) and the self-service upload
// (SetOwnProfilePicture, JWT-addressed); the caller enforces authorization and
// resolves personID. Any prior file is left in the backend (orphaned but harmless) —
// physical cleanup is deferred, see the plan/PR notes.
func storeProfilePicture(
	ctx context.Context, attachmentsStore conf.AttachmentsStore, s3Client *attachment.S3Client,
	imsDBQ *store.DBQ, req *http.Request, personID int32, actorHandle string,
) *herr.HTTPError {
	// this must match the key sent by the client (shared with the attachment uploads)
	fi, fiHead, err := req.FormFile(IMSAttachmentFormKey)
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return herr.RequestEntityTooLarge(fmt.Sprintf("The supplied file is above the server limit of %v", format.HumanByteSize(mbe.Limit)), err)
		}
		return herr.BadRequest("Failed to parse file", err)
	}
	defer shut(fi)

	mtype, errHTTP := sniffFile(fi)
	if errHTTP != nil {
		return errHTTP.From("[sniffFile]")
	}
	mediaType, _, _ := mime.ParseMediaType(mtype.String())
	if !slices.Contains(profilePictureMediaTypes, mediaType) {
		return herr.BadRequest(fmt.Sprintf("A profile picture must be an image (got %v)", mtype.String()), nil)
	}

	// Bound the stored size. The browser already downscales most uploads before
	// sending (see downscaleImageForUpload), but re-cap here as a backstop for
	// anything decodable in pure Go. Undecodable formats (notably HEIC) and
	// already-small images fall through and are stored as uploaded.
	saveReader, ext := io.Reader(fi), mtype.Extension()
	if resized, ok := resizeProfilePicture(fi, maxProfilePictureEdge); ok {
		saveReader, ext = bytes.NewReader(resized), ".jpg"
	}

	newFileName := fmt.Sprintf("person_%05d_%v%v", personID, rand.Text(), ext)
	// #nosec G706 // log injection
	slog.Info("User uploaded a profile picture",
		"user", actorHandle,
		"personID", personID,
		"originalName", fiHead.Filename,
		"newFileName", newFileName,
		"size", fiHead.Size,
		"contentType", mtype.String(),
	)

	errHTTP = saveFile(ctx, attachmentsStore, s3Client, newFileName, saveReader)
	if errHTTP != nil {
		return errHTTP.From("[saveFile]")
	}

	err = imsDBQ.SetPersonProfilePicture(ctx, imsDBQ, imsdb.SetPersonProfilePictureParams{
		ProfilePicture: sql.NullString{String: newFileName, Valid: true},
		ID:             personID,
	})
	if err != nil {
		return herr.InternalServerError("Failed to save profile picture", err).From("[SetPersonProfilePicture]")
	}
	return nil
}

func (action GetPersonProfilePicture) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	file, contentType, errHTTP := action.getPersonProfilePicture(req)
	if errHTTP != nil {
		errHTTP.From("[getPersonProfilePicture]").WriteResponse(w)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", contentDisposition(contentType))
	http.ServeContent(w, req, "Profile Picture", time.Now(), file)
}

func (action GetPersonProfilePicture) getPersonProfilePicture(
	req *http.Request,
) (fi io.ReadSeeker, contentType string, errHTTP *herr.HTTPError) {
	// Viewing a picture matches viewing the profile card: any personnel reader
	// (GlobalReadPersonnel), the same gate personnelByID uses. Not admin-gated — a
	// face helps identify people; it isn't contact PII like email/phone.
	_, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[getGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalReadPersonnel == 0 {
		return nil, "", herr.Forbidden("The requestor does not have GlobalReadPersonnel permission", nil)
	}
	ctx := req.Context()

	person, errHTTP := personByIDFromPath(ctx, action.imsDBQ, req)
	if errHTTP != nil {
		return nil, "", errHTTP
	}

	// retrieveFile returns a friendly 404 when the name is empty (no picture set).
	file, errHTTP := retrieveFile(ctx, action.attachmentsStore, action.s3Client, person.ProfilePicture.String)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[retrieveFile]")
	}

	mtype, errHTTP := sniffFile(file)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[sniffFile]")
	}
	// Only ever stored images, but sanitize the served type the same way attachments
	// do (unknown/unsafe → octet-stream, forced to download) as defense in depth.
	contentType = safeToPreviewContentType(mtype.String())

	return file, contentType, nil
}

func (action DeletePersonProfilePicture) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.deletePersonProfilePicture(req)
	if errHTTP != nil {
		errHTTP.From("[deletePersonProfilePicture]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Removed profile picture")
}

func (action DeletePersonProfilePicture) deletePersonProfilePicture(req *http.Request) *herr.HTTPError {
	// Same admin-only gate as upload/edit.
	_, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return errHTTP.From("[getGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalAdministratePersonnel == 0 {
		return herr.Forbidden("The requestor does not have GlobalAdministratePersonnel permission", nil)
	}
	ctx := req.Context()

	person, errHTTP := personByIDFromPath(ctx, action.imsDBQ, req)
	if errHTTP != nil {
		return errHTTP
	}

	return clearProfilePicture(ctx, action.imsDBQ, person.ID)
}

// clearProfilePicture clears a person's profile-picture pointer. Shared by the admin
// remove (DeletePersonProfilePicture) and the self-service remove
// (DeleteOwnProfilePicture); the caller enforces authorization and resolves personID.
// The backing file (if any) is left in the backend (harmless orphan) — physical
// cleanup is deferred, see the plan/PR notes.
func clearProfilePicture(ctx context.Context, imsDBQ *store.DBQ, personID int32) *herr.HTTPError {
	err := imsDBQ.SetPersonProfilePicture(ctx, imsDBQ, imsdb.SetPersonProfilePictureParams{
		ProfilePicture: sql.NullString{},
		ID:             personID,
	})
	if err != nil {
		return herr.InternalServerError("Failed to remove profile picture", err).From("[SetPersonProfilePicture]")
	}
	return nil
}
