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
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"runtime/debug"
	"strings"
	"time"

	"connectrpc.com/connect"
	"connectrpc.com/validate"
	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// The interceptor spine (plan 09g, M9/M5). The REST tier applies cross-cutting
// behaviour as per-route middleware adapters, opt-in one route at a time — the
// failure mode CLAUDE.md documents: "easy to omit and fails closed (unlogged)".
// The Connect tier flips that: the interceptors below are declared ONCE, in
// Interceptors(), and every RPC gets the whole chain by default. Nothing is
// per-route; there is no flag to forget.
//
// Each interceptor mirrors an existing REST adapter so the two transports behave
// identically while both live (M13): NewAuthInterceptor ≈ OptionalAuthN,
// NewActionLogInterceptor ≈ LogRequest, NewRecoveryInterceptor ≈ RecoverFromPanic.

// requestIDHeader is both read (to adopt a client- or proxy-supplied id) and
// echoed back on the response, so one id follows a request across tiers.
const requestIDHeader = "X-Request-Id"

// RequestIDContextKey holds the per-request correlation id in the context.
const RequestIDContextKey ContextKey = "RequestID"

// ActionLogger is the metadata-only audit sink the action-log interceptor writes
// to. It is the behaviour the interceptor depends on (not the concrete
// *actionlog.Logger), so the default-on skip/log decision is unit-testable with a
// spy. *actionlog.Logger satisfies it.
type ActionLogger interface {
	Log(ctx context.Context, record imsdb.AddActionLogParams)
}

// Interceptors builds the full, ordered cross-cutting chain applied to every RPC.
// The slice is outermost-first (connect applies interceptor[0] as the outermost
// wrapper), so the order is deliberate:
//
//   - Recovery is outermost: it catches a panic from anything inside — the other
//     interceptors and the handler — and turns it into CodeInternal.
//   - RequestID next, so the id is in the context before anything logs.
//   - Auth populates the caller's claims before the two things that read them
//     (slog and the action log) and before the handler.
//   - Slog and the action log sit inside Auth so both see the caller; the action
//     log also runs inside Validate so a request rejected by protovalidate is
//     still audited as an attempt.
//   - Validate is innermost, right against the handler: it rejects a
//     constraint-violating request with CodeInvalidArgument before the handler
//     ever runs (proven in the 1a Step-0 spike — validation fires independently
//     of whether the method itself is implemented).
func Interceptors(
	jwter authz.JWTer,
	actionLogger ActionLogger,
	userStore directory.UserStore,
	validateInterceptor *validate.Interceptor,
) []connect.Interceptor {
	return []connect.Interceptor{
		NewRecoveryInterceptor(),
		NewRequestIDInterceptor(),
		NewAuthInterceptor(jwter),
		NewSlogInterceptor(),
		NewActionLogInterceptor(actionLogger, userStore),
		validateInterceptor,
	}
}

// NewValidateInterceptor builds the protovalidate interceptor (M5): every
// constraint written into the protos as buf.validate options is enforced here,
// with no hand-written validation code. In connectrpc.com/validate v0.6.0
// NewInterceptor is single-return (no error) — corrected from the reference
// material in the 1a Step-0 finding.
func NewValidateInterceptor() *validate.Interceptor {
	return validate.NewInterceptor()
}

// NewRecoveryInterceptor turns a panic in an RPC handler (or an inner
// interceptor) into a CodeInternal error instead of crashing the connection,
// mirroring the REST RecoverFromPanic adapter. connect does not recover panics
// unless asked, so this is the recovery point for the Connect tier.
func NewRecoveryInterceptor() connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (resp connect.AnyResponse, err error) {
			defer func() {
				if r := recover(); r != nil {
					slog.Error("Recovered from panic in RPC handler",
						"err", r, "procedure", req.Spec().Procedure)
					debug.PrintStack()
					err = connect.NewError(connect.CodeInternal, errors.New("the server malfunctioned"))
				}
			}()
			return next(ctx, req)
		}
	}
}

// NewRequestIDInterceptor adopts an inbound X-Request-Id (from a client or a
// proxy) or mints one, stashes it in the context for downstream logging, and
// echoes it on the response so a caller can correlate. Uses crypto/rand.Text
// like the rest of the codebase's opaque identifiers.
func NewRequestIDInterceptor() connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			id := req.Header().Get(requestIDHeader)
			if id == "" {
				id = rand.Text()
			}
			ctx = context.WithValue(ctx, RequestIDContextKey, id)
			resp, err := next(ctx, req)
			if resp != nil {
				resp.Header().Set(requestIDHeader, id)
			}
			return resp, err
		}
	}
}

