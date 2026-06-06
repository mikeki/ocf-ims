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

type EditReportReportEntry struct {
	imsDBQ      *store.DBQ
	userStore   *directory.UserStore
	eventSource *EventSourcerer
	imsAdmins   []string
}

func (action EditReportReportEntry) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.editReportEntry(req)
	if errHTTP != nil {
		errHTTP.From("[editReportEntry]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Success")
}

func (action EditReportReportEntry) editReportEntry(req *http.Request) *herr.HTTPError {
	event, jwtCtx, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore, action.imsAdmins)
	if errHTTP != nil {
		return errHTTP.From("[getEventPermissions]")
	}
	if eventPermissions&(authz.EventWriteAllReports|authz.EventWriteOwnReports) == 0 {
		return herr.Forbidden("The requestor does not have permission to write Reports on this Event", nil)
	}
	ctx := req.Context()

	authorPersonID := conv.MustInt32(jwtCtx.Claims.DirectoryID())

	reportNumber, err := conv.ParseInt32(req.PathValue("reportNumber"))
	if err != nil {
		return herr.BadRequest("Failed to parse reportNumber", err).From("[ParseInt32]")
	}
	reportEntryId, err := conv.ParseInt32(req.PathValue("reportEntryId"))
	if err != nil {
		return herr.BadRequest("Failed to parse reportEntryId", err).From("[ParseInt32]")
	}

	re, errHTTP := readBodyAs[imsjson.ReportEntry](req)
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

	txn, err := action.imsDBQ.Begin()
	if err != nil {
		return herr.InternalServerError("Error beginning transaction", err).From("[Begin]")
	}
	defer rollback(txn)

	err = action.imsDBQ.SetReportReportEntryStricken(ctx, txn,
		imsdb.SetReportReportEntryStrickenParams{
			Stricken:     *re.Stricken,
			Event:        event.ID,
			ReportNumber: reportNumber,
			ReportEntry:  reportEntryId,
		},
	)
	if err != nil {
		return herr.InternalServerError("Error setting report entry", err).From("[SetReportReportEntryStricken]")
	}
	struckVerb := "Struck"
	if !*re.Stricken {
		struckVerb = "Unstruck"
	}
	_, errHTTP = addReportEntry(ctx, action.imsDBQ, txn, event.ID, reportNumber, authorPersonID, fmt.Sprintf("%v reportEntry %v", struckVerb, reportEntryId), true, "", "", "")
	if errHTTP != nil {
		return errHTTP.From("[addReportEntry]")
	}
	err = txn.Commit()
	if err != nil {
		return herr.InternalServerError("Error committing transaction", err).From("[Commit]")
	}

	defer action.eventSource.notifyReportUpdate(event.ID, reportNumber)

	return nil
}

type EditIncidentReportEntry struct {
	imsDBQ      *store.DBQ
	userStore   *directory.UserStore
	eventSource *EventSourcerer
	imsAdmins   []string
}

func (action EditIncidentReportEntry) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.editIncidentReportEntry(req)
	if errHTTP != nil {
		errHTTP.From("[editIncidentReportEntry]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Success")
}

func (action EditIncidentReportEntry) editIncidentReportEntry(req *http.Request) *herr.HTTPError {
	event, jwtCtx, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore, action.imsAdmins)
	if errHTTP != nil {
		return errHTTP.From("[getEventPermissions]")
	}
	if eventPermissions&(authz.EventWriteIncidents) == 0 {
		return herr.Forbidden("The requestor does not have permission to write Report Entries on this Event", nil)
	}
	ctx := req.Context()

	authorPersonID := conv.MustInt32(jwtCtx.Claims.DirectoryID())

	incidentNumber, err := conv.ParseInt32(req.PathValue("incidentNumber"))
	if err != nil {
		return herr.BadRequest("Failed to parse incidentNumber", err).From("[ParseInt32]")
	}
	reportEntryId, err := conv.ParseInt32(req.PathValue("reportEntryId"))
	if err != nil {
		return herr.BadRequest("Failed to parse reportEntryId", err).From("[ParseInt32]")
	}

	re, errHTTP := readBodyAs[imsjson.ReportEntry](req)
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

	err = action.imsDBQ.SetIncidentReportEntryStricken(ctx, txn,
		imsdb.SetIncidentReportEntryStrickenParams{
			Stricken:       *re.Stricken,
			Event:          event.ID,
			IncidentNumber: incidentNumber,
			ReportEntry:    reportEntryId,
		},
	)
	if err != nil {
		return herr.InternalServerError("Error setting incident report entry", err).From("[SetIncidentReportEntryStricken]")
	}
	struckVerb := "Struck"
	if !*re.Stricken {
		struckVerb = "Unstruck"
	}
	_, errHTTP = addIncidentReportEntry(ctx, action.imsDBQ, txn, event.ID, incidentNumber, authorPersonID, fmt.Sprintf("%v reportEntry %v", struckVerb, reportEntryId), true, "", "", "")
	if errHTTP != nil {
		return errHTTP.From("[addIncidentReportEntry]")
	}
	err = txn.Commit()
	if err != nil {
		return herr.InternalServerError("Error committing transaction", err).From("[Commit]")
	}

	defer action.eventSource.notifyIncidentUpdate(event.ID, incidentNumber)
	return nil
}

