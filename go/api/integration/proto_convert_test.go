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

package integration_test

import (
	"net/http"

	"connectrpc.com/connect"
	commonv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/common/v1"
	resourcesv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/resources/v1"
	servicerpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	authapi "github.com/mikeki/ocf-ims/internal/auth"
	imsjson "github.com/mikeki/ocf-ims/json"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// incidentViewToJSON maps the GetIncident RPC's IncidentView proto back to the legacy
// imsjson.Incident the incident tests assert against (and feed back into the still-REST
// update/link write helpers). It is the exact inverse of the server's
// incident.incidentJSONToProto: empty repeated fields, which the proto wire drops to
// nil, are restored to the non-nil empty slices incidentToJSON always emitted, so the
// read↔write round-trips and requireEqualIncident keep working unchanged while the
// incident write path is still REST. This test-only bridge dies with json/ once the
// whole incident surface moves onto Connect (plan 09 §Migration strategy).
func incidentViewToJSON(view *servicerpcv1.IncidentView) imsjson.Incident {
	inc := view.GetIncident()
	out := imsjson.Incident{
		Event:               inc.GetEvent(),
		EventID:             inc.GetEventId(),
		Number:              inc.GetNumber(),
		Created:             inc.GetCreated().AsTime(),
		LastModified:        inc.GetLastModified().AsTime(),
		CreatedBy:           personRefToMention(inc.GetCreatedBy()),
		State:               incidentStateToString(inc.GetState()),
		Private:             inc.Private,
		OutcomeID:           inc.OutcomeId,
		Started:             inc.GetStarted().AsTime(),
		Priority:            int8(inc.GetPriority()),
		Summary:             inc.Summary,
		ViewerMayAddJournal: view.GetViewerMayAddJournal(),
	}
	// Closed is unset (zero time) when the incident is open; incidentToJSON emitted a
	// zero time.Time in that case, which AsTime() on a nil timestamp also yields.
	if c := inc.GetClosed(); c != nil {
		out.Closed = c.AsTime()
	}
	if loc := inc.GetLocation(); loc != nil {
		out.Location = imsjson.Location{
			AreaSlug:    loc.AreaSlug,
			Description: loc.Description,
			Booth:       loc.Booth,
		}
	}

	// incidentToJSON always emitted non-nil pointers for these collection fields, but
	// the proto wire drops an empty repeated field to a nil slice — restore the empty
	// slice so requireEqualIncident's &[]T{} expectations still hold.
	typeIDs := inc.GetIncidentTypeIds()
	if typeIDs == nil {
		typeIDs = []int32{}
	}
	out.IncidentTypeIDs = &typeIDs

	reports := inc.GetReports()
	if reports == nil {
		reports = []int32{}
	}
	out.Reports = &reports

	// Visits are excluded from the contract (09e). incidentToJSON always emitted a
	// slice (empty for the beta, since visits are disabled), so restore the empty shape.
	visits := []int32{}
	out.Visits = &visits

	people := []imsjson.IncidentPerson{}
	for _, p := range inc.GetPeople() {
		person := p.GetPerson()
		people = append(people, imsjson.IncidentPerson{
			PersonID:       int64(person.GetPersonId()),
			Handle:         person.GetHandle(),
			Name:           person.GetName(),
			Involvement:    p.Involvement,
			GrantedAccess:  p.GetGrantedAccess(),
			HasEventAccess: p.GetHasEventAccess(),
		})
	}
	out.People = &people

	linked := []imsjson.LinkedIncident{}
	for _, li := range inc.GetLinkedIncidents() {
		linked = append(linked, imsjson.LinkedIncident{
			EventName: li.GetEventName(),
			EventID:   li.GetEventId(),
			Number:    li.GetIncidentNumber(),
			Summary:   li.GetSummary(),
		})
	}
	out.LinkedIncidents = &linked

	for _, je := range inc.GetJournalEntries() {
		out.JournalEntries = append(out.JournalEntries, journalEntryProtoToJSON(je))
	}
	return out
}

// reportViewToJSON maps the report read RPCs' ReportView proto back to the legacy
// imsjson.Report the report tests assert against — the report-side mirror of
// incidentViewToJSON. The caller-dependent edit flags live on the wrapper (may_edit_summary
// / may_add_journal_entry); the resource carries the rest. journal_entries the proto wire
// drops to nil stay nil, matching reportToJSON (requireEqualReport ignores them anyway).
// This test-only bridge dies with json/ once the whole report surface moves onto Connect.
func reportViewToJSON(view *servicerpcv1.ReportView) imsjson.Report {
	r := view.GetReport()
	out := imsjson.Report{
		Event:              r.GetEvent(),
		Number:             r.GetNumber(),
		Created:            r.GetCreated().AsTime(),
		CreatedBy:          personRefToMention(r.GetCreatedBy()),
		Summary:            r.Summary,
		Incident:           r.Incident,
		MayEditSummary:     view.GetMayEditSummary(),
		MayAddJournalEntry: view.GetMayAddJournalEntry(),
	}
	for _, je := range r.GetJournalEntries() {
		out.JournalEntries = append(out.JournalEntries, journalEntryProtoToJSON(je))
	}
	return out
}

func journalEntryProtoToJSON(je *resourcesv1.JournalEntry) imsjson.JournalEntry {
	out := imsjson.JournalEntry{
		ID:          je.GetId(),
		Created:     je.GetCreated().AsTime(),
		Author:      je.GetAuthor(),
		SystemEntry: je.GetSystemEntry(),
		Text:        je.GetText(),
		Stricken:    je.Stricken,
		OnBehalfOf:  personRefToMention(je.GetOnBehalfOf()),
	}
	if att := je.GetAttachment(); att != nil {
		out.Attachment = imsjson.Attachment{Name: att.GetId(), Previewable: att.GetPreviewable()}
	}
	for _, m := range je.GetMentions() {
		out.Mentions = append(out.Mentions, imsjson.Mention{
			PersonID: m.GetPersonId(),
			Handle:   m.GetHandle(),
			Name:     m.GetName(),
		})
	}
	return out
}

// reportWriteToProto maps the imsjson.Report the report-write test helpers build at their call
// sites onto the plain Report resource the CreateReport / UpdateReport RPCs take — the write-side
// mirror of reportViewToJSON, and the inverse of the server's incident.reportWriteToJSON. The
// summary/incident presence pointers pass straight through; each journal entry contributes its
// text plus the write-side person id lists collapsed onto resolved-form PersonRefs
// (mentions[].person_id, on_behalf_of.person_id), matching the contract's "client sets person_id,
// server resolves handle/name" rule.
func reportWriteToProto(r imsjson.Report) *resourcesv1.Report {
	out := &resourcesv1.Report{
		Summary:  r.Summary,
		Incident: r.Incident,
	}
	for _, je := range r.JournalEntries {
		out.JournalEntries = append(out.JournalEntries, journalEntryWriteToProto(je))
	}
	return out
}

// journalEntryWriteToProto maps a write-body imsjson.JournalEntry onto the proto JournalEntry: its
// text and (for the strike endpoint) the optional stricken flag, plus the on-behalf-of and mention
// person ids as resolved-form PersonRefs carrying only person_id.
func journalEntryWriteToProto(je imsjson.JournalEntry) *resourcesv1.JournalEntry {
	out := &resourcesv1.JournalEntry{
		Text:     je.Text,
		Stricken: je.Stricken,
	}
	if je.OnBehalfOfPersonID != nil {
		out.OnBehalfOf = &commonv1.PersonRef{PersonId: *je.OnBehalfOfPersonID}
	}
	for _, id := range je.MentionedPersonIDs {
		out.Mentions = append(out.Mentions, &commonv1.PersonRef{PersonId: id})
	}
	return out
}

func personRefToMention(ref *commonv1.PersonRef) *imsjson.Mention {
	if ref == nil {
		return nil
	}
	return &imsjson.Mention{
		PersonID: ref.GetPersonId(),
		Handle:   ref.GetHandle(),
		Name:     ref.GetName(),
	}
}

// incidentUpdateFromJSON maps the legacy imsjson.Incident that the incident write helpers
// still build at their call sites onto the presence-tracked IncidentUpdate the UpdateIncident
// RPC takes — the write-side mirror of incidentViewToJSON, and the exact inverse of the
// server's incident.incidentUpdateToJSON. imsjson.Incident's pointer/zero fields already carry
// the presence the proto needs: a nil scalar/list stays absent ("leave unchanged"), while a
// non-nil (even empty) list becomes a present Int32List/IncidentRefList ("set exactly these",
// empty clears). Visits and People have no IncidentUpdate field — visits are excluded from
// the contract (09e) and people are managed via AttachPersonToIncident; the shared write helper
// never applied either from the incident body, so they are intentionally not carried here. This
// test-only bridge dies with json/ once the incident write path maps proto straight to the
// store (plan 09 §Migration strategy).
func incidentUpdateFromJSON(inc imsjson.Incident) *servicerpcv1.IncidentUpdate {
	out := &servicerpcv1.IncidentUpdate{
		State:     incidentStateToProtoEnum(inc.State),
		Private:   inc.Private,
		OutcomeId: inc.OutcomeID,
		Priority:  incidentPriorityToProtoEnum(inc.Priority),
		Summary:   inc.Summary,
	}
	if !inc.Started.IsZero() {
		out.Started = timestamppb.New(inc.Started)
	}
	// Only send a location when at least one piece is set; an all-nil Location means "touch
	// nothing", which an absent proto location expresses.
	if inc.Location.AreaSlug != nil || inc.Location.Description != nil || inc.Location.Booth != nil {
		out.Location = &resourcesv1.IncidentLocation{
			AreaSlug:    inc.Location.AreaSlug,
			Description: inc.Location.Description,
			Booth:       inc.Location.Booth,
		}
	}
	if inc.IncidentTypeIDs != nil {
		out.IncidentTypeIds = &servicerpcv1.Int32List{Values: *inc.IncidentTypeIDs}
	}
	if inc.Reports != nil {
		out.Reports = &servicerpcv1.Int32List{Values: *inc.Reports}
	}
	if inc.LinkedIncidents != nil {
		refs := make([]*commonv1.IncidentRef, 0, len(*inc.LinkedIncidents))
		for _, li := range *inc.LinkedIncidents {
			refs = append(refs, &commonv1.IncidentRef{
				EventId:        li.EventID,
				IncidentNumber: li.Number,
			})
		}
		out.LinkedIncidents = &servicerpcv1.IncidentRefList{Refs: refs}
	}
	for _, je := range inc.JournalEntries {
		out.JournalEntries = append(out.JournalEntries, &servicerpcv1.NewJournalEntry{
			Text:               je.Text,
			MentionedPersonIds: je.MentionedPersonIDs,
		})
	}
	return out
}

func incidentStateToProtoEnum(s string) resourcesv1.IncidentState {
	switch s {
	case "open":
		return resourcesv1.IncidentState_INCIDENT_STATE_OPEN
	case "closed":
		return resourcesv1.IncidentState_INCIDENT_STATE_CLOSED
	default:
		return resourcesv1.IncidentState_INCIDENT_STATE_UNSPECIFIED
	}
}

func incidentPriorityToProtoEnum(p int8) resourcesv1.IncidentPriority {
	switch p {
	case imsjson.IncidentPriorityHigh:
		return resourcesv1.IncidentPriority_INCIDENT_PRIORITY_HIGH
	case imsjson.IncidentPriorityNormal:
		return resourcesv1.IncidentPriority_INCIDENT_PRIORITY_NORMAL
	case imsjson.IncidentPriorityLow:
		return resourcesv1.IncidentPriority_INCIDENT_PRIORITY_LOW
	default:
		return resourcesv1.IncidentPriority_INCIDENT_PRIORITY_UNSPECIFIED
	}
}

func incidentStateToString(s resourcesv1.IncidentState) string {
	switch s {
	case resourcesv1.IncidentState_INCIDENT_STATE_OPEN:
		return "open"
	case resourcesv1.IncidentState_INCIDENT_STATE_CLOSED:
		return "closed"
	default:
		return ""
	}
}

// connectStatus maps a Connect RPC error back to the HTTP status the retired REST
// endpoint would have returned, so the incident tests' existing status-code assertions
// keep working while the read helper drives the RPC (the response body is synthesized
// as http.NoBody — see ApiHelper.getIncident).
func connectStatus(err error) int {
	if err == nil {
		return http.StatusOK
	}
	switch connect.CodeOf(err) {
	case connect.CodeUnauthenticated:
		return http.StatusUnauthorized
	case connect.CodePermissionDenied:
		return http.StatusForbidden
	case connect.CodeNotFound:
		return http.StatusNotFound
	case connect.CodeInvalidArgument:
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

// getAuthResponseFromProto maps the GetAuthStatus RPC's proto response back to the legacy
// authapi.GetAuthResponse the auth tests assert against. The proto keys event_access by numeric
// event id; the tests are name-keyed, so the single requested entry is re-keyed under eventName
// (getAuth resolves the name to the id it sends, so there is at most one entry). This test-only
// bridge plays the role imsjson does for the other resources and dies with the REST DTO.
func getAuthResponseFromProto(p *servicerpcv1.GetAuthStatusResponse, eventName string) authapi.GetAuthResponse {
	out := authapi.GetAuthResponse{
		Authenticated:        p.GetAuthenticated(),
		User:                 p.GetUser(),
		PersonID:             int64(p.GetPersonId()),
		Admin:                p.GetAdmin(),
		CanManagePersonnel:   p.GetCanManagePersonnel(),
		PushVAPIDPublicKey:   p.GetPushVapidPublicKey(),
		UsingDefaultPassword: p.GetUsingDefaultPassword(),
	}
	// At most one entry (getAuth requests a single event); re-key it under the caller's name.
	for _, a := range p.GetEventAccess() {
		out.EventAccess = map[string]authapi.AccessForEvent{eventName: accessForEventFromProto(a)}
	}
	return out
}

func accessForEventFromProto(a *servicerpcv1.AccessForEvent) authapi.AccessForEvent {
	return authapi.AccessForEvent{
		EventID:               a.GetEventId(),
		ReadIncidents:         a.GetReadIncidents(),
		WriteIncidents:        a.GetWriteIncidents(),
		WriteReports:          a.GetWriteReports(),
		ReadVisits:            a.GetReadVisits(),
		WriteVisits:           a.GetWriteVisits(),
		AttachFiles:           a.GetAttachFiles(),
		ReadAreas:             a.GetReadAreas(),
		ReadIncidentsViaGrant: a.GetReadIncidentsViaGrant(),
		InviteReporters:       a.GetInviteReporters(),
	}
}
