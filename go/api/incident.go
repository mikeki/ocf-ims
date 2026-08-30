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
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/internal/server"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"golang.org/x/sync/errgroup"
)

type GetIncidents struct {
	imsDBQ             *store.DBQ
	userStore          directory.UserStore
	attachmentsEnabled bool
}

func (action GetIncidents) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.getIncidents(req)
	if errHTTP != nil {
		errHTTP.From("[getIncidents]").WriteResponse(w)
		return
	}
	server.MustWriteJSON(w, req, resp)
}

func (action GetIncidents) getIncidents(req *http.Request) (imsjson.Incidents, *herr.HTTPError) {
	resp := make(imsjson.Incidents, 0)
	event, jwt, eventPermissions, errHTTP := server.GetEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return resp, errHTTP.From("[server.GetEventPermissions]")
	}
	hasEventRead := eventPermissions&authz.EventReadIncidents != 0
	viewerPersonID := jwt.Claims.PersonID()
	viewerIsAdmin := jwt.Claims.PersonAdmin()

	// Per-incident grants (52f) now do double duty: they're the only incidents a
	// reporter without event-wide read may see, AND they reveal a private incident to
	// a granted viewer who otherwise couldn't. Admins bypass both (mayViewIncident),
	// so skip the query for them. A non-admin with neither the read bit nor any grant
	// stays forbidden, so volunteer/public access isn't loosened.
	grantedSet := map[int32]bool{}
	if !viewerIsAdmin {
		grantedNums, err := action.imsDBQ.GrantedIncidentNumbersForPerson(req.Context(), action.imsDBQ,
			imsdb.GrantedIncidentNumbersForPersonParams{Event: event.ID, PersonID: viewerPersonID})
		if err != nil {
			return nil, herr.InternalServerError("Failed to fetch granted incidents", err).From("[GrantedIncidentNumbersForPerson]")
		}
		if !hasEventRead && len(grantedNums) == 0 {
			return nil, herr.Forbidden("The requestor does not have EventReadIncidents permission", nil)
		}
		for _, n := range grantedNums {
			grantedSet[n] = true
		}
	}
	err := req.ParseForm()
	if err != nil {
		return nil, herr.BadRequest("Failed to parse form", err)
	}
	includeSystemEntries := !strings.EqualFold(req.Form.Get("exclude_system_entries"), "true")

	// The Incidents and JournalEntries queries both request a lot of data, and we can query
	// and process those results concurrently.
	group, groupCtx := errgroup.WithContext(req.Context())

	entriesByIncident := make(map[int32][]imsjson.JournalEntry)
	group.Go(func() error {
		journalEntries, err := action.imsDBQ.Incidents_JournalEntries(
			groupCtx,
			action.imsDBQ,
			imsdb.Incidents_JournalEntriesParams{
				Event:     event.ID,
				Generated: includeSystemEntries,
			},
		)
		if err != nil {
			return herr.InternalServerError("Failed to fetch Incident Journal Entries", err).From("[Incidents_JournalEntries]")
		}
		for _, row := range journalEntries {
			entriesByIncident[row.IncidentNumber] = append(
				entriesByIncident[row.IncidentNumber],
				// Incidents don't set "on behalf of" (6m is reports-only for now).
				journalEntryToJSON(row.JournalEntry, row.Author.String, nil, action.attachmentsEnabled),
			)
		}
		return nil
	})

	peopleByIncident := make(map[int32][]imsjson.IncidentPerson)
	group.Go(func() error {
		peopleRows, err := action.imsDBQ.Incidents_People(groupCtx, action.imsDBQ, event.ID)
		if err != nil {
			return herr.InternalServerError("Failed to fetch people", err).From("[Incidents_People]")
		}
		for _, row := range peopleRows {
			peopleByIncident[row.IncidentPerson.IncidentNumber] = append(peopleByIncident[row.IncidentPerson.IncidentNumber],
				imsjson.IncidentPerson{PersonID: int64(row.IncidentPerson.PersonID), Handle: row.Handle.String, Name: row.Name.String, Involvement: conv.SqlToString(row.IncidentPerson.Involvement), GrantedAccess: row.IncidentPerson.GrantedAccess, HasEventAccess: row.HasEventAccess.Bool})
		}
		return nil
	})

	var incidentsRows []imsdb.IncidentsRow
	group.Go(func() error {
		var err error
		incidentsRows, err = action.imsDBQ.Incidents(groupCtx, action.imsDBQ, event.ID)
		if err != nil {
			return herr.InternalServerError("Failed to fetch Incidents", err).From("[Incidents]")
		}
		return nil
	})
	err = group.Wait()
	if err != nil {
		return resp, herr.AsHTTPError(err)
	}

	for _, r := range incidentsRows {
		// One check covers both the granted-reporter scope (52f) and the private flag:
		// a private incident is dropped for anyone who isn't its creator, an admin, or
		// a grant-holder; a reporter without event read still sees only granted ones.
		if !mayViewIncident(r.Incident.Private, r.Incident.CreatedBy, viewerPersonID, viewerIsAdmin, hasEventRead, grantedSet[r.Incident.Number]) {
			continue
		}
		// The conversion from IncidentsRow to IncidentRow works because the Incident and Incidents
		// query row structs currently have the same fields in the same order. If that changes in the
		// future, this won't compile, and we may need to duplicate the readExtraIncidentRowFields
		// function.
		incidentRow := imsdb.IncidentRow(r)

		// we don't bother looking up linked incidents for the GetIncidents call
		var emptyLinkedIncidents []imsdb.Incident_LinkedIncidentsRow

		incJSON, errHTTP := incidentToJSON(incidentRow, peopleByIncident[r.Incident.Number], entriesByIncident[r.Incident.Number], emptyLinkedIncidents, event, action.attachmentsEnabled)
		if errHTTP != nil {
			return resp, errHTTP.From("[incidentToJSON]")
		}
		resp = append(resp, incJSON)
	}

	return resp, nil
}

type GetIncident struct {
	imsDBQ             *store.DBQ
	userStore          directory.UserStore
	attachmentsEnabled bool
}

func (action GetIncident) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.getIncident(req)
	if errHTTP != nil {
		errHTTP.From("[getIncident]").WriteResponse(w)
		return
	}
	server.MustWriteJSON(w, req, resp)
}

