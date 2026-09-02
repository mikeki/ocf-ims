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

package incident

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/gabriel-vasile/mimetype"
	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/attachment"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/format"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

const (
	IMSAttachmentFormKey = "imsAttachment"
	octetStream          = "application/octet-stream"
)

type GetIncidentAttachment struct {
	ImsDBQ           *store.DBQ
	UserStore        directory.UserStore
	AttachmentsStore conf.AttachmentsStore
	S3Client         *attachment.S3Client
}

type AttachToIncident struct {
	ImsDBQ             *store.DBQ
	UserStore          directory.UserStore
	Es                 *server.EventSourcerer
	AttachmentsStore   conf.AttachmentsStore
	S3Client           *attachment.S3Client
	MaxAttachmentBytes int64
}

type GetReportAttachment struct {
	ImsDBQ           *store.DBQ
	UserStore        directory.UserStore
	AttachmentsStore conf.AttachmentsStore
	S3Client         *attachment.S3Client
}

type AttachToReport struct {
	ImsDBQ             *store.DBQ
	UserStore          directory.UserStore
	Es                 *server.EventSourcerer
	AttachmentsStore   conf.AttachmentsStore
	S3Client           *attachment.S3Client
	MaxAttachmentBytes int64
}

type GetVisitAttachment struct {
	ImsDBQ           *store.DBQ
	UserStore        directory.UserStore
	AttachmentsStore conf.AttachmentsStore
	S3Client         *attachment.S3Client
}

type AttachToVisit struct {
	ImsDBQ             *store.DBQ
	UserStore          directory.UserStore
	Es                 *server.EventSourcerer
	AttachmentsStore   conf.AttachmentsStore
	S3Client           *attachment.S3Client
	MaxAttachmentBytes int64
}

func (action GetIncidentAttachment) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	file, contentType, errHTTP := action.getIncidentAttachment(req)
	if errHTTP != nil {
		errHTTP.From("[getIncidentAttachment]").WriteResponse(w)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", ContentDisposition(contentType))
	http.ServeContent(w, req, "Attached File", time.Now(), file)
}

func (action GetIncidentAttachment) getIncidentAttachment(
	req *http.Request,
) (fi io.ReadSeeker, contentType string, errHTTP *herr.HTTPError) {
	event, jwtCtx, eventPermissions, errHTTP := server.GetEventPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[server.GetEventPermissions]")
	}
	ctx := req.Context()

	incidentNumber, err := conv.ParseInt32(req.PathValue("incidentNumber"))
	if err != nil {
		return nil, "", herr.BadRequest("Failed to parse incident number", err).From("[ParseInt32]")
	}
	attachmentNumber, err := conv.ParseInt32(req.PathValue("attachmentNumber"))
	if err != nil {
		return nil, "", herr.BadRequest("Failed to parse attachment number", err).From("[ParseInt32]")
	}

	hasEventRead := eventPermissions&authz.EventReadIncidents != 0
	viewerPersonID := jwtCtx.Claims.PersonID()
	viewerIsAdmin := jwtCtx.Claims.PersonAdmin()

	// Mirror the incident read rules for attachment downloads: without event-wide
	// read, require a per-incident grant (52f), denied before the fetch so existence
	// isn't leaked.
	hasGrant := false
	if !hasEventRead {
		hasGrant, err = action.ImsDBQ.IncidentPersonHasGrant(ctx, action.ImsDBQ, imsdb.IncidentPersonHasGrantParams{
			Event: event.ID, IncidentNumber: incidentNumber, PersonID: viewerPersonID,
		})
		if err != nil {
			return nil, "", herr.InternalServerError("Failed to check incident grant", err).From("[IncidentPersonHasGrant]")
		}
		if !hasGrant {
			return nil, "", herr.Forbidden("The requestor does not have EventReadIncidents permission on this Event", nil)
		}
	}

	storedRow, _, errHTTP := fetchIncident(ctx, action.ImsDBQ, event.ID, incidentNumber, action.AttachmentsStore.Type != conf.AttachmentsStoreNone)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[fetchIncident]")
	}

	// A private incident's attachments are off-limits to event-wide readers who
	// aren't its creator, an admin, or a grant-holder; hide with 404.
	if storedRow.Incident.Private && !hasGrant && !viewerIsAdmin &&
		!(storedRow.Incident.CreatedBy.Valid && storedRow.Incident.CreatedBy.Int32 == viewerPersonID) {
		hasGrant, err = action.ImsDBQ.IncidentPersonHasGrant(ctx, action.ImsDBQ, imsdb.IncidentPersonHasGrantParams{
			Event: event.ID, IncidentNumber: incidentNumber, PersonID: viewerPersonID,
		})
		if err != nil {
			return nil, "", herr.InternalServerError("Failed to check incident grant", err).From("[IncidentPersonHasGrant]")
		}
		if !hasGrant {
			return nil, "", herr.NotFound("Incident not found", nil)
		}
	}

	// The internal attached-file name lives only on the stored row, not the JSON
	// view, so look it up from the raw journal-entry rows.
	journalEntryRows, err := action.ImsDBQ.Incident_JournalEntries(ctx, action.ImsDBQ, imsdb.Incident_JournalEntriesParams{
		Event:          event.ID,
		IncidentNumber: incidentNumber,
	})
	if err != nil {
		return nil, "", herr.InternalServerError("Failed to fetch journal entries", err).From("[Incident_JournalEntries]")
	}

	var filename string
	for _, row := range journalEntryRows {
		if row.JournalEntry.ID == attachmentNumber {
			filename = row.JournalEntry.AttachedFile.String
			break
		}
	}

	file, errHTTP := RetrieveFile(ctx, action.AttachmentsStore, action.S3Client, filename)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[RetrieveFile]")
	}

	mtype, errHTTP := SniffFile(file)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[SniffFile]")
	}
	contentType = SafeToPreviewContentType(mtype.String())

	return file, contentType, nil
}

