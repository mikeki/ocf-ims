// SPDX-License-Identifier: Apache-2.0

package api_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mikeki/ocf-ims/api"
	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/gen/ocf/ims/service/v1/servicev1connect"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/store/actionlog"
	"github.com/stretchr/testify/require"
)

// The dev-CORS tests for slice 3a.0 (plan 09j / 09i E9). They stand up BOTH muxes — the REST
// blob routes (AddToMux) and the Connect prefix (AddConnectToMux) — exactly as serve.go wires
// them, with no database: every request here is answered before any handler touches storage
// (a preflight never reaches a handler; an actual request without a Bearer is rejected by
// RequireAuthN / the domain method first). The point is the HEADERS, and that they land on
// those early rejections too.

const (
	devOrigin   = "http://localhost:8081"
	otherOrigin = "http://evil.example.org"
)

// newCORSTestServer wires the production route tables with the given allow-list and returns
// the server URL. A nil allow-list is the production shape: CORS off.
func newCORSTestServer(t *testing.T, allowedOrigins []string) string {
	t.Helper()
	cfg := conf.DefaultIMS()
	cfg.Core.CORSAllowedOrigins = allowedOrigins
	require.NoError(t, cfg.Validate())
	logger := actionlog.NewLogger(context.Background(), nil, false, false)
	// AddToMux dereferences the SSE hub at registration time; the privacy oracle is never
	// consulted here because no request reaches a publishing handler.
	es := server.NewEventSourcerer(func(context.Context, int32, int32) (bool, error) { return false, nil })
	t.Cleanup(es.Server.Close)

	mux := api.AddToMux(http.NewServeMux(), es, cfg, nil, nil, nil, logger)
	api.AddConnectToMux(mux, cfg, nil, logger, nil, nil, nil, nil, nil, nil)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv.URL
}

// send performs req and returns just the status and headers — the body is never of
// interest here and is closed before returning.
func send(t *testing.T, req *http.Request) (int, http.Header) {
	t.Helper()
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	return resp.StatusCode, resp.Header
}

// preflight sends a browser-shaped CORS preflight for method on path from origin. The
// requested header names are lowercase and sorted, as the Fetch spec has browsers send them
// (rs/cors ≥ 1.11 insists on that form — see server.CORS).
func preflight(t *testing.T, serverURL, path, origin, method string) (int, http.Header) {
	t.Helper()
	req, err := http.NewRequestWithContext(context.Background(), http.MethodOptions, serverURL+path, http.NoBody)
	require.NoError(t, err)
	req.Header.Set("Origin", origin)
	req.Header.Set("Access-Control-Request-Method", method)
	req.Header.Set("Access-Control-Request-Headers", "authorization, connect-protocol-version, content-type")
	return send(t, req)
}