func (action GetIncident) getIncident(req *http.Request) (imsjson.Incident, *herr.HTTPError) {
	var resp imsjson.Incident

	event, jwt, eventPermissions, errHTTP := server.GetEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return resp, errHTTP.From("[server.GetEventPermissions]")
	}
	ctx := req.Context()

	incidentNumber, err := conv.ParseInt32(req.PathValue("incidentNumber"))
	if err != nil {
		return resp, herr.BadRequest("Failed to parse incident number", err)
	}

	hasEventRead := eventPermissions&authz.EventReadIncidents != 0
	viewerPersonID := jwt.Claims.PersonID()
	viewerIsAdmin := jwt.Claims.PersonAdmin()

	// 52f: without event-wide incident read, allow only if the caller has a
	// per-incident grant (an involved reporter). Deny before the DB fetch so we
	// don't leak the incident's existence. hasGrant also decides whether the detail
	// page may show the journal-add box (viewer_may_add_journal below).
	hasGrant := false
	if !hasEventRead {
		hasGrant, err = action.imsDBQ.IncidentPersonHasGrant(ctx, action.imsDBQ, imsdb.IncidentPersonHasGrantParams{
			Event: event.ID, IncidentNumber: incidentNumber, PersonID: viewerPersonID,
		})
		if err != nil {
			return resp, herr.InternalServerError("Failed to check incident grant", err).From("[IncidentPersonHasGrant]")
		}
		if !hasGrant {
			return resp, herr.Forbidden("The requestor does not have EventReadIncidents permission on this Event", nil)
		}
	}

	storedRow, journalEntries, errHTTP := fetchIncident(ctx, action.imsDBQ, event.ID, incidentNumber, action.attachmentsEnabled)
	if errHTTP != nil {
		return resp, errHTTP.From("[fetchIncident]")
	}

	// A private incident is off-limits to event-wide readers who aren't its creator,
	// an admin, or a grant-holder. If a grant hasn't already been confirmed (i.e. the
	// caller reached here via event-wide read), check for one now; still no access →
	// 404 so the incident's very existence stays hidden.
	if storedRow.Incident.Private && !hasGrant && !viewerIsAdmin &&
		!(storedRow.Incident.CreatedBy.Valid && storedRow.Incident.CreatedBy.Int32 == viewerPersonID) {
		hasGrant, err = action.imsDBQ.IncidentPersonHasGrant(ctx, action.imsDBQ, imsdb.IncidentPersonHasGrantParams{
			Event: event.ID, IncidentNumber: incidentNumber, PersonID: viewerPersonID,
		})
		if err != nil {
			return resp, herr.InternalServerError("Failed to check incident grant", err).From("[IncidentPersonHasGrant]")
		}
		if !hasGrant {
			return resp, herr.NotFound("Incident not found", nil)
		}
	}

	permsByEvent, errHTTP := server.PermissionsByEvent(req.Context(), jwt, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return resp, errHTTP.From("[server.PermissionsByEvent]")
	}

	peopleRows, err := action.imsDBQ.Incident_People(ctx, action.imsDBQ, imsdb.Incident_PeopleParams{
		Event:          event.ID,
		IncidentNumber: incidentNumber,
	})
	if err != nil {
		return resp, herr.InternalServerError("Failed to fetch people", err)
	}
	people := make([]imsjson.IncidentPerson, len(peopleRows))
	for i, row := range peopleRows {
		people[i] = imsjson.IncidentPerson{PersonID: int64(row.IncidentPerson.PersonID), Handle: row.Handle.String, Name: row.Name.String, Involvement: conv.SqlToString(row.IncidentPerson.Involvement), GrantedAccess: row.IncidentPerson.GrantedAccess, HasEventAccess: row.HasEventAccess.Bool}
	}

	linkedIncidents, err := action.imsDBQ.Incident_LinkedIncidents(ctx, action.imsDBQ, imsdb.Incident_LinkedIncidentsParams{
		Event1:          event.ID,
		IncidentNumber1: incidentNumber,
	})
	if err != nil {
		return resp, herr.InternalServerError("Failed to fetch linked incidents", err)
	}
	for i := range linkedIncidents {
		li := linkedIncidents[i]
		noEventRead := permsByEvent[li.LinkedEvent]&authz.EventReadIncidents == 0
		// Withhold a private linked incident's summary from anyone who isn't an admin
		// or its creator. The link's event/number stay visible (a grant-holder can open
		// it directly); only the summary content is hidden here.
		privateHidden := li.LinkedIncidentPrivate && !viewerIsAdmin &&
			!(li.LinkedIncidentCreatedBy.Valid && li.LinkedIncidentCreatedBy.Int32 == viewerPersonID)
		if noEventRead || privateHidden {
			linkedIncidents[i].LinkedIncidentSummary = sql.NullString{}
		}
	}

	resp, errHTTP = incidentToJSON(storedRow, people, journalEntries, linkedIncidents, event, action.attachmentsEnabled)
	if errHTTP != nil {
		return resp, errHTTP.From("[incidentToJSON]")
	}
	// 52f: a writer (or admin) may always add journal entries; an involved reporter
	// may too, but only on incidents they were granted.
	resp.ViewerMayAddJournal = eventPermissions&authz.EventWriteIncidents != 0 || hasGrant
	return resp, nil
}

func incidentToJSON(storedRow imsdb.IncidentRow, incidentPeople []imsjson.IncidentPerson,
	resultEntries []imsjson.JournalEntry, linkedIncidents []imsdb.Incident_LinkedIncidentsRow,
	event imsdb.Event, attachmentsEnabled bool,
) (imsjson.Incident, *herr.HTTPError) {
	var resp imsjson.Incident

	linkedIncidentJson := make([]imsjson.LinkedIncident, len(linkedIncidents))
	for i, li := range linkedIncidents {
		linkedIncidentJson[i] = imsjson.LinkedIncident{
			EventID:   li.LinkedEvent,
			EventName: li.LinkedEventName,
			Number:    li.LinkedIncident,
			Summary:   li.LinkedIncidentSummary.String,
		}
	}

	peopleJson := incidentPeople

	incidentTypeIDs, reportNumbers, visitNumbers, err := readExtraIncidentRowFields(storedRow)
	if err != nil {
		return resp, herr.InternalServerError("Failed to fetch Incident details", err).From("[readExtraIncidentRowFields]")
	}

	lastModified := conv.FloatToTime(storedRow.Incident.Created)
	for _, re := range resultEntries {
		if re.Created.After(lastModified) {
			lastModified = re.Created
		}
	}
	resp = imsjson.Incident{
		Event:        event.Name,
		EventID:      event.ID,
		Number:       storedRow.Incident.Number,
		Created:      conv.FloatToTime(storedRow.Incident.Created),
		LastModified: lastModified,
		CreatedBy:    createdByJSON(storedRow.Incident.CreatedBy, storedRow.CreatedByHandle, storedRow.CreatedByName),
		State:        string(storedRow.Incident.State),
		Private:      &storedRow.Incident.Private,
		OutcomeID:    conv.SqlToInt32(storedRow.Incident.OutcomeID),
		Started:      conv.FloatToTime(storedRow.Incident.Started),
		Closed:       conv.NullFloatToTime(storedRow.Incident.Closed),
		Priority:     storedRow.Incident.Priority,
		Summary:      conv.SqlToString(storedRow.Incident.Summary),
		Location: imsjson.Location{
			AreaSlug:    conv.SqlToString(storedRow.Incident.LocationAreaSlug),
			Description: conv.SqlToString(storedRow.Incident.LocationDescription),
			Booth:       conv.SqlToString(storedRow.Incident.LocationBooth),
		},
		IncidentTypeIDs: &incidentTypeIDs,
		Reports:         &reportNumbers,
		Visits:          &visitNumbers,
		People:          &peopleJson,
		JournalEntries:  resultEntries,
		LinkedIncidents: &linkedIncidentJson,
	}
	return resp, nil
}

// mayViewIncident reports whether a caller may see an incident, honoring the
// PRIVATE flag. A non-private incident follows the normal rule: event-wide
// incident read, or a per-incident grant (52f). A private incident is visible
// ONLY to an admin, its creator, or someone granted per-incident access —
// event-wide read (a writer/crew-leader) is deliberately not sufficient.
func mayViewIncident(private bool, createdBy sql.NullInt32, viewerPersonID int32, viewerIsAdmin, hasEventRead, hasGrant bool) bool {
	if private {
		return viewerIsAdmin || (createdBy.Valid && createdBy.Int32 == viewerPersonID) || hasGrant
	}
	return hasEventRead || hasGrant
}

