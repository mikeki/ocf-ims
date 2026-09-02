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
	"net/http"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/directory"
	servicerpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/gen/ocf/ims/service/v1/servicev1connect"
	"github.com/mikeki/ocf-ims/internal/actionlog"
	"github.com/mikeki/ocf-ims/internal/area"
	"github.com/mikeki/ocf-ims/internal/auth"
	"github.com/mikeki/ocf-ims/internal/crew"
	"github.com/mikeki/ocf-ims/internal/event"
	"github.com/mikeki/ocf-ims/internal/incident"
	"github.com/mikeki/ocf-ims/internal/incidenttype"
	"github.com/mikeki/ocf-ims/internal/metrics"
	"github.com/mikeki/ocf-ims/internal/notification"
	"github.com/mikeki/ocf-ims/internal/outcome"
	"github.com/mikeki/ocf-ims/internal/person"
	"github.com/mikeki/ocf-ims/internal/push"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/attachment"
	"github.com/mikeki/ocf-ims/lib/authz"
	pushlib "github.com/mikeki/ocf-ims/lib/push"
	"github.com/mikeki/ocf-ims/store"
)

// ImsService is the Connect implementation of the ocf.ims.service.v1.ImsService
// contract (plan 09, Phase 1). It sits beside AddToMux in this wiring package
// because — like AddToMux — it aggregates every domain: it composes each domain's
// internal/<domain>.Service and every method delegates to it. As a resource is extracted (1c/1d) its REST
// route is DELETED, not shimmed — the aggressive migration path in plan 09 §6, so
// the RPC becomes the sole transport for that resource.
//
// The Phase-1 exit gate is now PASSED: every RPC on the servicev1connect.ImsServiceHandler
// interface is implemented, so the type no longer embeds UnimplementedImsServiceHandler.
// That scaffold satisfied the interface while methods were filled in resource-by-resource
// across 1c/1d; dropping it makes the compiler the exhaustiveness check — a future RPC added
// to the contract fails to build until it has a method here, instead of silently answering
// CodeUnimplemented. (The unimplemented-passes-validation probe uses a test-only bare handler;
// see newBareUnimplementedConnectClient in connect_test.go.)
type ImsService struct {
	// Each domain package exposes a Service that holds the dependencies its RPCs share;
	// ImsService composes them (each built once in AddConnectToMux) and every RPC method
	// delegates to the matching domain Service. A resource is extracted by adding its
	// domain Service here and wiring it below — that is where the shared, mutable
	// cross-surface state (the SSE EventSourcerer, the dashboard MetricsCache) is threaded
	// in so a Connect write fans out and invalidates exactly as the REST surface does.
	Event        event.Service
	Incident     incident.Service
	Person       person.Service
	Auth         auth.Service
	IncidentType incidenttype.Service
	Outcome      outcome.Service
	Area         area.Service
	Crew         crew.Service
	Notification notification.Service
	Push         push.Service
	Metrics      metrics.Service
	ActionLog    actionlog.Service
}

