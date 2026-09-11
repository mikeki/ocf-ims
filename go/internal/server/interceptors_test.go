// SPDX-License-Identifier: Apache-2.0

package server

import (
	"context"
	"errors"
	"io"
	"net/http"
	"slices"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"github.com/stretchr/testify/require"
)

// These exercise the interceptors that do not depend on the RPC's idempotency
// level (recovery, request id, auth). The action-log interceptor's read/write
// split needs a populated req.Spec(), which only the real Connect handler
// supplies, so it is proven end-to-end in api.TestConnectActionLog*.

// unaryReq builds a minimal connect.AnyRequest for driving an interceptor
// directly. The interceptors under test read only its headers, so the message
// type is irrelevant.
func unaryReq() connect.AnyRequest {
	return connect.NewRequest(&struct{}{})
}

// okUnary is a no-op handler that runs inspect against the context it was called
// with, so a test can pull out exactly what an interceptor placed there (a
// request id, claims) without capturing the context itself.
func okUnary(inspect func(ctx context.Context)) connect.UnaryFunc {
	return func(ctx context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
		if inspect != nil {
			inspect(ctx)
		}
		return connect.NewResponse(&struct{}{}), nil
	}
}

func TestRecoveryInterceptorTurnsPanicIntoInternal(t *testing.T) {
	t.Parallel()
	panicky := func(context.Context, connect.AnyRequest) (connect.AnyResponse, error) {
		panic("boom")
	}
	wrapped := NewRecoveryInterceptor().WrapUnary(panicky)

	require.NotPanics(t, func() {
		_, err := wrapped(context.Background(), unaryReq())
		require.Equal(t, connect.CodeInternal, connect.CodeOf(err))
	})
}

func TestRequestIDInterceptorMintsAndEchoes(t *testing.T) {
	t.Parallel()
	var id string
	var ok bool
	req := unaryReq()
	resp, err := NewRequestIDInterceptor().WrapUnary(okUnary(func(ctx context.Context) {
		id, ok = RequestIDFromContext(ctx)
	}))(context.Background(), req)
	require.NoError(t, err)

	require.True(t, ok, "an id must be minted into the context")
	require.NotEmpty(t, id)
	require.Equal(t, id, resp.Header().Get(requestIDHeader), "the id must be echoed on the response")
}

func TestRequestIDInterceptorAdoptsInbound(t *testing.T) {
	t.Parallel()
	var id string
	req := unaryReq()
	req.Header().Set(requestIDHeader, "inbound-123")
	resp, err := NewRequestIDInterceptor().WrapUnary(okUnary(func(ctx context.Context) {
		id, _ = RequestIDFromContext(ctx)
	}))(context.Background(), req)
	require.NoError(t, err)

	require.Equal(t, "inbound-123", id, "an inbound id must be adopted, not replaced")
	require.Equal(t, "inbound-123", resp.Header().Get(requestIDHeader))
}

func TestAuthInterceptorPopulatesClaims(t *testing.T) {
	t.Parallel()
	jwter := authz.JWTer{SecretKey: "unit-test-secret"}
	token, err := jwter.CreateAccessToken("bob", 7, nil, false, nil, time.Now().Add(time.Hour))
	require.NoError(t, err)

	req := unaryReq()
	req.Header().Set("Authorization", "Bearer "+token)
	var handle string
	var id int32
	var ok bool
	_, err = NewAuthInterceptor(jwter).WrapUnary(okUnary(func(ctx context.Context) {
		if claims, present := ClaimsFromContext(ctx); present {
			ok, handle, id = true, claims.PersonHandle(), claims.PersonID()
		}
	}))(context.Background(), req)
	require.NoError(t, err)

	require.True(t, ok)
	require.Equal(t, "bob", handle)
	require.Equal(t, int32(7), id)
}