func fetchIncident(ctx context.Context, imsDBQ *store.DBQ, eventID, incidentNumber int32, attachmentsEnabled bool) (
	imsdb.IncidentRow, []imsjson.JournalEntry, *herr.HTTPError,
) {
	var empty imsdb.IncidentRow
	var journalEntries []imsjson.JournalEntry
	incidentRow, err := imsDBQ.Incident(ctx, imsDBQ,
		imsdb.IncidentParams{
			Event:  eventID,
			Number: incidentNumber,
		},
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return empty, nil, herr.NotFound("Incident not found", err).From("[Incident]")
		}
		return empty, nil, herr.InternalServerError("Failed to fetch Incident", err).From("[Incident]")
	}
	journalEntryRows, err := imsDBQ.Incident_JournalEntries(ctx, imsDBQ,
		imsdb.Incident_JournalEntriesParams{
			Event:          eventID,
			IncidentNumber: incidentNumber,
		},
	)
	if err != nil {
		return empty, nil, herr.InternalServerError("Failed to fetch journal entries", err).From("[Incident_JournalEntries]")
	}
	for _, rer := range journalEntryRows {
		journalEntries = append(journalEntries, journalEntryToJSON(rer.JournalEntry, rer.Author.String, nil, attachmentsEnabled))
	}
	// Attach @mention rows (plan 81) to their entries for rendering/linking.
	mentionRows, err := imsDBQ.Incident_JournalEntryMentions(ctx, imsDBQ,
		imsdb.Incident_JournalEntryMentionsParams{
			Event:          eventID,
			IncidentNumber: incidentNumber,
		},
	)
	if err != nil {
		return empty, nil, herr.InternalServerError("Failed to fetch journal entry mentions", err).From("[Incident_JournalEntryMentions]")
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
	return incidentRow, journalEntries, nil
}

func addIncidentJournalEntry(
	ctx context.Context, db *store.DBQ, dbtx imsdb.DBTX,
	eventID, incidentNum int32, authorPersonID int32, text string, generated bool,
	attachment, attachmentOriginalName, attachmentMediaType string,
) (int32, *herr.HTTPError) {
	reID64, err := db.CreateJournalEntry(ctx, dbtx, imsdb.CreateJournalEntryParams{
		AuthorPersonID:           authorPersonID,
		Text:                     text,
		Created:                  conv.TimeToFloat(time.Now()),
		Generated:                generated,
		Stricken:                 false,
		AttachedFile:             conv.StringToSql(&attachment, 128),
		AttachedFileOriginalName: conv.StringToSql(&attachmentOriginalName, 128),
		AttachedFileMediaType:    conv.StringToSql(&attachmentMediaType, 128),
	})
	if err != nil {
		return 0, herr.InternalServerError("Failed to create journal entry", err).From("[MustInt32]")
	}
	// This column is an int32, so this is safe
	reID := conv.MustInt32(reID64)
	err = db.AttachJournalEntryToIncident(ctx, dbtx, imsdb.AttachJournalEntryToIncidentParams{
		Event:          eventID,
		IncidentNumber: incidentNum,
		JournalEntry:   reID,
	})
	if err != nil {
		return 0, herr.InternalServerError("Failed to attach journal entry", err).From("[AttachJournalEntryToIncident]")
	}
	return reID, nil
}

// personChangeLog returns the system-journal lines for a person attach/edit on an
// incident. Because an attach is a detach-then-reattach replace, the caller passes
// the person's pre-existing state (alreadyAttached, plus their old involvement and
// grant): a first-time add records the add along with any involvement and access
// grant, while an edit records only the involvement and/or access-grant that
// actually changed — so re-saving an unchanged person writes nothing. Returns an
// empty slice when there is nothing to record.
func personChangeLog(name string, alreadyAttached bool, oldInvolvement, newInvolvement sql.NullString, oldGranted, newGranted bool) []string {
	if !alreadyAttached {
		lines := []string{fmt.Sprintf("Added person: %v", name)}
		if newInvolvement.Valid {
			lines = append(lines, fmt.Sprintf("Set involvement for %v: %v", name, newInvolvement.String))
		}
		if newGranted {
			lines = append(lines, fmt.Sprintf("Granted incident access to %v", name))
		}
		return lines
	}
	var lines []string
	if newInvolvement != oldInvolvement {
		if newInvolvement.Valid {
			lines = append(lines, fmt.Sprintf("Changed involvement for %v: %v", name, newInvolvement.String))
		} else {
			lines = append(lines, fmt.Sprintf("Cleared involvement for %v", name))
		}
	}
	if newGranted != oldGranted {
		if newGranted {
			lines = append(lines, fmt.Sprintf("Granted incident access to %v", name))
		} else {
			lines = append(lines, fmt.Sprintf("Revoked incident access from %v", name))
		}
	}
	return lines
}

// addJournalEntryMentions records the @mention rows for a freshly-created
// journal entry (plan 81). It records both the people the author picked via the
// "@" typeahead (explicitPersonIDs) and any "@handle" they typed by hand without
// picking — the latter resolved from the directory by resolveTypedMentionIDs, so
// a fat-fingered or pasted mention still notifies the right person. The insert is
// insert-ignore, so a person appearing in both lists, a duplicate, or a
// stale/non-existent ID is silently skipped rather than aborting the surrounding
// transaction — a dropped bad ID is the fail-safe outcome.
func addJournalEntryMentions(
	ctx context.Context, db *store.DBQ, userStore directory.UserStore, dbtx imsdb.DBTX,
	journalEntryID int32, text string, explicitPersonIDs []int32,
) *herr.HTTPError {
	typed, err := resolveTypedMentionIDs(ctx, userStore, text)
	if err != nil {
		return herr.InternalServerError("Failed to resolve typed mentions", err).From("[resolveTypedMentionIDs]")
	}
	personIDs := append(append([]int32(nil), explicitPersonIDs...), typed...)
	for _, personID := range personIDs {
		if personID <= 0 {
			continue
		}
		err := db.CreateJournalEntryMention(ctx, dbtx, imsdb.CreateJournalEntryMentionParams{
			JournalEntry: journalEntryID,
			PersonID:     personID,
		})
		if err != nil {
			return herr.InternalServerError("Failed to record journal entry mention", err).From("[CreateJournalEntryMention]")
		}
	}
	return nil
}

// mentionTokenRe finds "@token" mention candidates an author typed by hand: an
// "@" at the start of the text or right after whitespace, then a run of
// non-whitespace. This mirrors the frontend "@" typeahead trigger
// (currentMentionQuery in ims.ts), which only fires on an "@" at start-of-text or
// after whitespace and stops at the next whitespace — so a mid-word "@" (an email
// address) is not treated as a mention here either.
var mentionTokenRe = regexp.MustCompile(`(?:^|\s)@(\S+)`)

