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

package push_test

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/mikeki/ocf-ims/lib/push"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTestSubscription builds a subscription with real, encryptable client keys
// (a valid P-256 public point for p256dh and a 16-byte auth secret) pointed at
// the given endpoint, so the library's payload encryption succeeds and we
// actually exercise the HTTP round-trip.
func newTestSubscription(t *testing.T, endpoint string) push.Subscription {
	t.Helper()
	priv, err := ecdh.P256().GenerateKey(rand.Reader)
	require.NoError(t, err)
	auth := make([]byte, 16)
	_, err = rand.Read(auth)
	require.NoError(t, err)
	return push.Subscription{
		Endpoint: endpoint,
		P256dh:   base64.RawURLEncoding.EncodeToString(priv.PublicKey().Bytes()),
		Auth:     base64.RawURLEncoding.EncodeToString(auth),
	}
}

func newTestSender(t *testing.T) *push.WebPushSender {
	t.Helper()
	priv, pub, err := webpush.GenerateVAPIDKeys()
	require.NoError(t, err)
	return push.NewWebPushSender(pub, priv, "mailto:ims@example.test")
}

func TestWebPushSenderSendStatusMapping(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		status int
		want   error // nil means require.NoError
		gone   bool
	}{
		{name: "201 accepted", status: http.StatusCreated},
		{name: "200 accepted", status: http.StatusOK},
		{name: "404 gone", status: http.StatusNotFound, gone: true},
		{name: "410 gone", status: http.StatusGone, gone: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var gotMethod string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotMethod = r.Method
				w.WriteHeader(tc.status)
			}))
			defer srv.Close()

			sender := newTestSender(t)
			err := sender.Send(t.Context(), newTestSubscription(t, srv.URL), push.Message{
				Title: "OCF IMS", Body: "You were mentioned in incident #12", URL: "/ims/app",
			})

			assert.Equal(t, http.MethodPost, gotMethod, "web push is delivered as a POST")
			if tc.gone {
				assert.ErrorIs(t, err, push.ErrSubscriptionGone)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestWebPushSenderSendTransientError(t *testing.T) {
	t.Parallel()
	// A 5xx from the push service is a transient failure: not nil, but not the
	// prune-me ErrSubscriptionGone either.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	sender := newTestSender(t)
	err := sender.Send(t.Context(), newTestSubscription(t, srv.URL), push.Message{Title: "t", Body: "b", URL: "/ims/app"})
	require.Error(t, err)
	assert.NotErrorIs(t, err, push.ErrSubscriptionGone)
}

func TestWebPushSenderEnabled(t *testing.T) {
	t.Parallel()
	assert.True(t, newTestSender(t).Enabled())
}
