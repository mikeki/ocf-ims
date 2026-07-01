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
	"fmt"
	"net/http"
	"time"

	"github.com/mikeki/ocf-ims/directory"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

type EditReportJournalEntry struct {
	imsDBQ      *store.DBQ
	userStore   directory.UserStore
	eventSource *EventSourcerer
}

func (action EditReportJournalEntry) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.editJournalEntry(req)
	if errHTTP != nil {
		errHTTP.From("[editJournalEntry]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Success")
}

func (action EditReportJournalEntry) editJournalEntry(req *http.Request) *herr.HTTPError {
	event, jwtCtx, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return errHTTP.From("[getEventPermissions]")
	}
	if eventPermissions&(authz.EventWriteAllReports|authz.EventWriteOwnReports) == 0 {
		return herr.Forbidden("The requestor does not have permission to write Reports on this Event", nil)
	}
	ctx := req.Context()

	authorPersonID := jwtCtx.Claims.PersonID()

	reportNumber, err := conv.ParseInt32(req.PathValue("reportNumber"))
	if err != nil {
		return herr.BadRequest("Failed to parse reportNumber", err).From("[ParseInt32]")
	}
	journalEntryId, err := conv.ParseInt32(req.PathValue("journalEntryId"))
	if err != nil {
		return herr.BadRequest("Failed to parse journalEntryId", err).From("[ParseInt32]")
	}

	re, errHTTP := readBodyAs[imsjson.JournalEntry](req)
	if errHTTP != nil {
		return errHTTP.From("[readBodyAs]")
	}

	_, err = action.imsDBQ.Report(ctx, action.imsDBQ, imsdb.ReportParams{
		Event:  event.ID,
		Number: reportNumber,
	})
	if err != nil {
		return herr.NotFound("There is no Report for the provided ID", err).From("[Report]")
	}

	if re.Stricken == nil {
		// Nothing to do if no Stricken value is set, since Stricken is the only field this endpoint can modify
		return nil
	}

	// A user with only EventWriteOwnReports (a reporter) may strike/unstrike only
	// the journal entries they authored themselves — striking someone else's entry
	// would let them tamper with another person's words in the report's audit trail
	// (plan 90 finding M1). Writers/admins (EventWriteAllReports) may strike any
	// entry. A report is a collection of entries owned by their individual authors,
	// so this is a per-entry check, not per-report.
	if eventPermissions&authz.EventWriteAllReports == 0 {
		author, err := action.imsDBQ.ReportJournalEntryAuthor(ctx, action.imsDBQ,
			imsdb.ReportJournalEntryAuthorParams{
				Event:        event.ID,
				ReportNumber: reportNumber,
				JournalEntry: journalEntryId,
			},
		)
		if errors.Is(err, sql.ErrNoRows) {
			return herr.NotFound("There is no such JournalEntry on this Report", err)
		}
		if err != nil {
			return herr.InternalServerError("Failed to fetch JournalEntry author", err).From("[ReportJournalEntryAuthor]")
		}
		if author.String != jwtCtx.Claims.PersonHandle() {
			return herr.Forbidden("The requestor may only strike their own journal entries", nil)
		}
	}

	txn, err := action.imsDBQ.Begin()
	if err != nil {
		return herr.InternalServerError("Error beginning transaction", err).From("[Begin]")
	}
	defer rollback(txn)

	err = action.imsDBQ.SetReportJournalEntryStricken(ctx, txn,
		imsdb.SetReportJournalEntryStrickenParams{
			Stricken:     *re.Stricken,
			Event:        event.ID,
			ReportNumber: reportNumber,
			JournalEntry: journalEntryId,
		},
	)
	if err != nil {
		return herr.InternalServerError("Error setting journal entry", err).From("[SetReportJournalEntryStricken]")
	}
	struckVerb := "Struck"
	if !*re.Stricken {
		struckVerb = "Unstruck"
	}
	_, errHTTP = addJournalEntry(ctx, action.imsDBQ, txn, event.ID, reportNumber, authorPersonID, fmt.Sprintf("%v journalEntry %v", struckVerb, journalEntryId), true, "", "", "", sql.NullInt32{})
	if errHTTP != nil {
		return errHTTP.From("[addJournalEntry]")
	}
	err = txn.Commit()
	if err != nil {
		return herr.InternalServerError("Error committing transaction", err).From("[Commit]")
	}

	defer action.eventSource.notifyReportUpdate(event.ID, reportNumber)

	return nil
}

