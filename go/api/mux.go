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
	"github.com/mikeki/ocf-ims/internal/auth"
	"github.com/mikeki/ocf-ims/internal/crew"
	"github.com/mikeki/ocf-ims/internal/debug"
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
	"github.com/mikeki/ocf-ims/lib/herr"
	pushlib "github.com/mikeki/ocf-ims/lib/push"
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
	pushSender pushlib.Sender,
) *http.ServeMux {
	if mux == nil {
		mux = http.NewServeMux()
	}

	jwter := authz.JWTer{SecretKey: cfg.Core.JWTSecret}
	attachmentsEnabled := cfg.AttachmentsStore.Type != conf.AttachmentsStoreNone

	// Web-push fan-out (plan 84c). The caller selects the backend: a real
	// VAPID-signing sender when push is configured, else a no-op so every fan-out
	// short-circuits. A nil sender is treated as the no-op backend.
	if pushSender == nil {
		pushSender = pushlib.NoopSender{}
	}
	pusher := server.NewPusher(db, pushSender)

	// metricsCache is created by the caller and shared with the Connect surface
	// (AddConnectToMux): the dashboard read handler (metrics.GetMetrics) lives here on
	// REST while the incident-mutation RPCs that must invalidate it on a write live on
	// Connect, so both must hold the *same* cache or the dashboard would go stale until
	// the TTL. (Passed in like es for the same reason — one shared instance.)

	// Reference-data caches: the incident-type taxonomy (global) and each event's
	// area list are read on nearly every incident form load but change rarely, so
	// they are memoized here and invalidated by their write handlers.
	incidentTypesCache := server.NewIncidentTypesCache()
	areasCache := server.NewAreasCache()
	crewsCache := server.NewCrewsCache()
	outcomesCache := server.NewOutcomesCache()

	// Failed-login throttle/lockout for POST /ims/api/auth (plan 90, findings H1 +
	// M4). Enabled in real deployments; the shared test suite disables it via config.
	loginLimiter := server.NewLoginRateLimiter(server.DefaultLoginRateLimiterConfig(cfg.Core.LoginRateLimitEnabled))

	mux.Handle("GET /ims/api/actionlogs",
		server.Adapt(
			actionlog.GetActionLogs{ImsDBQ: db, UserStore: userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/auth",
		server.Adapt(
			auth.PostAuth{ImsDBQ: db, UserStore: userStore, JwtSecret: cfg.Core.JWTSecret, AccessTokenDuration: cfg.Core.AccessTokenLifetime, RefreshTokenDuration: cfg.Core.RefreshTokenLifetime},
			server.RecoverFromPanic(),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
			// server.ThrottleLogin sits inside server.LimitRequestBytes so the body it peeks at
			// for per-account keying is already size-capped. It sheds excess/failed
			// attempts with 429 before the argon2 verify runs.
			server.ThrottleLogin(loginLimiter),
			// This endpoint does not require authentication, nor
			// does it even consider the request's Authorization header,
			// because the point of this is to make a new JWT.
		),
	)

	mux.Handle("GET /ims/api/auth",
		server.Adapt(
			auth.GetAuth{ImsDBQ: db, UserStore: userStore, JwtSecret: cfg.Core.JWTSecret, AttachmentsEnabled: attachmentsEnabled, PushVAPIDPublicKey: cfg.Push.VAPIDPublicKey, DefaultPassword: cfg.Core.DefaultPassword},
			server.RecoverFromPanic(),
			// This endpoint does not require authentication or authorization, by design
			server.OptionalAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/auth/refresh",
		server.Adapt(
			auth.RefreshAccessToken{ImsDBQ: db, UserStore: userStore, JwtSecret: cfg.Core.JWTSecret, AccessTokenDuration: cfg.Core.AccessTokenLifetime},
			server.RecoverFromPanic(),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
			// This endpoint does not require authentication, nor
			// does it even consider the request's Authorization header,
			// because the point of this is to make a new access token.
		),
	)

	// Self-service password change: the caller sets their OWN password (resolved
	// from the JWT), no admin permission required. Backs the "you're on the shared
	// default password" post-login prompt. Mutating → logged.
	mux.Handle("POST /ims/api/auth/password",
		server.Adapt(
			person.SetOwnPassword{ImsDBQ: db, UserStore: userStore, DefaultPassword: cfg.Core.DefaultPassword},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// Self-service profile edit: the caller changes their OWN identity/contact fields
	// (resolved from the JWT), no admin permission required. Participation and the
	// admin flag are not editable here — those stay admin-only. Mutating → logged.
	mux.Handle("POST /ims/api/auth/profile",
		server.Adapt(
			person.SetOwnProfile{ImsDBQ: db, UserStore: userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// Self-service profile picture: the caller uploads/removes their OWN picture. Same
	// admin-free, JWT-resolved model as /auth/profile. Serving stays on the shared
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

	mux.Handle("DELETE /ims/api/auth/picture",
		server.Adapt(
			person.DeleteOwnProfilePicture{ImsDBQ: db, AttachmentsStore: cfg.AttachmentsStore, S3Client: s3Client},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// GET /events/{eventName}/incidents (list) was RETIRED when ListIncidents moved
	// onto Connect (plan 09h/1c, aggressive migration path — plan 09 §6). Listing an
	// event's incidents is now the ImsService.ListIncidents RPC (registered via
	// AddConnectToMux); there is deliberately no REST shim.

	mux.Handle("POST /ims/api/events/{eventName}/incidents",
		server.Adapt(
			incident.NewIncident{ImsDBQ: db, UserStore: userStore, Es: es, Pusher: pusher, Metrics: metricsCache},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

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

	mux.Handle("POST /ims/api/events/{eventName}/incidents/{incidentNumber}/people/{personId}",
		server.Adapt(
			incident.AttachPersonToIncident{ImsDBQ: db, UserStore: userStore, Es: es, Pusher: pusher},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("DELETE /ims/api/events/{eventName}/incidents/{incidentNumber}/people/{personId}",
		server.Adapt(
			incident.DetachPersonFromIncident{ImsDBQ: db, UserStore: userStore, Es: es},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/incidents/{incidentNumber}/journal_entries/{journalEntryId}",
		server.Adapt(
			incident.EditIncidentJournalEntry{ImsDBQ: db, UserStore: userStore, EventSource: es},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/reports",
		server.Adapt(
			incident.GetReports{ImsDBQ: db, UserStore: userStore, AttachmentsEnabled: attachmentsEnabled},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/reports",
		server.Adapt(
			incident.NewReport{ImsDBQ: db, UserStore: userStore, EventSource: es, Pusher: pusher},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/reports/{reportNumber}",
		server.Adapt(
			incident.GetReport{ImsDBQ: db, UserStore: userStore, AttachmentsEnabled: attachmentsEnabled},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/reports/{reportNumber}",
		server.Adapt(
			incident.EditReport{ImsDBQ: db, UserStore: userStore, EventSource: es, Pusher: pusher},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

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

	mux.Handle("POST /ims/api/events/{eventName}/reports/{reportNumber}/journal_entries/{journalEntryId}",
		server.Adapt(
			incident.EditReportJournalEntry{ImsDBQ: db, UserStore: userStore, EventSource: es},
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

	// GET /ims/api/events was retired: listing events is now the ListEvents RPC
	// (plan 09h/1c). Per the migration decision (plan 09 §Migration strategy), a
	// resource's REST reads are DELETED as they are extracted rather than kept as
	// shims — there is no live product to protect in the off-season, and the templ
	// UI is being replaced by the Expo client, not ported. POST /events (event
	// create/update) is still REST until its own extraction lands.
	mux.Handle("POST /ims/api/events",
		server.Adapt(
			event.EditEvent{ImsDBQ: db, UserStore: userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/incident_types",
		server.Adapt(
			incidenttype.GetIncidentTypes{ImsDBQ: db, UserStore: userStore, Cache: incidentTypesCache, CacheControlShort: cfg.Core.CacheControlShort},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/incident_types",
		server.Adapt(
			incidenttype.EditIncidentTypes{ImsDBQ: db, UserStore: userStore, Metrics: metricsCache, Types: incidentTypesCache},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// An event writer proposes a new incident type from the incident form; the
	// route is event-scoped only to authorize the caller as a writer (the type is
	// global). Approval happens back on the global admin endpoint above.
	mux.Handle("POST /ims/api/events/{eventName}/incident_types",
		server.Adapt(
			incidenttype.ProposeIncidentType{ImsDBQ: db, UserStore: userStore, Metrics: metricsCache, Types: incidentTypesCache},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/outcomes",
		server.Adapt(
			outcome.GetOutcomes{ImsDBQ: db, UserStore: userStore, Cache: outcomesCache, CacheControlShort: cfg.Core.CacheControlShort},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/outcomes",
		server.Adapt(
			outcome.EditOutcomes{ImsDBQ: db, UserStore: userStore, Outcomes: outcomesCache},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// An event writer proposes a new outcome from the incident form; the route is
	// event-scoped only to authorize the caller as a writer (the outcome is global).
	// Approval happens back on the global admin endpoint above.
	mux.Handle("POST /ims/api/events/{eventName}/outcomes",
		server.Adapt(
			outcome.ProposeOutcome{ImsDBQ: db, UserStore: userStore, Outcomes: outcomesCache},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/personnel",
		server.Adapt(
			person.GetPersonnel{ImsDBQ: db, UserStore: userStore, CacheControlShort: cfg.Core.CacheControlShort},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/personnel",
		server.Adapt(
			person.CreatePerson{ImsDBQ: db, UserStore: userStore, DefaultPassword: cfg.Core.DefaultPassword},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/personnel/{personId}",
		server.Adapt(
			person.EditPerson{ImsDBQ: db, UserStore: userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/personnel/{personId}/password",
		server.Adapt(
			person.SetPersonPassword{ImsDBQ: db, UserStore: userStore, DefaultPassword: cfg.Core.DefaultPassword},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/personnel/{personId}/admin",
		server.Adapt(
			person.SetPersonAdmin{ImsDBQ: db, UserStore: userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/personnel/{personId}/participation",
		server.Adapt(
			person.SetPersonParticipation{ImsDBQ: db, UserStore: userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("DELETE /ims/api/personnel/{personId}/participation",
		server.Adapt(
			person.RemovePersonEvent{ImsDBQ: db, UserStore: userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			// Logged: this is the audit trail for who removed/ejected whom from an
			// event (the eject case keeps the row via the POST above, also logged).
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// Profile picture: upload/remove are admin-only (mirror person.EditPerson), serving is
	// open to any personnel reader (mirror the profile card). Upload/remove mutate →
	// logged; the GET is a read → unlogged.
	mux.Handle("POST /ims/api/personnel/{personId}/picture",
		server.Adapt(
			person.SetPersonProfilePicture{ImsDBQ: db, UserStore: userStore, AttachmentsStore: cfg.AttachmentsStore, S3Client: s3Client},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("DELETE /ims/api/personnel/{personId}/picture",
		server.Adapt(
			person.DeletePersonProfilePicture{ImsDBQ: db, UserStore: userStore, AttachmentsStore: cfg.AttachmentsStore, S3Client: s3Client},
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