var SafeToPreviewMediaTypes = []string{
	"application/pdf",
	"image/gif",
	"image/heic",
	"image/jpeg",
	"image/png",
	"image/tiff",
	"image/webp",
	"text/plain",
	"video/mp4",
	"video/x-msvideo",
}

// SafeToPreviewContentType returns a safe form of contentType if possible, or octetStream otherwise.
//
// This is important for the client side. For example, if we're serving an HTML document,
// we want the client to think it's just text/plain, so that it doesn't attempt to render it.
// SVG graphics are similarly a problem, since they can include scripting. The client
// previews these attachments in the same origin as IMS, which leaves us open to XSS attacks
// for unsafe files. This function works conservatively by returning octetStream unless we
// know the content type ought to be safe.
func SafeToPreviewContentType(contentType string) string {
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return octetStream
	}
	if slices.Contains(SafeToPreviewMediaTypes, mediaType) {
		return contentType
	}
	// Any Chromium browser won't play videos with video/quicktime media type (https://crbug.com/40714674),
	// but it will play those same videos if you use video/mp4 as the media type. This is technically incorrect,
	// but it works for Chromium browsers, and is also not a problem for Firefox or Safari.
	if mediaType == "video/quicktime" {
		return mime.FormatMediaType("video/mp4", nil)
	}
	if strings.HasPrefix(mediaType, "text/") {
		return mime.FormatMediaType("text/plain", params)
	}
	return mime.FormatMediaType(octetStream, nil)
}

func previewableContentType(contentType string) bool {
	return SafeToPreviewContentType(contentType) != octetStream
}

// ContentDisposition decides whether an attachment renders inline or is forced to
// download (plan 90 finding L4). Only the types we deem safe to preview render
// inline; everything else — including the octet-stream we downgrade unknown / HTML
// / SVG uploads to — is served as an "attachment" so the browser downloads it
// rather than rendering an untrusted file in our origin. Paired with the global
// X-Content-Type-Options: nosniff, this keeps a browser from sniffing a downgraded
// type back into something renderable. contentType here is the already-sanitized
// type from SafeToPreviewContentType.
func ContentDisposition(contentType string) string {
	if previewableContentType(contentType) {
		return "inline"
	}
	return "attachment"
}