type EditIncidentJournalEntry struct {
	imsDBQ      *store.DBQ
	userStore   directory.UserStore
	eventSource *EventSourcerer
}

func (action EditIncidentJournalEntry) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.editIncidentJournalEntry(req)
	if errHTTP != nil {
		errHTTP.From("[editIncidentJournalEntry]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Success")
}

func (action EditIncidentJournalEntry) editIncidentJournalEntry(req *http.Request) *herr.HTTPError {
	event, jwtCtx, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return errHTTP.From("[getEventPermissions]")
	}
	if eventPermissions&(authz.EventWriteIncidents) == 0 {
		return herr.Forbidden("The requestor does not have permission to write Journal Entries on this Event", nil)
	}
	ctx := req.Context()

	authorPersonID := jwtCtx.Claims.PersonID()

	incidentNumber, err := conv.ParseInt32(req.PathValue("incidentNumber"))
	if err != nil {
		return herr.BadRequest("Failed to parse incidentNumber", err).From("[ParseInt32]")
	}
	journalEntryId, err := conv.ParseInt32(req.PathValue("journalEntryId"))
	if err != nil {
		return herr.BadRequest("Failed to parse journalEntryId", err).From("[ParseInt32]")
	}

	re, errHTTP := readBodyAs[imsjson.JournalEntry](req)
	if errHTTP != nil {
		return errHTTP.From("[readBodyAs]")
	}

	if re.Stricken == nil {
		// Nothing to do if no Stricken value is set, since Stricken is the only field this endpoint can modify
		return nil
	}

	txn, err := action.imsDBQ.Begin()
	if err != nil {
		return herr.InternalServerError("Error beginning transaction", err).From("[Begin]")
	}
	defer rollback(txn)

	err = action.imsDBQ.SetIncidentJournalEntryStricken(ctx, txn,
		imsdb.SetIncidentJournalEntryStrickenParams{
			Stricken:       *re.Stricken,
			Event:          event.ID,
			IncidentNumber: incidentNumber,
			JournalEntry:   journalEntryId,
		},
	)
	if err != nil {
		return herr.InternalServerError("Error setting incident journal entry", err).From("[SetIncidentJournalEntryStricken]")
	}
	struckVerb := "Struck"
	if !*re.Stricken {
		struckVerb = "Unstruck"
	}
	_, errHTTP = addIncidentJournalEntry(ctx, action.imsDBQ, txn, event.ID, incidentNumber, authorPersonID, fmt.Sprintf("%v journalEntry %v", struckVerb, journalEntryId), true, "", "", "")
	if errHTTP != nil {
		return errHTTP.From("[addIncidentJournalEntry]")
	}
	err = txn.Commit()
	if err != nil {
		return herr.InternalServerError("Error committing transaction", err).From("[Commit]")
	}

	defer action.eventSource.notifyIncidentUpdate(event.ID, incidentNumber)
	return nil
}

type EditVisitJournalEntry struct {
	imsDBQ      *store.DBQ
	userStore   directory.UserStore
	eventSource *EventSourcerer
}

func (action EditVisitJournalEntry) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.editVisitJournalEntry(req)
	if errHTTP != nil {
		errHTTP.From("[editVisitJournalEntry]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Success")
}

