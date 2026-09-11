// SPDX-License-Identifier: Apache-2.0

package server

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
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

// The interceptor spine (plan 09g, M9/M5; made streaming-safe in 09p slice
// 3b.0a). The REST tier applies cross-cutting behaviour as per-route middleware
// adapters, opt-in one route at a time — the failure mode CLAUDE.md documents:
// "easy to omit and fails closed (unlogged)". The Connect tier flips that: the
// interceptors below are declared ONCE, in Interceptors(), and every RPC gets
// the whole chain by default. Nothing is per-route; there is no flag to forget.
//
// Each interceptor mirrors an existing REST adapter so the two transports behave
// identically while both live (M13): NewAuthInterceptor ≈ OptionalAuthN,
// NewActionLogInterceptor ≈ LogRequest, NewRecoveryInterceptor ≈ RecoverFromPanic.
//
// # Why these are types and not connect.UnaryInterceptorFunc
//
// They were all UnaryInterceptorFunc until 3b.0a, and that was a latent hole
// rather than a style choice. connect.UnaryInterceptorFunc satisfies
// connect.Interceptor with a **pass-through** WrapStreamingHandler: a streaming
// RPC added to this service would have compiled, served, and run with no claims
// in its context, no panic recovery, no request id and no log line — silently,
// with nothing failing to compile and nothing warning. The first streaming RPC
// (WatchEvent, 3b.0b) reads ClaimsFromContext, so that hole was an authorization
// bypass waiting to be written.
//
// Every interceptor here therefore implements connect.Interceptor properly, and
// each one's unary and streaming halves share a single body so the two cannot
// drift apart later. WrapStreamingClient is a pass-through everywhere because we
// are a server: nothing in this chain wraps an outbound call.

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

// serverInterceptor supplies the client half of connect.Interceptor to each
// handler-side interceptor below. Embedding it is what keeps "we never wrap an
// outbound call" stated once instead of five times.
type serverInterceptor struct{}

func (serverInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next
}

// Interceptors builds the full, ordered cross-cutting chain applied to every RPC,
// unary and streaming alike.
//
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
// material in the 1a Step-0 finding. It handles streaming itself: it validates
// each message a client sends, so a client- or bidi-stream is covered without
// anything from us.
func NewValidateInterceptor() *validate.Interceptor {
	return validate.NewInterceptor()
}

// RecoveryInterceptor turns a panic in an RPC handler (or an inner interceptor)
// into a CodeInternal error instead of crashing the connection, mirroring the
// REST RecoverFromPanic adapter. connect does not recover panics unless asked,
// so this is the recovery point for the Connect tier.
//
// The limit is the same one every recover() has: it covers the goroutine the
// handler runs on. A stream handler that fans work out to goroutines of its own
// (the WatchEvent hub will) has to recover inside them — this cannot reach there.
type RecoveryInterceptor struct{ serverInterceptor }

func NewRecoveryInterceptor() RecoveryInterceptor { return RecoveryInterceptor{} }

func (RecoveryInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (resp connect.AnyResponse, err error) {
		defer func() { err = recoverRPC(recover(), req.Spec().Procedure, err) }()
		return next(ctx, req)
	}
}

func (RecoveryInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) (err error) {
		defer func() { err = recoverRPC(recover(), conn.Spec().Procedure, err) }()
		return next(ctx, conn)
	}
}

// recoverRPC is the shared body of both halves: it is called from a
// deferred closure with the result of recover(), and returns the error the RPC
// should end with — the original one when nothing panicked.
func recoverRPC(recovered any, procedure string, err error) error {
	if recovered == nil {
		return err
	}
	slog.Error("Recovered from panic in RPC handler", "err", recovered, "procedure", procedure)
	debug.PrintStack()
	return connect.NewError(connect.CodeInternal, errors.New("the server malfunctioned"))
}

// RequestIDInterceptor adopts an inbound X-Request-Id (from a client or a proxy)
// or mints one, stashes it in the context for downstream logging, and echoes it
// on the response so a caller can correlate. Uses crypto/rand.Text like the rest
// of the codebase's opaque identifiers.
type RequestIDInterceptor struct{ serverInterceptor }

func NewRequestIDInterceptor() RequestIDInterceptor { return RequestIDInterceptor{} }

func (RequestIDInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		ctx, id := withRequestID(ctx, req.Header())
		resp, err := next(ctx, req)
		if resp != nil {
			resp.Header().Set(requestIDHeader, id)
		}
		return resp, err
	}
}

func (RequestIDInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		ctx, id := withRequestID(ctx, conn.RequestHeader())
		// Set BEFORE the handler runs: a stream's response headers are flushed
		// with its first message, so echoing afterwards (as the unary half does)
		// would put the id on the wire too late to ever be sent.
		conn.ResponseHeader().Set(requestIDHeader, id)
		return next(ctx, conn)
	}
}

