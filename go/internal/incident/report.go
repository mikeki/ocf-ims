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
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/internal/notification"
	"github.com/mikeki/ocf-ims/internal/server"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// The field-report reads — GetReport (singular) and GetReports (plural, formerly the
// GET .../reports list handler here) — were extracted onto Connect (plan 09h/1c): their
// domain methods, proto authorization, and the json→proto bridge live in connect.go
// (incident.GetReport, incident.ListReports), and both REST GET routes were retired, not
// shimmed (aggressive migration, plan 09 §6). The shared helpers below (ownsReport,
// crewReportNumberSet, reportEditRights, reportToJSON, fetchReport) stay — they are used by
// those Connect reads and by the still-REST report writes.

// ownsReport reports whether a limited (own-reports-only) caller may see this
// report. Ownership is anchored on REPORT.CREATED_BY — the deterministic creator
// link (set on every report created since the CREATED_BY column landed) — so a
// reporter always sees the reports they filed, even ones with no journal entry
// they authored (e.g. a bare report, or one whose only entries are system
// entries or were stricken). Authoring a journal entry is kept as a fallback so
// legacy reports created before CREATED_BY existed, and reports a caller
// contributed to but did not create, stay visible. This mirrors the edit-path
// ownership floor (isCreator || isPreviousAuthor) in EditReport, keeping read and
// write scoping consistent.
func ownsReport(report imsdb.Report, entries []imsjson.JournalEntry, callerPersonID int32, callerHandle string) bool {
	if report.CreatedBy.Valid && report.CreatedBy.Int32 == callerPersonID {
		return true
	}
	return containsAuthor(entries, callerHandle)
}

func containsAuthor(entries []imsjson.JournalEntry, author string) bool {
	for _, e := range entries {
		if e.Author == author {
			return true
		}
	}
	return false
}

// crewReportNumberSet returns the set of report numbers a crew leader may read:
// reports whose creator is a member of a crew the caller leads (slice 10c). The
// caller must already hold EventReadCrewReports.
func crewReportNumberSet(
	ctx context.Context, imsDBQ *store.DBQ, eventID, leaderPersonID int32,
) (map[int32]bool, *herr.HTTPError) {
	nums, err := imsDBQ.CrewLeaderReportNumbers(ctx, imsDBQ, imsdb.CrewLeaderReportNumbersParams{
		Event:          eventID,
		LeaderPersonID: leaderPersonID,
	})
	if err != nil {
		return nil, herr.InternalServerError("Failed to scope crew reports", err).From("[CrewLeaderReportNumbers]")
	}
	set := make(map[int32]bool, len(nums))
	for _, n := range nums {
		set[n] = true
	}
	return set, nil
}

func createdByJSON(personID sql.NullInt32, handle, name sql.NullString) *imsjson.Mention {
	if !personID.Valid {
		return nil
	}
	return &imsjson.Mention{
		PersonID: personID.Int32,
		Handle:   handle.String,
		Name:     name.String,
	}
}

// reportEditRights reports what the caller may do to a report. Editing the summary
// is limited to the report's creator (REPORT.CREATED_BY) and admins; adding journal
// entries additionally allows the writer role (EventWriteAllReports, held by writers
// and — via the admin bypass — admins). EditReport enforces these server-side; the
// same values ride on the report JSON to gate the client's controls.
func reportEditRights(
	report imsdb.Report, callerPersonID int32, callerIsAdmin bool, eventPermissions authz.EventPermissionMask,
) (mayEditSummary, mayAddEntry bool) {
	isCreator := report.CreatedBy.Valid && report.CreatedBy.Int32 == callerPersonID
	isWriter := eventPermissions&authz.EventWriteAllReports != 0
	mayEditSummary = callerIsAdmin || isCreator
	mayAddEntry = callerIsAdmin || isWriter || isCreator
	return mayEditSummary, mayAddEntry
}

func reportToJSON(
	row imsdb.ReportsRow, journalEntries []imsjson.JournalEntry, event imsdb.Event, attachmentsEnabled bool,
	mayEditSummary, mayAddEntry bool,
) imsjson.Report {
	return imsjson.Report{
		Event:              event.Name,
		Number:             row.Report.Number,
		Created:            conv.FloatToTime(row.Report.Created),
		CreatedBy:          createdByJSON(row.Report.CreatedBy, row.CreatedByHandle, row.CreatedByName),
		Summary:            conv.SqlToString(row.Report.Summary),
		Incident:           conv.SqlToInt32(row.Report.IncidentNumber),
		JournalEntries:     journalEntries,
		MayEditSummary:     mayEditSummary,
		MayAddJournalEntry: mayAddEntry,
	}
}

