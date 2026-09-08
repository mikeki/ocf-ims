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
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	servicerpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/gen/ocf/ims/service/v1/servicev1connect"
	incidentapi "github.com/mikeki/ocf-ims/internal/incident"

	authapi "github.com/mikeki/ocf-ims/internal/auth"
	personapi "github.com/mikeki/ocf-ims/internal/person"

	pushapi "github.com/mikeki/ocf-ims/internal/push"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
)

type ApiHelper struct {
	t         *testing.T
	serverURL *url.URL
	jwt       string
	referrer  string
}

// postAuth drives login through the generated Connect client (ImsService.Login). The REST POST
// /ims/api/auth endpoint was retired when the RPC was extracted (plan 09h/1c). The legacy
// authapi.PostAuthRequest (Identification/Password) is mapped onto the contract's LoginRequest
// (email/password), and the return shape is preserved so the ~20 call sites are unchanged: on
// success it yields 200 + the access token; on failure it yields the mapped HTTP status
// (connectStatus) and the error string as the "body" (so the "bad credentials" assertion still
// matches). The refresh cookie the RPC sets on its response header is not surfaced here — the
// cookie round-trip is exercised in TestPostAuthMakesRefreshCookie via the client directly.
func (a ApiHelper) postAuth(ctx context.Context, req authapi.PostAuthRequest) (statusCode int, body, validJWT string) {
	a.t.Helper()
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	resp, err := client.Login(ctx, connect.NewRequest(&servicerpcv1.LoginRequest{
		Email:    req.Identification,
		Password: req.Password,
	}))
	if err != nil {
		return connectStatus(err), err.Error(), ""
	}
	return http.StatusOK, "", resp.Msg.GetToken()
}