func TestAuthInterceptorAnonymousHasNoClaims(t *testing.T) {
	t.Parallel()
	jwter := authz.JWTer{SecretKey: "unit-test-secret"}
	var ok bool
	_, err := NewAuthInterceptor(jwter).WrapUnary(okUnary(func(ctx context.Context) {
		_, ok = ClaimsFromContext(ctx)
	}))(context.Background(), unaryReq())
	require.NoError(t, err)

	require.False(t, ok, "a request with no token must carry no claims")
}

func TestClaimsFromContextEmpty(t *testing.T) {
	t.Parallel()
	_, ok := ClaimsFromContext(context.Background())
	require.False(t, ok)
}

// ---------------------------------------------------------------------------
// The streaming half (09p slice 3b.0a).
//
// These are the regression guard for the hole 3b.0a closed: every interceptor
// used to be a connect.UnaryInterceptorFunc, whose WrapStreamingHandler is a
// PASS-THROUGH, so a streaming RPC ran with no claims, no recovery, no request
// id and no audit row — and nothing failed to compile. Each test below asserts
// the streaming half does what the unary half does, so the two cannot silently
// diverge again.
// ---------------------------------------------------------------------------

// Every interceptor in the spine must be a real connect.Interceptor, not a
// function type that fakes one.
var (
	_ connect.Interceptor = RecoveryInterceptor{}
	_ connect.Interceptor = RequestIDInterceptor{}
	_ connect.Interceptor = AuthInterceptor{}
	_ connect.Interceptor = SlogInterceptor{}
	_ connect.Interceptor = ActionLogInterceptor{}
)

// fakeStreamConn is a connect.StreamingHandlerConn that carries only what the
// interceptors read: the spec, the peer and the two header sets. Nothing here
// sends or receives a message — the interceptors never touch the message flow.
type fakeStreamConn struct {
	spec     connect.Spec
	peer     connect.Peer
	reqHdr   http.Header
	respHdr  http.Header
	trailers http.Header
}

func newStreamConn(idempotency connect.IdempotencyLevel) *fakeStreamConn {
	return &fakeStreamConn{
		spec: connect.Spec{
			StreamType:       connect.StreamTypeServer,
			Procedure:        "/ocf.ims.service.v1.ImsService/WatchEvent",
			IdempotencyLevel: idempotency,
		},
		peer:     connect.Peer{Addr: "10.0.0.9:51234", Protocol: connect.ProtocolConnect},
		reqHdr:   http.Header{},
		respHdr:  http.Header{},
		trailers: http.Header{},
	}
}

func (c *fakeStreamConn) Spec() connect.Spec           { return c.spec }
func (c *fakeStreamConn) Peer() connect.Peer           { return c.peer }
func (c *fakeStreamConn) Receive(any) error            { return io.EOF }
func (c *fakeStreamConn) RequestHeader() http.Header   { return c.reqHdr }
func (c *fakeStreamConn) Send(any) error               { return nil }
func (c *fakeStreamConn) ResponseHeader() http.Header  { return c.respHdr }
func (c *fakeStreamConn) ResponseTrailer() http.Header { return c.trailers }

// okStream is the streaming twin of okUnary.
func okStream(inspect func(ctx context.Context)) connect.StreamingHandlerFunc {
	return func(ctx context.Context, _ connect.StreamingHandlerConn) error {
		if inspect != nil {
			inspect(ctx)
		}
		return nil
	}
}

func TestRecoveryInterceptorStreamPanicIsInternal(t *testing.T) {
	t.Parallel()
	panicky := func(context.Context, connect.StreamingHandlerConn) error { panic("boom") }
	wrapped := NewRecoveryInterceptor().WrapStreamingHandler(panicky)

	require.NotPanics(t, func() {
		err := wrapped(context.Background(), newStreamConn(connect.IdempotencyUnknown))
		require.Equal(t, connect.CodeInternal, connect.CodeOf(err))
	})
}

