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
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/mikeki/ocf-ims/directory"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

type GetReports struct {
	imsDBQ             *store.DBQ
	userStore          directory.UserStore
	attachmentsEnabled bool
}

func (action GetReports) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.getReports(req)
	if errHTTP != nil {
		errHTTP.From("[getReports]").WriteResponse(w)
		return
	}
	mustWriteJSON(w, req, resp)
}
func (action GetReports) getReports(req *http.Request) (imsjson.Reports, *herr.HTTPError) {
	resp := make(imsjson.Reports, 0)
	event, jwtCtx, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return resp, errHTTP.From("[getEventPermissions]")
	}
	if eventPermissions&(authz.EventReadAllReports|authz.EventReadOwnReports) == 0 {
		return resp, herr.Forbidden("The requestor does not have permission to read Reports on this Event", nil)
	}
	// i.e. the user has EventReadOwnReports, but not EventReadAllReports
	limitedAccess := eventPermissions&authz.EventReadAllReports == 0

	err := req.ParseForm()
	if err != nil {
		return resp, herr.BadRequest("Failed to parse form", err).From("[ParseForm]")
	}

	includeSystemEntries := !strings.EqualFold(req.Form.Get("exclude_system_entries"), "true")

	journalEntries, err := action.imsDBQ.Reports_JournalEntries(
		req.Context(),
		action.imsDBQ,
		imsdb.Reports_JournalEntriesParams{
			Event:     event.ID,
			Generated: includeSystemEntries,
		},
	)
	if err != nil {
		return resp, herr.InternalServerError("Failed to get FR journal entries", err).From("[Reports_JournalEntries]")
	}

	entriesByReport := make(map[int32][]imsjson.JournalEntry)
	for _, row := range journalEntries {
		entriesByReport[row.ReportNumber] = append(entriesByReport[row.ReportNumber],
			journalEntryToJSON(row.JournalEntry, row.Author, action.attachmentsEnabled))
	}

	storedReports, err := action.imsDBQ.Reports(req.Context(), action.imsDBQ, event.ID)
	if err != nil {
		return resp, herr.InternalServerError("Failed to fetch Reports", err).From("[Reports]")
	}

	var authorizedReports []imsdb.ReportsRow
	if limitedAccess {
		for _, storedReport := range storedReports {
			entries := entriesByReport[storedReport.Report.Number]
			if containsAuthor(entries, jwtCtx.Claims.PersonHandle()) {
				authorizedReports = append(authorizedReports, storedReport)
			}
		}
	} else {
		authorizedReports = storedReports
	}

	resp = make(imsjson.Reports, 0, len(authorizedReports))
	for _, report := range authorizedReports {
		resp = append(
			resp,
			reportToJSON(
				report.Report,
				entriesByReport[report.Report.Number],
				event,
				action.attachmentsEnabled,
			),
		)
	}

	return resp, nil
}

func containsAuthor(entries []imsjson.JournalEntry, author string) bool {
	for _, e := range entries {
		if e.Author == author {
			return true
		}
	}
	return false
}

type GetReport struct {
	imsDBQ             *store.DBQ
	userStore          directory.UserStore
	attachmentsEnabled bool
}

func (action GetReport) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.getReport(req)
	if errHTTP != nil {
		errHTTP.From("[getReport]").WriteResponse(w)
		return
	}
	mustWriteJSON(w, req, resp)
}

func (action GetReport) getReport(req *http.Request) (imsjson.Report, *herr.HTTPError) {
	var response imsjson.Report

	event, jwtCtx, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return response, errHTTP.From("[getEventPermissions]")
	}
	if eventPermissions&(authz.EventReadAllReports|authz.EventReadOwnReports) == 0 {
		return response, herr.Forbidden("The requestor does not have permission to read Reports on this Event", nil)
	}
	// i.e. they have EventReadOwnReports, but not EventReadAllReports
	limitedAccess := eventPermissions&authz.EventReadAllReports == 0

	ctx := req.Context()

	reportNumber, err := conv.ParseInt32(req.PathValue("reportNumber"))
	if err != nil {
		return response, herr.BadRequest("Invalid report number", err).From("[ParseInt32]")
	}

	report, journalEntries, errHTTP := fetchReport(ctx, action.imsDBQ, event.ID, reportNumber, action.attachmentsEnabled)
	if errHTTP != nil {
		return response, errHTTP.From("[fetchReport]")
	}

	if limitedAccess {
		if !containsAuthor(journalEntries, jwtCtx.Claims.PersonHandle()) {
			return response, herr.Forbidden("The requestor does not have permission to access this particular Report", nil)
		}
	}

	return reportToJSON(report, journalEntries, event, action.attachmentsEnabled), nil
}