// resolveTypedMentionIDs scans journal text for "@handle" mentions and returns
// the person IDs whose handle matches one (case-insensitively). It's the safety
// net for when an author types "@handle" without picking from the "@" typeahead:
// the frontend records no person ID in that case, so without this the mention
// would notify nobody. Only exact handle matches resolve — display names (which
// contain spaces and so are ambiguous in free text) are intentionally not
// matched — and trailing punctuation is trimmed so "@bob." and "@bob," resolve.
func resolveTypedMentionIDs(ctx context.Context, userStore directory.UserStore, text string) ([]int32, error) {
	if !strings.Contains(text, "@") {
		return nil, nil
	}
	matches := mentionTokenRe.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return nil, nil
	}
	users, err := userStore.GetAllUsers(ctx)
	if err != nil {
		return nil, err
	}
	idByHandle := make(map[string]int32, len(users))
	for _, u := range users {
		if u.Handle != "" {
			idByHandle[strings.ToLower(u.Handle)] = int32(u.ID)
		}
	}
	var ids []int32
	for _, m := range matches {
		token := strings.ToLower(strings.TrimRight(m[1], `.,;:!?)]}'"`))
		if id, ok := idByHandle[token]; ok {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

type NewIncident struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
	es        *server.EventSourcerer
	pusher    *server.Pusher
	metrics   *server.MetricsCache
}

func (action NewIncident) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	number, location, errHTTP := action.newIncident(req)
	if errHTTP != nil {
		errHTTP.From("[newIncident]").WriteResponse(w)
		return
	}

	w.Header().Set("IMS-Incident-Number", strconv.Itoa(int(number)))
	w.Header().Set("Location", location)
	herr.WriteCreatedResponse(w, http.StatusText(http.StatusCreated))
}
func (action NewIncident) newIncident(req *http.Request) (incidentNumber int32, location string, errHTTP *herr.HTTPError) {
	event, jwtCtx, eventPermissions, errHTTP := server.GetEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return 0, "", errHTTP.From("[server.GetEventPermissions]")
	}
	if eventPermissions&authz.EventWriteIncidents == 0 {
		return 0, "", herr.Forbidden("The requestor does not have EventWriteIncidents permission on this Event", nil)
	}
	ctx := req.Context()
	newIncident, errHTTP := server.ReadBodyAs[imsjson.Incident](req)
	if errHTTP != nil {
		return 0, "", errHTTP.From("[server.ReadBodyAs]")
	}

	authorPersonID := jwtCtx.Claims.PersonID()

	// First create the incident, to lock in the incident number reservation
	newIncidentNumber, err := action.imsDBQ.NextIncidentNumber(ctx, action.imsDBQ, event.ID)
	if err != nil {
		return 0, "", herr.InternalServerError("Failed to find next Incident number", err).From("[NextIncidentNumber]")
	}
	newIncident.EventID = event.ID
	newIncident.Event = event.Name
	newIncident.Number = newIncidentNumber
	now := conv.TimeToFloat(time.Now())
	createTheIncident := imsdb.CreateIncidentParams{
		Event:     newIncident.EventID,
		Number:    newIncidentNumber,
		Created:   now,
		Started:   now,
		Priority:  imsjson.IncidentPriorityNormal,
		State:     imsdb.IncidentStateOpen,
		CreatedBy: sql.NullInt32{Int32: authorPersonID, Valid: true},
	}
	_, err = action.imsDBQ.CreateIncident(ctx, action.imsDBQ, createTheIncident)
	if err != nil {
		return 0, "", herr.InternalServerError("Failed to create incident", err).From("[CreateIncident]")
	}

	errHTTP = updateIncident(ctx, action.imsDBQ, action.userStore, action.es, action.pusher, newIncident, authorPersonID, jwtCtx.Claims.PersonAdmin())
	if errHTTP != nil {
		return 0, "", errHTTP.From("[updateIncident]")
	}

	// A new incident shifts the dashboard aggregate for this event.
	action.metrics.InvalidateEvent(event.Name)

	return newIncident.Number, fmt.Sprintf("/ims/api/events/%v/incidents/%d", event.Name, newIncident.Number), nil
}

func unmarshalByteSlice[T any](isByteSlice any) (T, error) {
	var result T
	b, ok := isByteSlice.([]byte)
	if !ok {
		return result, fmt.Errorf("could not read object as []bytes. Was actually %T", b)
	}
	err := json.Unmarshal(b, &result)
	if err != nil {
		return result, fmt.Errorf("[Unmarshal]: %w", err)
	}
	return result, nil
}

func readExtraIncidentRowFields(row imsdb.IncidentRow) (incidentTypeIDs, reportNumbers, visitNumbers []int32, err error) {
	incidentTypeIDs, err = unmarshalByteSlice[[]int32](row.IncidentTypeIds)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("[unmarshalByteSlice]: %w", err)
	}
	reportNumbers, err = unmarshalByteSlice[[]int32](row.ReportNumbers)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("[unmarshalByteSlice]: %w", err)
	}
	visitNumbers, err = unmarshalByteSlice[[]int32](row.VisitNumbers)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("[unmarshalByteSlice]: %w", err)
	}
	return incidentTypeIDs, reportNumbers, visitNumbers, nil
}

// isJournalOnly reports whether an incident edit payload only appends journal entries
// and changes no other field (52f). It backs the granted-reporter write path: such a
// caller may add to the incident's running log but may not touch state/type/priority/
// people/links/etc. Mirrors the zero/nil "no change" semantics updateIncident uses.
func isJournalOnly(inc imsjson.Incident) bool {
	return len(inc.JournalEntries) > 0 &&
		inc.State == "" &&
		inc.Priority == 0 &&
		inc.OutcomeID == nil &&
		inc.Started.IsZero() &&
		inc.Summary == nil &&
		inc.Private == nil &&
		inc.Location.AreaSlug == nil &&
		inc.Location.Description == nil &&
		inc.Location.Booth == nil &&
		inc.IncidentTypeIDs == nil &&
		inc.Reports == nil &&
		inc.Visits == nil &&
		inc.People == nil &&
		inc.LinkedIncidents == nil
}