// ListEvents is a thin RPC method over the event.ListEvents domain method (plan
// 09h/1c). Its REST predecessor (GET /events) was deleted in the same slice, so
// this is the only transport for listing events. The interceptor spine has already
// populated the caller's claims into ctx, so the method just delegates; the domain
// function already speaks Connect errors, so there is nothing to map.
func (s ImsService) ListEvents(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ListEventsRequest],
) (*connect.Response[servicerpcv1.ListEventsResponse], error) {
	resp, err := s.Event.ListEvents(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// CreateEvent and UpdateEvent are thin methods over event.Service (plan 09h/1c). They decompose the
// retired REST POST /events multiplexer (EditEvent) into an explicit create and update.

func (s ImsService) CreateEvent(
	ctx context.Context,
	req *connect.Request[servicerpcv1.CreateEventRequest],
) (*connect.Response[servicerpcv1.CreateEventResponse], error) {
	resp, err := s.Event.CreateEvent(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) UpdateEvent(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UpdateEventRequest],
) (*connect.Response[servicerpcv1.UpdateEventResponse], error) {
	resp, err := s.Event.UpdateEvent(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// ListIncidents is a thin RPC method over the incident.ListIncidents domain method
// (plan 09h/1c). Its REST predecessor (GET /events/{eventName}/incidents) was deleted in
// the same slice, so this is the only transport for listing an event's incidents. The
// domain method authorizes from ctx claims and speaks Connect errors, so this just
// delegates.
func (s ImsService) ListIncidents(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ListIncidentsRequest],
) (*connect.Response[servicerpcv1.ListIncidentsResponse], error) {
	resp, err := s.Incident.ListIncidents(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// GetIncident is a thin RPC method over the incident.GetIncident domain method
// (plan 09h/1c). Its REST predecessor (GET .../incidents/{n}) was deleted in the same
// slice, so this is the only transport for reading a single incident. The domain
// function already authorizes from ctx claims and speaks Connect errors, so this just
// delegates.
func (s ImsService) GetIncident(
	ctx context.Context,
	req *connect.Request[servicerpcv1.GetIncidentRequest],
) (*connect.Response[servicerpcv1.GetIncidentResponse], error) {
	resp, err := s.Incident.GetIncident(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// CreateIncident is a thin RPC method over the incident.CreateIncident domain method
// (plan 09h/1c). Its REST predecessor (POST .../incidents) was deleted in the same slice,
// so this is the only transport for creating an incident. The domain method authorizes
// from ctx claims and speaks Connect errors, so this just delegates; it carries the shared
// EventSourcerer / Pusher / MetricsCache so the create fans out SSE + push and invalidates
// the dashboard exactly as REST did.
func (s ImsService) CreateIncident(
	ctx context.Context,
	req *connect.Request[servicerpcv1.CreateIncidentRequest],
) (*connect.Response[servicerpcv1.CreateIncidentResponse], error) {
	resp, err := s.Incident.CreateIncident(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// UpdateIncident is a thin RPC method over the incident.UpdateIncident domain method
// (plan 09h/1c). Its REST predecessor (POST .../incidents/{n}) was deleted in the same
// slice. The domain method authorizes from ctx claims and speaks Connect errors, so
// this just delegates; it carries the shared EventSourcerer / Pusher / MetricsCache so
// the write fans out SSE + push and invalidates the dashboard exactly as REST did.
func (s ImsService) UpdateIncident(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UpdateIncidentRequest],
) (*connect.Response[servicerpcv1.UpdateIncidentResponse], error) {
	resp, err := s.Incident.UpdateIncident(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// GetReport is a thin RPC method over the incident.GetReport domain method (plan 09h/1c,
// reports). Its REST predecessor (GET .../reports/{n}) was deleted in the same slice, so this
// is the only transport for reading a single field report. The domain method authorizes from
// ctx claims and speaks Connect errors, so this just delegates.
func (s ImsService) GetReport(
	ctx context.Context,
	req *connect.Request[servicerpcv1.GetReportRequest],
) (*connect.Response[servicerpcv1.GetReportResponse], error) {
	resp, err := s.Incident.GetReport(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// ListReports is a thin RPC method over the incident.ListReports domain method (plan 09h/1c,
// reports). Its REST predecessor (GET .../reports) was deleted in the same slice, so this is
// the only transport for listing an event's field reports. The domain method authorizes from
// ctx claims and speaks Connect errors, so this just delegates.
func (s ImsService) ListReports(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ListReportsRequest],
) (*connect.Response[servicerpcv1.ListReportsResponse], error) {
	resp, err := s.Incident.ListReports(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// CreateReport is a thin RPC method over the incident.CreateReport domain method (plan 09h/1c,
// reports). Its REST predecessor (POST .../reports) was deleted in the same slice, so this is the
// only transport for creating a field report. The domain method authorizes from ctx claims and
// speaks Connect errors, so this just delegates.
func (s ImsService) CreateReport(
	ctx context.Context,
	req *connect.Request[servicerpcv1.CreateReportRequest],
) (*connect.Response[servicerpcv1.CreateReportResponse], error) {
	resp, err := s.Incident.CreateReport(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// UpdateReport is a thin RPC method over the incident.UpdateReport domain method (plan 09h/1c,
// reports). Its REST predecessor (POST .../reports/{n}) was deleted in the same slice, so this is
// the only transport for editing a field report's summary, journal, and incident link. The domain
// method authorizes from ctx claims and speaks Connect errors, so this just delegates.
func (s ImsService) UpdateReport(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UpdateReportRequest],
) (*connect.Response[servicerpcv1.UpdateReportResponse], error) {
	resp, err := s.Incident.UpdateReport(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// UpdateReportJournalEntry is a thin RPC method over the incident.UpdateReportJournalEntry domain
// method (plan 09h/1c, reports). Its REST predecessor (POST .../reports/{n}/journal_entries/{id})
// was deleted in the same slice, so this is the only transport for striking a report's journal
// entry. The domain method authorizes from ctx claims and speaks Connect errors, so this just
// delegates.
func (s ImsService) UpdateReportJournalEntry(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UpdateReportJournalEntryRequest],
) (*connect.Response[servicerpcv1.UpdateReportJournalEntryResponse], error) {
	resp, err := s.Incident.UpdateReportJournalEntry(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// AttachPersonToIncident is a thin RPC method over the incident.AttachPersonToIncident domain
// method (plan 09h/1c). Its REST predecessor (POST .../incidents/{n}/people/{personId}) was deleted
// in the same slice, so this is the only transport for attaching a person to an incident (or
// editing their involvement / access grant). The domain method authorizes from ctx claims and
// speaks Connect errors, so this just delegates; it carries the shared EventSourcerer / Pusher so
// the write fans out SSE + push exactly as REST did.
func (s ImsService) AttachPersonToIncident(
	ctx context.Context,
	req *connect.Request[servicerpcv1.AttachPersonToIncidentRequest],
) (*connect.Response[servicerpcv1.AttachPersonToIncidentResponse], error) {
	resp, err := s.Incident.AttachPersonToIncident(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// DetachPersonFromIncident is a thin RPC method over the incident.DetachPersonFromIncident domain
// method (plan 09h/1c). Its REST predecessor (DELETE .../incidents/{n}/people/{personId}) was
// deleted in the same slice, so this is the only transport for removing a person from an incident.
// The domain method authorizes from ctx claims and speaks Connect errors, so this just delegates.
func (s ImsService) DetachPersonFromIncident(
	ctx context.Context,
	req *connect.Request[servicerpcv1.DetachPersonFromIncidentRequest],
) (*connect.Response[servicerpcv1.DetachPersonFromIncidentResponse], error) {
	resp, err := s.Incident.DetachPersonFromIncident(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// UpdateIncidentJournalEntry is a thin RPC method over the incident.UpdateIncidentJournalEntry
// domain method (plan 09h/1c). Its REST predecessor (POST
// .../incidents/{n}/journal_entries/{id}) was deleted in the same slice, so this is the only
// transport for striking an incident's journal entry. The domain method authorizes from ctx claims
// and speaks Connect errors, so this just delegates.
func (s ImsService) UpdateIncidentJournalEntry(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UpdateIncidentJournalEntryRequest],
) (*connect.Response[servicerpcv1.UpdateIncidentJournalEntryResponse], error) {
	resp, err := s.Incident.UpdateIncidentJournalEntry(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// Login is a thin RPC method over the auth.Login domain method (plan 09h/1c). Its REST
// predecessor (POST /auth) was deleted in the same slice, so this is the only transport for
// logging in. The delegate does the two HTTP-boundary jobs the domain method stays clear of:
// it derives the rate-limit client IP from the forwarded headers / peer, and it sets the
// HttpOnly refresh cookie the domain method returns onto the response headers.
func (s ImsService) Login(
	ctx context.Context,
	req *connect.Request[servicerpcv1.LoginRequest],
) (*connect.Response[servicerpcv1.LoginResponse], error) {
	clientIP := server.ClientIP(req.Header(), req.Peer().Addr)
	msg, cookie, err := s.Auth.Login(ctx, req.Msg, clientIP)
	if err != nil {
		return nil, err
	}
	resp := connect.NewResponse(msg)
	resp.Header().Set("Set-Cookie", cookie.String())
	return resp, nil
}

// RefreshToken is a thin RPC method over the auth.RefreshToken domain method (plan 09h/1c).
// Its REST predecessor (POST /auth/refresh) was deleted in the same slice. The refresh token
// rides in the HttpOnly cookie, so the delegate reads it from the request headers and hands
// its value to the domain method (which stays HTTP-agnostic).
func (s ImsService) RefreshToken(
	ctx context.Context,
	req *connect.Request[servicerpcv1.RefreshTokenRequest],
) (*connect.Response[servicerpcv1.RefreshTokenResponse], error) {
	msg, err := s.Auth.RefreshToken(ctx, req.Msg, refreshTokenFromHeader(req.Header()))
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(msg), nil
}

// refreshTokenFromHeader pulls the refresh-token cookie value out of a request's headers,
// returning "" when it is absent (which the domain method treats as Unauthenticated). It reuses
// net/http's cookie parser by wrapping the header map in a throwaway request.
func refreshTokenFromHeader(h http.Header) string {
	cookie, err := (&http.Request{Header: h}).Cookie(authz.RefreshTokenCookieName)
	if err != nil {
		return ""
	}
	return cookie.Value
}

// GetAuthStatus is a thin RPC method over the auth.GetAuthStatus domain method (plan
// 09h/1c). It began in slice 1b as an in-line stub answering only the identity subset of the
// whoami (proving the interceptor spine plumbed auth through Connect); it now delegates to the
// completed domain method, which adds the viewer-derived remainder — can_manage_personnel,
// per-event event_access, push_vapid_public_key, using_default_password. Its REST predecessor
// (GET /auth) was deleted in the same slice, so this is the only transport. The domain method
// tolerates an anonymous caller (returns authenticated:false, not an error), so this just
// delegates.
func (s ImsService) GetAuthStatus(
	ctx context.Context,
	req *connect.Request[servicerpcv1.GetAuthStatusRequest],
) (*connect.Response[servicerpcv1.GetAuthStatusResponse], error) {
	resp, err := s.Auth.GetAuthStatus(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// ListPersonnel is a thin RPC method over the person.ListPersonnel domain method (plan 09h/1c). Its
// REST predecessor (GET /personnel) was deleted in the same slice. The domain method authorizes from
// ctx claims (GlobalReadPersonnel) and speaks Connect errors, so this just delegates.
func (s ImsService) ListPersonnel(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ListPersonnelRequest],
) (*connect.Response[servicerpcv1.ListPersonnelResponse], error) {
	resp, err := s.Person.ListPersonnel(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// ChangeOwnPassword is a thin RPC method over the person.ChangeOwnPassword domain method (plan
// 09h/1c). Its REST predecessor (POST /auth/password) was deleted in the same slice, so this is the
// only transport for a caller changing their own password. The domain method authorizes from ctx
// claims (the JWT subject is the target) and speaks Connect errors, so this just delegates.
func (s ImsService) ChangeOwnPassword(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ChangeOwnPasswordRequest],
) (*connect.Response[servicerpcv1.ChangeOwnPasswordResponse], error) {
	resp, err := s.Person.ChangeOwnPassword(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// UpdateOwnProfile is a thin RPC method over the person.UpdateOwnProfile domain method (plan
// 09h/1c). Its REST predecessor (POST /auth/profile) was deleted in the same slice, so this is the
// only transport for a caller editing their own identity/contact fields. The domain method
// authorizes from ctx claims and speaks Connect errors, so this just delegates.
func (s ImsService) UpdateOwnProfile(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UpdateOwnProfileRequest],
) (*connect.Response[servicerpcv1.UpdateOwnProfileResponse], error) {
	resp, err := s.Person.UpdateOwnProfile(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// DeleteOwnProfilePicture is a thin RPC method over the person.DeleteOwnProfilePicture domain method
// (plan 09h/1c). Its REST predecessor (DELETE /auth/picture) was deleted in the same slice, so this
// is the only transport for a caller removing their own picture. The domain method authorizes from
// ctx claims and speaks Connect errors, so this just delegates. (The picture *upload* stays REST.)
func (s ImsService) DeleteOwnProfilePicture(
	ctx context.Context,
	req *connect.Request[servicerpcv1.DeleteOwnProfilePictureRequest],
) (*connect.Response[servicerpcv1.DeleteOwnProfilePictureResponse], error) {
	resp, err := s.Person.DeleteOwnProfilePicture(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// The seven admin personnel-management writes below are thin RPC methods over the matching
// person.Service domain methods (connect_admin.go, plan 09h/1c). Each retired its REST route in the
// same slice; the domain method authorizes from ctx claims and speaks Connect errors, so these just
// delegate.

func (s ImsService) CreatePerson(
	ctx context.Context,
	req *connect.Request[servicerpcv1.CreatePersonRequest],
) (*connect.Response[servicerpcv1.CreatePersonResponse], error) {
	resp, err := s.Person.CreatePerson(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) UpdatePerson(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UpdatePersonRequest],
) (*connect.Response[servicerpcv1.UpdatePersonResponse], error) {
	resp, err := s.Person.UpdatePerson(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) SetPersonPassword(
	ctx context.Context,
	req *connect.Request[servicerpcv1.SetPersonPasswordRequest],
) (*connect.Response[servicerpcv1.SetPersonPasswordResponse], error) {
	resp, err := s.Person.SetPersonPassword(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) SetPersonAdmin(
	ctx context.Context,
	req *connect.Request[servicerpcv1.SetPersonAdminRequest],
) (*connect.Response[servicerpcv1.SetPersonAdminResponse], error) {
	resp, err := s.Person.SetPersonAdmin(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) SetPersonParticipation(
	ctx context.Context,
	req *connect.Request[servicerpcv1.SetPersonParticipationRequest],
) (*connect.Response[servicerpcv1.SetPersonParticipationResponse], error) {
	resp, err := s.Person.SetPersonParticipation(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) RemovePersonFromEvent(
	ctx context.Context,
	req *connect.Request[servicerpcv1.RemovePersonFromEventRequest],
) (*connect.Response[servicerpcv1.RemovePersonFromEventResponse], error) {
	resp, err := s.Person.RemovePersonFromEvent(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) DeletePersonProfilePicture(
	ctx context.Context,
	req *connect.Request[servicerpcv1.DeletePersonProfilePictureRequest],
) (*connect.Response[servicerpcv1.DeletePersonProfilePictureResponse], error) {
	resp, err := s.Person.DeletePersonProfilePicture(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// The six incident-type RPCs below are thin methods over the matching incidenttype.Service domain
// methods (connect.go, plan 09h/1c). The POST /incident_types multiplexer was decomposed into
// Create/Update/Approve/SetHidden; each retired its REST route in the same slice.

func (s ImsService) ListIncidentTypes(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ListIncidentTypesRequest],
) (*connect.Response[servicerpcv1.ListIncidentTypesResponse], error) {
	resp, err := s.IncidentType.ListIncidentTypes(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) CreateIncidentType(
	ctx context.Context,
	req *connect.Request[servicerpcv1.CreateIncidentTypeRequest],
) (*connect.Response[servicerpcv1.CreateIncidentTypeResponse], error) {
	resp, err := s.IncidentType.CreateIncidentType(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) UpdateIncidentType(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UpdateIncidentTypeRequest],
) (*connect.Response[servicerpcv1.UpdateIncidentTypeResponse], error) {
	resp, err := s.IncidentType.UpdateIncidentType(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) ApproveIncidentType(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ApproveIncidentTypeRequest],
) (*connect.Response[servicerpcv1.ApproveIncidentTypeResponse], error) {
	resp, err := s.IncidentType.ApproveIncidentType(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) SetIncidentTypeHidden(
	ctx context.Context,
	req *connect.Request[servicerpcv1.SetIncidentTypeHiddenRequest],
) (*connect.Response[servicerpcv1.SetIncidentTypeHiddenResponse], error) {
	resp, err := s.IncidentType.SetIncidentTypeHidden(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) ProposeIncidentType(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ProposeIncidentTypeRequest],
) (*connect.Response[servicerpcv1.ProposeIncidentTypeResponse], error) {
	resp, err := s.IncidentType.ProposeIncidentType(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// The six outcome RPCs below are thin methods over the matching outcome.Service domain methods
// (connect.go, plan 09h/1c). The POST /outcomes multiplexer was decomposed into
// Create/Update/Approve/SetHidden; each retired its REST route in the same slice.

func (s ImsService) ListOutcomes(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ListOutcomesRequest],
) (*connect.Response[servicerpcv1.ListOutcomesResponse], error) {
	resp, err := s.Outcome.ListOutcomes(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) CreateOutcome(
	ctx context.Context,
	req *connect.Request[servicerpcv1.CreateOutcomeRequest],
) (*connect.Response[servicerpcv1.CreateOutcomeResponse], error) {
	resp, err := s.Outcome.CreateOutcome(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) UpdateOutcome(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UpdateOutcomeRequest],
) (*connect.Response[servicerpcv1.UpdateOutcomeResponse], error) {
	resp, err := s.Outcome.UpdateOutcome(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) ApproveOutcome(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ApproveOutcomeRequest],
) (*connect.Response[servicerpcv1.ApproveOutcomeResponse], error) {
	resp, err := s.Outcome.ApproveOutcome(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) SetOutcomeHidden(
	ctx context.Context,
	req *connect.Request[servicerpcv1.SetOutcomeHiddenRequest],
) (*connect.Response[servicerpcv1.SetOutcomeHiddenResponse], error) {
	resp, err := s.Outcome.SetOutcomeHidden(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) ProposeOutcome(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ProposeOutcomeRequest],
) (*connect.Response[servicerpcv1.ProposeOutcomeResponse], error) {
	resp, err := s.Outcome.ProposeOutcome(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// The five area RPCs below are thin methods over the matching area.Service domain methods (connect.go,
// plan 09h/1c). The POST /areas multiplexer was decomposed into Create/Update/Approve/MarkDuplicate;
// they retired their REST routes in the same slice.

func (s ImsService) ListAreas(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ListAreasRequest],
) (*connect.Response[servicerpcv1.ListAreasResponse], error) {
	resp, err := s.Area.ListAreas(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) CreateArea(
	ctx context.Context,
	req *connect.Request[servicerpcv1.CreateAreaRequest],
) (*connect.Response[servicerpcv1.CreateAreaResponse], error) {
	resp, err := s.Area.CreateArea(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) UpdateArea(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UpdateAreaRequest],
) (*connect.Response[servicerpcv1.UpdateAreaResponse], error) {
	resp, err := s.Area.UpdateArea(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) ApproveArea(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ApproveAreaRequest],
) (*connect.Response[servicerpcv1.ApproveAreaResponse], error) {
	resp, err := s.Area.ApproveArea(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) MarkAreaDuplicate(
	ctx context.Context,
	req *connect.Request[servicerpcv1.MarkAreaDuplicateRequest],
) (*connect.Response[servicerpcv1.MarkAreaDuplicateResponse], error) {
	resp, err := s.Area.MarkAreaDuplicate(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// The seven crew RPCs below are thin methods over the matching crew.Service domain methods
// (connect.go, plan 09h/1c). The POST /crews multiplexer was decomposed into
// Create/Update/Delete/SetCrewMembership, and the crew-leader self-service /crews/mine pair into
// ListMyCrews / SetMyCrewMembership; they retired their REST routes in the same slice.

func (s ImsService) ListCrews(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ListCrewsRequest],
) (*connect.Response[servicerpcv1.ListCrewsResponse], error) {
	resp, err := s.Crew.ListCrews(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) CreateCrew(
	ctx context.Context,
	req *connect.Request[servicerpcv1.CreateCrewRequest],
) (*connect.Response[servicerpcv1.CreateCrewResponse], error) {
	resp, err := s.Crew.CreateCrew(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) UpdateCrew(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UpdateCrewRequest],
) (*connect.Response[servicerpcv1.UpdateCrewResponse], error) {
	resp, err := s.Crew.UpdateCrew(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) DeleteCrew(
	ctx context.Context,
	req *connect.Request[servicerpcv1.DeleteCrewRequest],
) (*connect.Response[servicerpcv1.DeleteCrewResponse], error) {
	resp, err := s.Crew.DeleteCrew(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) SetCrewMembership(
	ctx context.Context,
	req *connect.Request[servicerpcv1.SetCrewMembershipRequest],
) (*connect.Response[servicerpcv1.SetCrewMembershipResponse], error) {
	resp, err := s.Crew.SetCrewMembership(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) ListMyCrews(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ListMyCrewsRequest],
) (*connect.Response[servicerpcv1.ListMyCrewsResponse], error) {
	resp, err := s.Crew.ListMyCrews(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) SetMyCrewMembership(
	ctx context.Context,
	req *connect.Request[servicerpcv1.SetMyCrewMembershipRequest],
) (*connect.Response[servicerpcv1.SetMyCrewMembershipResponse], error) {
	resp, err := s.Crew.SetMyCrewMembership(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// The three notification RPCs below are thin methods over notification.Service (connect.go, plan
// 09h/1c), retiring REST GET /notifications and POST /notifications/read[/{id}].

func (s ImsService) ListNotifications(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ListNotificationsRequest],
) (*connect.Response[servicerpcv1.ListNotificationsResponse], error) {
	resp, err := s.Notification.ListNotifications(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) MarkAllNotificationsRead(
	ctx context.Context,
	req *connect.Request[servicerpcv1.MarkAllNotificationsReadRequest],
) (*connect.Response[servicerpcv1.MarkAllNotificationsReadResponse], error) {
	resp, err := s.Notification.MarkAllNotificationsRead(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) MarkNotificationRead(
	ctx context.Context,
	req *connect.Request[servicerpcv1.MarkNotificationReadRequest],
) (*connect.Response[servicerpcv1.MarkNotificationReadResponse], error) {
	resp, err := s.Notification.MarkNotificationRead(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// The two web-push RPCs below are thin methods over push.Service (connect.go, plan 09h/1c), retiring
// REST POST/DELETE /push/subscribe. SubscribePush lifts the best-effort device label (User-Agent) off
// the request here at the HTTP boundary and hands it to the domain method as a plain string, mirroring
// how Login derives the client IP in its delegate.

func (s ImsService) SubscribePush(
	ctx context.Context,
	req *connect.Request[servicerpcv1.SubscribePushRequest],
) (*connect.Response[servicerpcv1.SubscribePushResponse], error) {
	resp, err := s.Push.SubscribePush(ctx, req.Msg, req.Header().Get("User-Agent"))
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (s ImsService) UnsubscribePush(
	ctx context.Context,
	req *connect.Request[servicerpcv1.UnsubscribePushRequest],
) (*connect.Response[servicerpcv1.UnsubscribePushResponse], error) {
	resp, err := s.Push.UnsubscribePush(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// GetMetrics is a thin method over metrics.Service (connect.go, plan 09h/1c), retiring REST GET
// /events/{eventName}/metrics. The domain method authorizes from ctx claims (admin or event writer),
// serves from the shared per-event MetricsCache, and speaks Connect errors, so this just delegates.
func (s ImsService) GetMetrics(
	ctx context.Context,
	req *connect.Request[servicerpcv1.GetMetricsRequest],
) (*connect.Response[servicerpcv1.GetMetricsResponse], error) {
	resp, err := s.Metrics.GetMetrics(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// ListActionLogs is a thin method over actionlog.Service (connect.go, plan 09h/1c), retiring REST GET
// /actionlogs. The domain method authorizes from ctx claims (GlobalAdministrateDebugging, admin-only)
// and speaks Connect errors, so this just delegates. This is the last RPC slice — every ImsService
// method is now implemented.
func (s ImsService) ListActionLogs(
	ctx context.Context,
	req *connect.Request[servicerpcv1.ListActionLogsRequest],
) (*connect.Response[servicerpcv1.ListActionLogsResponse], error) {
	resp, err := s.ActionLog.ListActionLogs(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// AddConnectToMux registers the ImsService Connect handler on the shared mux
// next to AddToMux (plan 09g). connect handlers are plain http.Handlers mounted
// at a path prefix, so the RPC surface coexists with the REST/web routes on one
// http.ServeMux with no second server (proven in the 1a Step-0 spike). The whole
// cross-cutting chain (server.Interceptors) is attached once here and applies to
// every RPC — request id, auth, slog, action log, protovalidate — so unlike the
// per-route REST middleware there is no flag to omit (M9).
//
//nolint:funlen // declarative handler-registration wiring, not business logic
func AddConnectToMux(
	mux *http.ServeMux,
	cfg *conf.IMSConfig,
	imsDBQ *store.DBQ,
	actionLogger server.ActionLogger,
	userStore directory.UserStore,
	es *server.EventSourcerer,
	metricsCache *server.MetricsCache,
	pushSender pushlib.Sender,
	s3Client *attachment.S3Client,
) *http.ServeMux {
	if mux == nil {
		mux = http.NewServeMux()
	}
	jwter := authz.JWTer{SecretKey: cfg.Core.JWTSecret}
	interceptors := server.Interceptors(jwter, actionLogger, userStore, server.NewValidateInterceptor())
	attachmentsEnabled := cfg.AttachmentsStore.Type != conf.AttachmentsStoreNone
	// Pusher is stateless (store + send backend), so a Connect-side instance built from
	// the same sender fans out identically to the REST one; a nil sender is the no-op
	// backend (push unconfigured), matching AddToMux.
	if pushSender == nil {
		pushSender = pushlib.NoopSender{}
	}
	pusher := server.NewPusher(imsDBQ, pushSender)
	// The login throttle/lockout (plan 90) now lives entirely on the Connect surface: the REST
	// POST /auth (and its ThrottleLogin middleware) were retired when Login moved here, so this
	// is the sole instance. Disabled by config in the shared test suite; on in real deployments.
	loginLimiter := server.NewLoginRateLimiter(server.DefaultLoginRateLimiterConfig(cfg.Core.LoginRateLimitEnabled))
	// The incident-type and outcome taxonomy caches lived in AddToMux while their routes were REST;
	// they moved here with the taxonomy extraction (plan 09h/1c) since every consumer is now a
	// Connect RPC. Each is invalidated by its own writes (the type cache is shared with metricsCache,
	// which the incident writes also use; outcomes carry no group so they feed no metrics).
	incidentTypesCache := server.NewIncidentTypesCache()
	outcomesCache := server.NewOutcomesCache()
	// The per-event area cache likewise moved here from AddToMux with the area extraction (plan
	// 09h/1c): its only consumers are now the area RPCs (an area write invalidates it and the shared
	// metricsCache the dashboard reads).
	areasCache := server.NewAreasCache()
	// The per-event crew cache moved here with the crew extraction (plan 09h/1c): its only consumers
	// are the crew RPCs now (a crew write, admin or crew-leader self-service, invalidates it).
	crewsCache := server.NewCrewsCache()
	path, handler := servicev1connect.NewImsServiceHandler(
		ImsService{
			Event: event.Service{ImsDBQ: imsDBQ, UserStore: userStore},
			Incident: incident.Service{
				ImsDBQ:             imsDBQ,
				UserStore:          userStore,
				Es:                 es,
				Pusher:             pusher,
				Metrics:            metricsCache,
				AttachmentsEnabled: attachmentsEnabled,
			},
			Person: person.Service{
				ImsDBQ:           imsDBQ,
				UserStore:        userStore,
				DefaultPassword:  cfg.Core.DefaultPassword,
				AttachmentsStore: cfg.AttachmentsStore,
				S3Client:         s3Client,
			},
			Auth: auth.Service{
				ImsDBQ:               imsDBQ,
				UserStore:            userStore,
				AttachmentsEnabled:   attachmentsEnabled,
				PushVAPIDPublicKey:   cfg.Push.VAPIDPublicKey,
				DefaultPassword:      cfg.Core.DefaultPassword,
				JwtSecret:            cfg.Core.JWTSecret,
				AccessTokenDuration:  cfg.Core.AccessTokenLifetime,
				RefreshTokenDuration: cfg.Core.RefreshTokenLifetime,
				LoginLimiter:         loginLimiter,
			},
			IncidentType: incidenttype.Service{
				ImsDBQ:    imsDBQ,
				UserStore: userStore,
				Metrics:   metricsCache,
				Types:     incidentTypesCache,
			},
			Outcome: outcome.Service{
				ImsDBQ:    imsDBQ,
				UserStore: userStore,
				Outcomes:  outcomesCache,
			},
			Area: area.Service{
				ImsDBQ:    imsDBQ,
				UserStore: userStore,
				Metrics:   metricsCache,
				Areas:     areasCache,
			},
			Crew: crew.Service{
				ImsDBQ:    imsDBQ,
				UserStore: userStore,
				Crews:     crewsCache,
			},
			Notification: notification.Service{ImsDBQ: imsDBQ, UserStore: userStore},
			Push:         push.Service{ImsDBQ: imsDBQ},
			// The dashboard read shares the same per-event MetricsCache the incident/area/type writes
			// invalidate — the REST GET .../metrics route was retired with this extraction, so the RPC
			// is now the sole reader of that cache.
			Metrics:   metrics.Service{ImsDBQ: imsDBQ, UserStore: userStore, Cache: metricsCache},
			ActionLog: actionlog.Service{ImsDBQ: imsDBQ, UserStore: userStore},
		},
		connect.WithInterceptors(interceptors...),
	)
	mux.Handle(path, handler)
	return mux
}
