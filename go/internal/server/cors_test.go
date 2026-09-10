// SPDX-License-Identifier: Apache-2.0

package server_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/stretchr/testify/require"
)

// TestCORSDisabledIsIdentity: an empty allow-list must return the very handler it is given —
// not a wrapper that happens to add nothing — so the production wiring is provably unchanged.
func TestCORSDisabledIsIdentity(t *testing.T) {
	t.Parallel()
	var reached bool
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { reached = true })

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "/x", http.NoBody)
	req.Header.Set("Origin", "http://localhost:8081")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	server.CORS(nil)(next).ServeHTTP(rec, req)

	require.True(t, reached, "the identity adapter passes everything through, preflights included")
	require.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"))
	require.False(t, server.CORSEnabled(nil))
	require.True(t, server.CORSEnabled([]string{"http://localhost:8081"}))
}

// TestCORSPolicy pins the policy the adapter applies (plan 09j): exact-origin echo with
// credentials, GET+POST, the Connect + Authorization + X-Request-Id request headers, and the
// exposed response headers a client must read. The preflight is answered without reaching
// the wrapped handler; an actual request from an unlisted origin reaches it but gets no grant.
func TestCORSPolicy(t *testing.T) {
	t.Parallel()
	const origin = "http://localhost:8081"
	var reached int
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached++
		w.WriteHeader(http.StatusTeapot)
	})
	h := server.CORS([]string{origin})(next)

	// Browser-shaped preflight: the Fetch spec has the browser send the requested header
	// names byte-lowercased, sorted and de-duplicated, and rs/cors ≥ 1.11 checks exactly
	// that form (a capitalised or unsorted list is refused — see the note on server.CORS).
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "/x", http.NoBody)
	req.Header.Set("Origin", origin)
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "authorization, connect-protocol-version, x-request-id")
	h.ServeHTTP(rec, req)
	require.Zero(t, reached, "a preflight is answered by the adapter")
	require.Equal(t, http.StatusNoContent, rec.Code)
	require.Equal(t, origin, rec.Header().Get("Access-Control-Allow-Origin"))
	require.Equal(t, "true", rec.Header().Get("Access-Control-Allow-Credentials"))
	require.Equal(t, http.MethodPost, rec.Header().Get("Access-Control-Allow-Methods"))
	require.Equal(t, "authorization, connect-protocol-version, x-request-id", rec.Header().Get("Access-Control-Allow-Headers"))
	require.Equal(t, "600", rec.Header().Get("Access-Control-Max-Age"))

	// A header outside the allow-list makes the whole preflight fail (no grant at all).
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodOptions, "/x", http.NoBody)
	req.Header.Set("Origin", origin)
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "authorization, x-not-allowed")
	h.ServeHTTP(rec, req)
	require.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"))

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/x", http.NoBody)
	req.Header.Set("Origin", origin)
	h.ServeHTTP(rec, req)
	require.Equal(t, 1, reached)
	require.Equal(t, http.StatusTeapot, rec.Code, "the wrapped handler's status is untouched")
	require.Equal(t, origin, rec.Header().Get("Access-Control-Allow-Origin"))
	exposed := rec.Header().Get("Access-Control-Expose-Headers")
	for _, want := range []string{"Grpc-Status", "X-Request-Id", "Retry-After", "Content-Disposition"} {
		require.Contains(t, exposed, want)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/x", http.NoBody)
	req.Header.Set("Origin", "http://other.example.org")
	h.ServeHTTP(rec, req)
	require.Equal(t, 2, reached, "an unlisted origin's actual request still reaches the handler (the browser enforces)")
	require.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"))
}
