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

package securityheaders_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mikeki/ocf-ims/lib/securityheaders"
	"github.com/stretchr/testify/require"
)

func TestHandlerSetsSecurityHeaders(t *testing.T) {
	t.Parallel()

	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("hi"))
	})
	rr := httptest.NewRecorder()
	securityheaders.Handler(inner).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/anything", nil))

	// The wrapped handler still runs and its status/body pass through.
	require.Equal(t, http.StatusTeapot, rr.Code)
	require.Equal(t, "hi", rr.Body.String())

	require.Equal(t, "nosniff", rr.Header().Get("X-Content-Type-Options"))
	require.Equal(t, "DENY", rr.Header().Get("X-Frame-Options"))
	require.Equal(t, "strict-origin-when-cross-origin", rr.Header().Get("Referrer-Policy"))

	// CSP ships report-only (observational) with a strict script-src; the
	// enforcing header must NOT be set yet.
	require.Empty(t, rr.Header().Get("Content-Security-Policy"))
	csp := rr.Header().Get("Content-Security-Policy-Report-Only")
	require.Contains(t, csp, "default-src 'self'")
	require.Contains(t, csp, "script-src 'self'")
	require.Contains(t, csp, "frame-ancestors 'none'")
	require.NotContains(t, csp, "script-src 'self' 'unsafe-inline'")

	// HSTS is a Caddy concern, not set by the app.
	require.Empty(t, rr.Header().Get("Strict-Transport-Security"))
}