func withRequestID(ctx context.Context, header http.Header) (context.Context, string) {
	id := header.Get(requestIDHeader)
	if id == "" {
		id = rand.Text()
	}
	return context.WithValue(ctx, RequestIDContextKey, id), id
}

// AuthInterceptor populates the caller's JWT claims into the context from the
// Bearer token, mirroring the REST OptionalAuthN adapter — it never rejects. A
// missing/invalid token yields a JWTContext with nil Claims and the error, and
// each handler asserts the identity it actually needs (returning
// CodeUnauthenticated). Login / RefreshToken / GetAuthStatus tolerate anonymous
// callers, which is why authentication is populate-only here rather than a gate.
//
// A stream is authenticated once, from the headers it opened with. It is
// therefore a token snapshot that outlives the token: a long-lived subscriber
// keeps whatever claims it connected with until it reconnects, which is why the
// stream's own per-poke access re-check (09p S3) — not this interceptor — is
// what has to notice a revoked permission.
type AuthInterceptor struct {
	serverInterceptor

	jwter authz.JWTer
}

func NewAuthInterceptor(jwter authz.JWTer) AuthInterceptor {
	return AuthInterceptor{jwter: jwter}
}

func (i AuthInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		return next(i.authenticate(ctx, req.Header()), req)
	}
}

func (i AuthInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		return next(i.authenticate(ctx, conn.RequestHeader()), conn)
	}
}

func (i AuthInterceptor) authenticate(ctx context.Context, header http.Header) context.Context {
	claims, err := i.jwter.AuthenticateJWT(strings.TrimPrefix(header.Get("Authorization"), "Bearer "))
	return context.WithValue(ctx, JWTContextKey, JWTContext{Claims: claims, Error: err})
}

// SlogInterceptor emits one log line per RPC — procedure, duration, code, caller and
// request id — mirroring the REST LogRequest adapter's trace line at Debug for a success,
// and standing in for what herr.HTTPError.WriteResponse did on the REST tier for a
// failure: an error is logged at Error when it is the server's fault (rpcErrorLevel) and
// at Warn otherwise, together with the server-side cause (ErrorCause) that never reaches
// the client. This is the developer-facing trace, distinct from the audit action log
// below.
//
// A stream gets the same closing line, marked stream=true — plus one Debug line
// when it opens, because a subscriber that stays connected for an hour would
// otherwise leave no trace in the log at all until it disconnects.
type SlogInterceptor struct{ serverInterceptor }

func NewSlogInterceptor() SlogInterceptor { return SlogInterceptor{} }

func (SlogInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		start := time.Now()
		resp, err := next(ctx, req)
		logRPC(ctx, req.Spec().Procedure, start, err, false)
		return resp, err
	}
}

func (SlogInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		procedure := conn.Spec().Procedure
		start := time.Now()
		slog.Debug("Opened RPC stream: "+procedure, rpcAttrs(ctx, procedure, start, nil, true)...)
		err := next(ctx, conn)
		logRPC(ctx, procedure, start, err, true)
		return err
	}
}

// logRPC writes the one closing line, at the level the outcome deserves.
func logRPC(ctx context.Context, procedure string, start time.Time, err error, stream bool) {
	attrs := rpcAttrs(ctx, procedure, start, err, stream)
	if err == nil {
		slog.Debug("Served RPC: "+procedure, attrs...)
		return
	}
	attrs = append(attrs, "err", err)
	cause := ErrorCause(err)
	if cause != nil {
		attrs = append(attrs, "cause", cause)
	}
	slog.Log(ctx, rpcErrorLevel(connect.CodeOf(err)), "RPC failed: "+procedure, attrs...)
}

func rpcAttrs(ctx context.Context, procedure string, start time.Time, err error, stream bool) []any {
	var user string
	if claims, ok := ClaimsFromContext(ctx); ok {
		user = claims.PersonHandle()
	}
	attrs := []any{
		"duration", fmt.Sprintf("%.3fms", float64(time.Since(start).Microseconds())/1000.0),
		"procedure", procedure,
		"user", user,
		"code", connect.CodeOf(err).String(),
	}
	if stream {
		attrs = append(attrs, "stream", true)
	}
	if id, ok := RequestIDFromContext(ctx); ok {
		attrs = append(attrs, "request_id", id)
	}
	return attrs
}

// rpcErrorLevel splits failed-RPC log severity the way herr.HTTPError.WriteResponse
// split HTTP statuses: a server fault (the 5xx analogues — Internal, Unknown, DataLoss,
// Unavailable) is Error; a client-attributable outcome (bad input, not found, denied,
// unauthenticated, throttled, conflict…) is notable at Warn but is not our fault.
func rpcErrorLevel(code connect.Code) slog.Level {
	if code == connect.CodeInternal || code == connect.CodeUnknown ||
		code == connect.CodeDataLoss || code == connect.CodeUnavailable {
		return slog.LevelError
	}
	return slog.LevelWarn
}