func updateIncident(ctx context.Context, imsDBQ *store.DBQ, userStore directory.UserStore, es *server.EventSourcerer, pusher *server.Pusher, newIncident imsjson.Incident, authorPersonID int32, callerIsAdmin bool,
) *herr.HTTPError {
	storedIncidentRow, err := imsDBQ.Incident(ctx, imsDBQ,
		imsdb.IncidentParams{
			Event:  newIncident.EventID,
			Number: newIncident.Number,
		},
	)
	if err != nil {
		return herr.InternalServerError("Failed to fetch incident", err).From("[Incident]")
	}
	storedIncident := storedIncidentRow.Incident

	allEvents, err := imsDBQ.Events(ctx, imsDBQ)
	if err != nil {
		return herr.InternalServerError("Failed to fetch events", err).From("[Events]")
	}
	eventNameById := make(map[int32]string)
	for _, event := range allEvents {
		eventNameById[event.Event.ID] = event.Event.Name
	}

	// Look up the incident types before starting the transaction, to avoid DB connection contention.
	var allIncidentTypes []imsdb.IncidentTypesRow
	if newIncident.IncidentTypeIDs != nil {
		allIncidentTypes, err = imsDBQ.IncidentTypes(ctx, imsDBQ)
		if err != nil {
			return herr.InternalServerError("Failed to get incident types", err).From("[IncidentTypes]")
		}
	}

	// Likewise load outcomes before the transaction, to validate an outcome edit and
	// resolve its display name for the journal line. Only needed when setting (not
	// clearing) an outcome; a 0 clears and needs no lookup.
	var allOutcomes []imsdb.OutcomesRow
	if newIncident.OutcomeID != nil && *newIncident.OutcomeID != 0 {
		allOutcomes, err = imsDBQ.Outcomes(ctx, imsDBQ)
		if err != nil {
			return herr.InternalServerError("Failed to get outcomes", err).From("[Outcomes]")
		}
	}

	linkedIncidents, err := imsDBQ.Incident_LinkedIncidents(ctx, imsDBQ, imsdb.Incident_LinkedIncidentsParams{
		Event1:          storedIncident.Event,
		IncidentNumber1: storedIncident.Number,
	})
	if err != nil {
		return herr.InternalServerError("Failed to fetch linked incidents", err)
	}

	incidentTypeIDs, reportNumbers, visitNumbers, err := readExtraIncidentRowFields(storedIncidentRow)
	if err != nil {
		return herr.InternalServerError("Failed to read incident details", err).From("[readExtraIncidentRowFields]")
	}

	txn, err := imsDBQ.Begin()
	if err != nil {
		return herr.InternalServerError("Failed to start transaction", err).From("[Begin]")
	}
	defer server.Rollback(txn)

	update := imsdb.UpdateIncidentParams{
		Event:               storedIncident.Event,
		Number:              storedIncident.Number,
		Priority:            storedIncident.Priority,
		State:               storedIncident.State,
		OutcomeID:           storedIncident.OutcomeID,
		Started:             storedIncident.Started,
		Closed:              storedIncident.Closed,
		Summary:             storedIncident.Summary,
		LocationDescription: storedIncident.LocationDescription,
		LocationAreaSlug:    storedIncident.LocationAreaSlug,
		LocationBooth:       storedIncident.LocationBooth,
		Private:             storedIncident.Private,
	}

	var logs []string

	// Privacy is writable only by an admin or the incident's creator (at create time
	// the caller is the creator). A granted reporter never reaches here for a privacy
	// change — isJournalOnly treats a Private payload as a non-journal edit, so the
	// write-permission gate rejects it first.
	if newIncident.Private != nil {
		if !callerIsAdmin && !(storedIncident.CreatedBy.Valid && storedIncident.CreatedBy.Int32 == authorPersonID) {
			return herr.Forbidden("Only an admin or the incident creator may change incident privacy", nil)
		}
		if *newIncident.Private != storedIncident.Private {
			update.Private = *newIncident.Private
			if *newIncident.Private {
				logs = append(logs, "Marked incident private")
			} else {
				logs = append(logs, "Marked incident public")
			}
		}
	}

	// Scalar fields log a "Changed …" entry only when the submitted value actually
	// differs from what's stored. The edit form re-submits every field, so a
	// presence check alone would record phantom changes on an unrelated edit; the
	// value comparison keeps the journal honest.
	if newIncident.Priority != 0 && newIncident.Priority != storedIncident.Priority {
		update.Priority = newIncident.Priority
		logs = append(logs, fmt.Sprintf("Changed priority: %v", update.Priority))
	}
	if newState := imsdb.IncidentState(newIncident.State); newState.Valid() && newState != storedIncident.State {
		update.State = newState
		logs = append(logs, fmt.Sprintf("Changed state: %v", update.State))
		if newState == imsdb.IncidentStateClosed {
			update.Closed = conv.TimeToNullFloat(time.Now())
		} else {
			update.Closed = sql.NullFloat64{}
		}
	}
	// OUTCOME_ID is orthogonal to STATE. Unlike STATE (which silently ignores
	// unknown values), an outcome id that references no OUTCOME row is rejected with
	// 400. nil leaves the existing outcome unchanged; 0 clears it.
	if newIncident.OutcomeID != nil {
		if *newIncident.OutcomeID == 0 {
			if storedIncident.OutcomeID.Valid {
				update.OutcomeID = sql.NullInt32{}
				logs = append(logs, "Cleared outcome")
			}
		} else if !storedIncident.OutcomeID.Valid || storedIncident.OutcomeID.Int32 != *newIncident.OutcomeID {
			var outcomeName string
			found := false
			for _, o := range allOutcomes {
				if o.Outcome.ID == *newIncident.OutcomeID {
					outcomeName = o.Outcome.Name
					found = true
					break
				}
			}
			if !found {
				return herr.BadRequest(fmt.Sprintf("Invalid outcome id: %v", *newIncident.OutcomeID), nil)
			}
			update.OutcomeID = sql.NullInt32{Int32: *newIncident.OutcomeID, Valid: true}
			logs = append(logs, fmt.Sprintf("Changed outcome: %v", outcomeName))
		}
	}
	if !newIncident.Started.IsZero() {
		newStarted := conv.TimeToFloat(newIncident.Started)
		if newStarted != storedIncident.Started {
			update.Started = newStarted
			logs = append(logs, fmt.Sprintf("Changed start time: %v", newIncident.Started.In(time.UTC).Format(time.RFC3339)))
		}
	}
	if newIncident.Summary != nil {
		newSummary := conv.StringToSql(newIncident.Summary, 0)
		if newSummary != storedIncident.Summary {
			update.Summary = newSummary
			logs = append(logs, fmt.Sprintf("Changed summary: %v", update.Summary.String))
		}
	}
	if newIncident.Location.Description != nil {
		newDescription := conv.StringToSql(newIncident.Location.Description, 0)
		if newDescription != storedIncident.LocationDescription {
			update.LocationDescription = newDescription
			logs = append(logs, fmt.Sprintf("Changed location description: %v", update.LocationDescription.String))
		}
	}
	if newIncident.Location.Booth != nil {
		newBooth := conv.StringToSql(newIncident.Location.Booth, 32)
		if newBooth != storedIncident.LocationBooth {
			update.LocationBooth = newBooth
			logs = append(logs, fmt.Sprintf("Changed location booth: %v", update.LocationBooth.String))
		}
	}
	if newIncident.Location.AreaSlug != nil {
		slug := strings.TrimSpace(*newIncident.Location.AreaSlug)
		if slug == "" {
			// Empty string clears the structured area, leaving only the freeform detail.
			if storedIncident.LocationAreaSlug.Valid {
				update.LocationAreaSlug = sql.NullString{}
				logs = append(logs, "Cleared location area")
			}
		} else if !storedIncident.LocationAreaSlug.Valid || storedIncident.LocationAreaSlug.String != slug {
			// The area must belong to this incident's event; the FK would also
			// reject a stray slug, but a 400 is clearer than a 500 on constraint.
			_, err = imsDBQ.Area(ctx, imsDBQ, imsdb.AreaParams{
				Event: storedIncident.Event,
				Slug:  slug,
			})
			if err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return herr.BadRequest(fmt.Sprintf("Unknown area for this event: %v", slug), err)
				}
				return herr.InternalServerError("Failed to look up area", err).From("[Area]")
			}
			update.LocationAreaSlug = sql.NullString{String: slug, Valid: true}
			logs = append(logs, fmt.Sprintf("Changed location area: %v", slug))
		}
	}
	err = imsDBQ.UpdateIncident(ctx, txn, update)
	if err != nil {
		return herr.InternalServerError("Failed to update incident", err).From("[UpdateIncident]")
	}

	if newIncident.IncidentTypeIDs != nil {
		add := sliceSubtract(*newIncident.IncidentTypeIDs, incidentTypeIDs)
		sub := sliceSubtract(incidentTypeIDs, *newIncident.IncidentTypeIDs)
		if len(add) > 0 {
			names := namesForIncidentTypes(allIncidentTypes, add)
			logs = append(logs, fmt.Sprintf("Added type: %v", names))
			for _, itype := range add {
				err = imsDBQ.AttachIncidentTypeToIncident(ctx, txn,
					imsdb.AttachIncidentTypeToIncidentParams{
						Event:          newIncident.EventID,
						IncidentNumber: newIncident.Number,
						IncidentType:   itype,
					},
				)
				if err != nil {
					return herr.InternalServerError("Failed to add Incident Type", err).From("[AttachIncidentTypeToIncident]")
				}
			}
		}
		if len(sub) > 0 {
			names := namesForIncidentTypes(allIncidentTypes, sub)
			logs = append(logs, fmt.Sprintf("Removed type: %v", names))
			for _, rh := range sub {
				err = imsDBQ.DetachIncidentTypeFromIncident(ctx, txn,
					imsdb.DetachIncidentTypeFromIncidentParams{
						Event:          newIncident.EventID,
						IncidentNumber: newIncident.Number,
						IncidentType:   rh,
					},
				)
				if err != nil {
					return herr.InternalServerError("Failed to detach Incident Type", err).From("[AttachIncidentTypeToIncident]")
				}
			}
		}
	}
	var updatedReports []int32
	if newIncident.Reports != nil {
		add := sliceSubtract(*newIncident.Reports, reportNumbers)
		sub := sliceSubtract(reportNumbers, *newIncident.Reports)
		updatedReports = append(updatedReports, add...)
		updatedReports = append(updatedReports, sub...)

		if len(add) > 0 {
			logs = append(logs, fmt.Sprintf("Report added: %v", add))
			for _, reportNum := range add {
				err = imsDBQ.AttachReportToIncident(ctx, txn,
					imsdb.AttachReportToIncidentParams{
						Event:          newIncident.EventID,
						Number:         reportNum,
						IncidentNumber: sql.NullInt32{Int32: newIncident.Number, Valid: true},
					},
				)
				if err != nil {
					return herr.InternalServerError("Failed to attach Report", err).From("[AttachReportToIncident]")
				}
				// Mirror the link onto the field report's own journal, so the change is
				// visible from either timeline regardless of which editor made it.
				_, errHTTP := addJournalEntry(ctx, imsDBQ, txn, newIncident.EventID, reportNum, authorPersonID,
					fmt.Sprintf("Attached to incident: %v", newIncident.Number), true, "", "", "", sql.NullInt32{})
				if errHTTP != nil {
					return errHTTP.From("[addJournalEntry]")
				}
			}
		}
		if len(sub) > 0 {
			logs = append(logs, fmt.Sprintf("Report removed: %v", sub))
			for _, reportNum := range sub {
				err = imsDBQ.AttachReportToIncident(ctx, txn,
					imsdb.AttachReportToIncidentParams{
						Event:          newIncident.EventID,
						Number:         reportNum,
						IncidentNumber: sql.NullInt32{},
					},
				)
				if err != nil {
					return herr.InternalServerError("Failed to detach Report", err).From("[AttachReportToIncident]")
				}
				// Mirror the unlink onto the field report's own journal (see attach above).
				_, errHTTP := addJournalEntry(ctx, imsDBQ, txn, newIncident.EventID, reportNum, authorPersonID,
					fmt.Sprintf("Detached from incident: %v", newIncident.Number), true, "", "", "", sql.NullInt32{})
				if errHTTP != nil {
					return errHTTP.From("[addJournalEntry]")
				}
			}
		}
	}
	var updatedVisits []int32
	if newIncident.Visits != nil {
		add := sliceSubtract(*newIncident.Visits, visitNumbers)
		sub := sliceSubtract(visitNumbers, *newIncident.Visits)
		updatedVisits = append(updatedVisits, add...)
		updatedVisits = append(updatedVisits, sub...)

		if len(add) > 0 {
			logs = append(logs, fmt.Sprintf("Visit added: %v", add))
			for _, visitNum := range add {
				err = imsDBQ.AttachVisitToIncident(ctx, txn,
					imsdb.AttachVisitToIncidentParams{
						Event:          newIncident.EventID,
						Number:         visitNum,
						IncidentNumber: sql.NullInt32{Int32: newIncident.Number, Valid: true},
					},
				)
				if err != nil {
					return herr.InternalServerError("Failed to attach Visit", err).From("[AttachVisitToIncidentParams]")
				}
			}
		}
		if len(sub) > 0 {
			logs = append(logs, fmt.Sprintf("Visit removed: %v", sub))
			for _, visitNum := range sub {
				err = imsDBQ.AttachVisitToIncident(ctx, txn,
					imsdb.AttachVisitToIncidentParams{
						Event:          newIncident.EventID,
						Number:         visitNum,
						IncidentNumber: sql.NullInt32{},
					},
				)
				if err != nil {
					return herr.InternalServerError("Failed to detach Visit", err).From("[AttachVisitToIncident]")
				}
			}
		}
	}
	var updatedLinkedIncidents []imsjson.LinkedIncident
	if newIncident.LinkedIncidents != nil {
		var currentLinkedIncidents []imsjson.LinkedIncident
		for _, cli := range linkedIncidents {
			currentLinkedIncidents = append(currentLinkedIncidents, imsjson.LinkedIncident{
				EventID: cli.LinkedEvent,
				Number:  cli.LinkedIncident,
			})
		}
		var desiredLinkedIncidents []imsjson.LinkedIncident
		for _, dli := range *newIncident.LinkedIncidents {
			desiredLinkedIncidents = append(desiredLinkedIncidents, imsjson.LinkedIncident{
				EventID: dli.EventID,
				Number:  dli.Number,
			})
		}

		add := sliceSubtract(desiredLinkedIncidents, currentLinkedIncidents)
		sub := sliceSubtract(currentLinkedIncidents, desiredLinkedIncidents)
		updatedLinkedIncidents = append(updatedLinkedIncidents, add...)
		updatedLinkedIncidents = append(updatedLinkedIncidents, sub...)

		if len(add) > 0 {
			names := namesForLinkedIncidents(add, eventNameById)
			logs = append(logs, fmt.Sprintf("Incident linked: %v", names))
			for _, otherIncident := range add {
				err = imsDBQ.LinkIncidents(ctx, txn,
					imsdb.LinkIncidentsParams{
						Event1:          newIncident.EventID,
						IncidentNumber1: newIncident.Number,
						Event2:          otherIncident.EventID,
						IncidentNumber2: otherIncident.Number,
					},
				)
				if err != nil {
					// We'll just assume in this case that the problem is that the otherIncident ID
					// is invalid. This is probably the case...
					return herr.BadRequest(fmt.Sprintf("Failed to link Incident. There may be no IMS #%v for the given event.", otherIncident.Number), err).From("[LinkIncidents]")
				}
				err = imsDBQ.LinkIncidents(ctx, txn,
					imsdb.LinkIncidentsParams{
						Event2:          newIncident.EventID,
						IncidentNumber2: newIncident.Number,
						Event1:          otherIncident.EventID,
						IncidentNumber1: otherIncident.Number,
					},
				)
				if err != nil {
					return herr.InternalServerError("Failed to link Incident", err).From("[LinkIncidents]")
				}
				_, errHTTP := addIncidentJournalEntry(
					ctx, imsDBQ, txn, otherIncident.EventID, otherIncident.Number,
					authorPersonID, fmt.Sprintf("Incident linked: %v #%v", eventNameById[newIncident.EventID],
						newIncident.Number,
					), true, "", "", "",
				)
				if errHTTP != nil {
					return errHTTP.From("[addIncidentJournalEntry]")
				}
			}
		}
		if len(sub) > 0 {
			names := namesForLinkedIncidents(sub, eventNameById)
			logs = append(logs, fmt.Sprintf("Incident unlinked: %v", names))
			for _, otherIncident := range sub {
				err = imsDBQ.UnlinkIncidents(ctx, txn,
					imsdb.UnlinkIncidentsParams{
						Event1:          newIncident.EventID,
						IncidentNumber1: newIncident.Number,
						Event2:          otherIncident.EventID,
						IncidentNumber2: otherIncident.Number,
					},
				)
				if err != nil {
					return herr.InternalServerError("Failed to unlink Incident", err).From("[UnlinkIncidents]")
				}
				err = imsDBQ.UnlinkIncidents(ctx, txn,
					imsdb.UnlinkIncidentsParams{
						Event2:          newIncident.EventID,
						IncidentNumber2: newIncident.Number,
						Event1:          otherIncident.EventID,
						IncidentNumber1: otherIncident.Number,
					},
				)
				if err != nil {
					return herr.InternalServerError("Failed to unlink Incident", err).From("[UnlinkIncidents]")
				}
				_, errHTTP := addIncidentJournalEntry(
					ctx, imsDBQ, txn, otherIncident.EventID, otherIncident.Number,
					authorPersonID, fmt.Sprintf("Incident unlinked: %v #%v", eventNameById[newIncident.EventID],
						newIncident.Number,
					), true, "", "", "",
				)
				if errHTTP != nil {
					return errHTTP.From("[addIncidentJournalEntry]")
				}
			}
		}
	}

	if len(logs) > 0 {
		_, errHTTP := addIncidentJournalEntry(ctx, imsDBQ, txn, newIncident.EventID, newIncident.Number, authorPersonID, strings.Join(logs, "\n"), true, "", "", "")
		if errHTTP != nil {
			return errHTTP.From("[addIncidentJournalEntry]")
		}
	}

	var mentionedPersonIDs []int32
	for _, entry := range newIncident.JournalEntries {
		if entry.Text == "" {
			continue
		}
		entryID, errHTTP := addIncidentJournalEntry(ctx, imsDBQ, txn, newIncident.EventID, newIncident.Number, authorPersonID, entry.Text, false, "", "", "")
		if errHTTP != nil {
			return errHTTP.From("[addIncidentJournalEntry]")
		}
		errHTTP = addJournalEntryMentions(ctx, imsDBQ, userStore, txn, entryID, entry.Text, entry.MentionedPersonIDs)
		if errHTTP != nil {
			return errHTTP.From("[addJournalEntryMentions]")
		}
		// Notify the mentioned people (plan 82). Driven by the persisted mention
		// rows, so it's after the rows are written; the author is skipped.
		recipients, errHTTP := generateMentionNotifications(ctx, imsDBQ, txn, newIncident.EventID, newIncident.Number, entryID, authorPersonID)
		if errHTTP != nil {
			return errHTTP.From("[generateMentionNotifications]")
		}
		mentionedPersonIDs = append(mentionedPersonIDs, recipients...)
	}

	err = txn.Commit()
	if err != nil {
		return herr.InternalServerError("Failed to commit transaction", err).From("[Commit]")
	}

	es.NotifyIncidentUpdate(newIncident.EventID, newIncident.Number)
	// Web push the mentioned people (plan 84c): after commit, off the request path.
	pusher.NotifyMentionedInIncident(ctx, eventNameById[newIncident.EventID], newIncident.Number, mentionedPersonIDs, authorPersonID)
	for _, fr := range updatedReports {
		es.NotifyReportUpdate(newIncident.EventID, fr)
	}
	for _, inc := range updatedLinkedIncidents {
		es.NotifyIncidentUpdate(inc.EventID, inc.Number)
	}
	for _, s := range updatedVisits {
		es.NotifyVisitUpdate(newIncident.EventID, s)
	}

	return nil
}