func (action EditVisitJournalEntry) editVisitJournalEntry(req *http.Request) *herr.HTTPError {
	event, jwtCtx, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return errHTTP.From("[getEventPermissions]")
	}
	if eventPermissions&authz.EventWriteVisits == 0 {
		return herr.Forbidden("The requestor does not have permission to write Visits on this Event", nil)
	}
	ctx := req.Context()

	authorPersonID := jwtCtx.Claims.PersonID()

	visitNumber, err := conv.ParseInt32(req.PathValue("visitNumber"))
	if err != nil {
		return herr.BadRequest("Failed to parse visitNumber", err).From("[ParseInt32]")
	}
	journalEntryId, err := conv.ParseInt32(req.PathValue("journalEntryId"))
	if err != nil {
		return herr.BadRequest("Failed to parse journalEntryId", err).From("[ParseInt32]")
	}

	re, errHTTP := readBodyAs[imsjson.JournalEntry](req)
	if errHTTP != nil {
		return errHTTP.From("[readBodyAs]")
	}

	_, err = action.imsDBQ.Visit(ctx, action.imsDBQ, imsdb.VisitParams{
		Event:  event.ID,
		Number: visitNumber,
	})
	if err != nil {
		return herr.NotFound("There is no Visit for the provided ID", err).From("[Visit]")
	}

	if re.Stricken == nil {
		// Nothing to do if no Stricken value is set, since Stricken is the only field this endpoint can modify
		return nil
	}

	txn, err := action.imsDBQ.Begin()
	if err != nil {
		return herr.InternalServerError("Error beginning transaction", err).From("[Begin]")
	}
	defer rollback(txn)

	err = action.imsDBQ.SetVisitJournalEntryStricken(ctx, txn,
		imsdb.SetVisitJournalEntryStrickenParams{
			Stricken:     *re.Stricken,
			Event:        event.ID,
			VisitNumber:  visitNumber,
			JournalEntry: journalEntryId,
		},
	)
	if err != nil {
		return herr.InternalServerError("Error setting visit journal entry", err).From("[SetVisitJournalEntryStricken]")
	}
	struckVerb := "Struck"
	if !*re.Stricken {
		struckVerb = "Unstruck"
	}
	_, errHTTP = addVisitJournalEntry(ctx, action.imsDBQ, txn, event.ID, visitNumber, authorPersonID, fmt.Sprintf("%v journalEntry %v", struckVerb, journalEntryId), true, "", "", "")
	if errHTTP != nil {
		return errHTTP.From("[addVisitJournalEntry]")
	}
	err = txn.Commit()
	if err != nil {
		return herr.InternalServerError("Error committing transaction", err).From("[Commit]")
	}

	defer action.eventSource.notifyVisitUpdate(event.ID, visitNumber)

	return nil
}

// journalEntryToJSON builds the JSON view of a journal entry. The author nickname
// is supplied separately (resolved from AUTHOR_PERSON_ID via a PERSON join in the
// fetching query) since the stored row now keys the author on person_id.
func journalEntryToJSON(
	re imsdb.JournalEntry, author string, onBehalfOf *imsjson.Mention, attachmentsEnabled bool,
) imsjson.JournalEntry {
	var attachment imsjson.Attachment
	if attachmentsEnabled && re.AttachedFileOriginalName.Valid {
		attachment.Name = re.AttachedFileOriginalName.String
		attachment.Previewable = previewableContentType(re.AttachedFileMediaType.String)
	}
	return imsjson.JournalEntry{
		ID:          re.ID,
		Created:     time.Unix(int64(re.Created), 0),
		Author:      author,
		SystemEntry: re.Generated,
		Text:        re.Text,
		Stricken:    new(re.Stricken),
		Attachment:  attachment,
		OnBehalfOf:  onBehalfOf,
	}
}

// onBehalfOfParam converts the optional "on behalf of" id from a write payload
// into the nullable column value (null = the author is reporting for themselves).
func onBehalfOfParam(id *int32) sql.NullInt32 {
	if id == nil {
		return sql.NullInt32{}
	}
	return sql.NullInt32{Int32: *id, Valid: true}
}

// onBehalfOfJSON resolves a journal entry's "on behalf of" person for display,
// or nil when the entry has none (the author is reporting for themselves). The
// id comes from the entry row; handle/name from a left join on PERSON.
func onBehalfOfJSON(id sql.NullInt32, handle, name sql.NullString) *imsjson.Mention {
	if !id.Valid {
		return nil
	}
	return &imsjson.Mention{
		PersonID: id.Int32,
		Handle:   handle.String,
		Name:     name.String,
	}
}