// The ACTION_TYPE an audit row carries. A unary RPC is one row written when it
// finishes; a mutating stream is two — see streamActionLog below.
const (
	actionTypeRPC         = "rpc"
	actionTypeStreamOpen  = "rpc_stream_open"
	actionTypeStreamClose = "rpc_stream_close"
)

// ActionLogInterceptor records a metadata-only audit row for every mutating
// RPC, mirroring the REST LogRequest adapter — but default-ON (M9). Reads
// (methods marked idempotency_level = NO_SIDE_EFFECTS in the contract) are
// skipped; everything else is logged, so the "easy to omit" per-route flag is
// gone. As with LogRequest, only metadata is captured — procedure, caller,
// client address, code, timing — NEVER the request or response body, so secret
// payloads (login, password reset) are never at risk of being logged.
//
// # Streams (09p open question 1)
//
// The contract-driven read/write split decides this too, and it is the reason
// the answer is cheap: WatchEvent mutates nothing, so it is NO_SIDE_EFFECTS and
// is skipped exactly like GetIncident. There is no row per poke, because there
// is no row at all.
//
// A stream that *does* mutate gets two rows — one when it opens, one when it
// closes — rather than the unary shape of one row on completion. A subscription
// can live for hours, and a single row written at teardown means the audit log
// has no record of a connection that is currently open, and none at all if the
// process dies while it is. The open row is the audit fact; the close row adds
// the duration and the final code.
type ActionLogInterceptor struct {
	serverInterceptor

	actionLogger ActionLogger
	userStore    directory.UserStore
}

func NewActionLogInterceptor(actionLogger ActionLogger, userStore directory.UserStore) ActionLogInterceptor {
	return ActionLogInterceptor{actionLogger: actionLogger, userStore: userStore}
}

func (i ActionLogInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		start := time.Now()
		resp, err := next(ctx, req)
		if req.Spec().IdempotencyLevel != connect.IdempotencyNoSideEffects {
			i.record(ctx, actionTypeRPC, req.HTTPMethod(), req.Spec().Procedure,
				req.Peer().Addr, err, time.Since(start))
		}
		return resp, err
	}
}

func (i ActionLogInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		if conn.Spec().IdempotencyLevel == connect.IdempotencyNoSideEffects {
			return next(ctx, conn)
		}
		// A Connect stream is always a POST; StreamingHandlerConn, unlike
		// AnyRequest, does not carry the verb, so it is named rather than read.
		procedure, addr := conn.Spec().Procedure, conn.Peer().Addr
		start := time.Now()
		i.record(ctx, actionTypeStreamOpen, http.MethodPost, procedure, addr, nil, 0)
		err := next(ctx, conn)
		i.record(ctx, actionTypeStreamClose, http.MethodPost, procedure, addr, err, time.Since(start))
		return err
	}
}

// record writes the one audit row. The audit schema's http_status column carries
// the connect code number for RPCs (0 = OK); there is no per-RPC HTTP status.
func (i ActionLogInterceptor) record(
	ctx context.Context,
	actionType string,
	method string,
	procedure string,
	remoteAddr string,
	err error,
	duration time.Duration,
) {
	var username sql.NullString
	var userID sql.NullInt64
	var positionID sql.NullInt64
	var positionName sql.NullString
	if claims, ok := ClaimsFromContext(ctx); ok {
		username = conv.StringToSql(new(claims.PersonHandle()), 128)
		userID = sql.NullInt64{Int64: int64(claims.PersonID()), Valid: true}
		if posID := claims.PersonOnDutyPosition(); posID != nil {
			positionID = sql.NullInt64{Int64: *posID, Valid: true}
			if positions, _ := i.userStore.GetPositions(ctx); positions != nil {
				positionName = conv.StringToSql(conv.EmptyToNil(positions[*posID]), 128)
			}
		}
	}

	i.actionLogger.Log(ctx, imsdb.AddActionLogParams{
		CreatedAt:      conv.TimeToFloat(time.Now()),
		ActionType:     actionType,
		Method:         conv.StringToSql(&method, 128),
		Path:           conv.StringToSql(&procedure, 128),
		UserID:         userID,
		UserName:       username,
		PositionID:     positionID,
		PositionName:   positionName,
		ClientAddress:  conv.StringToSql(&remoteAddr, 128),
		HttpStatus:     sql.NullInt16{Int16: int16(connect.CodeOf(err)), Valid: true},
		DurationMicros: sql.NullInt64{Int64: duration.Microseconds(), Valid: true},
	})
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
