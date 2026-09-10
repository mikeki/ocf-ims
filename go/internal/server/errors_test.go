// SPDX-License-Identifier: Apache-2.0

package server

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"testing"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/stretchr/testify/require"
)

// A store error of the shape MariaDB produces — the text that must never reach a client.
const storeErrText = "Error 1146: Table 'ims.INCIDENT' doesn't exist"

func TestInternalErrorHidesCauseFromWire(t *testing.T) {
	t.Parallel()
	cause := errors.New(storeErrText)
	err := InternalError("failed to fetch incident", cause)

	require.Equal(t, connect.CodeInternal, connect.CodeOf(err))
	// Message() is what connect-go puts on the wire.
	require.Equal(t, "failed to fetch incident", err.Message())
	require.NotContains(t, err.Error(), "INCIDENT")
	// The cause stays reachable server-side, through the standard chain.
	require.Equal(t, cause, ErrorCause(err))
	require.ErrorIs(t, err, cause)
}

func TestErrorCauseIsNilWithoutOne(t *testing.T) {
	t.Parallel()
	require.NoError(t, ErrorCause(connect.NewError(connect.CodeNotFound, errors.New("nope"))))
	require.NoError(t, ErrorCause(errors.New("plain")))
	require.NoError(t, ErrorCause(PublicError(connect.CodeUnauthenticated, "no cookie", nil)))
}

func TestHerrToConnectMapsCodesAndKeepsCause(t *testing.T) {
	t.Parallel()
	cause := errors.New(storeErrText)
	cases := []struct {
		status int
		code   connect.Code
	}{
		{http.StatusBadRequest, connect.CodeInvalidArgument},
		{http.StatusUnauthorized, connect.CodeUnauthenticated},
		{http.StatusForbidden, connect.CodePermissionDenied},
		{http.StatusNotFound, connect.CodeNotFound},
		{http.StatusConflict, connect.CodeAlreadyExists},
		{http.StatusTooManyRequests, connect.CodeResourceExhausted},
		{http.StatusInternalServerError, connect.CodeInternal},
		{http.StatusTeapot, connect.CodeInternal}, // anything unmapped is a server fault
	}
	for _, tc := range cases {
		err := HerrToConnect(herr.New(tc.status, "public message", cause))
		require.Equal(t, tc.code, connect.CodeOf(err), "status %d", tc.status)
		var cerr *connect.Error
		require.ErrorAs(t, err, &cerr)
		require.Equal(t, "public message", cerr.Message(), "status %d", tc.status)
		require.NotContains(t, err.Error(), "INCIDENT", "status %d", tc.status)
		require.Equal(t, cause, ErrorCause(err), "status %d", tc.status)
	}
}

func TestRPCErrorLevel(t *testing.T) {
	t.Parallel()
	require.Equal(t, slog.LevelError, rpcErrorLevel(connect.CodeInternal))
	require.Equal(t, slog.LevelError, rpcErrorLevel(connect.CodeUnknown))
	require.Equal(t, slog.LevelWarn, rpcErrorLevel(connect.CodeNotFound))
	require.Equal(t, slog.LevelWarn, rpcErrorLevel(connect.CodeInvalidArgument))
	require.Equal(t, slog.LevelWarn, rpcErrorLevel(connect.CodePermissionDenied))
	require.Equal(t, slog.LevelWarn, rpcErrorLevel(connect.CodeResourceExhausted))
}

// recordingHandler captures slog records so a test can assert on what an interceptor logged.
type recordingHandler struct {
	records []slog.Record
}

func (h *recordingHandler) Enabled(context.Context, slog.Level) bool { return true }
func (h *recordingHandler) Handle(_ context.Context, r slog.Record) error {
	h.records = append(h.records, r)
	return nil
}
func (h *recordingHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h *recordingHandler) WithGroup(string) slog.Handler      { return h }

func attrsOf(r slog.Record) map[string]string {
	out := map[string]string{}
	r.Attrs(func(a slog.Attr) bool {
		out[a.Key] = a.Value.String()
		return true
	})
	return out
}

// TestSlogInterceptorLogsFailures proves the REST-parity behaviour: a failed RPC is logged
// (Error for a server fault, Warn for a client-attributable code) with the server-side cause
// that the wire message omits. Not parallel: it swaps the process-wide default logger.
func TestSlogInterceptorLogsFailures(t *testing.T) { //nolint:paralleltest // swaps slog.Default
	rec := &recordingHandler{}
	prev := slog.Default()
	slog.SetDefault(slog.New(rec))
	t.Cleanup(func() { slog.SetDefault(prev) })

	cause := errors.New(storeErrText)
	failing := func(context.Context, connect.AnyRequest) (connect.AnyResponse, error) {
		return nil, InternalError("failed to fetch incident", cause)
	}
	_, err := NewSlogInterceptor()(failing)(context.Background(), unaryReq())
	require.Error(t, err)
	require.Len(t, rec.records, 1)
	require.Equal(t, slog.LevelError, rec.records[0].Level)
	attrs := attrsOf(rec.records[0])
	require.Equal(t, "internal", attrs["code"])
	require.Contains(t, attrs["cause"], "INCIDENT", "the hidden cause must be logged")
	require.NotContains(t, attrs["err"], "INCIDENT", "the wire-facing error must stay public")

	rec.records = nil
	denied := func(context.Context, connect.AnyRequest) (connect.AnyResponse, error) {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("nope"))
	}
	_, err = NewSlogInterceptor()(denied)(context.Background(), unaryReq())
	require.Error(t, err)
	require.Len(t, rec.records, 1)
	require.Equal(t, slog.LevelWarn, rec.records[0].Level)
	require.NotContains(t, attrsOf(rec.records[0]), "cause")

	rec.records = nil
	_, err = NewSlogInterceptor()(okUnary(nil))(context.Background(), unaryReq())
	require.NoError(t, err)
	require.Len(t, rec.records, 1)
	require.Equal(t, slog.LevelDebug, rec.records[0].Level)
}
