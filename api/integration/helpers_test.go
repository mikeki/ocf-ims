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
	"testing"
	"time"

	"github.com/mikeki/ocf-ims/api"
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

func (a ApiHelper) postAuth(ctx context.Context, req api.PostAuthRequest) (statusCode int, body, validJWT string) {
	a.t.Helper()
	response := &api.PostAuthResponse{}
	resp := a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/auth").String())
	b, err := io.ReadAll(resp.Body)
	require.NoError(a.t, resp.Body.Close())
	require.NoError(a.t, err)
	if resp.StatusCode != http.StatusOK {
		return resp.StatusCode, string(b), ""
	}
	err = json.Unmarshal(b, &response)
	require.NoError(a.t, err)
	return resp.StatusCode, string(b), response.Token
}

func (a ApiHelper) refreshAccessToken(ctx context.Context, refreshCookie *http.Cookie) (statusCode int, result *api.RefreshAccessTokenResponse) {
	a.t.Helper()
	response := &api.RefreshAccessTokenResponse{}
	postBody, err := json.Marshal(struct{}{})
	require.NoError(a.t, err)
	httpPost, err := http.NewRequestWithContext(ctx, http.MethodPost, a.serverURL.JoinPath("/ims/api/auth/refresh").String(), bytes.NewReader(postBody))
	require.NoError(a.t, err)
	if a.jwt != "" {
		httpPost.Header.Set("Authorization", "Bearer "+a.jwt)
	}
	httpPost.AddCookie(refreshCookie)
	// #nosec G704 // SSRF via taint analysis. We control the URLs.
	client := &http.Client{
		Timeout: 10 * time.Second,
	}
	// #nosec G704 // SSRF via taint analysis.
	resp, err := client.Do(httpPost)
	require.NoError(a.t, err)

	b, err := io.ReadAll(resp.Body)
	require.NoError(a.t, err)
	require.NoError(a.t, resp.Body.Close())
	if resp.StatusCode != http.StatusOK {
		return resp.StatusCode, nil
	}
	err = json.Unmarshal(b, &response)
	require.NoError(a.t, err)
	return resp.StatusCode, response
}

func (a ApiHelper) getAuth(ctx context.Context, eventName string) (api.GetAuthResponse, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/auth").String()
	if eventName != "" {
		path = path + "?event_id=" + eventName
	}
	bod, resp := a.imsGet(ctx, path, &api.GetAuthResponse{})
	return *bod.(*api.GetAuthResponse), resp
}

func (a ApiHelper) setPersonPassword(ctx context.Context, personID int64, password string) *http.Response {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/personnel", strconv.FormatInt(personID, 10), "password").String()
	return a.imsPost(ctx, api.SetPersonPasswordRequest{Password: password}, path)
}

func (a ApiHelper) setPersonAdmin(ctx context.Context, personID int64, isAdmin bool) *http.Response {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/personnel", strconv.FormatInt(personID, 10), "admin").String()
	return a.imsPost(ctx, api.SetPersonAdminRequest{IsAdmin: isAdmin}, path)
}

func (a ApiHelper) createPerson(ctx context.Context, body api.CreatePersonRequest) *http.Response {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/personnel").String()
	return a.imsPost(ctx, body, path)
}