type EditVisitReportEntry struct {
	imsDBQ      *store.DBQ
	userStore   *directory.UserStore
	eventSource *EventSourcerer
	imsAdmins   []string
}

func (action EditVisitReportEntry) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.editVisitReportEntry(req)
	if errHTTP != nil {
		errHTTP.From("[editVisitReportEntry]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Success")
}

func (action EditVisitReportEntry) editVisitReportEntry(req *http.Request) *herr.HTTPError {
	event, jwtCtx, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore, action.imsAdmins)
	if errHTTP != nil {
		return errHTTP.From("[getEventPermissions]")
	}
	if eventPermissions&authz.EventWriteVisits == 0 {
		return herr.Forbidden("The requestor does not have permission to write Visits on this Event", nil)
	}
	ctx := req.Context()

	authorPersonID := conv.MustInt32(jwtCtx.Claims.DirectoryID())

	visitNumber, err := conv.ParseInt32(req.PathValue("visitNumber"))
	if err != nil {
		return herr.BadRequest("Failed to parse visitNumber", err).From("[ParseInt32]")
	}
	reportEntryId, err := conv.ParseInt32(req.PathValue("reportEntryId"))
	if err != nil {
		return herr.BadRequest("Failed to parse reportEntryId", err).From("[ParseInt32]")
	}

	re, errHTTP := readBodyAs[imsjson.ReportEntry](req)
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

	err = action.imsDBQ.SetVisitReportEntryStricken(ctx, txn,
		imsdb.SetVisitReportEntryStrickenParams{
			Stricken:    *re.Stricken,
			Event:       event.ID,
			VisitNumber: visitNumber,
			ReportEntry: reportEntryId,
		},
	)
	if err != nil {
		return herr.InternalServerError("Error setting visit report entry", err).From("[SetVisitReportEntryStricken]")
	}
	struckVerb := "Struck"
	if !*re.Stricken {
		struckVerb = "Unstruck"
	}
	_, errHTTP = addVisitReportEntry(ctx, action.imsDBQ, txn, event.ID, visitNumber, authorPersonID, fmt.Sprintf("%v reportEntry %v", struckVerb, reportEntryId), true, "", "", "")
	if errHTTP != nil {
		return errHTTP.From("[addVisitReportEntry]")
	}
	err = txn.Commit()
	if err != nil {
		return herr.InternalServerError("Error committing transaction", err).From("[Commit]")
	}

	defer action.eventSource.notifyVisitUpdate(event.ID, visitNumber)

	return nil
}

// reportEntryToJSON builds the JSON view of a report entry. The author nickname
// is supplied separately (resolved from AUTHOR_PERSON_ID via a PERSON join in the
// fetching query) since the stored row now keys the author on person_id.
func reportEntryToJSON(re imsdb.ReportEntry, author string, attachmentsEnabled bool) imsjson.ReportEntry {
	var attachment imsjson.Attachment
	if attachmentsEnabled && re.AttachedFileOriginalName.Valid {
		attachment.Name = re.AttachedFileOriginalName.String
		attachment.Previewable = previewableContentType(re.AttachedFileMediaType.String)
	}
	return imsjson.ReportEntry{
		ID:          re.ID,
		Created:     time.Unix(int64(re.Created), 0),
		Author:      author,
		SystemEntry: re.Generated,
		Text:        re.Text,
		Stricken:    new(re.Stricken),
		Attachment:  attachment,
	}
}