func reportToJSON(
	report imsdb.Report, journalEntries []imsjson.JournalEntry, event imsdb.Event, attachmentsEnabled bool,
) imsjson.Report {
	return imsjson.Report{
		Event:          event.Name,
		Number:         report.Number,
		Created:        conv.FloatToTime(report.Created),
		Summary:        conv.SqlToString(report.Summary),
		Incident:       conv.SqlToInt32(report.IncidentNumber),
		JournalEntries: journalEntries,
	}
}

func fetchReport(ctx context.Context, imsDBQ *store.DBQ, eventID, reportNumber int32, attachmentsEnabled bool) (
	imsdb.Report, []imsjson.JournalEntry, *herr.HTTPError,
) {
	reportRow, err := imsDBQ.Report(ctx, imsDBQ,
		imsdb.ReportParams{
			Event:  eventID,
			Number: reportNumber,
		},
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return imsdb.Report{}, nil, herr.NotFound("Report does not exist", err).From("[Report]")
		}
		return imsdb.Report{}, nil, herr.InternalServerError("Failed to fetch Report", err).From("[Report]")
	}
	journalEntryRows, err := imsDBQ.Report_JournalEntries(ctx, imsDBQ,
		imsdb.Report_JournalEntriesParams{
			Event:        eventID,
			ReportNumber: reportNumber,
		})
	if err != nil {
		return imsdb.Report{}, nil, herr.InternalServerError("Failed to fetch Journal Entries", err).From("[Report_JournalEntries]")
	}
	var journalEntries []imsjson.JournalEntry
	for _, rer := range journalEntryRows {
		journalEntries = append(journalEntries, journalEntryToJSON(rer.JournalEntry, rer.Author, attachmentsEnabled))
	}
	return reportRow.Report, journalEntries, nil
}

type EditReport struct {
	imsDBQ      *store.DBQ
	userStore   directory.UserStore
	eventSource *EventSourcerer
}

func (action EditReport) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.editReport(req)
	if errHTTP != nil {
		errHTTP.From("[editReport]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Success")
}
func (action EditReport) editReport(req *http.Request) *herr.HTTPError {
	event, jwt, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return errHTTP.From("[getEventPermissions]")
	}
	if eventPermissions&(authz.EventWriteAllReports|authz.EventWriteOwnReports) == 0 {
		return herr.Forbidden("The requestor does not have permission to edit Reports on this Event", nil)
	}
	// i.e. they have EventWriteOwnReports, but not EventWriteAllReports
	limitedAccess := eventPermissions&authz.EventWriteAllReports == 0

	ctx := req.Context()
	err := req.ParseForm()
	if err != nil {
		return herr.BadRequest("Failed to parse form data", err).From("[ParseForm]")
	}
	reportNumber, err := conv.ParseInt32(req.PathValue("reportNumber"))
	if err != nil {
		return herr.BadRequest("Invalid report number", err).From("[ParseInt32]")
	}
	author := jwt.Claims.PersonHandle()
	authorPersonID := jwt.Claims.PersonID()
	if limitedAccess {
		isPrevAuthor, errHTTP := action.isPreviousAuthor(req, event.ID, reportNumber, author)
		if errHTTP != nil {
			return errHTTP.From("[isPreviousAuthor]")
		}
		if !isPrevAuthor {
			return herr.Forbidden("The requestor does not have permission to edit this Report", nil)
		}
	}

	reportRow, err := action.imsDBQ.Report(ctx, action.imsDBQ,
		imsdb.ReportParams{
			Event:  event.ID,
			Number: reportNumber,
		},
	)
	if err != nil {
		return herr.InternalServerError("Failed to fetch Report", err).From("[Report]")
	}
	storedReport := reportRow.Report

	// If there's an "action" in the form, we're either linking or unlinking this Report from an Incident.
	if queryAction := req.FormValue("action"); queryAction != "" {
		targetIncidentVal := req.FormValue("incident")

		// TODO: get rid of this "action" framework, and just allow a standard POST, as with visit's incident field.
		errHTTP = action.handleLinkToIncident(ctx, storedReport, event, queryAction, targetIncidentVal, authorPersonID)
		if errHTTP != nil {
			return errHTTP.From("[handleLinkToIncident]")
		}
	}

	requestReport, errHTTP := readBodyAs[imsjson.Report](req)
	if errHTTP != nil {
		return errHTTP.From("[readBodyAs]")
	}
	// This is fine, as it may be that only a link/unlink was requested
	if requestReport.Number == 0 {
		slog.Debug("No report number provided")
		return nil
	}

	txn, err := action.imsDBQ.Begin()
	if err != nil {
		return herr.InternalServerError("Failed to begin transaction", err).From("[Begin]")
	}
	defer rollback(txn)

	if requestReport.Summary != nil {
		storedReport.Summary = conv.StringToSql(requestReport.Summary, 0)
		text := "Changed summary to: " + *requestReport.Summary
		_, errHTTP := addJournalEntry(ctx, action.imsDBQ, txn, event.ID, storedReport.Number, authorPersonID, text, true, "", "", "")
		if errHTTP != nil {
			return errHTTP.From("[addJournalEntry]")
		}
	}
	err = action.imsDBQ.UpdateReport(ctx, txn,
		imsdb.UpdateReportParams{
			Event:          storedReport.Event,
			Number:         storedReport.Number,
			Summary:        storedReport.Summary,
			IncidentNumber: storedReport.IncidentNumber,
		},
	)
	if err != nil {
		return herr.InternalServerError("Failed to update Report", err).From("[UpdateReport]")
	}
	for _, entry := range requestReport.JournalEntries {
		if entry.Text == "" {
			continue
		}
		_, errHTTP := addJournalEntry(ctx, action.imsDBQ, txn, event.ID, storedReport.Number, authorPersonID, entry.Text, false, "", "", "")
		if errHTTP != nil {
			return errHTTP.From("[addJournalEntry]")
		}
	}

	err = txn.Commit()
	if err != nil {
		return herr.InternalServerError("Failed to commit transaction", err).From("[Commit]")
	}

	defer action.eventSource.notifyReportUpdate(event.ID, storedReport.Number)
	return nil
}