func RetrieveFile(
	ctx context.Context, attachmentsStore conf.AttachmentsStore,
	s3Client *attachment.S3Client, filename string,
) (io.ReadSeeker, *herr.HTTPError) {
	if filename == "" {
		return nil, herr.NotFound("No attachment for this ID", nil)
	}
	var file io.ReadSeeker
	var err error
	var errHTTP *herr.HTTPError
	switch attachmentsStore.Type {
	case conf.AttachmentsStoreLocal:
		file, err = attachmentsStore.Local.Dir.Open(filename)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil, herr.NotFound("File does not exist", nil)
			}
			return nil, herr.InternalServerError("Failed to open file", err).From("[Open]")
		}
	case conf.AttachmentsStoreS3:
		file, errHTTP = mustGetS3File(ctx, s3Client, attachmentsStore.S3.Bucket, attachmentsStore.S3.CommonKeyPrefix, filename)
		if errHTTP != nil {
			return nil, errHTTP.From("[mustGetS3File]")
		}
	default:
		return nil, herr.NotFound("Attachments are not currently supported", nil)
	}
	return file, nil
}

func mustGetS3File(ctx context.Context, s3Client *attachment.S3Client, bucket, prefix, filename string) (io.ReadSeeker, *herr.HTTPError) {
	file, errHTTP := s3Client.GetObject(ctx, bucket, prefix+filename)
	if errHTTP != nil {
		return nil, errHTTP.From("[GetObject]")
	}
	return file, nil
}

func (action GetReportAttachment) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	file, contentType, errHTTP := action.getReportAttachment(req)
	if errHTTP != nil {
		errHTTP.From("[getReportAttachment]").WriteResponse(w)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", ContentDisposition(contentType))
	http.ServeContent(w, req, "Attached File", time.Now(), file)
}

func (action GetReportAttachment) getReportAttachment(
	req *http.Request,
) (fi io.ReadSeeker, contentType string, errHTTP *herr.HTTPError) {
	event, jwtCtx, eventPermissions, errHTTP := server.GetEventPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[server.GetEventPermissions]")
	}
	if eventPermissions&(authz.EventReadAllReports|authz.EventReadOwnReports) == 0 {
		return nil, "", herr.Forbidden("The requestor does not have permission to read Reports on this Event", nil)
	}
	// i.e. the user has EventReadOwnReports, but not EventReadAllReports
	limitedAccess := eventPermissions&authz.EventReadAllReports == 0

	ctx := req.Context()

	reportNumber, err := conv.ParseInt32(req.PathValue("reportNumber"))
	if err != nil {
		return nil, "", herr.BadRequest("Failed to parse Report number", err).From("[ParseInt32]")
	}
	attachmentNumber, err := conv.ParseInt32(req.PathValue("attachmentNumber"))
	if err != nil {
		return nil, "", herr.BadRequest("Failed to parse attachment number", err).From("[ParseInt32]")
	}

	_, journalEntries, errHTTP := fetchReport(ctx, action.ImsDBQ, event.ID, reportNumber, action.AttachmentsStore.Type != conf.AttachmentsStoreNone)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[fetchReport]")
	}

	if limitedAccess {
		if !containsAuthor(journalEntries, jwtCtx.Claims.PersonHandle()) {
			return nil, "", herr.Forbidden("The requestor does not have permission to read this particular Report", nil)
		}
	}

	// The internal attached-file name lives only on the stored row, not the JSON
	// view, so look it up from the raw journal-entry rows.
	journalEntryRows, err := action.ImsDBQ.Report_JournalEntries(ctx, action.ImsDBQ, imsdb.Report_JournalEntriesParams{
		Event:        event.ID,
		ReportNumber: reportNumber,
	})
	if err != nil {
		return nil, "", herr.InternalServerError("Failed to fetch journal entries", err).From("[Report_JournalEntries]")
	}
	var filename string
	for _, row := range journalEntryRows {
		if row.JournalEntry.ID == attachmentNumber {
			filename = row.JournalEntry.AttachedFile.String
			break
		}
	}

	file, errHTTP := RetrieveFile(ctx, action.AttachmentsStore, action.S3Client, filename)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[RetrieveFile]")
	}

	mtype, errHTTP := SniffFile(file)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[SniffFile]")
	}
	contentType = SafeToPreviewContentType(mtype.String())

	return file, contentType, nil
}