func TestRequestIDInterceptorStreamMintsAndEchoes(t *testing.T) {
	t.Parallel()
	conn := newStreamConn(connect.IdempotencyNoSideEffects)
	var id string
	var ok bool
	var echoedDuringHandler string
	err := NewRequestIDInterceptor().WrapStreamingHandler(okStream(func(ctx context.Context) {
		id, ok = RequestIDFromContext(ctx)
		echoedDuringHandler = conn.ResponseHeader().Get(requestIDHeader)
	}))(context.Background(), conn)
	require.NoError(t, err)

	require.True(t, ok, "an id must be minted into the context")
	require.NotEmpty(t, id)
	// A stream flushes its response headers with the first message, so the id
	// has to be set before the handler runs, not after it returns.
	require.Equal(t, id, echoedDuringHandler,
		"the id must be on the response header before the handler can send")
}

func TestRequestIDInterceptorStreamAdoptsInbound(t *testing.T) {
	t.Parallel()
	conn := newStreamConn(connect.IdempotencyNoSideEffects)
	conn.RequestHeader().Set(requestIDHeader, "inbound-stream-9")
	var id string
	err := NewRequestIDInterceptor().WrapStreamingHandler(okStream(func(ctx context.Context) {
		id, _ = RequestIDFromContext(ctx)
	}))(context.Background(), conn)
	require.NoError(t, err)

	require.Equal(t, "inbound-stream-9", id, "an inbound id must be adopted, not replaced")
	require.Equal(t, "inbound-stream-9", conn.ResponseHeader().Get(requestIDHeader))
}

func TestAuthInterceptorStreamPopulatesClaims(t *testing.T) {
	t.Parallel()
	jwter := authz.JWTer{SecretKey: "unit-test-secret"}
	token, err := jwter.CreateAccessToken("bob", 7, nil, false, nil, time.Now().Add(time.Hour))
	require.NoError(t, err)

	conn := newStreamConn(connect.IdempotencyNoSideEffects)
	conn.RequestHeader().Set("Authorization", "Bearer "+token)
	var handle string
	var id int32
	var ok bool
	err = NewAuthInterceptor(jwter).WrapStreamingHandler(okStream(func(ctx context.Context) {
		if claims, present := ClaimsFromContext(ctx); present {
			ok, handle, id = true, claims.PersonHandle(), claims.PersonID()
		}
	}))(context.Background(), conn)
	require.NoError(t, err)

	require.True(t, ok, "a streaming handler must see the caller's claims")
	require.Equal(t, "bob", handle)
	require.Equal(t, int32(7), id)
}

func TestAuthInterceptorStreamAnonymousHasNoClaims(t *testing.T) {
	t.Parallel()
	jwter := authz.JWTer{SecretKey: "unit-test-secret"}
	var ok bool
	err := NewAuthInterceptor(jwter).WrapStreamingHandler(okStream(func(ctx context.Context) {
		_, ok = ClaimsFromContext(ctx)
	}))(context.Background(), newStreamConn(connect.IdempotencyNoSideEffects))
	require.NoError(t, err)

	require.False(t, ok, "a stream with no token must carry no claims")
}

// spyActionLogger records the audit rows an interceptor writes.
type spyActionLogger struct {
	mu      sync.Mutex
	records []imsdb.AddActionLogParams
}

func (s *spyActionLogger) Log(_ context.Context, record imsdb.AddActionLogParams) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records = append(s.records, record)
}

func TestActionLogInterceptorSkipsReadOnlyStream(t *testing.T) {
	t.Parallel()
	spy := &spyActionLogger{}
	// WatchEvent is NO_SIDE_EFFECTS, so the contract-driven read/write split
	// answers 09p open question 1 by itself: no row per poke, because no row.
	err := NewActionLogInterceptor(spy, nil).
		WrapStreamingHandler(okStream(nil))(context.Background(), newStreamConn(connect.IdempotencyNoSideEffects))
	require.NoError(t, err)
	require.Empty(t, spy.records, "a read-only stream is not audited, like a read-only unary RPC")
}