// actual sends a cross-origin actual request (no credentials) for method on path.
func actual(t *testing.T, serverURL, path, origin, method, contentType, body string) (int, http.Header) {
	t.Helper()
	req, err := http.NewRequestWithContext(context.Background(), method, serverURL+path, strings.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Origin", origin)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	return send(t, req)
}

// requireCORSAllowed asserts the headers a browser needs to accept a credentialed
// cross-origin response from origin.
func requireCORSAllowed(t *testing.T, h http.Header, origin string) {
	t.Helper()
	require.Equal(t, origin, h.Get("Access-Control-Allow-Origin"))
	require.Equal(t, "true", h.Get("Access-Control-Allow-Credentials"))
}

// requireNoCORS asserts that no Access-Control-* header at all was emitted.
func requireNoCORS(t *testing.T, h http.Header) {
	t.Helper()
	for name := range h {
		require.False(t, strings.HasPrefix(name, "Access-Control-"), "unexpected CORS header %s", name)
	}
}

// TestCORSConnectPrefix proves the policy on the Connect prefix: a preflight from an allowed
// origin is answered with the origin echoed, credentials allowed, and the request headers
// Connect + Bearer auth need; an actual call carries the origin, credentials and the exposed
// headers a client must read (the request id, Retry-After for the throttle). A disallowed
// origin gets no Access-Control-Allow-Origin, on either.
func TestCORSConnectPrefix(t *testing.T) {
	t.Parallel()
	serverURL := newCORSTestServer(t, []string{devOrigin})

	status, h := preflight(t, serverURL, servicev1connect.ImsServiceLoginProcedure, devOrigin, http.MethodPost)
	require.Equal(t, http.StatusNoContent, status)
	requireCORSAllowed(t, h, devOrigin)
	allowHeaders := strings.ToLower(h.Get("Access-Control-Allow-Headers"))
	for _, want := range []string{"authorization", "connect-protocol-version", "content-type"} {
		require.Contains(t, allowHeaders, want)
	}
	require.Contains(t, h.Get("Access-Control-Allow-Methods"), http.MethodPost)
	require.NotEmpty(t, h.Get("Access-Control-Max-Age"))

	// An actual (anonymous) call: GetAuthStatus answers 200 for anyone.
	status, h = actual(t, serverURL, servicev1connect.ImsServiceGetAuthStatusProcedure, devOrigin,
		http.MethodPost, "application/json", "{}")
	require.Equal(t, http.StatusOK, status)
	requireCORSAllowed(t, h, devOrigin)
	exposed := strings.ToLower(h.Get("Access-Control-Expose-Headers"))
	for _, want := range []string{"x-request-id", "retry-after"} {
		require.Contains(t, exposed, want)
	}

	// A rejected RPC still carries the headers, so the browser can read the error rather
	// than reporting an opaque CORS failure.
	status, h = actual(t, serverURL, servicev1connect.ImsServiceListEventsProcedure, devOrigin,
		http.MethodPost, "application/json", "{}")
	require.Equal(t, http.StatusUnauthorized, status)
	requireCORSAllowed(t, h, devOrigin)

	// Not on the list: no Allow-Origin on the preflight or the actual request.
	_, h = preflight(t, serverURL, servicev1connect.ImsServiceLoginProcedure, otherOrigin, http.MethodPost)
	require.Empty(t, h.Get("Access-Control-Allow-Origin"))
	_, h = actual(t, serverURL, servicev1connect.ImsServiceGetAuthStatusProcedure, otherOrigin,
		http.MethodPost, "application/json", "{}")
	require.Empty(t, h.Get("Access-Control-Allow-Origin"))
}

// TestCORSBlobRoutes proves the six plain-HTTP blob routes (M8) are covered: their
// method-specific mux patterns cannot see an OPTIONS request, so the preflight is answered by
// the OPTIONS /ims/api/ route; the actual request carries the headers even on the 401 that
// RequireAuthN answers for a missing Bearer (the adapter is outermost); and the downloads
// expose Content-Disposition. A non-preflight OPTIONS still 405s as it always did.
func TestCORSBlobRoutes(t *testing.T) {
	t.Parallel()
	serverURL := newCORSTestServer(t, []string{devOrigin})

	for _, path := range []string{
		"/ims/api/events/E/incidents/1/attachments",
		"/ims/api/events/E/incidents/1/attachments/1",
		"/ims/api/events/E/reports/1/attachments",
		"/ims/api/events/E/reports/1/attachments/1",
		"/ims/api/auth/picture",
		"/ims/api/personnel/1/picture",
	} {
		status, h := preflight(t, serverURL, path, devOrigin, http.MethodPost)
		require.Equal(t, http.StatusNoContent, status, path)
		requireCORSAllowed(t, h, devOrigin)
	}

	status, h := actual(t, serverURL, "/ims/api/personnel/1/picture", devOrigin, http.MethodGet, "", "")
	require.Equal(t, http.StatusUnauthorized, status)
	requireCORSAllowed(t, h, devOrigin)
	require.Contains(t, strings.ToLower(h.Get("Access-Control-Expose-Headers")), "content-disposition")

	// OPTIONS without Access-Control-Request-Method is not a preflight: it falls through the
	// catch-all to the same 405 the mux answered before CORS existed.
	req, err := http.NewRequestWithContext(context.Background(), http.MethodOptions,
		serverURL+"/ims/api/personnel/1/picture", http.NoBody)
	require.NoError(t, err)
	status, _ = send(t, req)
	require.Equal(t, http.StatusMethodNotAllowed, status)
}

// TestCORSScopedToConnectAndBlobs proves the policy is NOT applied beyond its scope: the SSE
// stream (cookie-authenticated, browser EventSource — not something a foreign origin should
// subscribe to) and the liveness probe get no CORS headers even from an allowed origin.
func TestCORSScopedToConnectAndBlobs(t *testing.T) {
	t.Parallel()
	serverURL := newCORSTestServer(t, []string{devOrigin})

	status, h := actual(t, serverURL, "/ims/api/eventsource", devOrigin, http.MethodGet, "", "")
	require.Equal(t, http.StatusUnauthorized, status)
	requireNoCORS(t, h)

	status, h = actual(t, serverURL, "/ims/api/ping", devOrigin, http.MethodGet, "", "")
	require.Equal(t, http.StatusOK, status)
	requireNoCORS(t, h)
}

// TestCORSOffByDefault proves the production shape: with no allow-list, no Access-Control-*
// header is emitted anywhere, no preflight route exists (OPTIONS on a blob route is the
// mux's 405, on the Connect prefix whatever connect-go answers — but never a CORS grant), and
// the ordinary responses are byte-identical to before the adapter existed.
func TestCORSOffByDefault(t *testing.T) {
	t.Parallel()
	serverURL := newCORSTestServer(t, nil)

	status, h := preflight(t, serverURL, "/ims/api/personnel/1/picture", devOrigin, http.MethodPost)
	require.Equal(t, http.StatusMethodNotAllowed, status)
	requireNoCORS(t, h)

	_, h = preflight(t, serverURL, servicev1connect.ImsServiceLoginProcedure, devOrigin, http.MethodPost)
	requireNoCORS(t, h)

	status, h = actual(t, serverURL, servicev1connect.ImsServiceGetAuthStatusProcedure, devOrigin,
		http.MethodPost, "application/json", "{}")
	require.Equal(t, http.StatusOK, status)
	requireNoCORS(t, h)

	status, h = actual(t, serverURL, "/ims/api/personnel/1/picture", devOrigin, http.MethodGet, "", "")
	require.Equal(t, http.StatusUnauthorized, status)
	requireNoCORS(t, h)
}