func (a ApiHelper) editPerson(ctx context.Context, personID int64, body api.EditPersonRequest) *http.Response {
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

// setParticipation upserts a person's per-event participation via the dedicated
// endpoint (enroll / mark not-present / eject), without touching their profile.
func (a ApiHelper) setParticipation(ctx context.Context, personID int64, eventName string, body api.SetParticipationRequest) *http.Response {
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

func (a ApiHelper) newReport(ctx context.Context, req imsjson.Report) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events/"+req.Event+"/reports").String())
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

func (a ApiHelper) getReport(ctx context.Context, eventName string, report int32) (imsjson.Report, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/events/", eventName, "/reports/", strconv.Itoa(int(report))).String()
	bod, resp := a.imsGet(ctx, path, &imsjson.Report{})
	return *bod.(*imsjson.Report), resp
}

func (a ApiHelper) getReports(ctx context.Context, eventName string) (imsjson.Reports, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath(fmt.Sprint("/ims/api/events/", eventName, "/reports")).String()
	bod, resp := a.imsGet(ctx, path, &imsjson.Reports{})
	return *bod.(*imsjson.Reports), resp
}

func (a ApiHelper) updateReport(ctx context.Context, eventName string, report int32, req imsjson.Report) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events/", eventName, "/reports/", conv.FormatInt(report)).String())
}

func (a ApiHelper) attachReportToIncident(ctx context.Context, eventName string, report int32, incident int32) *http.Response {
	a.t.Helper()
	req := imsjson.Report{}
	params := "?action=attach&incident=" + conv.FormatInt(incident)
	return a.imsPost(ctx, req,
		a.serverURL.JoinPath("/ims/api/events/", eventName, "/reports/",
			conv.FormatInt(report)).String()+params)
}

func (a ApiHelper) detachReportFromIncident(ctx context.Context, eventName string, report int32) *http.Response {
	a.t.Helper()
	req := imsjson.Report{}
	params := "?action=detach"
	return a.imsPost(ctx, req,
		a.serverURL.JoinPath("/ims/api/events/", eventName, "/reports/",
			conv.FormatInt(report)).String()+params)
}

func (a ApiHelper) newIncident(ctx context.Context, req imsjson.Incident) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events/"+req.Event+"/incidents").String())
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

func (a ApiHelper) getIncident(ctx context.Context, eventName string, incident int32) (imsjson.Incident, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/events/", eventName, "/incidents/", strconv.Itoa(int(incident))).String()
	bod, resp := a.imsGet(ctx, path, &imsjson.Incident{})
	return *bod.(*imsjson.Incident), resp
}

func (a ApiHelper) getVisit(ctx context.Context, eventName string, visit int32) (imsjson.Visit, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/events/", eventName, "/visits/", strconv.Itoa(int(visit))).String()
	bod, resp := a.imsGet(ctx, path, &imsjson.Visit{})
	return *bod.(*imsjson.Visit), resp
}

func (a ApiHelper) updateIncident(ctx context.Context, eventName string, incident int32, req imsjson.Incident) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events/", eventName, "/incidents/", strconv.Itoa(int(incident))).String())
}

func (a ApiHelper) updateVisit(ctx context.Context, eventName string, visit int32, req imsjson.Visit) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events/", eventName, "/visits/", strconv.Itoa(int(visit))).String())
}

func (a ApiHelper) attachPersonToIncident(ctx context.Context, eventName string, incident int32, personID int64) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, imsjson.IncidentPerson{}, a.serverURL.JoinPath("/ims/api/events/", eventName, "/incidents/", strconv.Itoa(int(incident)), "/people/", strconv.FormatInt(personID, 10)).String())
}

func (a ApiHelper) attachPersonToVisit(ctx context.Context, eventName string, visit int32, personID int64) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, imsjson.VisitPerson{}, a.serverURL.JoinPath("/ims/api/events/", eventName, "/visits/", strconv.Itoa(int(visit)), "/people/", strconv.FormatInt(personID, 10)).String())
}

func (a ApiHelper) detachPersonFromIncident(ctx context.Context, eventName string, incident int32, personID int64) *http.Response {
	a.t.Helper()
	_, resp := a.imsDelete(ctx, a.serverURL.JoinPath("/ims/api/events/", eventName, "/incidents/", strconv.Itoa(int(incident)), "/people/", strconv.FormatInt(personID, 10)).String(), nil)
	return resp
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

func (a ApiHelper) getIncidents(ctx context.Context, eventName string) (imsjson.Incidents, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath(fmt.Sprint("/ims/api/events/", eventName, "/incidents")).String()
	bod, resp := a.imsGet(ctx, path, &imsjson.Incidents{})
	return *bod.(*imsjson.Incidents), resp
}

func (a ApiHelper) getVisits(ctx context.Context, eventName string) (imsjson.Visits, *http.Response) {
	a.t.Helper()
	path := a.serverURL.JoinPath(fmt.Sprint("/ims/api/events/", eventName, "/visits")).String()
	bod, resp := a.imsGet(ctx, path, &imsjson.Visits{})
	return *bod.(*imsjson.Visits), resp
}

func (a ApiHelper) updateIncidentJournalEntry(ctx context.Context, eventName string, incident int32, req imsjson.JournalEntry) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events/", eventName, "/incidents/", conv.FormatInt(incident), "/journal_entries/", conv.FormatInt(req.ID)).String())
}