func namesForIncidentTypes(rows []imsdb.IncidentTypesRow, typeIDs []int32) string {
	var names []string
	for _, row := range rows {
		if slices.Contains(typeIDs, row.IncidentType.ID) {
			names = append(names, row.IncidentType.Name)
		}
	}
	return strings.Join(names, ", ")
}

func namesForLinkedIncidents(linked []imsjson.LinkedIncident, eventNamesById map[int32]string) string {
	var names []string
	for _, link := range linked {
		names = append(names, fmt.Sprintf("%v #%v", eventNamesById[link.EventID], link.Number))
	}
	return strings.Join(names, ", ")
}

func sliceSubtract[T comparable](a, b []T) []T {
	var ret []T
	for _, item := range a {
		if !slices.Contains(b, item) {
			ret = append(ret, item)
		}
	}
	return ret
}

type EditIncident struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
	es        *server.EventSourcerer
	pusher    *server.Pusher
	metrics   *server.MetricsCache
}

func (action EditIncident) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.editIncident(req)
	if errHTTP != nil {
		errHTTP.From("[editIncident]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Success")
}

func (action EditIncident) editIncident(req *http.Request) *herr.HTTPError {
	event, jwtCtx, eventPermissions, errHTTP := server.GetEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return errHTTP.From("[server.GetEventPermissions]")
	}
	ctx := req.Context()

	incidentNumber, err := conv.ParseInt32(req.PathValue("incidentNumber"))
	if err != nil {
		return herr.BadRequest("Invalid Incident Number", err).From("[ParseInt32]")
	}
	newIncident, errHTTP := server.ReadBodyAs[imsjson.Incident](req)
	if errHTTP != nil {
		return errHTTP.From("[server.ReadBodyAs]")
	}

	// 52f: full edit needs EventWriteIncidents. A reporter granted per-incident access
	// may *only* append journal entries — so without the write bit, require a grant
	// AND a journal-only payload (no field changes). updateIncident already ignores
	// zero/nil fields, so isJournalOnly is the guard that keeps them from editing.
	if eventPermissions&authz.EventWriteIncidents == 0 {
		hasGrant, err := action.imsDBQ.IncidentPersonHasGrant(ctx, action.imsDBQ, imsdb.IncidentPersonHasGrantParams{
			Event: event.ID, IncidentNumber: incidentNumber, PersonID: jwtCtx.Claims.PersonID(),
		})
		if err != nil {
			return herr.InternalServerError("Failed to check incident grant", err).From("[IncidentPersonHasGrant]")
		}
		if !hasGrant {
			return herr.Forbidden("The requestor does not have EventWriteIncidents permission for this Event", nil)
		}
		if !isJournalOnly(newIncident) {
			return herr.Forbidden("A granted reporter may only add journal entries to this incident", nil)
		}
	}

	newIncident.Event = event.Name
	newIncident.EventID = event.ID
	newIncident.Number = incidentNumber

	authorPersonID := jwtCtx.Claims.PersonID()

	errHTTP = updateIncident(ctx, action.imsDBQ, action.userStore, action.es, action.pusher, newIncident, authorPersonID, jwtCtx.Claims.PersonAdmin())
	if errHTTP != nil {
		return errHTTP.From("[updateIncident]")
	}

	// State / priority / outcome / area edits all feed the dashboard aggregate.
	action.metrics.InvalidateEvent(event.Name)

	return nil
}