func (action AttachToIncident) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	reID, errHTTP := action.attachToIncident(req)
	if errHTTP != nil {
		errHTTP.From("[attachToIncident]").WriteResponse(w)
		return
	}
	slog.Info("Saved Incident attachment")
	w.Header().Set("IMS-Journal-Entry-Number", conv.FormatInt(reID))
	herr.WriteNoContentResponse(w, "Saved Incident attachment")
}

func (action AttachToIncident) attachToIncident(req *http.Request) (int32, *herr.HTTPError) {
	event, jwtCtx, eventPermissions, errHTTP := server.GetEventPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return 0, errHTTP.From("[server.GetEventPermissions]")
	}
	if eventPermissions&authz.EventWriteIncidents == 0 {
		return 0, herr.Forbidden("The requestor does not have EventWriteIncidents permission on this Event", nil)
	}
	ctx := req.Context()

	incidentNumber, err := conv.ParseInt32(req.PathValue("incidentNumber"))
	if err != nil {
		return 0, herr.BadRequest("Failed to parse incident number", err).From("[ParseInt32]")
	}

	// this must match the key sent by the client
	fi, fiHead, err := req.FormFile(IMSAttachmentFormKey)
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return 0, herr.RequestEntityTooLarge(fmt.Sprintf("The supplied file is above the server limit of %v", format.HumanByteSize(mbe.Limit)), err)
		}
		return 0, herr.BadRequest("Failed to parse file", err)
	}
	defer server.Shut(fi)

	errHTTP = checkAttachmentSize(fiHead, action.MaxAttachmentBytes)
	if errHTTP != nil {
		return 0, errHTTP.From("[checkAttachmentSize]")
	}

	mtype, errHTTP := SniffFile(fi)
	if errHTTP != nil {
		return 0, errHTTP.From("[SniffFile]")
	}

	newFileName := fmt.Sprintf("event_%05d_incident_%05d_%v%v", event.ID, incidentNumber, rand.Text(), mtype.Extension())
	// #nosec G706 // log injection
	slog.Info("User uploaded an incident attachment",
		"user", jwtCtx.Claims.PersonHandle(),
		"eventName", event.Name,
		"incidentNumber", incidentNumber,
		"originalName", fiHead.Filename,
		"newFileName", newFileName,
		"size", fiHead.Size,
		"contentType", mtype.String(),
		"extension", mtype.Extension(),
	)

	errHTTP = SaveFile(ctx, action.AttachmentsStore, action.S3Client, newFileName, fi)
	if errHTTP != nil {
		return 0, errHTTP.From("[SaveFile]")
	}

	reText := fmt.Sprintf("File Name: %v, Size: %v, Type:%v",
		fiHead.Filename, format.HumanByteSize(fiHead.Size), mtype.String())
	reID, errHTTP := addIncidentJournalEntry(
		ctx, action.ImsDBQ, action.ImsDBQ, event.ID, incidentNumber, jwtCtx.Claims.PersonID(),
		reText, false, newFileName, fiHead.Filename, mtype.String(),
	)
	if errHTTP != nil {
		return 0, errHTTP.From("[addIncidentJournalEntry]")
	}

	action.Es.NotifyIncidentUpdate(ctx, event.ID, incidentNumber)
	return reID, nil
}

// checkAttachmentSize rejects a journal-entry upload whose file exceeds the configured
// per-attachment cap (conf MaxAttachmentBytes / IMS_MAX_ATTACHMENT_SIZE). fiHead.Size is
// the multipart part's length as measured by the parser (not a client-declared header),
// so it's a reliable gate to apply before the bytes are sniffed or stored. The global
// server.LimitRequestBytes middleware is a coarser whole-request backstop; this gives a clear
// per-file error well below it.
func checkAttachmentSize(fiHead *multipart.FileHeader, maxBytes int64) *herr.HTTPError {
	if fiHead.Size > maxBytes {
		return herr.RequestEntityTooLarge(
			fmt.Sprintf("An attachment must be under %v (got %v)",
				format.HumanByteSize(maxBytes), format.HumanByteSize(fiHead.Size)), nil)
	}
	return nil
}

