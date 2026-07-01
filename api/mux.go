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
	"fmt"
	"log/slog"
	"net/http"
	"net/netip"
	"runtime/debug"
	"strings"
	"time"

	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/lib/attachment"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/lib/push"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/actionlog"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

func AddToMux(
	mux *http.ServeMux,
	es *EventSourcerer,
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
	pusher := NewPusher(db, pushSender)

	// One dashboard-metrics cache shared by the read handler (GetMetrics) and the
	// mutation handlers that must invalidate it on a write, so the dashboard
	// reflects changes immediately rather than waiting out the TTL.
	metricsCache := newMetricsCache()

	// Reference-data caches: the incident-type taxonomy (global) and each event's
	// area list are read on nearly every incident form load but change rarely, so
	// they are memoized here and invalidated by their write handlers.
	incidentTypesCache := newIncidentTypesCache()
	areasCache := newAreasCache()

	// Failed-login throttle/lockout for POST /ims/api/auth (plan 90, findings H1 +
	// M4). Enabled in real deployments; the shared test suite disables it via config.
	loginLimiter := newLoginRateLimiter(defaultLoginRateLimiterConfig(cfg.Core.LoginRateLimitEnabled))

	mux.Handle("GET /ims/api/actionlogs",
		Adapt(
			GetActionLogs{db, userStore},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/auth",
		Adapt(
			PostAuth{
				db,
				userStore,
				cfg.Core.JWTSecret,
				cfg.Core.AccessTokenLifetime,
				cfg.Core.RefreshTokenLifetime,
			},
			RecoverFromPanic(),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
			// ThrottleLogin sits inside LimitRequestBytes so the body it peeks at
			// for per-account keying is already size-capped. It sheds excess/failed
			// attempts with 429 before the argon2 verify runs.
			ThrottleLogin(loginLimiter),
			// This endpoint does not require authentication, nor
			// does it even consider the request's Authorization header,
			// because the point of this is to make a new JWT.
		),
	)

	mux.Handle("GET /ims/api/auth",
		Adapt(
			GetAuth{
				db,
				userStore,
				cfg.Core.JWTSecret,
				attachmentsEnabled,
				cfg.Push.VAPIDPublicKey,
			},
			RecoverFromPanic(),
			// This endpoint does not require authentication or authorization, by design
			OptionalAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/auth/refresh",
		Adapt(
			RefreshAccessToken{
				db,
				userStore,
				cfg.Core.JWTSecret,
				cfg.Core.AccessTokenLifetime,
			},
			RecoverFromPanic(),
			LogRequest(false, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
			// This endpoint does not require authentication, nor
			// does it even consider the request's Authorization header,
			// because the point of this is to make a new access token.
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/incidents",
		Adapt(
			GetIncidents{db, userStore, attachmentsEnabled},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(false, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/incidents",
		Adapt(
			NewIncident{db, userStore, es, pusher, metricsCache},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/incidents/{incidentNumber}",
		Adapt(
			GetIncident{db, userStore, attachmentsEnabled},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(false, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/incidents/{incidentNumber}",
		Adapt(
			EditIncident{db, userStore, es, pusher, metricsCache},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/incidents/{incidentNumber}/attachments/{attachmentNumber}",
		Adapt(
			GetIncidentAttachment{db, userStore, cfg.AttachmentsStore, s3Client},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/incidents/{incidentNumber}/attachments",
		Adapt(
			AttachToIncident{db, userStore, es, cfg.AttachmentsStore, s3Client},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/incidents/{incidentNumber}/people/{personId}",
		Adapt(
			AttachPersonToIncident{db, userStore, es, pusher},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("DELETE /ims/api/events/{eventName}/incidents/{incidentNumber}/people/{personId}",
		Adapt(
			DetachPersonFromIncident{db, userStore, es},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/incidents/{incidentNumber}/journal_entries/{journalEntryId}",
		Adapt(
			EditIncidentJournalEntry{db, userStore, es},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/reports",
		Adapt(
			GetReports{db, userStore, attachmentsEnabled},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(false, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/reports",
		Adapt(
			NewReport{db, userStore, es, pusher},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/reports/{reportNumber}",
		Adapt(
			GetReport{db, userStore, attachmentsEnabled},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(false, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/reports/{reportNumber}",
		Adapt(
			EditReport{db, userStore, es, pusher},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/reports/{reportNumber}/attachments/{attachmentNumber}",
		Adapt(
			GetReportAttachment{db, userStore, cfg.AttachmentsStore, s3Client},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/reports/{reportNumber}/attachments",
		Adapt(
			AttachToReport{db, userStore, es, cfg.AttachmentsStore, s3Client},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/reports/{reportNumber}/journal_entries/{journalEntryId}",
		Adapt(
			EditReportJournalEntry{db, userStore, es},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/visits",
		Adapt(
			GetVisits{db, userStore, attachmentsEnabled},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(false, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/visits/{visitNumber}",
		Adapt(
			GetVisit{db, userStore, attachmentsEnabled},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(false, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/visits",
		Adapt(
			NewVisit{db, userStore, es},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/visits/{visitNumber}",
		Adapt(
			EditVisit{db, userStore, es},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/visits/{visitNumber}/people/{personId}",
		Adapt(
			AttachPersonToVisit{db, userStore, es},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("DELETE /ims/api/events/{eventName}/visits/{visitNumber}/people/{personId}",
		Adapt(
			DetachPersonFromVisit{db, userStore, es},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/visits/{visitNumber}/attachments/{attachmentNumber}",
		Adapt(
			GetVisitAttachment{db, userStore, cfg.AttachmentsStore, s3Client},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/visits/{visitNumber}/attachments",
		Adapt(
			AttachToVisit{db, userStore, es, cfg.AttachmentsStore, s3Client},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/visits/{visitNumber}/journal_entries/{journalEntryId}",
		Adapt(
			EditVisitJournalEntry{db, userStore, es},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/areas",
		Adapt(
			GetAreas{db, userStore, areasCache, cfg.Core.CacheControlShort},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events/{eventName}/areas",
		Adapt(
			EditAreas{db, userStore, metricsCache, areasCache},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events/{eventName}/metrics",
		Adapt(
			GetMetrics{db, userStore, metricsCache},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(false, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/events",
		Adapt(
			GetEvents{db, userStore, cfg.Core.CacheControlShort},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(false, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/events",
		Adapt(
			EditEvent{db, userStore},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/incident_types",
		Adapt(
			GetIncidentTypes{db, userStore, incidentTypesCache, cfg.Core.CacheControlShort},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(false, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/incident_types",
		Adapt(
			EditIncidentTypes{db, userStore, metricsCache, incidentTypesCache},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// An event writer proposes a new incident type from the incident form; the
	// route is event-scoped only to authorize the caller as a writer (the type is
	// global). Approval happens back on the global admin endpoint above.
	mux.Handle("POST /ims/api/events/{eventName}/incident_types",
		Adapt(
			ProposeIncidentType{db, userStore, metricsCache, incidentTypesCache},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/personnel",
		Adapt(
			GetPersonnel{db, userStore, cfg.Core.CacheControlShort},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(false, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/personnel",
		Adapt(
			CreatePerson{db, userStore},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/personnel/{personId}",
		Adapt(
			EditPerson{db, userStore},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/personnel/{personId}/password",
		Adapt(
			SetPersonPassword{db, userStore},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/personnel/{personId}/admin",
		Adapt(
			SetPersonAdmin{db, userStore},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/personnel/{personId}/participation",
		Adapt(
			SetPersonParticipation{db, userStore},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("DELETE /ims/api/personnel/{personId}/participation",
		Adapt(
			RemovePersonEvent{db, userStore},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			// Logged: this is the audit trail for who removed/ejected whom from an
			// event (the eject case keeps the row via the POST above, also logged).
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// Notifications (plan 82): per-person (the caller's own), so only
	// authentication is required — no event scoping.
	mux.Handle("GET /ims/api/notifications",
		Adapt(
			GetNotifications{db, userStore, cfg.Core.CacheControlShort},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(false, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/notifications/read",
		Adapt(
			MarkNotificationsRead{db, userStore},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/notifications/{notificationId}/read",
		Adapt(
			MarkNotificationsRead{db, userStore},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// Web push subscriptions (plan 84): per-person, per-device, so only
	// authentication is required — no event scoping. Mutating, so LogRequest(true).
	mux.Handle("POST /ims/api/push/subscribe",
		Adapt(
			PostPushSubscribe{db},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("DELETE /ims/api/push/subscribe",
		Adapt(
			DeletePushSubscribe{db},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/eventsource",
		Adapt(
			es.Server.Handler(EventSourceChannel),
			RecoverFromPanic(),
			LogRequest(false, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/debug/buildinfo",
		Adapt(
			GetBuildInfo{db, userStore},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("GET /ims/api/debug/runtimemetrics",
		Adapt(
			GetRuntimeMetrics{db, userStore},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	mux.Handle("POST /ims/api/debug/gc",
		Adapt(
			PerformGC{db, userStore},
			RecoverFromPanic(),
			RequireAuthN(jwter),
			LogRequest(true, actionLogger, userStore),
			LimitRequestBytes(cfg.Core.MaxRequestBytes),
		),
	)

	// Readiness probe: unlike /ping (liveness — "is the process serving HTTP?",
	// used to decide a restart), /readyz reports whether the app can actually
	// reach its dependencies, so a monitor can tell "DB down" from "process
	// dead". It lives here rather than in AddBasicHandlers because that's where
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

	return AddBasicHandlers(mux)
}

func AddBasicHandlers(mux *http.ServeMux) *http.ServeMux {
	if mux == nil {
		mux = http.NewServeMux()
	}

	mux.HandleFunc("GET /{$}",
		func(w http.ResponseWriter, req *http.Request) {
			herr.WriteOKResponse(w, "IMS")
		},
	)

	mux.HandleFunc("GET /ims/api/ping",
		func(w http.ResponseWriter, req *http.Request) {
			herr.WriteOKResponse(w, "ack")
		},
	)

	return mux
}

type Adapter func(http.Handler) http.Handler

// responseWriter is a wrapper around http.ResponseWriter that lets us
// capture details about the response.
type responseWriter struct {
	http.ResponseWriter
	http.Flusher

	code int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.code = code
	rw.ResponseWriter.WriteHeader(code)
}

func LimitRequestBytes(maxRequestBytes int64) Adapter {
	return func(next http.Handler) http.Handler {
		return http.MaxBytesHandler(next, maxRequestBytes)
	}
}

func clientAddress(r *http.Request) string {
	if connectingIP := r.Header.Get("CF-Connecting-IP"); connectingIP != "" {
		return connectingIP
	}
	if forwardedFor := r.Header.Get("X-Forwarded-For"); forwardedFor != "" {
		return forwardedFor
	}
	addrPort, err := netip.ParseAddrPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return addrPort.Addr().String()
}

func LogRequest(enable bool, actionLogger *actionlog.Logger, userStore directory.UserStore) Adapter {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			writ := &responseWriter{w, w.(http.Flusher), http.StatusOK}

			next.ServeHTTP(writ, r)

			var username sql.NullString
			var userID sql.NullInt64
			var positionID sql.NullInt64
			var positionName sql.NullString
			jwtCtx, _ := r.Context().Value(JWTContextKey).(JWTContext)
			if jwtCtx.Claims != nil {
				username = conv.StringToSql(new(jwtCtx.Claims.PersonHandle()), 128)
				userID = sql.NullInt64{Int64: int64(jwtCtx.Claims.PersonID()), Valid: true}
				if posID := jwtCtx.Claims.PersonOnDutyPosition(); posID != nil {
					positionID = sql.NullInt64{Int64: *posID, Valid: true}
					positions, _, _ := userStore.GetPositionsAndTeams(r.Context())
					if positions != nil {
						posName := positions[*posID]
						positionName = conv.StringToSql(conv.EmptyToNil(posName), 128)
					}
				}
			}

			if enable {
				// SECURITY: the action log is deliberately metadata-only —
				// method, path, user, position, client address, status, and
				// timing. It never records the request or response body.
				// Endpoints that accept secrets (password reset, personnel
				// create) rely on this invariant, so do NOT add a body/payload
				// field to AddActionLogParams below.
				referrerHeader := r.Header.Get("Referer")
				referrerUsefulIndex := strings.Index(referrerHeader, "/ims")
				if referrerUsefulIndex != -1 {
					referrerHeader = referrerHeader[referrerUsefulIndex:]
				}
				referrer := conv.EmptyToNil(referrerHeader)
				remoteAddr := clientAddress(r)
				actionLogger.Log(
					r.Context(),
					imsdb.AddActionLogParams{
						CreatedAt:      conv.TimeToFloat(time.Now()),
						ActionType:     "api",
						Method:         conv.StringToSql(&r.Method, 128),
						Path:           conv.StringToSql(&r.URL.Path, 128),
						Referrer:       conv.StringToSql(referrer, 128),
						UserID:         userID,
						UserName:       username,
						PositionID:     positionID,
						PositionName:   positionName,
						ClientAddress:  conv.StringToSql(&remoteAddr, 128),
						HttpStatus:     sql.NullInt16{Int16: int16(writ.code), Valid: true},
						DurationMicros: sql.NullInt64{Int64: time.Since(start).Microseconds(), Valid: true},
					})
			}

			// #nosec G706 // log injection
			slog.Debug(fmt.Sprintf("Served request for: %v %v ", r.Method, r.URL.Path),
				"duration", fmt.Sprintf("%.3fms", float64(time.Since(start).Microseconds())/1000.0),
				"method", r.Method,
				"user", username.String,
				"code", writ.code,
			)
		})
	}
}

func RecoverFromPanic() Adapter {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if err := recover(); err != nil {
					slog.Error("Recovered from panic", "err", err)
					debug.PrintStack()
					herr.InternalServerError("The server malfunctioned", nil).WriteResponse(w)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

type ContextKey string

const JWTContextKey ContextKey = "JWTContext"

type JWTContext struct {
	Claims *authz.IMSClaims
	Error  error
}

func OptionalAuthN(j authz.JWTer) Adapter {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			claims, err := j.AuthenticateJWT(strings.TrimPrefix(header, "Bearer "))
			ctx := context.WithValue(r.Context(), JWTContextKey, JWTContext{
				Claims: claims,
				Error:  err,
			})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireAuthN(j authz.JWTer) Adapter {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			claims, err := j.AuthenticateJWT(strings.TrimPrefix(header, "Bearer "))
			if err != nil || claims == nil {
				herr.Unauthorized("Invalid Authorization token", err).WriteResponse(w)
				return
			}
			jwtCtx := context.WithValue(r.Context(), JWTContextKey, JWTContext{
				Claims: claims,
				Error:  err,
			})
			next.ServeHTTP(w, r.WithContext(jwtCtx))
		})
	}
}

func Adapt(handler http.Handler, adapters ...Adapter) http.Handler {
	for i := range adapters {
		adapter := adapters[len(adapters)-1-i] // range in reverse
		handler = adapter(handler)
	}
	return handler
}