func fetchReport(ctx context.Context, imsDBQ *store.DBQ, eventID, reportNumber int32, attachmentsEnabled bool) (
	imsdb.ReportRow, []imsjson.JournalEntry, *herr.HTTPError,
) {
	reportRow, err := imsDBQ.Report(ctx, imsDBQ,
		imsdb.ReportParams{
			Event:  eventID,
			Number: reportNumber,
		},
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return imsdb.ReportRow{}, nil, herr.NotFound("Report does not exist", err).From("[Report]")
		}
		return imsdb.ReportRow{}, nil, herr.InternalServerError("Failed to fetch Report", err).From("[Report]")
	}
	journalEntryRows, err := imsDBQ.Report_JournalEntries(ctx, imsDBQ,
		imsdb.Report_JournalEntriesParams{
			Event:        eventID,
			ReportNumber: reportNumber,
		})
	if err != nil {
		return imsdb.ReportRow{}, nil, herr.InternalServerError("Failed to fetch Journal Entries", err).From("[Report_JournalEntries]")
	}
	var journalEntries []imsjson.JournalEntry
	for _, rer := range journalEntryRows {
		journalEntries = append(journalEntries, journalEntryToJSON(rer.JournalEntry, rer.Author.String,
			onBehalfOfJSON(rer.JournalEntry.OnBehalfOfPersonID, rer.OnBehalfOfHandle, rer.OnBehalfOfName),
			attachmentsEnabled))
	}
	// Attach @mention rows (plan 81) to their entries for rendering/linking.
	mentionRows, err := imsDBQ.Report_JournalEntryMentions(ctx, imsDBQ,
		imsdb.Report_JournalEntryMentionsParams{
			Event:        eventID,
			ReportNumber: reportNumber,
		},
	)
	if err != nil {
		return imsdb.ReportRow{}, nil, herr.InternalServerError("Failed to fetch journal entry mentions", err).From("[Report_JournalEntryMentions]")
	}
	mentionsByEntry := make(map[int32][]imsjson.Mention, len(mentionRows))
	for _, m := range mentionRows {
		mentionsByEntry[m.JournalEntry] = append(mentionsByEntry[m.JournalEntry], imsjson.Mention{
			PersonID: m.PersonID,
			Handle:   m.Handle.String,
			Name:     m.Name.String,
		})
	}
	for i := range journalEntries {
		if ms, ok := mentionsByEntry[journalEntries[i].ID]; ok {
			journalEntries[i].Mentions = ms
		}
	}
	return reportRow, journalEntries, nil
}