// SaveFile writes fi's bytes to the configured attachments backend under newFileName.
// fi is an io.Reader (not multipart.File) so callers can pass either the uploaded
// multipart file or an in-memory reader over transformed bytes (e.g. a resized
// profile picture).
func SaveFile(
	ctx context.Context, attachmentsStore conf.AttachmentsStore,
	s3Client *attachment.S3Client, newFileName string, fi io.Reader,
) *herr.HTTPError {
	switch attachmentsStore.Type {
	case conf.AttachmentsStoreLocal:
		outFi, err := attachmentsStore.Local.Dir.Create(newFileName)
		if err != nil {
			return herr.InternalServerError("Failed to create file", err).From("[Create]")
		}
		defer server.Shut(outFi)
		_, err = io.Copy(outFi, fi)
		if err != nil {
			return herr.InternalServerError("Failed to write file", err).From("[Copy]")
		}
	case conf.AttachmentsStoreS3:
		s3Name := attachmentsStore.S3.CommonKeyPrefix + newFileName
		errHTTP := s3Client.UploadToS3(ctx, attachmentsStore.S3.Bucket, s3Name, fi)
		if errHTTP != nil {
			return errHTTP.From("[UploadToS3]")
		}
	default:
		return herr.NotFound("Attachments are not currently supported", nil)
	}
	return nil
}

// DeleteFile best-effort removes filename from the configured attachments backend.
// A name that's empty or already gone is treated as success (idempotent). It is used
// to clean up a profile picture that has just been replaced or cleared; the DB pointer
// is updated first, so a deletion failure leaves at worst a harmless orphaned file —
// callers log it rather than fail the request.
func DeleteFile(
	ctx context.Context, attachmentsStore conf.AttachmentsStore,
	s3Client *attachment.S3Client, filename string,
) error {
	if filename == "" {
		return nil
	}
	switch attachmentsStore.Type {
	case conf.AttachmentsStoreLocal:
		err := attachmentsStore.Local.Dir.Remove(filename)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("[Remove]: %w", err)
		}
		return nil
	case conf.AttachmentsStoreS3:
		return s3Client.DeleteObject(ctx, attachmentsStore.S3.Bucket, attachmentsStore.S3.CommonKeyPrefix+filename)
	default:
		// No backend (noop) — nothing to delete.
		return nil
	}
}

