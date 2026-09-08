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

	"connectrpc.com/connect"
	servicerpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/gen/ocf/ims/service/v1/servicev1connect"
	authapi "github.com/mikeki/ocf-ims/internal/auth"

	"github.com/mikeki/ocf-ims/api"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestLoginRateLimit exercises plan 90's login throttle end to end over real HTTP. The throttle
// now lives on the Connect surface: the REST POST /auth and its ThrottleLogin middleware were
// retired in slice 1c, and the limiter is built inside AddConnectToMux from
// cfg.Core.LoginRateLimitEnabled. The shared suite disables it (many parallel tests fail logins
// from the same loopback address); this test spins up a dedicated Connect server with it enabled
// so the wiring — ResourceExhausted (429) + Retry-After after repeated failures, and that the
// throttle is scoped to Login and doesn't touch RefreshToken — is actually verified.
func TestLoginRateLimit(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	// A dedicated server with the login throttle turned on. Copy the shared config (which has it
	// off) and flip the flag; ConfigCore is a value, so the copy is independent.
	cfg := *shared.cfg
	cfg.Core.LoginRateLimitEnabled = true
	srv := httptest.NewServer(
		api.AddConnectToMux(nil, &cfg, shared.imsDBQ, shared.actionLogger, shared.userStore, shared.es, shared.metricsCache, nil, nil),
	)
	defer srv.Close()
	srvURL, err := url.Parse(srv.URL)
	require.NoError(t, err)

	apis := ApiHelper{t: t, serverURL: srvURL}
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, srv.URL)

	// Baseline: a valid login works while the limiter is armed but untriggered, and the success
	// leaves the per-IP/per-account counters clear for the loop below.
	code, _, token := apis.postAuth(ctx, authapi.PostAuthRequest{
		Identification: userAliceEmail,
		Password:       userAlicePassword,
	})
	require.Equal(t, http.StatusOK, code)
	require.NotEmpty(t, token)

	// Grab a valid refresh cookie from a clean login to prove later that throttling Login never
	// blocks RefreshToken (a different, cookie-authenticated RPC).
	loginResp, err := client.Login(ctx, connect.NewRequest(&servicerpcv1.LoginRequest{
		Email:    userAliceEmail,
		Password: userAlicePassword,
	}))
	require.NoError(t, err)
	refreshCookie, err := http.ParseSetCookie(loginResp.Header().Get("Set-Cookie"))
	require.NoError(t, err)

	// Hammer with wrong-password attempts for a valid email. The first few return Unauthenticated
	// (bad credentials); once backoff/lockout engages Login sheds with ResourceExhausted +
	// Retry-After, before ever reaching the password verify. Rapid consecutive failures hit the
	// exponential backoff well before the hard lockout ceiling, so a dozen attempts is more than
	// enough to observe a throttle.
	var gotThrottled bool
	var retryAfter string
	for i := range 12 {
		_, err := client.Login(ctx, connect.NewRequest(&servicerpcv1.LoginRequest{
			Email:    userAliceEmail,
			Password: "definitely-not-the-password",
		}))
		require.Error(t, err)
		if connect.CodeOf(err) == connect.CodeResourceExhausted {
			gotThrottled = true
			var connectErr *connect.Error
			require.ErrorAs(t, err, &connectErr)
			retryAfter = connectErr.Meta().Get("Retry-After")
			break
		}
		require.Equalf(t, connect.CodeUnauthenticated, connect.CodeOf(err),
			"attempt %d before throttling should be unauthenticated", i)
	}
	require.True(t, gotThrottled, "repeated failed logins should eventually be throttled")
	require.NotEmpty(t, retryAfter, "a throttled response must carry a Retry-After")
	secs, err := strconv.Atoi(retryAfter)
	require.NoError(t, err)
	assert.Positive(t, secs)

	// The correct password is now also throttled from this IP (the per-IP counter is tripped) —
	// confirming the shed happens before the verify.
	code, _, _ = apis.postAuth(ctx, authapi.PostAuthRequest{
		Identification: userAliceEmail,
		Password:       userAlicePassword,
	})
	assert.Equal(t, http.StatusTooManyRequests, code)

	// But RefreshToken is untouched by the login throttle: a previously issued refresh cookie
	// still mints a fresh access token.
	refreshCode, refreshResp := apis.refreshAccessToken(ctx, refreshCookie)
	assert.Equal(t, http.StatusOK, refreshCode)
	require.NotNil(t, refreshResp)
	assert.NotEmpty(t, refreshResp.Token)
}
