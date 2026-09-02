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

package integration_test

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"

	authapi "github.com/mikeki/ocf-ims/internal/auth"

	"github.com/mikeki/ocf-ims/api"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestLoginRateLimit exercises plan 90's login throttle end to end over real HTTP.
// The shared suite disables the limiter (many parallel tests fail logins from the
// same loopback address); this test spins up a dedicated server with it enabled so
// the wiring — 429 + Retry-After after repeated failures, and that the throttle is
// scoped to /auth and doesn't touch /auth/refresh — is actually verified.
func TestLoginRateLimit(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	// A dedicated server with the login throttle turned on. Copy the shared config
	// (which has it off) and flip the flag; ConfigCore is a value, so the copy is
	// independent.
	cfg := *shared.cfg
	cfg.Core.LoginRateLimitEnabled = true
	srv := httptest.NewServer(
		api.AddToMux(nil, shared.es, shared.metricsCache, &cfg, shared.imsDBQ, shared.userStore, nil, shared.actionLogger, nil),
	)
	defer srv.Close()
	srvURL, err := url.Parse(srv.URL)
	require.NoError(t, err)

	client := ApiHelper{t: t, serverURL: srvURL}

	// Baseline: a valid login works while the limiter is armed but untriggered, and
	// the success leaves the per-IP/per-account counters clear for the loop below.
	code, _, token := client.postAuth(ctx, authapi.PostAuthRequest{
		Identification: userAliceEmail,
		Password:       userAlicePassword,
	})
	require.Equal(t, http.StatusOK, code)
	require.NotEmpty(t, token)

	// Grab a valid refresh cookie from a clean login to prove later that throttling
	// /auth never blocks /auth/refresh (a different, cookie-authenticated route).
	loginResp := client.imsPost(ctx, authapi.PostAuthRequest{
		Identification: userAliceEmail,
		Password:       userAlicePassword,
	}, srvURL.JoinPath("/ims/api/auth").String())
	require.Equal(t, http.StatusOK, loginResp.StatusCode)
	refreshCookie, err := http.ParseSetCookie(loginResp.Header.Get("Set-Cookie"))
	require.NoError(t, err)
	require.NoError(t, loginResp.Body.Close())

	// Hammer the endpoint with wrong-password attempts for a valid handle. The first
	// few return 401 (bad credentials); once backoff/lockout engages the endpoint
	// sheds with 429 + Retry-After, before ever reaching the password verify.
	// Rapid consecutive failures hit the exponential backoff well before the hard
	// lockout ceiling, so a dozen attempts is more than enough to observe a 429.
	var got429 bool
	var retryAfter string
	for i := range 12 {
		resp := client.imsPost(ctx, authapi.PostAuthRequest{
			Identification: userAliceEmail,
			Password:       "definitely-not-the-password",
		}, srvURL.JoinPath("/ims/api/auth").String())
		status := resp.StatusCode
		ra := resp.Header.Get("Retry-After")
		require.NoError(t, resp.Body.Close())
		if status == http.StatusTooManyRequests {
			got429 = true
			retryAfter = ra
			break
		}
		require.Equal(t, http.StatusUnauthorized, status, "attempt %d before throttling should be 401", i)
	}
	require.True(t, got429, "repeated failed logins should eventually be throttled with 429")
	require.NotEmpty(t, retryAfter, "a throttled response must carry a Retry-After header")
	secs, err := strconv.Atoi(retryAfter)
	require.NoError(t, err)
	assert.Positive(t, secs)

	// The correct password is now also throttled from this IP (the per-IP counter is
	// tripped) — confirming the shed happens before the verify.
	code, _, _ = client.postAuth(ctx, authapi.PostAuthRequest{
		Identification: userAliceEmail,
		Password:       userAlicePassword,
	})
	assert.Equal(t, http.StatusTooManyRequests, code)

	// But the refresh route is untouched by the login throttle: a previously issued
	// refresh cookie still mints a fresh access token.
	refreshCode, refreshResp := client.refreshAccessToken(ctx, refreshCookie)
	assert.Equal(t, http.StatusOK, refreshCode)
	require.NotNil(t, refreshResp)
	assert.NotEmpty(t, refreshResp.Token)
}