func (action AttachToReport) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	reID, errHTTP := action.attachToReport(req)
	if errHTTP != nil {
		errHTTP.From("[attachToReport]").WriteResponse(w)
		return
	}
	slog.Info("Saved Report attachment")
	w.Header().Set("IMS-Journal-Entry-Number", conv.FormatInt(reID))
	herr.WriteNoContentResponse(w, "Saved Report attachment")
}
func (action AttachToReport) attachToReport(req *http.Request) (int32, *herr.HTTPError) {
	event, jwtCtx, eventPermissions, errHTTP := server.GetEventPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return 0, errHTTP.From("[server.GetEventPermissions]")
	}
	if eventPermissions&(authz.EventWriteAllReports|authz.EventWriteOwnReports) == 0 {
		return 0, herr.Forbidden("The requestor does not have permission to write Reports on this Event", nil)
	}
	// i.e. the user has EventReadOwnReports, but not EventReadAllReports
	limitedAccess := eventPermissions&authz.EventReadAllReports == 0
	ctx := req.Context()

	reportNumber, err := conv.ParseInt32(req.PathValue("reportNumber"))
	if err != nil {
		return 0, herr.BadRequest("Failed to parse Report number", err).From("[ParseInt32]")
	}

	report, entries, errHTTP := fetchReport(ctx, action.ImsDBQ, event.ID, reportNumber, action.AttachmentsStore.Type != conf.AttachmentsStoreNone)
	if errHTTP != nil {
		return 0, errHTTP.From("[fetchReport]")
	}
	if limitedAccess {
		if !containsAuthor(entries, jwtCtx.Claims.PersonHandle()) {
			return 0, herr.Forbidden("The requestor does not have permission to read this particular Report", nil)
		}
	}

	// this must match the key sent by the client
	fi, fiHead, err := req.FormFile(IMSAttachmentFormKey)
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return 0, herr.RequestEntityTooLarge(fmt.Sprintf("The supplied file is above the server limit of %v", format.HumanByteSize(mbe.Limit)), err)
		}
		return 0, herr.BadRequest("Failed to parse file", err)
	}
	defer server.Shut(fi)

	errHTTP = checkAttachmentSize(fiHead, action.MaxAttachmentBytes)
	if errHTTP != nil {
		return 0, errHTTP.From("[checkAttachmentSize]")
	}

	mtype, errHTTP := SniffFile(fi)
	if errHTTP != nil {
		return 0, errHTTP.From("[SniffFile]")
	}

	newFileName := fmt.Sprintf("event_%05d_report_%05d_%v%v", event.ID, reportNumber, rand.Text(), mtype.Extension())
	// #nosec G706 // log injection
	slog.Info("User uploaded a Report attachment",
		"user", jwtCtx.Claims.PersonHandle(),
		"eventName", event.Name,
		"reportNumber", reportNumber,
		"originalName", fiHead.Filename,
		"newFileName", newFileName,
		"size", fiHead.Size,
		"contentType", mtype.String(),
		"extension", mtype.Extension(),
	)

	errHTTP = SaveFile(ctx, action.AttachmentsStore, action.S3Client, newFileName, fi)
	if errHTTP != nil {
		return 0, errHTTP.From("[SaveFile]")
	}

	reText := fmt.Sprintf("File Name: %v, Size: %v, Type: %v",
		fiHead.Filename, format.HumanByteSize(fiHead.Size), mtype.String())
	reID, errHTTP := addJournalEntry(
		ctx, action.ImsDBQ, action.ImsDBQ, event.ID, reportNumber,
		jwtCtx.Claims.PersonID(), reText, false,
		newFileName, fiHead.Filename, mtype.String(),
		sql.NullInt32{},
	)
	if errHTTP != nil {
		return 0, errHTTP.From("[addJournalEntry]")
	}

	action.Es.NotifyReportUpdate(event.ID, reportNumber)
	if report.Report.IncidentNumber.Valid {
		action.Es.NotifyIncidentUpdate(ctx, event.ID, report.Report.IncidentNumber.Int32)
	}
	return reID, nil
}

func (action GetVisitAttachment) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	file, contentType, errHTTP := action.getVisitAttachment(req)
	if errHTTP != nil {
		errHTTP.From("[getVisitAttachment]").WriteResponse(w)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", ContentDisposition(contentType))
	http.ServeContent(w, req, "Attached File", time.Now(), file)
}

func (action GetVisitAttachment) getVisitAttachment(
	req *http.Request,
) (fi io.ReadSeeker, contentType string, errHTTP *herr.HTTPError) {
	event, _, eventPermissions, errHTTP := server.GetEventPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[server.GetEventPermissions]")
	}
	if eventPermissions&authz.EventReadVisits == 0 {
		return nil, "", herr.Forbidden("The requestor does not have EventReadVisits permission on this Event", nil)
	}
	ctx := req.Context()

	visitNumber, err := conv.ParseInt32(req.PathValue("visitNumber"))
	if err != nil {
		return nil, "", herr.BadRequest("Failed to parse visit number", err).From("[ParseInt32]")
	}
	attachmentNumber, err := conv.ParseInt32(req.PathValue("attachmentNumber"))
	if err != nil {
		return nil, "", herr.BadRequest("Failed to parse attachment number", err).From("[ParseInt32]")
	}

	_, _, errHTTP = fetchVisit(ctx, action.ImsDBQ, event.ID, visitNumber, action.AttachmentsStore.Type != conf.AttachmentsStoreNone)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[fetchVisit]")
	}

	// The internal attached-file name lives only on the stored row, not the JSON
	// view, so look it up from the raw journal-entry rows.
	journalEntryRows, err := action.ImsDBQ.Visit_JournalEntries(ctx, action.ImsDBQ, imsdb.Visit_JournalEntriesParams{
		Event:       event.ID,
		VisitNumber: visitNumber,
	})
	if err != nil {
		return nil, "", herr.InternalServerError("Failed to fetch journal entries", err).From("[Visit_JournalEntries]")
	}

	var filename string
	for _, row := range journalEntryRows {
		if row.JournalEntry.ID == attachmentNumber {
			filename = row.JournalEntry.AttachedFile.String
			break
		}
	}

	file, errHTTP := RetrieveFile(ctx, action.AttachmentsStore, action.S3Client, filename)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[RetrieveFile]")
	}

	mtype, errHTTP := SniffFile(file)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[SniffFile]")
	}
	contentType = SafeToPreviewContentType(mtype.String())

	return file, contentType, nil
}

