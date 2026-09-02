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
	"time"

	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/internal/actionlog"
	"github.com/mikeki/ocf-ims/internal/area"
	"github.com/mikeki/ocf-ims/internal/crew"
	"github.com/mikeki/ocf-ims/internal/debug"
	"github.com/mikeki/ocf-ims/internal/incident"
	"github.com/mikeki/ocf-ims/internal/metrics"
	"github.com/mikeki/ocf-ims/internal/notification"
	"github.com/mikeki/ocf-ims/internal/person"
	"github.com/mikeki/ocf-ims/internal/push"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/attachment"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	actionlogstore "github.com/mikeki/ocf-ims/store/actionlog"
)

func AddToMux(
	mux *http.ServeMux,
	es *server.EventSourcerer,
	metricsCache *server.MetricsCache,
	cfg *conf.IMSConfig,
	db *store.DBQ,
	userStore directory.UserStore,
	s3Client *attachment.S3Client,
	actionLogger *actionlogstore.Logger,
) *http.ServeMux {
	if mux == nil {
		mux = http.NewServeMux()
	}

	jwter := authz.JWTer{SecretKey: cfg.Core.JWTSecret}
	attachmentsEnabled := cfg.AttachmentsStore.Type != conf.AttachmentsStoreNone

	// Web-push fan-out (plan 84c) is no longer wired here: the REST surface's last
	// push-firing route (AttachPersonToIncident) moved onto Connect in slice 1c, so the
	// Pusher now lives only on the Connect surface (AddConnectToMux builds it from the
	// pushSender). The push *subscription* REST endpoints below only persist rows and
	// need no Sender.

	// metricsCache is created by the caller and shared with the Connect surface
	// (AddConnectToMux): the dashboard read handler (metrics.GetMetrics) lives here on
	// REST while the incident-mutation RPCs that must invalidate it on a write live on
	// Connect, so both must hold the *same* cache or the dashboard would go stale until
	// the TTL. (Passed in like es for the same reason — one shared instance.)

	// Reference-data caches: each event's area list is read on nearly every incident
	// form load but changes rarely, so it is memoized here and invalidated by its write
	// handlers. (The incident-type and outcome taxonomy caches moved to the Connect side
	// when those taxonomy routes were extracted, plan 09h/1c.)
	areasCache := server.NewAreasCache()
	crewsCache := server.NewCrewsCache()

	mux.Handle("GET /ims/api/actionlogs",
		server.Adapt(
			actionlog.GetActionLogs{ImsDBQ: db, UserStore: userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// The whole auth & session surface — login (POST /auth), refresh (POST /auth/refresh), and
	// the whoami / session status (GET /auth) — moved onto Connect (ImsService.Login /
	// RefreshToken / GetAuthStatus, registered via AddConnectToMux). Their REST routes were
	// retired, not shimmed (aggressive migration, plan 09 §6). The plan-90 login throttle went
	// with Login: the ThrottleLogin middleware and its limiter now live on the Connect surface.
	//
	// The self-service password change (POST /auth/password), identity/contact edit (POST
	// /auth/profile), and picture removal (DELETE /auth/picture) likewise moved onto Connect
	// (ImsService.ChangeOwnPassword / UpdateOwnProfile / DeleteOwnProfilePicture). Only the
	// picture *upload* below (multipart/binary, outside the proto contract) stays REST.

	// Self-service profile picture UPLOAD: the caller uploads/replaces their OWN picture. Same
	// admin-free, JWT-resolved model as the retired /auth/profile. Serving stays on the shared
	// GET /ims/api/personnel/{personId}/picture (any personnel reader). Mutating → logged.
	mux.Handle("POST /ims/api/auth/picture",
		server.Adapt(
			person.SetOwnProfilePicture{ImsDBQ: db, AttachmentsStore: cfg.AttachmentsStore, S3Client: s3Client},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// GET and POST /events/{eventName}/incidents (list + create) were RETIRED when
	// ListIncidents and CreateIncident moved onto Connect (plan 09h/1c, aggressive
	// migration path — plan 09 §6). Listing and creating an event's incidents are now the
	// ImsService.ListIncidents / ImsService.CreateIncident RPCs (registered via
	// AddConnectToMux); there is deliberately no REST shim.

	// GET and POST .../incidents/{incidentNumber} were RETIRED when the single-incident
	// read (GetIncident) and edit (UpdateIncident) moved onto Connect (plan 09h/1c,
	// aggressive migration path — plan 09 §6). Reading and editing one incident are now
	// the ImsService.GetIncident / ImsService.UpdateIncident RPCs (registered via
	// AddConnectToMux); there is deliberately no REST shim.

	mux.Handle("GET /ims/api/events/{eventName}/incidents/{incidentNumber}/attachments/{attachmentNumber}",
		server.Adapt(
			incident.GetIncidentAttachment{ImsDBQ: db, UserStore: userStore, AttachmentsStore: cfg.AttachmentsStore, S3Client: s3Client},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/incidents/{incidentNumber}/attachments",
		server.Adapt(
			incident.AttachToIncident{ImsDBQ: db, UserStore: userStore, Es: es, AttachmentsStore: cfg.AttachmentsStore, S3Client: s3Client, MaxAttachmentBytes: cfg.Core.MaxAttachmentBytes},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// The incident people sub-resource (POST/DELETE .../incidents/{n}/people/{personId}) and the
	// incident journal-entry strike (POST .../incidents/{n}/journal_entries/{id}) moved onto Connect
	// (ImsService.AttachPersonToIncident / DetachPersonFromIncident / UpdateIncidentJournalEntry,
	// registered via AddConnectToMux); their REST routes were retired, not shimmed (aggressive
	// migration, plan 09 §6). Only the incident-attachment upload/download (binary/multipart,
	// outside the proto contract) stays REST above.

	// GET .../reports (list) and GET .../reports/{n} (single) were RETIRED when
	// ListReports and GetReport moved onto Connect (plan 09h/1c, aggressive migration
	// path — plan 09 §6). Reading field reports is now the ImsService.ListReports /
	// The field-report reads (Get/List) AND writes (Create/Update/UpdateReportJournalEntry) are
	// all Connect RPCs now (registered via AddConnectToMux); their REST routes were retired, not
	// shimmed (aggressive migration, plan 09 §6). Only the report-attachment upload/download
	// (binary/multipart, outside the proto contract) stays REST below.

	mux.Handle("GET /ims/api/events/{eventName}/reports/{reportNumber}/attachments/{attachmentNumber}",
		server.Adapt(
			incident.GetReportAttachment{ImsDBQ: db, UserStore: userStore, AttachmentsStore: cfg.AttachmentsStore, S3Client: s3Client},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/reports/{reportNumber}/attachments",
		server.Adapt(
			incident.AttachToReport{ImsDBQ: db, UserStore: userStore, Es: es, AttachmentsStore: cfg.AttachmentsStore, S3Client: s3Client, MaxAttachmentBytes: cfg.Core.MaxAttachmentBytes},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/visits",
		server.Adapt(
			incident.GetVisits{ImsDBQ: db, UserStore: userStore, AttachmentsEnabled: attachmentsEnabled},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/visits/{visitNumber}",
		server.Adapt(
			incident.GetVisit{ImsDBQ: db, UserStore: userStore, AttachmentsEnabled: attachmentsEnabled},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/visits",
		server.Adapt(
			incident.NewVisit{ImsDBQ: db, UserStore: userStore, Es: es},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/visits/{visitNumber}",
		server.Adapt(
			incident.EditVisit{ImsDBQ: db, UserStore: userStore, Es: es},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/visits/{visitNumber}/people/{personId}",
		server.Adapt(
			incident.AttachPersonToVisit{ImsDBQ: db, UserStore: userStore, Es: es},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("DELETE /ims/api/events/{eventName}/visits/{visitNumber}/people/{personId}",
		server.Adapt(
			incident.DetachPersonFromVisit{ImsDBQ: db, UserStore: userStore, Es: es},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/visits/{visitNumber}/attachments/{attachmentNumber}",
		server.Adapt(
			incident.GetVisitAttachment{ImsDBQ: db, UserStore: userStore, AttachmentsStore: cfg.AttachmentsStore, S3Client: s3Client},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/visits/{visitNumber}/attachments",
		server.Adapt(
			incident.AttachToVisit{ImsDBQ: db, UserStore: userStore, Es: es, AttachmentsStore: cfg.AttachmentsStore, S3Client: s3Client, MaxAttachmentBytes: cfg.Core.MaxAttachmentBytes},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/visits/{visitNumber}/journal_entries/{journalEntryId}",
		server.Adapt(
			incident.EditVisitJournalEntry{ImsDBQ: db, UserStore: userStore, EventSource: es},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/areas",
		server.Adapt(
			area.GetAreas{ImsDBQ: db, UserStore: userStore, Cache: areasCache, CacheControlShort: cfg.Core.CacheControlShort},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/areas",
		server.Adapt(
			area.EditAreas{ImsDBQ: db, UserStore: userStore, Metrics: metricsCache, Areas: areasCache},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/crews",
		server.Adapt(
			crew.GetCrews{ImsDBQ: db, UserStore: userStore, Cache: crewsCache, CacheControlShort: cfg.Core.CacheControlShort},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/crews",
		server.Adapt(
			crew.EditCrews{ImsDBQ: db, UserStore: userStore, Crews: crewsCache},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// The crew-leader "My Crew" self-service pair (slice 10c): read the crews you
	// lead, and add/remove their members. Not admin-gated — authorization is that the
	// caller leads the crew (checked in the handler), so any authenticated user may
	// reach these and only ever act on crews they lead.
	mux.Handle("GET /ims/api/events/{eventName}/crews/mine",
		server.Adapt(
			crew.MyCrews{ImsDBQ: db, UserStore: userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/crews/mine",
		server.Adapt(
			crew.EditMyCrew{ImsDBQ: db, UserStore: userStore, Crews: crewsCache},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/metrics",
		server.Adapt(
			metrics.GetMetrics{ImsDBQ: db, UserStore: userStore, Cache: metricsCache},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// The event read + create/update moved to the ImsService RPCs (plan 09h/1c) and their REST
	// routes were retired: GET /events → ListEvents, and the POST /events multiplexer (EditEvent)
	// decomposed into CreateEvent / UpdateEvent. Per the migration decision (plan 09 §Migration
	// strategy) a resource's REST surface is DELETED as it is extracted rather than kept as a shim —
	// there is no live product to protect in the off-season, and the templ UI is being replaced by
	// the Expo client, not ported.

	// The incident-type read + all writes (the POST multiplexer, decomposed into
	// Create/Update/Approve/SetHidden, and the event-scoped writer Propose) moved to the
	// ImsService RPCs (plan 09h/1c) and their REST routes were retired; the shared
	// incidentTypesCache moved to the Connect side (built in AddConnectToMux).

	// The outcome read + all writes (the POST multiplexer, decomposed into
	// Create/Update/Approve/SetHidden, and the event-scoped writer Propose) moved to the
	// ImsService RPCs (plan 09h/1c) and their REST routes were retired; the shared
	// outcomesCache moved to the Connect side (built in AddConnectToMux).

	// The personnel READ (GET /personnel) and all seven personnel WRITES (create, edit,
	// password reset, admin toggle, set/remove participation, delete picture) moved to the
	// ImsService RPCs (plan 09h/1c) and their REST routes were retired. Only the multipart
	// profile-picture upload + serve stay REST (binary, M8).
	mux.Handle("POST /ims/api/personnel/{personId}/picture",
		server.Adapt(
			person.SetPersonProfilePicture{ImsDBQ: db, UserStore: userStore, AttachmentsStore: cfg.AttachmentsStore, S3Client: s3Client},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/personnel/{personId}/picture",
		server.Adapt(
			person.GetPersonProfilePicture{ImsDBQ: db, UserStore: userStore, AttachmentsStore: cfg.AttachmentsStore, S3Client: s3Client},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// Notifications (plan 82): per-person (the caller's own), so only
	// authentication is required — no event scoping.
	mux.Handle("GET /ims/api/notifications",
		server.Adapt(
			notification.GetNotifications{ImsDBQ: db, UserStore: userStore, CacheControlShort: cfg.Core.CacheControlShort},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/notifications/read",
		server.Adapt(
			notification.MarkNotificationsRead{ImsDBQ: db, UserStore: userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/notifications/{notificationId}/read",
		server.Adapt(
			notification.MarkNotificationsRead{ImsDBQ: db, UserStore: userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// Web push subscriptions (plan 84): per-person, per-device, so only
	// authentication is required — no event scoping. Mutating, so server.LogRequest(true).
	mux.Handle("POST /ims/api/push/subscribe",
		server.Adapt(
			push.PostPushSubscribe{ImsDBQ: db},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("DELETE /ims/api/push/subscribe",
		server.Adapt(
			push.DeletePushSubscribe{ImsDBQ: db},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/eventsource",
		server.Adapt(
			es.Server.Handler(server.EventSourceChannel),
			server.RecoverFromPanic(),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/debug/buildinfo",
		server.Adapt(
			debug.GetBuildInfo{ImsDBQ: db, UserStore: userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/debug/runtimemetrics",
		server.Adapt(
			debug.GetRuntimeMetrics{ImsDBQ: db, UserStore: userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/debug/gc",
		server.Adapt(
			debug.PerformGC{ImsDBQ: db, UserStore: userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// Readiness probe: unlike /ping (liveness — "is the process serving HTTP?",
	// used to decide a restart), /readyz reports whether the app can actually
	// reach its dependencies, so a monitor can tell "DB down" from "process
	// dead". It lives here rather than in server.AddBasicHandlers because that's where
	// the *store.DBQ handle is. Deliberately unauthenticated (like /ping, it only
	// leaks up/down) and unlogged (high-frequency; it would spam the action log).
	// The short timeout makes a hung/locked DB fail the probe fast instead of
	// hanging it, and the body avoids echoing the DB error.
	mux.HandleFunc("GET /ims/api/readyz",
		func(w http.ResponseWriter, req *http.Request) {
			ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
			defer cancel()
			err := db.PingContext(ctx)
			if err != nil {
				http.Error(w, "not ready", http.StatusServiceUnavailable)
				return
			}
			herr.WriteOKResponse(w, "ready")
		},
	)

	// Uncomment these to add pprof into the program. Note that we'd probably want
	// these endpoints to be restricted to admins only, were this going to run in
	// production.
	// https://pkg.go.dev/runtime/pprof
	// https://github.com/google/pprof/blob/main/doc/README.md
	// mux.HandleFunc("GET /debug/pprof/", pprof.Index)
	// mux.HandleFunc("GET /debug/pprof/cmdline", pprof.Cmdline)
	// mux.HandleFunc("GET /debug/pprof/profile", pprof.Profile)
	// mux.HandleFunc("GET /debug/pprof/symbol", pprof.Symbol)
	// mux.HandleFunc("GET /debug/pprof/trace", pprof.Trace)

	return server.AddBasicHandlers(mux)
}