type AttachPersonToIncident struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
	es        *server.EventSourcerer
	pusher    *server.Pusher
}

func (action AttachPersonToIncident) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.attachPerson(req)
	if errHTTP != nil {
		errHTTP.From("[attachPerson]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Success")
}

func (action AttachPersonToIncident) attachPerson(req *http.Request) *herr.HTTPError {
	event, jwtCtx, eventPermissions, errHTTP := server.GetEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return errHTTP.From("[server.GetEventPermissions]")
	}
	if eventPermissions&authz.EventWriteIncidents == 0 {
		return herr.Forbidden("The requestor does not have EventWriteIncidents permission for this Event", nil)
	}
	ctx := req.Context()

	incidentNumber, err := conv.ParseInt32(req.PathValue("incidentNumber"))
	if err != nil {
		return herr.BadRequest("Invalid Incident Number", err).From("[ParseInt32]")
	}

	person, errHTTP := server.PersonByIDFromPath(ctx, action.imsDBQ, req)
	if errHTTP != nil {
		return errHTTP.From("[server.PersonByIDFromPath]")
	}
	personID := person.ID

	body, errHTTP := server.ReadBodyAs[imsjson.IncidentPerson](req)
	if errHTTP != nil {
		return errHTTP.From("[server.ReadBodyAs]")
	}

	// Run the whole change in a retrying transaction: attach is a
	// detach-then-reattach replace and can deadlock against a concurrent
	// attach/detach on the same incident, so a transient deadlock / lock-wait
	// timeout retries the whole transaction (store.RunInTx) instead of 500ing.
	// Whether this save was a genuine new attach (vs. an involvement edit), set in
	// the transaction and read after commit to drive the push fan-out (plan 84c).
	var newlyAttached bool
	newInvolvement := conv.StringToSql(body.Involvement, 128)
	runErr := action.imsDBQ.RunInTx(ctx, func(txn *sql.Tx) error {
		// Attach is a detach-then-reattach replace, so we can't tell a new add from
		// an involvement edit afterwards. Read the person's current row up front: its
		// presence distinguishes a genuine new add (which alone fires an
		// "added_to_incident" notification, plan 82) from an edit, and its old
		// involvement/grant let the journal record what actually changed.
		var oldInvolvement sql.NullString
		var oldGranted, alreadyAttached bool
		existingPeople, txErr := action.imsDBQ.Incident_People(ctx, txn, imsdb.Incident_PeopleParams{
			Event:          event.ID,
			IncidentNumber: incidentNumber,
		})
		if txErr != nil {
			return herr.InternalServerError("Failed to fetch incident people", txErr).From("[Incident_People]")
		}
		for _, row := range existingPeople {
			if row.IncidentPerson.PersonID == personID {
				alreadyAttached = true
				oldInvolvement = row.IncidentPerson.Involvement
				oldGranted = row.IncidentPerson.GrantedAccess
				break
			}
		}
		// Reassigned each attempt (RunInTx may retry on deadlock) so it reflects the
		// committed run, not a rolled-back one.
		newlyAttached = !alreadyAttached

		txErr = action.imsDBQ.DetachPersonFromIncident(ctx, txn, imsdb.DetachPersonFromIncidentParams{
			Event:          event.ID,
			IncidentNumber: incidentNumber,
			PersonID:       personID,
		})
		if txErr != nil {
			return herr.InternalServerError("Failed to detach person from Incident", txErr).From("[DetachPersonFromIncident]")
		}

		txErr = action.imsDBQ.AttachPersonToIncident(ctx, txn, imsdb.AttachPersonToIncidentParams{
			Event:          event.ID,
			IncidentNumber: incidentNumber,
			PersonID:       personID,
			Involvement:    newInvolvement,
			// 52f: per-incident access grant for an involved reporter (writer-gated here).
			GrantedAccess: body.GrantedAccess,
		})
		if txErr != nil {
			return herr.InternalServerError("Failed to attach person to Incident", txErr).From("[AttachPersonToIncident]")
		}

		// Record what actually changed — the add, and/or the involvement and
		// access-grant edits — as a single system entry. Nothing changed → no entry.
		if lines := personChangeLog(server.PersonDisplayName(person), alreadyAttached, oldInvolvement, newInvolvement, oldGranted, body.GrantedAccess); len(lines) > 0 {
			_, errJournal := addIncidentJournalEntry(
				ctx, action.imsDBQ, txn, event.ID, incidentNumber,
				jwtCtx.Claims.PersonID(), strings.Join(lines, "\n"),
				true, "", "", "",
			)
			if errJournal != nil {
				return errJournal.From("[addIncidentJournalEntry]")
			}
		}

		// Notify the person they were added — only on a genuine new attach (plan 82).
		if !alreadyAttached {
			errNotify := generateAddedToIncidentNotification(ctx, action.imsDBQ, txn, event.ID, incidentNumber, personID, jwtCtx.Claims.PersonID())
			if errNotify != nil {
				return errNotify.From("[generateAddedToIncidentNotification]")
			}
		}
		return nil
	})
	if runErr != nil {
		return herr.AsHTTPError(runErr).From("[RunInTx]")
	}
	action.es.NotifyIncidentUpdate(event.ID, incidentNumber)
	// Web push the added person (plan 84c): after commit, off the request path, and
	// only on a genuine new attach — same gate as the in-app notification.
	if newlyAttached {
		action.pusher.NotifyAddedToIncident(ctx, event.Name, incidentNumber, personID, jwtCtx.Claims.PersonID())
	}

	return nil
}