type EditReport struct {
	ImsDBQ      *store.DBQ
	UserStore   directory.UserStore
	EventSource *server.EventSourcerer
	Pusher      *server.Pusher
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
	event, jwt, eventPermissions, errHTTP := server.GetEventPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return errHTTP.From("[server.GetEventPermissions]")
	}
	if eventPermissions&(authz.EventWriteAllReports|authz.EventWriteOwnReports) == 0 {
		return herr.Forbidden("The requestor does not have permission to edit Reports on this Event", nil)
	}

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
	isAdmin := jwt.Claims.PersonAdmin()

	reportRow, err := action.ImsDBQ.Report(ctx, action.ImsDBQ,
		imsdb.ReportParams{
			Event:  event.ID,
			Number: reportNumber,
		},
	)
	if errors.Is(err, sql.ErrNoRows) {
		return herr.NotFound("Report does not exist", err).From("[Report]")
	}
	if err != nil {
		return herr.InternalServerError("Failed to fetch Report", err).From("[Report]")
	}
	storedReport := reportRow.Report

	// Ownership floor. It governs the incident link/unlink action below and is the
	// baseline for the summary/entry edits. A caller with EventWriteAllReports (the
	// writer role, or an admin via the bypass) always qualifies; a limited
	// (own-reports) caller must own the report — as its creator (REPORT.CREATED_BY)
	// or, historically, as an author of one of its journal entries. The stricter
	// per-action gates for the summary and for adding entries are applied further down.
	hasWriteAll := eventPermissions&authz.EventWriteAllReports != 0
	isCreator := storedReport.CreatedBy.Valid && storedReport.CreatedBy.Int32 == authorPersonID
	if !hasWriteAll && !isCreator {
		isPrevAuthor, errHTTP := action.isPreviousAuthor(req, event.ID, reportNumber, author)
		if errHTTP != nil {
			return errHTTP.From("[isPreviousAuthor]")
		}
		if !isPrevAuthor {
			return herr.Forbidden("The requestor does not have permission to edit this Report", nil)
		}
	}

	// If there's an "action" in the form, we're either linking or unlinking this Report from an Incident.
	if queryAction := req.FormValue("action"); queryAction != "" {
		targetIncidentVal := req.FormValue("incident")

		// TODO: get rid of this "action" framework, and just allow a standard POST, as with visit's incident field.
		errHTTP = action.handleLinkToIncident(ctx, storedReport, event, queryAction, targetIncidentVal, authorPersonID)
		if errHTTP != nil {
			return errHTTP.From("[handleLinkToIncident]")
		}
	}

	requestReport, errHTTP := server.ReadBodyAs[imsjson.Report](req)
	if errHTTP != nil {
		return errHTTP.From("[server.ReadBodyAs]")
	}
	// This is fine, as it may be that only a link/unlink was requested
	if requestReport.Number == 0 {
		slog.Debug("No report number provided")
		return nil
	}

	// Per-action authorization: editing the summary is limited to the report's
	// creator and admins; adding journal entries additionally allows the writer role.
	// (Stricter than the ownership floor above — a writer may add entries to any
	// report but may not rewrite a summary they didn't create.)
	mayEditSummary, mayAddEntry := reportEditRights(storedReport, authorPersonID, isAdmin, eventPermissions)
	if requestReport.Summary != nil && !mayEditSummary {
		return herr.Forbidden("Only the report's creator or an admin may edit the summary", nil)
	}
	addsJournalEntry := false
	for _, entry := range requestReport.JournalEntries {
		if entry.Text != "" {
			addsJournalEntry = true
			break
		}
	}
	if addsJournalEntry && !mayAddEntry {
		return herr.Forbidden("Only the report's creator, a writer, or an admin may add journal entries", nil)
	}

	txn, err := action.ImsDBQ.Begin()
	if err != nil {
		return herr.InternalServerError("Failed to begin transaction", err).From("[Begin]")
	}
	defer server.Rollback(txn)

	if requestReport.Summary != nil {
		storedReport.Summary = conv.StringToSql(requestReport.Summary, 0)
		text := "Changed summary to: " + *requestReport.Summary
		_, errHTTP := addJournalEntry(ctx, action.ImsDBQ, txn, event.ID, storedReport.Number, authorPersonID, text, true, "", "", "", sql.NullInt32{})
		if errHTTP != nil {
			return errHTTP.From("[addJournalEntry]")
		}
	}
	err = action.ImsDBQ.UpdateReport(ctx, txn,
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
	var mentionedPersonIDs []int32
	for _, entry := range requestReport.JournalEntries {
		if entry.Text == "" {
			continue
		}
		entryID, errHTTP := addJournalEntry(ctx, action.ImsDBQ, txn, event.ID, storedReport.Number, authorPersonID, entry.Text, false, "", "", "", onBehalfOfParam(entry.OnBehalfOfPersonID))
		if errHTTP != nil {
			return errHTTP.From("[addJournalEntry]")
		}
		errHTTP = addJournalEntryMentions(ctx, action.ImsDBQ, action.UserStore, txn, entryID, entry.Text, entry.MentionedPersonIDs)
		if errHTTP != nil {
			return errHTTP.From("[addJournalEntryMentions]")
		}
		recipients, errHTTP := notification.GenerateReportMentionNotifications(ctx, action.ImsDBQ, txn, event.ID, storedReport.Number, entryID, authorPersonID)
		if errHTTP != nil {
			return errHTTP.From("[notification.GenerateReportMentionNotifications]")
		}
		mentionedPersonIDs = append(mentionedPersonIDs, recipients...)
	}

	err = txn.Commit()
	if err != nil {
		return herr.InternalServerError("Failed to commit transaction", err).From("[Commit]")
	}

	defer action.EventSource.NotifyReportUpdate(event.ID, storedReport.Number)
	// Web push the mentioned people (plan 84c): after commit, off the request path.
	action.Pusher.NotifyMentionedInReport(ctx, event.Name, storedReport.Number, mentionedPersonIDs, authorPersonID)
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
	// The incident whose journal should mirror this link, plus the line to write on
	// it, so the change shows on both the report's and the incident's timelines.
	var incidentForJournal sql.NullInt32
	var incidentEntryText string
	switch queryAction {
	case "attach":
		num, err := conv.ParseInt32(targetIncidentVal)
		if err != nil {
			return herr.BadRequest("Invalid incident number for attachment of FR", err).From("[ParseInt32]")
		}
		newIncident = sql.NullInt32{Int32: num, Valid: true}
		entryText = fmt.Sprintf("Attached to incident: %v", num)
		incidentForJournal = sql.NullInt32{Int32: num, Valid: true}
		incidentEntryText = fmt.Sprintf("Report added: %v", reportNumber)
	case "detach":
		newIncident = sql.NullInt32{Valid: false}
		entryText = fmt.Sprintf("Detached from incident: %v", previousIncident.Int32)
		// Mirror onto the previous incident — valid only if it was actually attached.
		incidentForJournal = previousIncident
		incidentEntryText = fmt.Sprintf("Report removed: %v", reportNumber)
	default:
		return herr.BadRequest("Invalid action", fmt.Errorf("provided bad action was %v", queryAction))
	}
	err := action.ImsDBQ.AttachReportToIncident(ctx, action.ImsDBQ,
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
	_, errHTTP := addJournalEntry(ctx, action.ImsDBQ, action.ImsDBQ, event.ID, reportNumber, actorPersonID, entryText, true, "", "", "", sql.NullInt32{})
	if errHTTP != nil {
		return errHTTP.From("[addJournalEntry]")
	}
	// Mirror the link onto the incident's journal too (skip a detach from nothing —
	// there is no incident to record it against).
	if incidentForJournal.Valid {
		_, errHTTP = addIncidentJournalEntry(ctx, action.ImsDBQ, action.ImsDBQ, event.ID, incidentForJournal.Int32, actorPersonID, incidentEntryText, true, "", "", "")
		if errHTTP != nil {
			return errHTTP.From("[addIncidentJournalEntry]")
		}
	}
	defer action.EventSource.NotifyReportUpdate(event.ID, reportNumber)
	defer action.EventSource.NotifyIncidentUpdates(event.ID, previousIncident.Int32, newIncident.Int32)
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
	entries, err := action.ImsDBQ.Report_JournalEntries(req.Context(), action.ImsDBQ,
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
		if entry.Author.String == author {
			authorMatch = true
			break
		}
	}
	return authorMatch, nil
}

type NewReport struct {
	ImsDBQ      *store.DBQ
	UserStore   directory.UserStore
	EventSource *server.EventSourcerer
	Pusher      *server.Pusher
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
	event, jwtCtx, eventPermissions, errHTTP := server.GetEventPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return 0, "", errHTTP.From("[server.GetEventPermissions]")
	}
	if eventPermissions&(authz.EventWriteAllReports|authz.EventWriteOwnReports) == 0 {
		return 0, "", herr.Forbidden("The requestor does not have permission to write Reports on this Event", nil)
	}
	ctx := req.Context()

	report, errHTTP := server.ReadBodyAs[imsjson.Report](req)
	if errHTTP != nil {
		return 0, "", errHTTP.From("[server.ReadBodyAs]")
	}

	// A new Report may be created already attached to an incident (10e): a
	// reporter can enter the IMS# on the create form, before or without a
	// Summary. An unknown incident trips the composite FK below (1452).
	var incidentNumber sql.NullInt32
	if report.Incident != nil {
		incidentNumber = sql.NullInt32{Int32: *report.Incident, Valid: true}
	}

	authorPersonID := jwtCtx.Claims.PersonID()

	newReportNum, err := action.ImsDBQ.NextReportNumber(ctx, action.ImsDBQ, event.ID)
	if err != nil {
		return 0, "", herr.InternalServerError("Failed to find next Report number", err).From("[NextReportNumber]")
	}
	report.Number = newReportNum

	err = action.ImsDBQ.CreateReport(ctx, action.ImsDBQ,
		imsdb.CreateReportParams{
			Event:          event.ID,
			Number:         newReportNum,
			Created:        conv.TimeToFloat(time.Now()),
			Summary:        conv.StringToSql(report.Summary, 0),
			IncidentNumber: incidentNumber,
			CreatedBy:      sql.NullInt32{Int32: authorPersonID, Valid: true},
		},
	)
	if err != nil {
		// A bad incident number trips the composite (EVENT, INCIDENT_NUMBER) FK.
		var mysqlErr *mysql.MySQLError
		const mySQLErNoReferencedRow2 = 1452
		if errors.As(err, &mysqlErr) && mysqlErr.Number == mySQLErNoReferencedRow2 {
			return 0, "", herr.NotFound("No such Incident", err).From("[CreateReport]")
		}
		return 0, "", herr.InternalServerError("Failed to create Report", err).From("[CreateReport]")
	}

	txn, err := action.ImsDBQ.Begin()
	if err != nil {
		return 0, "", herr.InternalServerError("Failed to begin transaction", err).From("[Begin]")
	}
	defer server.Rollback(txn)

	if report.Summary != nil {
		text := "Changed summary to: " + *report.Summary
		_, errHTTP := addJournalEntry(ctx, action.ImsDBQ, txn, event.ID, report.Number, authorPersonID, text, true, "", "", "", sql.NullInt32{})
		if errHTTP != nil {
			return 0, "", errHTTP.From("[addJournalEntry]")
		}
	}

	if report.Incident != nil {
		text := fmt.Sprintf("Attached to incident: %v", *report.Incident)
		_, errHTTP := addJournalEntry(ctx, action.ImsDBQ, txn, event.ID, report.Number, authorPersonID, text, true, "", "", "", sql.NullInt32{})
		if errHTTP != nil {
			return 0, "", errHTTP.From("[addJournalEntry]")
		}
		// Mirror the link onto the incident's journal too, so it shows on both
		// timelines (see EditReport.handleLinkToIncident).
		_, errHTTP = addIncidentJournalEntry(ctx, action.ImsDBQ, txn, event.ID, *report.Incident, authorPersonID, fmt.Sprintf("Report added: %v", report.Number), true, "", "", "")
		if errHTTP != nil {
			return 0, "", errHTTP.From("[addIncidentJournalEntry]")
		}
	}

	var mentionedPersonIDs []int32
	for _, entry := range report.JournalEntries {
		if entry.Text == "" {
			continue
		}
		entryID, errHTTP := addJournalEntry(ctx, action.ImsDBQ, txn, event.ID, report.Number, authorPersonID, entry.Text, false, "", "", "", onBehalfOfParam(entry.OnBehalfOfPersonID))
		if errHTTP != nil {
			return 0, "", errHTTP.From("[addJournalEntry]")
		}
		errHTTP = addJournalEntryMentions(ctx, action.ImsDBQ, action.UserStore, txn, entryID, entry.Text, entry.MentionedPersonIDs)
		if errHTTP != nil {
			return 0, "", errHTTP.From("[addJournalEntryMentions]")
		}
		recipients, errHTTP := notification.GenerateReportMentionNotifications(ctx, action.ImsDBQ, txn, event.ID, report.Number, entryID, authorPersonID)
		if errHTTP != nil {
			return 0, "", errHTTP.From("[notification.GenerateReportMentionNotifications]")
		}
		mentionedPersonIDs = append(mentionedPersonIDs, recipients...)
	}

	err = txn.Commit()
	if err != nil {
		return 0, "", herr.InternalServerError("Failed to commit transaction", err).From("[Commit]")
	}

	loc := fmt.Sprintf("/ims/api/events/%v/reports/%v", event.Name, report.Number)
	defer action.EventSource.NotifyReportUpdate(event.ID, report.Number)
	if report.Incident != nil {
		// The incident just gained a report; refresh its subscribers too (0 =
		// no previous incident, mirroring an attach from unattached).
		defer action.EventSource.NotifyIncidentUpdates(event.ID, 0, *report.Incident)
	}
	// Web push the mentioned people (plan 84c): after commit, off the request path.
	action.Pusher.NotifyMentionedInReport(ctx, event.Name, report.Number, mentionedPersonIDs, authorPersonID)
	return report.Number, loc, nil
}

func addJournalEntry(
	ctx context.Context, imsDBQ *store.DBQ, dbtx imsdb.DBTX, eventID, reportNum int32,
	authorPersonID int32, text string, generated bool,
	attachment, attachmentOriginalName, attachmentMediaType string,
	onBehalfOf sql.NullInt32,
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
			OnBehalfOfPersonID:       onBehalfOf,
		},
	)
	if err != nil {
		// A bad "on behalf of" person id trips the PERSON FK; surface as 400.
		var mysqlErr *mysql.MySQLError
		const mySQLErNoReferencedRow2 = 1452
		if errors.As(err, &mysqlErr) && mysqlErr.Number == mySQLErNoReferencedRow2 {
			return 0, herr.BadRequest("No such person for 'on behalf of'", err).From("[CreateJournalEntry]")
		}
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