func (action AttachToVisit) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	reID, errHTTP := action.attachToVisit(req)
	if errHTTP != nil {
		errHTTP.From("[attachToVisit]").WriteResponse(w)
		return
	}
	slog.Info("Saved Visit attachment")
	w.Header().Set("IMS-Journal-Entry-Number", conv.FormatInt(reID))
	herr.WriteNoContentResponse(w, "Saved Visit attachment")
}

func (action AttachToVisit) attachToVisit(req *http.Request) (int32, *herr.HTTPError) {
	event, jwtCtx, eventPermissions, errHTTP := server.GetEventPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return 0, errHTTP.From("[server.GetEventPermissions]")
	}
	if eventPermissions&authz.EventWriteVisits == 0 {
		return 0, herr.Forbidden("The requestor does not have EventWriteVisits permission on this Event", nil)
	}
	ctx := req.Context()

	visitNumber, err := conv.ParseInt32(req.PathValue("visitNumber"))
	if err != nil {
		return 0, herr.BadRequest("Failed to parse visit number", err).From("[ParseInt32]")
	}

	// this must match the key sent by the client
	fi, fiHead, err := req.FormFile(IMSAttachmentFormKey)
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return 0, herr.RequestEntityTooLarge(fmt.Sprintf("The supplied file is above the server limit of %v", format.HumanByteSize(mbe.Limit)), err)
		}
		return 0, herr.BadRequest("Failed to parse file", err)
	}
	defer server.Shut(fi)

	errHTTP = checkAttachmentSize(fiHead, action.MaxAttachmentBytes)
	if errHTTP != nil {
		return 0, errHTTP.From("[checkAttachmentSize]")
	}

	mtype, errHTTP := SniffFile(fi)
	if errHTTP != nil {
		return 0, errHTTP.From("[SniffFile]")
	}

	newFileName := fmt.Sprintf("event_%05d_visit_%05d_%v%v", event.ID, visitNumber, rand.Text(), mtype.Extension())
	// #nosec G706 // log injection
	slog.Info("User uploaded a visit attachment",
		"user", jwtCtx.Claims.PersonHandle(),
		"eventName", event.Name,
		"visitNumber", visitNumber,
		"originalName", fiHead.Filename,
		"newFileName", newFileName,
		"size", fiHead.Size,
		"contentType", mtype.String(),
		"extension", mtype.Extension(),
	)

	errHTTP = SaveFile(ctx, action.AttachmentsStore, action.S3Client, newFileName, fi)
	if errHTTP != nil {
		return 0, errHTTP.From("[SaveFile]")
	}

	reText := fmt.Sprintf("File Name: %v, Size: %v, Type:%v",
		fiHead.Filename, format.HumanByteSize(fiHead.Size), mtype.String())
	reID, errHTTP := addVisitJournalEntry(
		ctx, action.ImsDBQ, action.ImsDBQ, event.ID, visitNumber, jwtCtx.Claims.PersonID(),
		reText, false, newFileName, fiHead.Filename, mtype.String(),
	)
	if errHTTP != nil {
		return 0, errHTTP.From("[addVisitJournalEntry]")
	}

	action.Es.NotifyVisitUpdate(event.ID, visitNumber)
	return reID, nil
}

func SniffFile(fi io.ReadSeeker) (*mimetype.MIME, *herr.HTTPError) {
	mtype, err := mimetype.DetectReader(fi)
	if err != nil {
		return mtype, herr.InternalServerError("Failed to detect content type", err).From("[DetectReader]")
	}
	slog.Info("found mime type details", "mime", mtype.String(), "ext", mtype.Extension())
	_, err = fi.Seek(0, io.SeekStart)
	if err != nil {
		return mtype, herr.InternalServerError("Failed to detect content type", err).From("[Seek]")
	}
	return mtype, nil
}
