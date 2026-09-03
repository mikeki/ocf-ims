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
	"time"

	"github.com/go-sql-driver/mysql"
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

// The report writes — NewReport (create), EditReport (summary/link/journal edit) and
// EditReportJournalEntry (strike, in journalentry.go) — were extracted onto Connect
// (plan 09h/1c): their domain methods live in connect.go (incident.CreateReport,
// incident.UpdateReport, incident.UpdateReportJournalEntry), and the REST POST routes were
// retired, not shimmed (aggressive migration, plan 09 §6). The incident link, which REST
// drove through a "?action=attach|detach" form param, is now reconciled from the Report
// resource's incident field (visit-field convention). addJournalEntry below stays — it is
// shared by those Connect writes and the still-REST report-attachment upload.

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