func TestActionLogInterceptorAuditsMutatingStreamOpenAndClose(t *testing.T) {
	t.Parallel()
	spy := &spyActionLogger{}
	failure := connect.NewError(connect.CodeCanceled, errors.New("client went away"))
	handler := func(context.Context, connect.StreamingHandlerConn) error { return failure }

	err := NewActionLogInterceptor(spy, nil).
		WrapStreamingHandler(handler)(context.Background(), newStreamConn(connect.IdempotencyUnknown))
	require.Equal(t, failure, err)

	// Two rows, not one: a subscription can live for hours, so the audit log
	// records the connection when it opens rather than only when it ends.
	require.Len(t, spy.records, 2)
	open, closed := spy.records[0], spy.records[1]
	require.Equal(t, actionTypeStreamOpen, open.ActionType)
	require.Equal(t, actionTypeStreamClose, closed.ActionType)
	require.Equal(t, "/ocf.ims.service.v1.ImsService/WatchEvent", open.Path.String)
	require.Equal(t, "10.0.0.9:51234", open.ClientAddress.String)
	require.Equal(t, int16(connect.CodeOf(nil)), open.HttpStatus.Int16, "the open row has no outcome yet")
	require.Equal(t, int16(connect.CodeCanceled), closed.HttpStatus.Int16)
}

// The whole chain, in the order Interceptors() declares it, applied to a
// streaming handler: the thing that was broken before 3b.0a.
func TestInterceptorChainAppliesToStreamingHandler(t *testing.T) {
	t.Parallel()
	jwter := authz.JWTer{SecretKey: "unit-test-secret"}
	token, err := jwter.CreateAccessToken("bob", 7, nil, false, nil, time.Now().Add(time.Hour))
	require.NoError(t, err)

	spy := &spyActionLogger{}
	conn := newStreamConn(connect.IdempotencyNoSideEffects)
	conn.RequestHeader().Set("Authorization", "Bearer "+token)

	var sawClaims, sawRequestID bool
	handler := connect.StreamingHandlerFunc(func(ctx context.Context, _ connect.StreamingHandlerConn) error {
		_, sawClaims = ClaimsFromContext(ctx)
		_, sawRequestID = RequestIDFromContext(ctx)
		panic("the handler blew up mid-stream")
	})

	// Wrap innermost-first, so the slice's outermost-first order is preserved.
	wrapped := handler
	for _, interceptor := range slices.Backward(Interceptors(jwter, spy, nil, NewValidateInterceptor())) {
		wrapped = interceptor.WrapStreamingHandler(wrapped)
	}

	require.NotPanics(t, func() {
		err = wrapped(context.Background(), conn)
	})
	require.Equal(t, connect.CodeInternal, connect.CodeOf(err), "recovery must reach a streaming handler")
	require.True(t, sawClaims, "auth must reach a streaming handler")
	require.True(t, sawRequestID, "the request id must reach a streaming handler")
	require.NotEmpty(t, conn.ResponseHeader().Get(requestIDHeader))
}

// This pins the connect-go behaviour that made the old spine a *silent* hole,
// rather than a compile error: connect.UnaryInterceptorFunc satisfies
// connect.Interceptor, and its WrapStreamingHandler is a pass-through — the
// unary body simply never runs on a stream. If connect-go ever changes that,
// this test tells us, and until then it is the executable version of the
// warning in the file header.
func TestUnaryInterceptorFuncIsAPassThroughOnStreams(t *testing.T) {
	t.Parallel()
	var ranUnaryBody bool
	var interceptor connect.Interceptor = connect.UnaryInterceptorFunc(
		func(next connect.UnaryFunc) connect.UnaryFunc {
			return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
				ranUnaryBody = true
				return next(ctx, req)
			}
		})

	err := interceptor.WrapStreamingHandler(okStream(nil))(
		context.Background(), newStreamConn(connect.IdempotencyUnknown))
	require.NoError(t, err)
	require.False(t, ranUnaryBody,
		"connect.UnaryInterceptorFunc does nothing on a stream — which is why the spine is types now")
}