func (action EditReport) handleLinkToIncident(
	ctx context.Context,
	storedReport imsdb.Report,
	event imsdb.Event,
	queryAction string,
	targetIncidentVal string,
	actorPersonID int32,
) *herr.HTTPError {
	previousIncident := storedReport.IncidentNumber
	reportNumber := storedReport.Number

	var newIncident sql.NullInt32
	var entryText string
	switch queryAction {
	case "attach":
		num, err := conv.ParseInt32(targetIncidentVal)
		if err != nil {
			return herr.BadRequest("Invalid incident number for attachment of FR", err).From("[ParseInt32]")
		}
		newIncident = sql.NullInt32{Int32: num, Valid: true}
		entryText = fmt.Sprintf("Attached to incident: %v", num)
	case "detach":
		newIncident = sql.NullInt32{Valid: false}
		entryText = fmt.Sprintf("Detached from incident: %v", previousIncident.Int32)
	default:
		return herr.BadRequest("Invalid action", fmt.Errorf("provided bad action was %v", queryAction))
	}
	err := action.imsDBQ.AttachReportToIncident(ctx, action.imsDBQ,
		imsdb.AttachReportToIncidentParams{
			IncidentNumber: newIncident,
			Event:          event.ID,
			Number:         reportNumber,
		},
	)
	if err != nil {
		var mysqlErr *mysql.MySQLError
		const mySQLErNoReferencedRow2 = 1452
		if errors.As(err, &mysqlErr) && mysqlErr.Number == mySQLErNoReferencedRow2 {
			return herr.NotFound("No such Incident", err).From("[AttachReportToIncident]")
		}
		return herr.InternalServerError("Failed to attach Report to incident", err).From("[AttachReportToIncident]")
	}
	_, errHTTP := addJournalEntry(ctx, action.imsDBQ, action.imsDBQ, event.ID, reportNumber, actorPersonID, entryText, true, "", "", "")
	if errHTTP != nil {
		return errHTTP.From("[addJournalEntry]")
	}
	defer action.eventSource.notifyReportUpdate(event.ID, reportNumber)
	defer action.eventSource.notifyIncidentUpdates(event.ID, previousIncident.Int32, newIncident.Int32)
	// #nosec G706 // log injection
	slog.Info("Attached Report to newIncident",
		"event", event.ID,
		"newIncident", newIncident.Int32,
		"previousIncident", previousIncident.Int32,
		"report", reportNumber,
	)
	return nil
}

func (action EditReport) isPreviousAuthor(
	req *http.Request,
	eventID int32,
	reportNumber int32,
	author string,
) (isPreviousAuthor bool, errHTTP *herr.HTTPError) {
	entries, err := action.imsDBQ.Report_JournalEntries(req.Context(), action.imsDBQ,
		imsdb.Report_JournalEntriesParams{
			Event:        eventID,
			ReportNumber: reportNumber,
		},
	)
	if err != nil {
		return false, herr.InternalServerError("Failed to fetch Report JournalEntries", err).From("[Report_JournalEntries]")
	}
	authorMatch := false
	for _, entry := range entries {
		if entry.Author == author {
			authorMatch = true
			break
		}
	}
	return authorMatch, nil
}

type NewReport struct {
	imsDBQ      *store.DBQ
	userStore   directory.UserStore
	eventSource *EventSourcerer
}