func (a ApiHelper) updateReportJournalEntry(ctx context.Context, eventName string, report int32, req imsjson.JournalEntry) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events/", eventName, "/reports/", conv.FormatInt(report), "/journal_entries/", conv.FormatInt(req.ID)).String())
}

func (a ApiHelper) editEvent(ctx context.Context, req imsjson.Event) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events").String())
}

func (a ApiHelper) createEvent(ctx context.Context, req imsjson.Event) (eventID int32, resp *http.Response) {
	a.t.Helper()
	resp = a.imsPost(ctx, req, a.serverURL.JoinPath("/ims/api/events").String())
	var err error
	eventID, err = conv.ParseInt32(resp.Header.Get("IMS-Event-ID"))
	require.NoError(a.t, err)
	return eventID, resp
}

func (a ApiHelper) getEvents(ctx context.Context) (imsjson.Events, *http.Response) {
	a.t.Helper()
	bod, resp := a.imsGet(ctx, a.serverURL.JoinPath("/ims/api/events").String(), &imsjson.Events{})
	return *bod.(*imsjson.Events), resp
}

// addWriter / addReporter grant a per-event role by setting the person's
// PERSON__EVENT participation tier (plan 52b: access derives from participation).
// They return 204.
func (a ApiHelper) addWriter(ctx context.Context, eventName, handle string) *http.Response {
	a.t.Helper()
	return a.setParticipation(ctx, personIDForHandle(a.t, handle), eventName,
		api.SetParticipationRequest{ParticipationType: "writer"})
}

func (a ApiHelper) addReporter(ctx context.Context, eventName, handle string) *http.Response {
	a.t.Helper()
	return a.setParticipation(ctx, personIDForHandle(a.t, handle), eventName,
		api.SetParticipationRequest{ParticipationType: "reporter"})
}

// addVisitWriter grants the writer tier. The 52b ladder has no visit-only rung
// (writer already covers visits), so this is a thin alias kept for the existing
// visit tests; visits themselves are disabled for the beta.
func (a ApiHelper) addVisitWriter(ctx context.Context, eventName, handle string) *http.Response {
	a.t.Helper()
	return a.setParticipation(ctx, personIDForHandle(a.t, handle), eventName,
		api.SetParticipationRequest{ParticipationType: "writer"})
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
	part, err := writer.CreateFormFile(api.IMSAttachmentFormKey, "irrelevant-filename-"+rand.NonCryptoText())
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
	part, err := writer.CreateFormFile(api.IMSAttachmentFormKey, "irrelevant-filename-"+rand.NonCryptoText())
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
	part, err := writer.CreateFormFile(api.IMSAttachmentFormKey, "irrelevant-filename-"+rand.NonCryptoText())
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
	statusCode, _, token := apisNotAuthenticated.postAuth(ctx, api.PostAuthRequest{
		Identification: userAliceEmail,
		Password:       userAlicePassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
	return token
}

func jwtForAdmin(ctx context.Context, t *testing.T) string {
	t.Helper()
	apisNotAuthenticated := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}
	statusCode, _, token := apisNotAuthenticated.postAuth(ctx, api.PostAuthRequest{
		Identification: userAdminEmail,
		Password:       userAdminPassword,
	})
	require.Equal(t, http.StatusOK, statusCode)
	return token
}