// NewAuthInterceptor populates the caller's JWT claims into the context from the
// Bearer token, mirroring the REST OptionalAuthN adapter — it never rejects. A
// missing/invalid token yields a JWTContext with nil Claims and the error, and
// each handler asserts the identity it actually needs (returning
// CodeUnauthenticated). Login / RefreshToken / GetAuthStatus tolerate anonymous
// callers, which is why authentication is populate-only here rather than a gate.
func NewAuthInterceptor(jwter authz.JWTer) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			header := req.Header().Get("Authorization")
			claims, err := jwter.AuthenticateJWT(strings.TrimPrefix(header, "Bearer "))
			ctx = context.WithValue(ctx, JWTContextKey, JWTContext{Claims: claims, Error: err})
			return next(ctx, req)
		}
	}
}

// NewSlogInterceptor emits one debug line per RPC — procedure, duration, code and
// caller — mirroring the tail of the REST LogRequest adapter. This is the
// developer-facing trace, distinct from the audit action log below.
func NewSlogInterceptor() connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			start := time.Now()
			resp, err := next(ctx, req)
			var user string
			if claims, ok := ClaimsFromContext(ctx); ok {
				user = claims.PersonHandle()
			}
			slog.Debug("Served RPC: "+req.Spec().Procedure,
				"duration", fmt.Sprintf("%.3fms", float64(time.Since(start).Microseconds())/1000.0),
				"procedure", req.Spec().Procedure,
				"user", user,
				"code", connect.CodeOf(err).String(),
			)
			return resp, err
		}
	}
}

// NewActionLogInterceptor records a metadata-only audit row for every mutating
// RPC, mirroring the REST LogRequest adapter — but default-ON (M9). Reads
// (methods marked idempotency_level = NO_SIDE_EFFECTS in the contract) are
// skipped; everything else is logged, so the "easy to omit" per-route flag is
// gone. As with LogRequest, only metadata is captured — procedure, caller,
// client address, code, timing — NEVER the request or response body, so secret
// payloads (login, password reset) are never at risk of being logged.
func NewActionLogInterceptor(actionLogger ActionLogger, userStore directory.UserStore) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			start := time.Now()
			resp, err := next(ctx, req)

			// Contract-driven read/write split: no-side-effect RPCs are not audited.
			if req.Spec().IdempotencyLevel == connect.IdempotencyNoSideEffects {
				return resp, err
			}

			var username sql.NullString
			var userID sql.NullInt64
			var positionID sql.NullInt64
			var positionName sql.NullString
			if claims, ok := ClaimsFromContext(ctx); ok {
				username = conv.StringToSql(new(claims.PersonHandle()), 128)
				userID = sql.NullInt64{Int64: int64(claims.PersonID()), Valid: true}
				if posID := claims.PersonOnDutyPosition(); posID != nil {
					positionID = sql.NullInt64{Int64: *posID, Valid: true}
					if positions, _ := userStore.GetPositions(ctx); positions != nil {
						positionName = conv.StringToSql(conv.EmptyToNil(positions[*posID]), 128)
					}
				}
			}

			procedure := req.Spec().Procedure
			method := req.HTTPMethod()
			remoteAddr := req.Peer().Addr
			// The audit schema's http_status column carries the connect code
			// number for RPCs (0 = OK); there is no per-RPC HTTP status.
			code := int16(connect.CodeOf(err))
			actionLogger.Log(ctx, imsdb.AddActionLogParams{
				CreatedAt:      conv.TimeToFloat(time.Now()),
				ActionType:     "rpc",
				Method:         conv.StringToSql(&method, 128),
				Path:           conv.StringToSql(&procedure, 128),
				UserID:         userID,
				UserName:       username,
				PositionID:     positionID,
				PositionName:   positionName,
				ClientAddress:  conv.StringToSql(&remoteAddr, 128),
				HttpStatus:     sql.NullInt16{Int16: code, Valid: true},
				DurationMicros: sql.NullInt64{Int64: time.Since(start).Microseconds(), Valid: true},
			})
			return resp, err
		}
	}
}

// ClaimsFromContext returns the authenticated caller's claims, if the auth
// interceptor (or the REST OptionalAuthN/RequireAuthN adapter) populated a valid
// token. Both transports store the same JWTContext under the same key, so this
// one accessor serves handlers on either side.
func ClaimsFromContext(ctx context.Context) (*authz.IMSClaims, bool) {
	jwtCtx, ok := ctx.Value(JWTContextKey).(JWTContext)
	if !ok || jwtCtx.Claims == nil {
		return nil, false
	}
	return jwtCtx.Claims, true
}

// RequestIDFromContext returns the per-request correlation id set by
// NewRequestIDInterceptor, if present.
func RequestIDFromContext(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(RequestIDContextKey).(string)
	return id, ok
}