func (action NewReport) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	number, location, errHTTP := action.newReport(req)
	if errHTTP != nil {
		errHTTP.From("[newReport]").WriteResponse(w)
		return
	}

	w.Header().Set("IMS-Report-Number", strconv.Itoa(int(number)))
	w.Header().Set("Location", location)
	herr.WriteCreatedResponse(w, http.StatusText(http.StatusCreated))
}

func (action NewReport) newReport(req *http.Request) (reportNumber int32, location string, errHTTP *herr.HTTPError) {
	event, jwtCtx, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return 0, "", errHTTP.From("[getEventPermissions]")
	}
	if eventPermissions&(authz.EventWriteAllReports|authz.EventWriteOwnReports) == 0 {
		return 0, "", herr.Forbidden("The requestor does not have permission to write Reports on this Event", nil)
	}
	ctx := req.Context()

	report, errHTTP := readBodyAs[imsjson.Report](req)
	if errHTTP != nil {
		return 0, "", errHTTP.From("[readBodyAs]")
	}

	if report.Incident != nil {
		return 0, "", herr.BadRequest("A new Report may not be attached to an incident", nil)
	}

	authorPersonID := jwtCtx.Claims.PersonID()

	newReportNum, err := action.imsDBQ.NextReportNumber(ctx, action.imsDBQ, event.ID)
	if err != nil {
		return 0, "", herr.InternalServerError("Failed to find next Report number", err).From("[NextReportNumber]")
	}
	report.Number = newReportNum

	err = action.imsDBQ.CreateReport(ctx, action.imsDBQ,
		imsdb.CreateReportParams{
			Event:          event.ID,
			Number:         newReportNum,
			Created:        conv.TimeToFloat(time.Now()),
			Summary:        conv.StringToSql(report.Summary, 0),
			IncidentNumber: sql.NullInt32{},
		},
	)
	if err != nil {
		return 0, "", herr.InternalServerError("Failed to create Report", err).From("[CreateReport]")
	}

	txn, err := action.imsDBQ.Begin()
	if err != nil {
		return 0, "", herr.InternalServerError("Failed to begin transaction", err).From("[Begin]")
	}
	defer rollback(txn)

	if report.Summary != nil {
		text := "Changed summary to: " + *report.Summary
		_, errHTTP := addJournalEntry(ctx, action.imsDBQ, txn, event.ID, report.Number, authorPersonID, text, true, "", "", "")
		if errHTTP != nil {
			return 0, "", errHTTP.From("[addJournalEntry]")
		}
	}

	for _, entry := range report.JournalEntries {
		if entry.Text == "" {
			continue
		}
		_, errHTTP := addJournalEntry(ctx, action.imsDBQ, txn, event.ID, report.Number, authorPersonID, entry.Text, false, "", "", "")
		if errHTTP != nil {
			return 0, "", errHTTP.From("[addJournalEntry]")
		}
	}

	err = txn.Commit()
	if err != nil {
		return 0, "", herr.InternalServerError("Failed to commit transaction", err).From("[Commit]")
	}

	loc := fmt.Sprintf("/ims/api/events/%v/reports/%v", event.Name, report.Number)
	defer action.eventSource.notifyReportUpdate(event.ID, report.Number)
	return report.Number, loc, nil
}

func addJournalEntry(
	ctx context.Context, imsDBQ *store.DBQ, dbtx imsdb.DBTX, eventID, reportNum int32,
	authorPersonID int32, text string, generated bool,
	attachment, attachmentOriginalName, attachmentMediaType string,
) (int32, *herr.HTTPError) {
	reID64, err := imsDBQ.CreateJournalEntry(ctx,
		dbtx,
		imsdb.CreateJournalEntryParams{
			AuthorPersonID:           authorPersonID,
			Text:                     text,
			Created:                  conv.TimeToFloat(time.Now()),
			Generated:                generated,
			Stricken:                 false,
			AttachedFile:             conv.StringToSql(&attachment, 128),
			AttachedFileOriginalName: conv.StringToSql(&attachmentOriginalName, 128),
			AttachedFileMediaType:    conv.StringToSql(&attachmentMediaType, 128),
		},
	)
	if err != nil {
		return 0, herr.InternalServerError("Failed to create journal entry", err).From("[CreateJournalEntry]")
	}
	// This column is an int32, so this is always safe
	reID := conv.MustInt32(reID64)
	err = imsDBQ.AttachJournalEntryToReport(ctx, dbtx,
		imsdb.AttachJournalEntryToReportParams{
			Event:        eventID,
			ReportNumber: reportNum,
			JournalEntry: reID,
		},
	)
	if err != nil {
		return 0, herr.InternalServerError("Failed to attach journal entry", err).From("[AttachJournalEntryToReport]")
	}
	return reID, nil
}
