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

package server

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

	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store/actionlog"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

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
					positions, _ := userStore.GetPositions(r.Context())
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

// RequireRefreshCookieAuthN authenticates a request from the HttpOnly refresh-token
// cookie (authz.RefreshTokenCookieName) rather than the Authorization: Bearer header.
// It exists for the SSE endpoint: the browser EventSource API cannot set a bearer
// header, but it sends same-site cookies (the web client opens the stream with
// withCredentials), so the refresh cookie is the credential available there. Gating
// the stream on a valid cookie closes the anonymous broadcast — an unauthenticated
// party can no longer subscribe and watch incident activity (plan 09 §6 M8). Absent
// or invalid cookie ⇒ 401.
func RequireRefreshCookieAuthN(j authz.JWTer) Adapter {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie(authz.RefreshTokenCookieName)
			if err != nil {
				herr.Unauthorized("Missing refresh token cookie", err).WriteResponse(w)
				return
			}
			claims, err := j.AuthenticateRefreshToken(cookie.Value)
			if err != nil || claims == nil {
				herr.Unauthorized("Invalid refresh token cookie", err).WriteResponse(w)
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