// refreshAccessToken drives the RefreshToken RPC. The REST POST /ims/api/auth/refresh endpoint
// was retired when the RPC was extracted (plan 09h/1c). The refresh token rides in the HttpOnly
// cookie, so the cookie's name=value is placed in the request's Cookie header (the server reads
// it back the same way it read the REST cookie). The proto Timestamp expiry is mapped back to
// the legacy epoch-millis field so call sites are unchanged.
func (a ApiHelper) refreshAccessToken(ctx context.Context, refreshCookie *http.Cookie) (statusCode int, result *authapi.RefreshAccessTokenResponse) {
	a.t.Helper()
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	rpcReq := connect.NewRequest(&servicerpcv1.RefreshTokenRequest{})
	if refreshCookie != nil {
		// Send just name=value (Cookie-header form), mirroring http.Request.AddCookie. The value
		// is a JWT (no cookie-octet chars needing escaping), so a plain join is exact.
		rpcReq.Header().Set("Cookie", refreshCookie.Name+"="+refreshCookie.Value)
	}
	if a.jwt != "" {
		rpcReq.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	resp, err := client.RefreshToken(ctx, rpcReq)
	if err != nil {
		return connectStatus(err), nil
	}
	return http.StatusOK, &authapi.RefreshAccessTokenResponse{
		Token:         resp.Msg.GetToken(),
		ExpiresUnixMs: resp.Msg.GetExpiresAt().AsTime().UnixMilli(),
	}
}

// getAuth drives the whoami / session status through the generated Connect client
// (GetAuthStatus). The REST GET /ims/api/auth endpoint was retired when the RPC was extracted
// (plan 09h/1c). Call sites still express the event as a NAME; the contract addresses it by
// numeric id, so the name is resolved to its id (a name with no matching event uses a
// non-existent sentinel id so the server's "event might exist, no access" path runs), and the
// single returned event_access entry is re-keyed under the original name so the ~existing
// name-keyed assertions hold. The response is mapped back into the legacy authapi.GetAuthResponse
// (getAuthResponseFromProto), and a synthesized *http.Response carries the equivalent status
// (connectStatus) since the retired endpoint always answered 200 for a well-formed request.
func (a ApiHelper) getAuth(ctx context.Context, eventName string) (authapi.GetAuthResponse, *http.Response) {
	a.t.Helper()
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	rpcReq := &servicerpcv1.GetAuthStatusRequest{}
	if eventName != "" {
		id := a.resolveEventIDOrSentinel(ctx, eventName)
		rpcReq.EventId = &id
	}
	req := connect.NewRequest(rpcReq)
	if a.jwt != "" {
		req.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	resp, err := client.GetAuthStatus(ctx, req)
	httpResp := &http.Response{StatusCode: connectStatus(err), Body: http.NoBody}
	if err != nil {
		return authapi.GetAuthResponse{}, httpResp
	}
	return getAuthResponseFromProto(resp.Msg, eventName), httpResp
}

// resolveEventIDOrSentinel is resolveEventID's non-failing sibling for getAuth: an event that
// exists returns its id; an unknown name returns a sentinel id that no event has, so the caller
// can exercise the "requested an event I can't see / doesn't exist" branch without a hard failure.
func (a ApiHelper) resolveEventIDOrSentinel(ctx context.Context, eventName string) int32 {
	a.t.Helper()
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	req := connect.NewRequest(&servicerpcv1.ListEventsRequest{IncludeGroups: true})
	req.Header().Set("Authorization", "Bearer "+adminJWTCached(a.t, ctx))
	resp, err := client.ListEvents(ctx, req)
	require.NoError(a.t, err)
	for _, e := range resp.Msg.GetEvents() {
		if e.GetName() == eventName {
			return e.GetId()
		}
	}
	return 1 << 30
}

func (a ApiHelper) setPersonPassword(ctx context.Context, personID int64, password string) *http.Response {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/personnel", strconv.FormatInt(personID, 10), "password").String()
	return a.imsPost(ctx, personapi.SetPersonPasswordRequest{Password: password}, path)
}

func (a ApiHelper) setPersonPasswordDefault(ctx context.Context, personID int64) *http.Response {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/personnel", strconv.FormatInt(personID, 10), "password").String()
	return a.imsPost(ctx, personapi.SetPersonPasswordRequest{UseDefaultPassword: true}, path)
}

// changeOwnPassword calls the self-service password change through the generated Connect
// client (ChangeOwnPassword). The REST POST /ims/api/auth/password endpoint was retired when
// the RPC was extracted (plan 09h/1c); the caller is resolved from the JWT, never a field. The
// retired endpoint returned 204 on success, mirrored by the synthesized *http.Response (else
// connectStatus(err)), so the call sites' status assertions are unchanged.
func (a ApiHelper) changeOwnPassword(ctx context.Context, password string) *http.Response {
	a.t.Helper()
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	rpcReq := connect.NewRequest(&servicerpcv1.ChangeOwnPasswordRequest{Password: password})
	if a.jwt != "" {
		rpcReq.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	_, err := client.ChangeOwnPassword(ctx, rpcReq)
	status := http.StatusNoContent
	if err != nil {
		status = connectStatus(err)
	}
	return &http.Response{StatusCode: status, Body: http.NoBody}
}

func (a ApiHelper) setPersonAdmin(ctx context.Context, personID int64, isAdmin bool) *http.Response {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/personnel", strconv.FormatInt(personID, 10), "admin").String()
	return a.imsPost(ctx, personapi.SetPersonAdminRequest{IsAdmin: isAdmin}, path)
}

func (a ApiHelper) createPerson(ctx context.Context, body personapi.CreatePersonRequest) *http.Response {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/personnel").String()
	return a.imsPost(ctx, body, path)
}

func (a ApiHelper) editPerson(ctx context.Context, personID int64, body personapi.EditPersonRequest) *http.Response {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/personnel", strconv.FormatInt(personID, 10)).String()
	return a.imsPost(ctx, body, path)
}

func (a ApiHelper) getAllPersonnel(ctx context.Context) ([]imsjson.Person, *http.Response) {
	a.t.Helper()
	return a.getAllPersonnelForEvent(ctx, "")
}

// getAllPersonnelForEvent fetches the admin People listing of EVERY person, scoped
// to an event so each person carries that event's wristband + participation type. An
// empty event name fetches the unscoped listing. (With an event the endpoint defaults
// to the roster, so this passes showAll=true to keep the "all people" semantics; use
// getEventRoster for the roster-only listing.)
func (a ApiHelper) getAllPersonnelForEvent(ctx context.Context, eventName string) ([]imsjson.Person, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/personnel").String() + "?all=true"
	if eventName != "" {
		path += "&event=" + url.QueryEscape(eventName) + "&showAll=true"
	}
	bod, resp := a.imsGet(ctx, path, &[]imsjson.Person{})
	return *bod.(*[]imsjson.Person), resp
}

// getEventRoster fetches only the people participating in the event (those with a
// PERSON__EVENT row), the People page's default event-scoped view (slice 6j).
func (a ApiHelper) getEventRoster(ctx context.Context, eventName string) ([]imsjson.Person, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/personnel").String() +
		"?all=true&event=" + url.QueryEscape(eventName)
	bod, resp := a.imsGet(ctx, path, &[]imsjson.Person{})
	return *bod.(*[]imsjson.Person), resp
}

// getPersonnelByID fetches one person's profile-card view (GET ?person_id=&event=),
// scoped to an event so the row carries that event's participation. Backs the person
// profile card.
func (a ApiHelper) getPersonnelByID(ctx context.Context, personID int64, eventName string) ([]imsjson.Person, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/personnel").String() +
		"?person_id=" + strconv.FormatInt(personID, 10)
	if eventName != "" {
		path += "&event=" + url.QueryEscape(eventName)
	}
	bod, resp := a.imsGet(ctx, path, &[]imsjson.Person{})
	return *bod.(*[]imsjson.Person), resp
}

// setParticipation upserts a person's per-event participation via the dedicated
// endpoint (enroll / mark not-present / eject), without touching their profile.
func (a ApiHelper) setParticipation(ctx context.Context, personID int64, eventName string, body personapi.SetParticipationRequest) *http.Response {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/personnel", strconv.FormatInt(personID, 10), "participation").String() +
		"?event=" + url.QueryEscape(eventName)
	return a.imsPost(ctx, body, path)
}

// removeParticipation deletes a person's per-event participation row entirely.
func (a ApiHelper) removeParticipation(ctx context.Context, personID int64, eventName string) *http.Response {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/personnel", strconv.FormatInt(personID, 10), "participation").String() +
		"?event=" + url.QueryEscape(eventName)
	_, resp := a.imsDelete(ctx, path, nil)
	return resp
}

func (a ApiHelper) editType(ctx context.Context, req imsjson.IncidentType) (*int32, *http.Response) {
	a.t.Helper()
	httpResp := a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/incident_types").String())
	numStr := httpResp.Header.Get("IMS-Incident-Type-ID")
	require.NoError(a.t, httpResp.Body.Close())
	if numStr == "" {
		return nil, httpResp
	}
	num, err := conv.ParseInt32(numStr)
	require.NoError(a.t, err)
	return &num, httpResp
}

func (a ApiHelper) getTypes(ctx context.Context) (imsjson.IncidentTypes, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/incident_types").String()
	bod, resp := a.imsGet(ctx, path, &imsjson.IncidentTypes{})
	return *bod.(*imsjson.IncidentTypes), resp
}

func (a ApiHelper) proposeType(ctx context.Context, eventName string, req imsjson.IncidentType) (*int32, *http.Response) {
	a.t.Helper()
	httpResp := a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events/", eventName, "/incident_types").String())
	numStr := httpResp.Header.Get("IMS-Incident-Type-ID")
	require.NoError(a.t, httpResp.Body.Close())
	if numStr == "" {
		return nil, httpResp
	}
	num, err := conv.ParseInt32(numStr)
	require.NoError(a.t, err)
	return &num, httpResp
}

func (a ApiHelper) editOutcome(ctx context.Context, req imsjson.Outcome) (*int32, *http.Response) {
	a.t.Helper()
	httpResp := a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/outcomes").String())
	numStr := httpResp.Header.Get("IMS-Outcome-ID")
	require.NoError(a.t, httpResp.Body.Close())
	if numStr == "" {
		return nil, httpResp
	}
	num, err := conv.ParseInt32(numStr)
	require.NoError(a.t, err)
	return &num, httpResp
}
func (a ApiHelper) getOutcomes(ctx context.Context) (imsjson.Outcomes, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/outcomes").String()
	bod, resp := a.imsGet(ctx, path, &imsjson.Outcomes{})
	return *bod.(*imsjson.Outcomes), resp
}

// outcomeIDByName resolves a seeded outcome's ID from its display name, so tests
// reference dispositions by name instead of hardcoding auto-increment IDs.
func (a ApiHelper) outcomeIDByName(ctx context.Context, name string) int32 {
	a.t.Helper()
	outcomes, resp := a.getOutcomes(ctx)
	require.Equal(a.t, http.StatusOK, resp.StatusCode)
	require.NoError(a.t, resp.Body.Close())
	for _, o := range outcomes {
		if o.Name != nil && *o.Name == name {
			return o.ID
		}
	}
	require.Failf(a.t, "outcome not found", "no outcome named %q", name)
	return 0
}
func (a ApiHelper) proposeOutcome(ctx context.Context, eventName string, req imsjson.Outcome) (*int32, *http.Response) {
	a.t.Helper()
	httpResp := a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events/", eventName, "/outcomes").String())
	numStr := httpResp.Header.Get("IMS-Outcome-ID")
	require.NoError(a.t, httpResp.Body.Close())
	if numStr == "" {
		return nil, httpResp
	}
	num, err := conv.ParseInt32(numStr)
	require.NoError(a.t, err)
	return &num, httpResp
}

func (a ApiHelper) editArea(ctx context.Context, eventName string, req imsjson.Area) (slug string, resp *http.Response) {
	a.t.Helper()
	httpResp := a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events/", eventName, "/areas").String())
	return httpResp.Header.Get("IMS-Area-Slug"), httpResp
}

func (a ApiHelper) getAreas(ctx context.Context, eventName string) (imsjson.Areas, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/events/", eventName, "/areas").String()
	bod, resp := a.imsGet(ctx, path, &imsjson.Areas{})
	return *bod.(*imsjson.Areas), resp
}

func (a ApiHelper) editCrew(ctx context.Context, eventName string, req imsjson.Crew) (slug string, resp *http.Response) {
	a.t.Helper()
	httpResp := a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events/", eventName, "/crews").String())
	return httpResp.Header.Get("IMS-Crew-Slug"), httpResp
}

func (a ApiHelper) getCrews(ctx context.Context, eventName string) (imsjson.Crews, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/events/", eventName, "/crews").String()
	bod, resp := a.imsGet(ctx, path, &imsjson.Crews{})
	return *bod.(*imsjson.Crews), resp
}

func (a ApiHelper) getMyCrews(ctx context.Context, eventName string) (imsjson.Crews, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/events/", eventName, "/crews/mine").String()
	bod, resp := a.imsGet(ctx, path, &imsjson.Crews{})
	return *bod.(*imsjson.Crews), resp
}

func (a ApiHelper) editMyCrew(ctx context.Context, eventName string, req imsjson.Crew) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events/", eventName, "/crews/mine").String())
}

// newReport creates a field report through the generated Connect client. The REST POST
// .../reports endpoint was retired when CreateReport was extracted (plan 09h/1c). Call sites still
// express the new report as an imsjson.Report, so it is converted to the plain Report resource
// (reportWriteToProto) and req.Event is resolved to its numeric id (resolveEventID). The retired
// endpoint returned 201 Created with the assigned number in an IMS-Report-Number header; the
// synthesized *http.Response mirrors both on success (else connectStatus(err)), so newReportSuccess
// and the negative-auth call sites are unchanged.
func (a ApiHelper) newReport(ctx context.Context, req imsjson.Report) *http.Response {
	a.t.Helper()
	eventID := a.resolveEventID(ctx, req.Event)
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	rpcReq := connect.NewRequest(&servicerpcv1.CreateReportRequest{
		EventId: eventID,
		Report:  reportWriteToProto(req),
	})
	if a.jwt != "" {
		rpcReq.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	resp, err := client.CreateReport(ctx, rpcReq)
	if err != nil {
		return &http.Response{StatusCode: connectStatus(err), Body: http.NoBody}
	}
	httpResp := &http.Response{StatusCode: http.StatusCreated, Header: http.Header{}, Body: http.NoBody}
	httpResp.Header.Set("IMS-Report-Number", conv.FormatInt(resp.Msg.GetReportNumber()))
	return httpResp
}

func (a ApiHelper) newReportSuccess(ctx context.Context, reportReq imsjson.Report) (report int32) {
	a.t.Helper()
	httpResp := a.newReport(ctx, reportReq)
	require.Equal(a.t, http.StatusCreated, httpResp.StatusCode)
	numStr := httpResp.Header.Get("IMS-Report-Number")
	require.NoError(a.t, httpResp.Body.Close())
	require.NotEmpty(a.t, numStr)
	num, err := conv.ParseInt32(numStr)
	require.NoError(a.t, err)
	require.Positive(a.t, num)
	return num
}

// getReport reads a single field report through the generated Connect client. The REST
// GET .../reports/{n} endpoint was retired when GetReport was extracted (plan 09h/1c); the
// ReportView response is mapped back to imsjson.Report (reportViewToJSON) and a synthesized
// *http.Response carries the equivalent HTTP status (connectStatus) so the tests' existing
// status assertions and Body.Close() calls keep working. resolveEventID uses an admin token
// so negative-auth callers still resolve the event and let the RPC do the rejecting.
func (a ApiHelper) getReport(ctx context.Context, eventName string, report int32) (imsjson.Report, *http.Response) {
	a.t.Helper()
	eventID := a.resolveEventID(ctx, eventName)
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	req := connect.NewRequest(&servicerpcv1.GetReportRequest{EventId: eventID, ReportNumber: report})
	if a.jwt != "" {
		req.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	resp, err := client.GetReport(ctx, req)
	httpResp := &http.Response{StatusCode: connectStatus(err), Body: http.NoBody}
	if err != nil {
		return imsjson.Report{}, httpResp
	}
	return reportViewToJSON(resp.Msg.GetReport()), httpResp
}

// getReports lists an event's field reports through the generated Connect client (the REST
// GET .../reports endpoint was retired with ListReports). Each ReportView is mapped back to
// imsjson.Report; see getReport for the synthesized-response and resolveEventID rationale.
func (a ApiHelper) getReports(ctx context.Context, eventName string) (imsjson.Reports, *http.Response) {
	a.t.Helper()
	eventID := a.resolveEventID(ctx, eventName)
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	req := connect.NewRequest(&servicerpcv1.ListReportsRequest{EventId: eventID})
	if a.jwt != "" {
		req.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	resp, err := client.ListReports(ctx, req)
	httpResp := &http.Response{StatusCode: connectStatus(err), Body: http.NoBody}
	if err != nil {
		return nil, httpResp
	}
	reports := make(imsjson.Reports, 0, len(resp.Msg.GetReports()))
	for _, rv := range resp.Msg.GetReports() {
		reports = append(reports, reportViewToJSON(rv))
	}
	return reports, httpResp
}

// updateReport edits a field report through the generated Connect client. The REST POST
// .../reports/{n} endpoint was retired when UpdateReport was extracted (plan 09h/1c). Call sites
// still express the edit as an imsjson.Report, converted to the plain Report resource
// (reportWriteToProto); the retired endpoint returned 204 No Content on success, which the
// synthesized *http.Response mirrors (else connectStatus(err)).
func (a ApiHelper) updateReport(ctx context.Context, eventName string, report int32, req imsjson.Report) *http.Response {
	a.t.Helper()
	eventID := a.resolveEventID(ctx, eventName)
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	rpcReq := connect.NewRequest(&servicerpcv1.UpdateReportRequest{
		EventId:      eventID,
		ReportNumber: report,
		Report:       reportWriteToProto(req),
	})
	if a.jwt != "" {
		rpcReq.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	_, err := client.UpdateReport(ctx, rpcReq)
	status := http.StatusNoContent
	if err != nil {
		status = connectStatus(err)
	}
	return &http.Response{StatusCode: status, Body: http.NoBody}
}

// attachReportToIncident / detachReportFromIncident drive the same UpdateReport RPC: the REST
// "?action=attach|detach" form framework was retired with the endpoint, and the incident link is
// now set through the Report resource's incident field (visit-field convention — a positive value
// links, a non-positive value detaches).
func (a ApiHelper) attachReportToIncident(ctx context.Context, eventName string, report int32, incident int32) *http.Response {
	a.t.Helper()
	return a.updateReport(ctx, eventName, report, imsjson.Report{Incident: new(incident)})
}

func (a ApiHelper) detachReportFromIncident(ctx context.Context, eventName string, report int32) *http.Response {
	a.t.Helper()
	return a.updateReport(ctx, eventName, report, imsjson.Report{Incident: new(int32(0))})
}

// newIncident creates an incident through the generated Connect client. The REST
// POST .../incidents endpoint was retired when CreateIncident was extracted (plan
// 09h/1c). Call sites still express the new incident as an imsjson.Incident, so it is
// converted to the presence-tracked IncidentUpdate (incidentUpdateFromJSON) and the event
// (req.Event) is resolved to its numeric id (resolveEventID). The retired endpoint
// returned 201 Created with the assigned number in an IMS-Incident-Number header; the
// synthesized *http.Response mirrors both on success (else connectStatus(err)), so
// newIncidentSuccess and the negative-auth call sites are unchanged. Like updateIncident,
// resolveEventID uses an admin token so the negative-auth tests still resolve the event
// and let the RPC itself do the rejecting.
func (a ApiHelper) newIncident(ctx context.Context, req imsjson.Incident) *http.Response {
	a.t.Helper()
	eventID := a.resolveEventID(ctx, req.Event)
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	rpcReq := connect.NewRequest(&servicerpcv1.CreateIncidentRequest{
		EventId:  eventID,
		Incident: incidentUpdateFromJSON(req),
	})
	if a.jwt != "" {
		rpcReq.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	resp, err := client.CreateIncident(ctx, rpcReq)
	if err != nil {
		return &http.Response{StatusCode: connectStatus(err), Body: http.NoBody}
	}
	httpResp := &http.Response{StatusCode: http.StatusCreated, Header: http.Header{}, Body: http.NoBody}
	httpResp.Header.Set("IMS-Incident-Number", conv.FormatInt(resp.Msg.GetIncidentNumber()))
	return httpResp
}

func (a ApiHelper) newIncidentSuccess(ctx context.Context, incidentReq imsjson.Incident) (incidentNumber int32) {
	a.t.Helper()
	resp := a.newIncident(ctx, incidentReq)
	require.Equal(a.t, http.StatusCreated, resp.StatusCode)
	numStr := resp.Header.Get("IMS-Incident-Number")
	require.NoError(a.t, resp.Body.Close())
	require.NotEmpty(a.t, numStr)
	num, err := conv.ParseInt32(numStr)
	require.NoError(a.t, err)
	require.Positive(a.t, num)
	return num
}

func (a ApiHelper) newVisit(ctx context.Context, req imsjson.Visit) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events/"+req.Event+"/visits").String())
}

func (a ApiHelper) newVisitSuccess(ctx context.Context, visitReq imsjson.Visit) (visitNumber int32) {
	a.t.Helper()
	resp := a.newVisit(ctx, visitReq)
	require.Equal(a.t, http.StatusCreated, resp.StatusCode)
	numStr := resp.Header.Get("IMS-Visit-Number")
	require.NoError(a.t, resp.Body.Close())
	require.NotEmpty(a.t, numStr)
	num, err := conv.ParseInt32(numStr)
	require.NoError(a.t, err)
	require.Positive(a.t, num)
	return num
}

// getIncident reads a single incident through the generated Connect client. The REST
// GET .../incidents/{n} endpoint was retired when GetIncident was extracted (plan
// 09h/1c), so the suite exercises the real RPC here. Two adaptations keep the ~50
// existing call sites unchanged: the proto keys the event by numeric id (resolved from
// the name via resolveEventID), and the IncidentView response is mapped back to the
// legacy imsjson.Incident (incidentViewToJSON) with a synthesized *http.Response whose
// status mirrors the retired endpoint (connectStatus). The write path is still REST and
// still json-shaped, so tests read→modify→re-POST the same imsjson.Incident.
func (a ApiHelper) getIncident(ctx context.Context, eventName string, incident int32) (imsjson.Incident, *http.Response) {
	a.t.Helper()
	eventID := a.resolveEventID(ctx, eventName)
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	req := connect.NewRequest(&servicerpcv1.GetIncidentRequest{EventId: eventID, IncidentNumber: incident})
	if a.jwt != "" {
		req.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	resp, err := client.GetIncident(ctx, req)
	// A synthesized in-process response, so the existing status-code assertions and
	// Body.Close() calls at the call sites keep working; there is no real body.
	httpResp := &http.Response{StatusCode: connectStatus(err), Body: http.NoBody}
	if err != nil {
		return imsjson.Incident{}, httpResp
	}
	return incidentViewToJSON(resp.Msg.GetIncident()), httpResp
}

// resolveEventID maps an event name to its numeric id for the id-keyed incident RPCs.
// It lists events as an admin (cached token), independent of the caller's own JWT — so
// it still resolves for the unauthenticated / no-access callers the negative-auth tests
// use, where the incident RPC itself is what must reject.
func (a ApiHelper) resolveEventID(ctx context.Context, eventName string) int32 {
	a.t.Helper()
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	req := connect.NewRequest(&servicerpcv1.ListEventsRequest{IncludeGroups: true})
	req.Header().Set("Authorization", "Bearer "+adminJWTCached(a.t, ctx))
	resp, err := client.ListEvents(ctx, req)
	require.NoError(a.t, err)
	for _, e := range resp.Msg.GetEvents() {
		if e.GetName() == eventName {
			return e.GetId()
		}
	}
	require.Failf(a.t, "event not found", "resolveEventID: no event named %q", eventName)
	return 0
}

func (a ApiHelper) getVisit(ctx context.Context, eventName string, visit int32) (imsjson.Visit, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/events/", eventName, "/visits/", strconv.Itoa(int(visit))).String()
	bod, resp := a.imsGet(ctx, path, &imsjson.Visit{})
	return *bod.(*imsjson.Visit), resp
}

// updateIncident edits an incident through the generated Connect client. The REST
// POST .../incidents/{n} endpoint was retired when UpdateIncident was extracted (plan
// 09h/1c). Call sites still express the edit as an imsjson.Incident, so it is converted to
// the presence-tracked IncidentUpdate (incidentUpdateFromJSON) and the event is resolved to
// its numeric id (resolveEventID). The retired endpoint returned 204 on success, so the
// synthesized *http.Response mirrors that (else connectStatus(err)) — keeping the ~30 call
// sites and their status assertions unchanged. Like getIncident, resolveEventID uses an
// admin token so the negative-auth tests still resolve the event and let the RPC itself do
// the rejecting.
func (a ApiHelper) updateIncident(ctx context.Context, eventName string, incident int32, req imsjson.Incident) *http.Response {
	a.t.Helper()
	eventID := a.resolveEventID(ctx, eventName)
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	rpcReq := connect.NewRequest(&servicerpcv1.UpdateIncidentRequest{
		EventId:        eventID,
		IncidentNumber: incident,
		Update:         incidentUpdateFromJSON(req),
	})
	if a.jwt != "" {
		rpcReq.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	_, err := client.UpdateIncident(ctx, rpcReq)
	status := http.StatusNoContent
	if err != nil {
		status = connectStatus(err)
	}
	return &http.Response{StatusCode: status, Body: http.NoBody}
}

func (a ApiHelper) updateVisit(ctx context.Context, eventName string, visit int32, req imsjson.Visit) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events/", eventName, "/visits/", strconv.Itoa(int(visit))).String())
}

func (a ApiHelper) attachPersonToIncident(ctx context.Context, eventName string, incident int32, personID int64) *http.Response {
	a.t.Helper()
	return a.attachPersonToIncidentBody(ctx, eventName, incident, personID, imsjson.IncidentPerson{})
}

// attachPersonToIncidentBody attaches (or edits) a person on an incident through the generated
// Connect client, with an explicit IncidentPerson body so tests can set the involvement /
// granted_access (52f) the bare attach helper leaves empty. The REST POST
// .../incidents/{n}/people/{personId} endpoint was retired when AttachPersonToIncident was
// extracted (plan 09h/1c); person_id, involvement, and granted_access ride the request fields. The
// retired endpoint returned 204 No Content on success, mirrored by the synthesized *http.Response
// (else connectStatus(err)), so the ~call sites' status assertions are unchanged.
func (a ApiHelper) attachPersonToIncidentBody(ctx context.Context, eventName string, incident int32, personID int64, body imsjson.IncidentPerson) *http.Response {
	a.t.Helper()
	eventID := a.resolveEventID(ctx, eventName)
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	rpcReq := connect.NewRequest(&servicerpcv1.AttachPersonToIncidentRequest{
		EventId:        eventID,
		IncidentNumber: incident,
		PersonId:       int32(personID),
		Involvement:    body.Involvement,
		GrantedAccess:  body.GrantedAccess,
	})
	if a.jwt != "" {
		rpcReq.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	_, err := client.AttachPersonToIncident(ctx, rpcReq)
	status := http.StatusNoContent
	if err != nil {
		status = connectStatus(err)
	}
	return &http.Response{StatusCode: status, Body: http.NoBody}
}

func (a ApiHelper) attachPersonToVisit(ctx context.Context, eventName string, visit int32, personID int64) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, imsjson.VisitPerson{}, a.serverURL.JoinPath("/ims/api/events/", eventName, "/visits/", strconv.Itoa(int(visit)), "/people/", strconv.FormatInt(personID, 10)).String())
}

// detachPersonFromIncident removes a person from an incident through the generated Connect client.
// The REST DELETE .../incidents/{n}/people/{personId} endpoint was retired when
// DetachPersonFromIncident was extracted (plan 09h/1c). The retired endpoint returned 204 No Content
// on success, mirrored by the synthesized *http.Response (else connectStatus(err)).
func (a ApiHelper) detachPersonFromIncident(ctx context.Context, eventName string, incident int32, personID int64) *http.Response {
	a.t.Helper()
	eventID := a.resolveEventID(ctx, eventName)
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	rpcReq := connect.NewRequest(&servicerpcv1.DetachPersonFromIncidentRequest{
		EventId:        eventID,
		IncidentNumber: incident,
		PersonId:       int32(personID),
	})
	if a.jwt != "" {
		rpcReq.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	_, err := client.DetachPersonFromIncident(ctx, rpcReq)
	status := http.StatusNoContent
	if err != nil {
		status = connectStatus(err)
	}
	return &http.Response{StatusCode: status, Body: http.NoBody}
}

func (a ApiHelper) detachPersonFromVisit(ctx context.Context, eventName string, visit int32, personID int64) *http.Response {
	a.t.Helper()
	_, resp := a.imsDelete(ctx, a.serverURL.JoinPath("/ims/api/events/", eventName, "/visits/", strconv.Itoa(int(visit)), "/people/", strconv.FormatInt(personID, 10)).String(), nil)
	return resp
}

func (a ApiHelper) getMetrics(ctx context.Context, eventName string) (imsjson.Metrics, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/events/", eventName, "/metrics").String()
	bod, resp := a.imsGet(ctx, path, &imsjson.Metrics{})
	return *bod.(*imsjson.Metrics), resp
}

// getIncidents lists an event's incidents through the generated Connect client. The REST
// GET .../incidents list endpoint was retired when ListIncidents was extracted (plan
// 09h/1c). As with getIncident, the event is resolved to its numeric id (resolveEventID)
// and each IncidentView is mapped back to the legacy imsjson.Incident (incidentViewToJSON)
// with a synthesized *http.Response mirroring the retired endpoint's status. Callers pass
// no exclude_system_entries, so — as with the old REST list without the query param — the
// list includes system entries.
func (a ApiHelper) getIncidents(ctx context.Context, eventName string) (imsjson.Incidents, *http.Response) {
	a.t.Helper()
	eventID := a.resolveEventID(ctx, eventName)
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	req := connect.NewRequest(&servicerpcv1.ListIncidentsRequest{EventId: eventID})
	if a.jwt != "" {
		req.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	resp, err := client.ListIncidents(ctx, req)
	httpResp := &http.Response{StatusCode: connectStatus(err), Body: http.NoBody}
	if err != nil {
		return nil, httpResp
	}
	incidents := make(imsjson.Incidents, 0, len(resp.Msg.GetIncidents()))
	for _, view := range resp.Msg.GetIncidents() {
		incidents = append(incidents, incidentViewToJSON(view))
	}
	return incidents, httpResp
}

func (a ApiHelper) getVisits(ctx context.Context, eventName string) (imsjson.Visits, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath(fmt.Sprint("/ims/api/events/", eventName, "/visits")).String()
	bod, resp := a.imsGet(ctx, path, &imsjson.Visits{})
	return *bod.(*imsjson.Visits), resp
}

// updateIncidentJournalEntry strikes/unstrikes an incident's journal entry through the generated
// Connect client. The REST POST .../incidents/{n}/journal_entries/{id} endpoint was retired when
// UpdateIncidentJournalEntry was extracted (plan 09h/1c). The entry id rides its own request field;
// the body carries only the stricken flag (journalEntryWriteToProto). The retired endpoint returned
// 204 No Content on success, mirrored by the synthesized *http.Response (else connectStatus(err)).
func (a ApiHelper) updateIncidentJournalEntry(ctx context.Context, eventName string, incident int32, req imsjson.JournalEntry) *http.Response {
	a.t.Helper()
	eventID := a.resolveEventID(ctx, eventName)
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	rpcReq := connect.NewRequest(&servicerpcv1.UpdateIncidentJournalEntryRequest{
		EventId:        eventID,
		IncidentNumber: incident,
		JournalEntryId: req.ID,
		Entry:          journalEntryWriteToProto(req),
	})
	if a.jwt != "" {
		rpcReq.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	_, err := client.UpdateIncidentJournalEntry(ctx, rpcReq)
	status := http.StatusNoContent
	if err != nil {
		status = connectStatus(err)
	}
	return &http.Response{StatusCode: status, Body: http.NoBody}
}

// updateReportJournalEntry strikes/unstrikes a report's journal entry through the generated
// Connect client. The REST POST .../reports/{n}/journal_entries/{id} endpoint was retired when
// UpdateReportJournalEntry was extracted (plan 09h/1c). The entry id rides its own request field;
// the body carries only the stricken flag (journalEntryWriteToProto). The retired endpoint returned
// 204 No Content on success, mirrored by the synthesized *http.Response (else connectStatus(err)).
func (a ApiHelper) updateReportJournalEntry(ctx context.Context, eventName string, report int32, req imsjson.JournalEntry) *http.Response {
	a.t.Helper()
	eventID := a.resolveEventID(ctx, eventName)
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	rpcReq := connect.NewRequest(&servicerpcv1.UpdateReportJournalEntryRequest{
		EventId:        eventID,
		ReportNumber:   report,
		JournalEntryId: req.ID,
		Entry:          journalEntryWriteToProto(req),
	})
	if a.jwt != "" {
		rpcReq.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	_, err := client.UpdateReportJournalEntry(ctx, rpcReq)
	status := http.StatusNoContent
	if err != nil {
		status = connectStatus(err)
	}
	return &http.Response{StatusCode: status, Body: http.NoBody}
}

func (a ApiHelper) editEvent(ctx context.Context, req imsjson.Event) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events").String())
}

func (a ApiHelper) createEvent(ctx context.Context, req imsjson.Event) (eventID int32, resp *http.Response) {
	a.t.Helper()
	resp = a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events").String())
	// Assert success before reading the id header: on a 5xx the header is empty and
	// ParseInt would otherwise fail with a cryptic "parsing \"\"" message that hides
	// the real status. Surface the status instead.
	require.Equalf(a.t, http.StatusNoContent, resp.StatusCode,
		"createEvent expected 204, got %d", resp.StatusCode)
	eventID, err := conv.ParseInt32(resp.Header.Get("IMS-Event-ID"))
	require.NoError(a.t, err)
	return eventID, resp
}

// listEvents lists events through the generated Connect client. The REST GET
// /events endpoint was retired when ListEvents was extracted (plan 09h/1c), so the
// suite exercises the real RPC here, carrying the helper's JWT as the Bearer token
// exactly as a browser or the Expo client will.
func (a ApiHelper) listEvents(ctx context.Context) (*servicerpcv1.ListEventsResponse, error) {
	a.t.Helper()
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	req := connect.NewRequest(&servicerpcv1.ListEventsRequest{})
	req.Header().Set("Authorization", "Bearer "+a.jwt)
	resp, err := client.ListEvents(ctx, req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

// addWriter / addReporter grant a per-event role by setting the person's
// PERSON__EVENT participation tier (plan 52b: access derives from participation).
// They return 204.
func (a ApiHelper) addWriter(ctx context.Context, eventName, handle string) *http.Response {
	a.t.Helper()
	return a.setParticipation(ctx, personIDForHandle(a.t, handle), eventName,
		personapi.SetParticipationRequest{ParticipationType: "writer"})
}

func (a ApiHelper) addReporter(ctx context.Context, eventName, handle string) *http.Response {
	a.t.Helper()
	return a.setParticipation(ctx, personIDForHandle(a.t, handle), eventName,
		personapi.SetParticipationRequest{ParticipationType: "reporter"})
}

// addVisitWriter grants the writer tier. The 52b ladder has no visit-only rung
// (writer already covers visits), so this is a thin alias kept for the existing
// visit tests; visits themselves are disabled for the beta.
func (a ApiHelper) addVisitWriter(ctx context.Context, eventName, handle string) *http.Response {
	a.t.Helper()
	return a.setParticipation(ctx, personIDForHandle(a.t, handle), eventName,
		personapi.SetParticipationRequest{ParticipationType: "writer"})
}

// personIDForHandle maps the suite's fixed login handles to their seeded PERSON.ID
// so role-granting helpers can target the per-event participation endpoint (which
// is keyed by person id).
func personIDForHandle(t *testing.T, handle string) int64 {
	t.Helper()
	switch handle {
	case userAdminHandle:
		return userAdminPersonID
	case userAliceHandle:
		return userAlicePersonID
	case userBobHandle:
		return userBobPersonID
	case userCarolHandle:
		return userCarolPersonID
	case userDaveHandle:
		return userDavePersonID
	case userErinHandle:
		return userErinPersonID
	}
	t.Fatalf("personIDForHandle: unknown handle %q", handle)
	return 0
}

func (a ApiHelper) attachFileToIncident(ctx context.Context, eventName string, incident int32, fileBytes []byte) (int32, *http.Response) {
	a.t.Helper()

	path := a.serverURL.JoinPath("/ims/api/events", eventName, "incidents", conv.FormatInt(incident), "attachments")

	// Create a `multipart/form-data`-encoded request, with a single form file inside
	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)
	part, err := writer.CreateFormFile(incidentapi.IMSAttachmentFormKey, "irrelevant-filename-"+rand.NonCryptoText())
	require.NoError(a.t, err)
	_, err = part.Write(fileBytes)
	require.NoError(a.t, err)
	require.NoError(a.t, writer.Close())

	httpPost, err := http.NewRequestWithContext(ctx, http.MethodPost, path.String(), &requestBody)
	require.NoError(a.t, err)
	if a.jwt != "" {
		httpPost.Header.Set("Authorization", "Bearer "+a.jwt)
	}
	httpPost.Header.Set("Content-Type", writer.FormDataContentType())
	client := &http.Client{
		Timeout: 10 * time.Second,
	}
	// #nosec G704 // SSRF via taint analysis. We control the URLs.
	resp, err := client.Do(httpPost)
	require.NoError(a.t, err)

	reID, _ := conv.ParseInt32(resp.Header.Get("IMS-Journal-Entry-Number"))

	return reID, resp
}

func (a ApiHelper) attachFileToVisit(ctx context.Context, eventName string, visit int32, fileBytes []byte) (int32, *http.Response) {
	a.t.Helper()

	path := a.serverURL.JoinPath("/ims/api/events", eventName, "visits", conv.FormatInt(visit), "attachments")

	// Create a `multipart/form-data`-encoded request, with a single form file inside
	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)
	part, err := writer.CreateFormFile(incidentapi.IMSAttachmentFormKey, "irrelevant-filename-"+rand.NonCryptoText())
	require.NoError(a.t, err)
	_, err = part.Write(fileBytes)
	require.NoError(a.t, err)
	require.NoError(a.t, writer.Close())

	httpPost, err := http.NewRequestWithContext(ctx, http.MethodPost, path.String(), &requestBody)
	require.NoError(a.t, err)
	if a.jwt != "" {
		httpPost.Header.Set("Authorization", "Bearer "+a.jwt)
	}
	httpPost.Header.Set("Content-Type", writer.FormDataContentType())
	client := &http.Client{
		Timeout: 10 * time.Second,
	}
	// #nosec G704 // SSRF via taint analysis.
	resp, err := client.Do(httpPost)
	require.NoError(a.t, err)

	reID, _ := conv.ParseInt32(resp.Header.Get("IMS-Journal-Entry-Number"))

	return reID, resp
}

func (a ApiHelper) getIncidentAttachment(ctx context.Context, eventName string, incident, reID int32) ([]byte, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/events", eventName, "incidents", conv.FormatInt(incident), "attachments", conv.FormatInt(reID)).String()
	return a.imsGetBodyBytes(ctx, path)
}

func (a ApiHelper) getVisitAttachment(ctx context.Context, eventName string, visit, reID int32) ([]byte, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/events", eventName, "visits", conv.FormatInt(visit), "attachments", conv.FormatInt(reID)).String()
	return a.imsGetBodyBytes(ctx, path)
}

func (a ApiHelper) attachFileToReport(ctx context.Context, eventName string, report int32, fileBytes []byte) (int32, *http.Response) {
	a.t.Helper()

	path := a.serverURL.JoinPath("/ims/api/events", eventName, "reports", conv.FormatInt(report), "attachments")

	// Create a `multipart/form-data`-encoded request, with a single form file inside
	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)
	part, err := writer.CreateFormFile(incidentapi.IMSAttachmentFormKey, "irrelevant-filename-"+rand.NonCryptoText())
	require.NoError(a.t, err)
	_, err = part.Write(fileBytes)
	require.NoError(a.t, err)
	require.NoError(a.t, writer.Close())

	httpPost, err := http.NewRequestWithContext(ctx, http.MethodPost, path.String(), &requestBody)
	require.NoError(a.t, err)
	if a.jwt != "" {
		httpPost.Header.Set("Authorization", "Bearer "+a.jwt)
	}
	httpPost.Header.Set("Content-Type", writer.FormDataContentType())
	client := &http.Client{
		Timeout: 10 * time.Second,
	}
	// #nosec G704 // SSRF via taint analysis.
	resp, err := client.Do(httpPost)
	require.NoError(a.t, err)

	reID, _ := conv.ParseInt32(resp.Header.Get("IMS-Journal-Entry-Number"))

	return reID, resp
}

func (a ApiHelper) getReportAttachment(ctx context.Context, eventName string, report, reID int32) ([]byte, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/events", eventName, "reports", conv.FormatInt(report), "attachments", conv.FormatInt(reID)).String()
	return a.imsGetBodyBytes(ctx, path)
}

func (a ApiHelper) imsPost(ctx context.Context, body any, path string) *http.Response {
	a.t.Helper()
	postBody, err := json.Marshal(body)
	require.NoError(a.t, err)
	httpPost, err := http.NewRequestWithContext(ctx, http.MethodPost, path, bytes.NewReader(postBody))
	require.NoError(a.t, err)
	if a.jwt != "" {
		httpPost.Header.Set("Authorization", "Bearer "+a.jwt)
	}
	if a.referrer != "" {
		httpPost.Header.Set("Referer", a.referrer)
	}
	client := &http.Client{
		Timeout: 10 * time.Second,
	}
	// #nosec G704 // SSRF via taint analysis.
	resp, err := client.Do(httpPost)
	require.NoError(a.t, err)
	return resp
}

func (a ApiHelper) imsGetBodyBytes(ctx context.Context, path string) ([]byte, *http.Response) {
	a.t.Helper()
	outBytes, httpResp := a.imsGet(ctx, path, nil)
	return outBytes.([]byte), httpResp
}

func (a ApiHelper) imsDelete(ctx context.Context, path string, resp any) (any, *http.Response) {
	a.t.Helper()
	return a.imsDoNoReqBody(ctx, http.MethodDelete, path, resp)
}

func (a ApiHelper) imsGet(ctx context.Context, path string, resp any) (any, *http.Response) {
	a.t.Helper()
	return a.imsDoNoReqBody(ctx, http.MethodGet, path, resp)
}

func (a ApiHelper) imsDoNoReqBody(ctx context.Context, method, path string, resp any) (any, *http.Response) {
	a.t.Helper()
	httpReq, err := http.NewRequestWithContext(ctx, method, path, nil)
	require.NoError(a.t, err)
	if a.jwt != "" {
		httpReq.Header.Set("Authorization", "Bearer "+a.jwt)
	}
	if a.referrer != "" {
		httpReq.Header.Set("Referer", a.referrer)
	}
	client := &http.Client{
		Timeout: 10 * time.Second,
	}
	// #nosec G704 // SSRF via taint analysis.
	get, err := client.Do(httpReq)
	require.NoError(a.t, err)
	b, err := io.ReadAll(get.Body)
	require.NoError(a.t, err)
	require.NoError(a.t, get.Body.Close())
	if resp == nil {
		return b, get
	}
	err = json.Unmarshal(b, &resp)
	if err != nil && get.StatusCode != http.StatusOK {
		return resp, get
	}
	require.NoError(a.t, err)
	return resp, get
}

func (a ApiHelper) getActionLogs(ctx context.Context, minTime, maxTime string) (imsjson.ActionLogs, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/actionlogs")
	q := path.Query()
	q.Set("minTimeUnixMs", minTime)
	q.Set("maxTimeUnixMs", maxTime)
	path.RawQuery = q.Encode()

	bod, resp := a.imsGet(ctx, path.String(), &imsjson.ActionLogs{})
	return *bod.(*imsjson.ActionLogs), resp
}

func jwtForAlice(t *testing.T, ctx context.Context) string {
	t.Helper()
	apisNotAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}
	statusCode, _, token := apisNotAuthenticated.postAuth(ctx, authapi.PostAuthRequest{
		Identification: userAliceEmail,
		Password:       userAlicePassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
	return token
}

func jwtForDave(t *testing.T, ctx context.Context) string {
	t.Helper()
	apisNotAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}
	statusCode, _, token := apisNotAuthenticated.postAuth(ctx, authapi.PostAuthRequest{
		Identification: userDaveEmail,
		Password:       userDavePassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
	return token
}

func jwtForErin(t *testing.T, ctx context.Context) string {
	t.Helper()
	apisNotAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}
	statusCode, _, token := apisNotAuthenticated.postAuth(ctx, authapi.PostAuthRequest{
		Identification: userErinEmail,
		Password:       userErinPassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
	return token
}

// addCrewLeader grants the crew_leader tier (reporter-level access, the
// invite-reporters power, and read-only incident access) by setting the person's
// PERSON__EVENT participation.
func (a ApiHelper) addCrewLeader(ctx context.Context, eventName, handle string) *http.Response {
	a.t.Helper()
	return a.setParticipation(ctx, personIDForHandle(a.t, handle), eventName,
		personapi.SetParticipationRequest{ParticipationType: "crew_leader"})
}

func (a ApiHelper) getNotifications(ctx context.Context) (imsjson.NotificationList, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/notifications").String()
	bod, resp := a.imsGet(ctx, path, &imsjson.NotificationList{})
	return *bod.(*imsjson.NotificationList), resp
}

func (a ApiHelper) markAllNotificationsRead(ctx context.Context) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, struct{}{}, a.serverURL.JoinPath("/ims/api/notifications/read").String())
}

// notificationsForEvent fetches the caller's notifications and returns only those
// for the given event. Notifications are global per person and seed users are
// shared across parallel tests, so a test must scope to its own (unique) event
// rather than asserting a global count.
func (a ApiHelper) notificationsForEvent(ctx context.Context, eventName string) []imsjson.Notification {
	a.t.Helper()
	list, resp := a.getNotifications(ctx)
	require.Equal(a.t, http.StatusOK, resp.StatusCode)
	require.NoError(a.t, resp.Body.Close())
	var out []imsjson.Notification
	for _, n := range list.Notifications {
		if n.Event == eventName {
			out = append(out, n)
		}
	}
	return out
}

// pushSubscribe POSTs a web-push subscription for the caller (plan 84).
func (a ApiHelper) pushSubscribe(ctx context.Context, body pushapi.PushSubscribeRequest) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, body, a.serverURL.JoinPath("/ims/api/push/subscribe").String())
}

// pushUnsubscribe DELETEs the caller's device named by its endpoint. DELETE
// carries a JSON body, so it can't reuse the no-body imsDelete helper.
func (a ApiHelper) pushUnsubscribe(ctx context.Context, body pushapi.PushUnsubscribeRequest) *http.Response {
	a.t.Helper()
	reqBody, err := json.Marshal(body)
	require.NoError(a.t, err)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		a.serverURL.JoinPath("/ims/api/push/subscribe").String(), bytes.NewReader(reqBody))
	require.NoError(a.t, err)
	if a.jwt != "" {
		httpReq.Header.Set("Authorization", "Bearer "+a.jwt)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	// #nosec G704 // SSRF via taint analysis.
	resp, err := client.Do(httpReq)
	require.NoError(a.t, err)
	return resp
}

func jwtForAdmin(ctx context.Context, t *testing.T) string {
	t.Helper()
	apisNotAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}
	statusCode, _, token := apisNotAuthenticated.postAuth(ctx, authapi.PostAuthRequest{
		Identification: userAdminEmail,
		Password:       userAdminPassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
	return token
}

var adminJWTOnce sync.Once
var adminJWTValue string

// adminJWTCached logs in as the admin once for the whole package and reuses the token.
// resolveEventID needs an always-authorized identity to translate event names to ids,
// and argon2id login is deliberately slow, so a single cached token avoids re-hashing
// on every incident read across the parallel suite.
func adminJWTCached(t *testing.T, ctx context.Context) string {
	t.Helper()
	adminJWTOnce.Do(func() {
		adminJWTValue = jwtForAdmin(ctx, t)
	})
	return adminJWTValue
}
