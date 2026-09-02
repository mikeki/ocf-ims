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
	"database/sql"
	"fmt"
	"net/http"
	"time"

	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/internal/server"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// EditReportJournalEntry (the strike/unstrike endpoint for a report's journal entries) and
// EditIncidentJournalEntry (the same for an incident's) were both extracted onto Connect (plan
// 09h/1c) as incident.UpdateReportJournalEntry / incident.UpdateIncidentJournalEntry in connect.go;
// their REST POST routes were retired, not shimmed (aggressive migration, plan 09 §6). The shared
// addIncidentJournalEntry helper is unchanged and still used from there. The visit journal-entry
// strike handler below stays REST for now (visits are outside the proto contract, 09e).

type EditVisitJournalEntry struct {
	ImsDBQ      *store.DBQ
	UserStore   directory.UserStore
	EventSource *server.EventSourcerer
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
	event, jwtCtx, eventPermissions, errHTTP := server.GetEventPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return errHTTP.From("[server.GetEventPermissions]")
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

	re, errHTTP := server.ReadBodyAs[imsjson.JournalEntry](req)
	if errHTTP != nil {
		return errHTTP.From("[server.ReadBodyAs]")
	}

	_, err = action.ImsDBQ.Visit(ctx, action.ImsDBQ, imsdb.VisitParams{
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

	txn, err := action.ImsDBQ.Begin()
	if err != nil {
		return herr.InternalServerError("Error beginning transaction", err).From("[Begin]")
	}
	defer server.Rollback(txn)

	err = action.ImsDBQ.SetVisitJournalEntryStricken(ctx, txn,
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
	_, errHTTP = addVisitJournalEntry(ctx, action.ImsDBQ, txn, event.ID, visitNumber, authorPersonID, fmt.Sprintf("%v journalEntry %v", struckVerb, journalEntryId), true, "", "", "")
	if errHTTP != nil {
		return errHTTP.From("[addVisitJournalEntry]")
	}
	err = txn.Commit()
	if err != nil {
		return herr.InternalServerError("Error committing transaction", err).From("[Commit]")
	}

	defer action.EventSource.NotifyVisitUpdate(event.ID, visitNumber)

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