type DetachPersonFromIncident struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
	es        *server.EventSourcerer
}

func (action DetachPersonFromIncident) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.detachPerson(req)
	if errHTTP != nil {
		errHTTP.From("[detachPerson]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Success")
}

func (action DetachPersonFromIncident) detachPerson(req *http.Request) *herr.HTTPError {
	event, jwtCtx, eventPermissions, errHTTP := server.GetEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return errHTTP.From("[server.GetEventPermissions]")
	}
	if eventPermissions&authz.EventWriteIncidents == 0 {
		return herr.Forbidden("The requestor does not have EventWriteIncidents permission for this Event", nil)
	}
	ctx := req.Context()

	incidentNumber, err := conv.ParseInt32(req.PathValue("incidentNumber"))
	if err != nil {
		return herr.BadRequest("Invalid Incident Number", err).From("[ParseInt32]")
	}

	person, errHTTP := server.PersonByIDFromPath(ctx, action.imsDBQ, req)
	if errHTTP != nil {
		return errHTTP.From("[server.PersonByIDFromPath]")
	}
	personID := person.ID

	// Run in a retrying transaction so a transient deadlock / lock-wait timeout
	// against a concurrent attach/detach on the same incident is retried rather
	// than surfaced as a 500.
	runErr := action.imsDBQ.RunInTx(ctx, func(txn *sql.Tx) error {
		txErr := action.imsDBQ.DetachPersonFromIncident(ctx, txn, imsdb.DetachPersonFromIncidentParams{
			Event:          event.ID,
			IncidentNumber: incidentNumber,
			PersonID:       personID,
		})
		if txErr != nil {
			return herr.InternalServerError("Failed to detach person from Incident", txErr).From("[DetachPersonFromIncident]")
		}
		_, errJournal := addIncidentJournalEntry(
			ctx, action.imsDBQ, txn, event.ID, incidentNumber,
			jwtCtx.Claims.PersonID(), fmt.Sprintf("Removed person: %v", server.PersonDisplayName(person)),
			true, "", "", "",
		)
		if errJournal != nil {
			return errJournal.From("[addIncidentJournalEntry]")
		}
		return nil
	})
	if runErr != nil {
		return herr.AsHTTPError(runErr).From("[RunInTx]")
	}

	action.es.NotifyIncidentUpdate(event.ID, incidentNumber)

	return nil
}
