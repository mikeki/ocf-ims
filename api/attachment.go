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
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/gabriel-vasile/mimetype"
	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/directory"
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
	imsDBQ           *store.DBQ
	userStore        directory.UserStore
	attachmentsStore conf.AttachmentsStore
	s3Client         *attachment.S3Client
}

type AttachToIncident struct {
	imsDBQ           *store.DBQ
	userStore        directory.UserStore
	es               *EventSourcerer
	attachmentsStore conf.AttachmentsStore
	s3Client         *attachment.S3Client
}

type GetReportAttachment struct {
	imsDBQ           *store.DBQ
	userStore        directory.UserStore
	attachmentsStore conf.AttachmentsStore
	s3Client         *attachment.S3Client
}

type AttachToReport struct {
	imsDBQ           *store.DBQ
	userStore        directory.UserStore
	es               *EventSourcerer
	attachmentsStore conf.AttachmentsStore
	s3Client         *attachment.S3Client
}

type GetVisitAttachment struct {
	imsDBQ           *store.DBQ
	userStore        directory.UserStore
	attachmentsStore conf.AttachmentsStore
	s3Client         *attachment.S3Client
}

type AttachToVisit struct {
	imsDBQ           *store.DBQ
	userStore        directory.UserStore
	es               *EventSourcerer
	attachmentsStore conf.AttachmentsStore
	s3Client         *attachment.S3Client
}

func (action GetIncidentAttachment) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	file, contentType, errHTTP := action.getIncidentAttachment(req)
	if errHTTP != nil {
		errHTTP.From("[getIncidentAttachment]").WriteResponse(w)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", contentDisposition(contentType))
	http.ServeContent(w, req, "Attached File", time.Now(), file)
}

func (action GetIncidentAttachment) getIncidentAttachment(
	req *http.Request,
) (fi io.ReadSeeker, contentType string, errHTTP *herr.HTTPError) {
	event, _, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[getEventPermissions]")
	}
	if eventPermissions&authz.EventReadIncidents == 0 {
		return nil, "", herr.Forbidden("The requestor does not have EventReadIncidents permission on this Event", nil)
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

	_, _, errHTTP = fetchIncident(ctx, action.imsDBQ, event.ID, incidentNumber, action.attachmentsStore.Type != conf.AttachmentsStoreNone)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[fetchIncident]")
	}

	// The internal attached-file name lives only on the stored row, not the JSON
	// view, so look it up from the raw journal-entry rows.
	journalEntryRows, err := action.imsDBQ.Incident_JournalEntries(ctx, action.imsDBQ, imsdb.Incident_JournalEntriesParams{
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

	file, errHTTP := retrieveFile(ctx, action.attachmentsStore, action.s3Client, filename)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[retrieveFile]")
	}

	mtype, errHTTP := sniffFile(file)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[sniffFile]")
	}
	contentType = safeToPreviewContentType(mtype.String())

	return file, contentType, nil
}

