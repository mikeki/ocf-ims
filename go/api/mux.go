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
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/attachment"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/lib/push"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/actionlog"
)

func AddToMux(
	mux *http.ServeMux,
	es *server.EventSourcerer,
	cfg *conf.IMSConfig,
	db *store.DBQ,
	userStore directory.UserStore,
	s3Client *attachment.S3Client,
	actionLogger *actionlog.Logger,
	pushSender push.Sender,
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
		pushSender = push.NoopSender{}
	}
	pusher := server.NewPusher(db, pushSender)

	// One dashboard-metrics cache shared by the read handler (GetMetrics) and the
	// mutation handlers that must invalidate it on a write, so the dashboard
	// reflects changes immediately rather than waiting out the TTL.
	metricsCache := server.NewMetricsCache()

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
			GetActionLogs{db, userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/auth",
		server.Adapt(
			PostAuth{
				db,
				userStore,
				cfg.Core.JWTSecret,
				cfg.Core.AccessTokenLifetime,
				cfg.Core.RefreshTokenLifetime,
			},
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
			GetAuth{
				db,
				userStore,
				cfg.Core.JWTSecret,
				attachmentsEnabled,
				cfg.Push.VAPIDPublicKey,
				cfg.Core.DefaultPassword,
			},
			server.RecoverFromPanic(),
			// This endpoint does not require authentication or authorization, by design
			server.OptionalAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/auth/refresh",
		server.Adapt(
			RefreshAccessToken{
				db,
				userStore,
				cfg.Core.JWTSecret,
				cfg.Core.AccessTokenLifetime,
			},
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
			SetOwnPassword{db, userStore, cfg.Core.DefaultPassword},
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
			SetOwnProfile{db, userStore},
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
			SetOwnProfilePicture{db, cfg.AttachmentsStore, s3Client},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("DELETE /ims/api/auth/picture",
		server.Adapt(
			DeleteOwnProfilePicture{db, cfg.AttachmentsStore, s3Client},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/incidents",
		server.Adapt(
			GetIncidents{db, userStore, attachmentsEnabled},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/incidents",
		server.Adapt(
			NewIncident{db, userStore, es, pusher, metricsCache},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/incidents/{incidentNumber}",
		server.Adapt(
			GetIncident{db, userStore, attachmentsEnabled},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/incidents/{incidentNumber}",
		server.Adapt(
			EditIncident{db, userStore, es, pusher, metricsCache},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/incidents/{incidentNumber}/attachments/{attachmentNumber}",
		server.Adapt(
			GetIncidentAttachment{db, userStore, cfg.AttachmentsStore, s3Client},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/incidents/{incidentNumber}/attachments",
		server.Adapt(
			AttachToIncident{db, userStore, es, cfg.AttachmentsStore, s3Client, cfg.Core.MaxAttachmentBytes},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/incidents/{incidentNumber}/people/{personId}",
		server.Adapt(
			AttachPersonToIncident{db, userStore, es, pusher},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("DELETE /ims/api/events/{eventName}/incidents/{incidentNumber}/people/{personId}",
		server.Adapt(
			DetachPersonFromIncident{db, userStore, es},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/incidents/{incidentNumber}/journal_entries/{journalEntryId}",
		server.Adapt(
			EditIncidentJournalEntry{db, userStore, es},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/reports",
		server.Adapt(
			GetReports{db, userStore, attachmentsEnabled},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/reports",
		server.Adapt(
			NewReport{db, userStore, es, pusher},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/reports/{reportNumber}",
		server.Adapt(
			GetReport{db, userStore, attachmentsEnabled},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/reports/{reportNumber}",
		server.Adapt(
			EditReport{db, userStore, es, pusher},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/reports/{reportNumber}/attachments/{attachmentNumber}",
		server.Adapt(
			GetReportAttachment{db, userStore, cfg.AttachmentsStore, s3Client},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/reports/{reportNumber}/attachments",
		server.Adapt(
			AttachToReport{db, userStore, es, cfg.AttachmentsStore, s3Client, cfg.Core.MaxAttachmentBytes},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/reports/{reportNumber}/journal_entries/{journalEntryId}",
		server.Adapt(
			EditReportJournalEntry{db, userStore, es},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/visits",
		server.Adapt(
			GetVisits{db, userStore, attachmentsEnabled},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/visits/{visitNumber}",
		server.Adapt(
			GetVisit{db, userStore, attachmentsEnabled},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/visits",
		server.Adapt(
			NewVisit{db, userStore, es},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/visits/{visitNumber}",
		server.Adapt(
			EditVisit{db, userStore, es},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/visits/{visitNumber}/people/{personId}",
		server.Adapt(
			AttachPersonToVisit{db, userStore, es},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("DELETE /ims/api/events/{eventName}/visits/{visitNumber}/people/{personId}",
		server.Adapt(
			DetachPersonFromVisit{db, userStore, es},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/visits/{visitNumber}/attachments/{attachmentNumber}",
		server.Adapt(
			GetVisitAttachment{db, userStore, cfg.AttachmentsStore, s3Client},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/visits/{visitNumber}/attachments",
		server.Adapt(
			AttachToVisit{db, userStore, es, cfg.AttachmentsStore, s3Client, cfg.Core.MaxAttachmentBytes},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/visits/{visitNumber}/journal_entries/{journalEntryId}",
		server.Adapt(
			EditVisitJournalEntry{db, userStore, es},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/areas",
		server.Adapt(
			GetAreas{db, userStore, areasCache, cfg.Core.CacheControlShort},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/areas",
		server.Adapt(
			EditAreas{db, userStore, metricsCache, areasCache},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/crews",
		server.Adapt(
			GetCrews{db, userStore, crewsCache, cfg.Core.CacheControlShort},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/crews",
		server.Adapt(
			EditCrews{db, userStore, crewsCache},
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
			MyCrews{db, userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/crews/mine",
		server.Adapt(
			EditMyCrew{db, userStore, crewsCache},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/metrics",
		server.Adapt(
			GetMetrics{db, userStore, metricsCache},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events",
		server.Adapt(
			GetEvents{db, userStore, cfg.Core.CacheControlShort},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events",
		server.Adapt(
			EditEvent{db, userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/incident_types",
		server.Adapt(
			GetIncidentTypes{db, userStore, incidentTypesCache, cfg.Core.CacheControlShort},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/incident_types",
		server.Adapt(
			EditIncidentTypes{db, userStore, metricsCache, incidentTypesCache},
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
			ProposeIncidentType{db, userStore, metricsCache, incidentTypesCache},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/outcomes",
		server.Adapt(
			GetOutcomes{db, userStore, outcomesCache, cfg.Core.CacheControlShort},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/outcomes",
		server.Adapt(
			EditOutcomes{db, userStore, outcomesCache},
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
			ProposeOutcome{db, userStore, outcomesCache},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/personnel",
		server.Adapt(
			GetPersonnel{db, userStore, cfg.Core.CacheControlShort},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/personnel",
		server.Adapt(
			CreatePerson{db, userStore, cfg.Core.DefaultPassword},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/personnel/{personId}",
		server.Adapt(
			EditPerson{db, userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/personnel/{personId}/password",
		server.Adapt(
			SetPersonPassword{db, userStore, cfg.Core.DefaultPassword},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/personnel/{personId}/admin",
		server.Adapt(
			SetPersonAdmin{db, userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/personnel/{personId}/participation",
		server.Adapt(
			SetPersonParticipation{db, userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("DELETE /ims/api/personnel/{personId}/participation",
		server.Adapt(
			RemovePersonEvent{db, userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			// Logged: this is the audit trail for who removed/ejected whom from an
			// event (the eject case keeps the row via the POST above, also logged).
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// Profile picture: upload/remove are admin-only (mirror EditPerson), serving is
	// open to any personnel reader (mirror the profile card). Upload/remove mutate →
	// logged; the GET is a read → unlogged.
	mux.Handle("POST /ims/api/personnel/{personId}/picture",
		server.Adapt(
			SetPersonProfilePicture{db, userStore, cfg.AttachmentsStore, s3Client},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("DELETE /ims/api/personnel/{personId}/picture",
		server.Adapt(
			DeletePersonProfilePicture{db, userStore, cfg.AttachmentsStore, s3Client},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/personnel/{personId}/picture",
		server.Adapt(
			GetPersonProfilePicture{db, userStore, cfg.AttachmentsStore, s3Client},
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
			GetNotifications{db, userStore, cfg.Core.CacheControlShort},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(false, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/notifications/read",
		server.Adapt(
			MarkNotificationsRead{db, userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/notifications/{notificationId}/read",
		server.Adapt(
			MarkNotificationsRead{db, userStore},
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
			PostPushSubscribe{db},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("DELETE /ims/api/push/subscribe",
		server.Adapt(
			DeletePushSubscribe{db},
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
			GetBuildInfo{db, userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/debug/runtimemetrics",
		server.Adapt(
			GetRuntimeMetrics{db, userStore},
			server.RecoverFromPanic(),
			server.RequireAuthN(jwter),
			server.LogRequest(true, actionLogger, userStore),
			server.LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/debug/gc",
		server.Adapt(
			PerformGC{db, userStore},
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