var safeToPreviewMediaTypes = []string{
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

// safeToPreviewContentType returns a safe form of contentType if possible, or octetStream otherwise.
//
// This is important for the client side. For example, if we're serving an HTML document,
// we want the client to think it's just text/plain, so that it doesn't attempt to render it.
// SVG graphics are similarly a problem, since they can include scripting. The client
// previews these attachments in the same origin as IMS, which leaves us open to XSS attacks
// for unsafe files. This function works conservatively by returning octetStream unless we
// know the content type ought to be safe.
func safeToPreviewContentType(contentType string) string {
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return octetStream
	}
	if slices.Contains(safeToPreviewMediaTypes, mediaType) {
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
	return safeToPreviewContentType(contentType) != octetStream
}

// contentDisposition decides whether an attachment renders inline or is forced to
// download (plan 90 finding L4). Only the types we deem safe to preview render
// inline; everything else — including the octet-stream we downgrade unknown / HTML
// / SVG uploads to — is served as an "attachment" so the browser downloads it
// rather than rendering an untrusted file in our origin. Paired with the global
// X-Content-Type-Options: nosniff, this keeps a browser from sniffing a downgraded
// type back into something renderable. contentType here is the already-sanitized
// type from safeToPreviewContentType.
func contentDisposition(contentType string) string {
	if previewableContentType(contentType) {
		return "inline"
	}
	return "attachment"
}

func retrieveFile(
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
	w.Header().Set("Content-Disposition", contentDisposition(contentType))
	http.ServeContent(w, req, "Attached File", time.Now(), file)
}

func (action GetReportAttachment) getReportAttachment(
	req *http.Request,
) (fi io.ReadSeeker, contentType string, errHTTP *herr.HTTPError) {
	event, jwtCtx, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[getEventPermissions]")
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

	_, journalEntries, errHTTP := fetchReport(ctx, action.imsDBQ, event.ID, reportNumber, action.attachmentsStore.Type != conf.AttachmentsStoreNone)
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
	journalEntryRows, err := action.imsDBQ.Report_JournalEntries(ctx, action.imsDBQ, imsdb.Report_JournalEntriesParams{
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

	file, errHTTP := retrieveFile(ctx, action.attachmentsStore, action.s3Client, filename)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[retrieveFile]")
	}

	mtype, errHTTP := sniffFile(file)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[sniffFile]")
	}
	contentType = safeToPreviewContentType(mtype.String())

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
	event, jwtCtx, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return 0, errHTTP.From("[getEventPermissions]")
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
	defer shut(fi)

	mtype, errHTTP := sniffFile(fi)
	if errHTTP != nil {
		return 0, errHTTP.From("[sniffFile]")
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

	errHTTP = saveFile(ctx, action.attachmentsStore, action.s3Client, newFileName, fi)
	if errHTTP != nil {
		return 0, errHTTP.From("[saveFile]")
	}

	reText := fmt.Sprintf("File Name: %v, Size: %v, Type:%v",
		fiHead.Filename, format.HumanByteSize(fiHead.Size), mtype.String())
	reID, errHTTP := addIncidentJournalEntry(
		ctx, action.imsDBQ, action.imsDBQ, event.ID, incidentNumber, jwtCtx.Claims.PersonID(),
		reText, false, newFileName, fiHead.Filename, mtype.String(),
	)
	if errHTTP != nil {
		return 0, errHTTP.From("[addIncidentJournalEntry]")
	}

	action.es.notifyIncidentUpdate(event.ID, incidentNumber)
	return reID, nil
}

// saveFile writes fi's bytes to the configured attachments backend under newFileName.
// fi is an io.Reader (not multipart.File) so callers can pass either the uploaded
// multipart file or an in-memory reader over transformed bytes (e.g. a resized
// profile picture).
func saveFile(
	ctx context.Context, attachmentsStore conf.AttachmentsStore,
	s3Client *attachment.S3Client, newFileName string, fi io.Reader,
) *herr.HTTPError {
	switch attachmentsStore.Type {
	case conf.AttachmentsStoreLocal:
		outFi, err := attachmentsStore.Local.Dir.Create(newFileName)
		if err != nil {
			return herr.InternalServerError("Failed to create file", err).From("[Create]")
		}
		defer shut(outFi)
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
	event, jwtCtx, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return 0, errHTTP.From("[getEventPermissions]")
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

	report, entries, errHTTP := fetchReport(ctx, action.imsDBQ, event.ID, reportNumber, action.attachmentsStore.Type != conf.AttachmentsStoreNone)
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
	defer shut(fi)

	mtype, errHTTP := sniffFile(fi)
	if errHTTP != nil {
		return 0, errHTTP.From("[sniffFile]")
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

	errHTTP = saveFile(ctx, action.attachmentsStore, action.s3Client, newFileName, fi)
	if errHTTP != nil {
		return 0, errHTTP.From("[saveFile]")
	}

	reText := fmt.Sprintf("File Name: %v, Size: %v, Type: %v",
		fiHead.Filename, format.HumanByteSize(fiHead.Size), mtype.String())
	reID, errHTTP := addJournalEntry(
		ctx, action.imsDBQ, action.imsDBQ, event.ID, reportNumber,
		jwtCtx.Claims.PersonID(), reText, false,
		newFileName, fiHead.Filename, mtype.String(),
		sql.NullInt32{},
	)
	if errHTTP != nil {
		return 0, errHTTP.From("[addJournalEntry]")
	}

	action.es.notifyReportUpdate(event.ID, reportNumber)
	if report.Report.IncidentNumber.Valid {
		action.es.notifyIncidentUpdate(event.ID, report.Report.IncidentNumber.Int32)
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
	w.Header().Set("Content-Disposition", contentDisposition(contentType))
	http.ServeContent(w, req, "Attached File", time.Now(), file)
}

func (action GetVisitAttachment) getVisitAttachment(
	req *http.Request,
) (fi io.ReadSeeker, contentType string, errHTTP *herr.HTTPError) {
	event, _, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[getEventPermissions]")
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

	_, _, errHTTP = fetchVisit(ctx, action.imsDBQ, event.ID, visitNumber, action.attachmentsStore.Type != conf.AttachmentsStoreNone)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[fetchVisit]")
	}

	// The internal attached-file name lives only on the stored row, not the JSON
	// view, so look it up from the raw journal-entry rows.
	journalEntryRows, err := action.imsDBQ.Visit_JournalEntries(ctx, action.imsDBQ, imsdb.Visit_JournalEntriesParams{
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

	file, errHTTP := retrieveFile(ctx, action.attachmentsStore, action.s3Client, filename)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[retrieveFile]")
	}

	mtype, errHTTP := sniffFile(file)
	if errHTTP != nil {
		return nil, "", errHTTP.From("[sniffFile]")
	}
	contentType = safeToPreviewContentType(mtype.String())

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
	event, jwtCtx, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return 0, errHTTP.From("[getEventPermissions]")
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
	defer shut(fi)

	mtype, errHTTP := sniffFile(fi)
	if errHTTP != nil {
		return 0, errHTTP.From("[sniffFile]")
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

	errHTTP = saveFile(ctx, action.attachmentsStore, action.s3Client, newFileName, fi)
	if errHTTP != nil {
		return 0, errHTTP.From("[saveFile]")
	}

	reText := fmt.Sprintf("File Name: %v, Size: %v, Type:%v",
		fiHead.Filename, format.HumanByteSize(fiHead.Size), mtype.String())
	reID, errHTTP := addVisitJournalEntry(
		ctx, action.imsDBQ, action.imsDBQ, event.ID, visitNumber, jwtCtx.Claims.PersonID(),
		reText, false, newFileName, fiHead.Filename, mtype.String(),
	)
	if errHTTP != nil {
		return 0, errHTTP.From("[addVisitJournalEntry]")
	}

	action.es.notifyVisitUpdate(event.ID, visitNumber)
	return reID, nil
}

func sniffFile(fi io.ReadSeeker) (*mimetype.MIME, *herr.HTTPError) {
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
