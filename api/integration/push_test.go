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
	"context"
	"net/http"
	"sync"
	"testing"

	"github.com/mikeki/ocf-ims/api"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
)

// pushSubByEndpoint returns the caller-person's stored subscription for an
// endpoint, or false if absent. Subscriptions are global per person and these
// seed users are shared across parallel tests, so a test must key on its own
// (unique) endpoints rather than asserting a total count.
func pushSubByEndpoint(ctx context.Context, t *testing.T, personID int32, endpoint string) (string, string, bool) {
	t.Helper()
	rows, err := shared.imsDBQ.PushSubscriptionsForPerson(ctx, shared.imsDBQ, personID)
	require.NoError(t, err)
	for _, r := range rows {
		if r.Endpoint == endpoint {
			return r.P256dh, r.Auth, true
		}
	}
	return "", "", false
}

// TestPushSubscriptions exercises plan 84a's subscribe/unsubscribe API end to
// end: storing a device, upserting on re-subscribe, isolating devices and
// people, validation, and idempotent unsubscribe.
func TestPushSubscriptions(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	alice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	dave := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForDave(t, ctx)}

	// Unique endpoints so assertions don't collide with any other test's devices.
	endpoint1 := "https://push.test/" + rand.NonCryptoText()
	endpoint2 := "https://push.test/" + rand.NonCryptoText()
	daveEndpoint := "https://push.test/" + rand.NonCryptoText()

	sub := func(endpoint, p256dh, auth string) api.PushSubscribeRequest {
		req := api.PushSubscribeRequest{Endpoint: endpoint}
		req.Keys.P256dh = p256dh
		req.Keys.Auth = auth
		return req
	}

	// Alice subscribes a device -> stored with its keys.
	resp := alice.pushSubscribe(ctx, sub(endpoint1, "p256dh-1", "auth-1"))
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	p256, auth, found := pushSubByEndpoint(ctx, t, userAlicePersonID, endpoint1)
	require.True(t, found)
	require.Equal(t, "p256dh-1", p256)
	require.Equal(t, "auth-1", auth)

	// Re-subscribing the SAME endpoint upserts (refreshed keys, still one device).
	resp = alice.pushSubscribe(ctx, sub(endpoint1, "p256dh-1b", "auth-1b"))
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	p256, auth, found = pushSubByEndpoint(ctx, t, userAlicePersonID, endpoint1)
	require.True(t, found)
	require.Equal(t, "p256dh-1b", p256)
	require.Equal(t, "auth-1b", auth)

	// A second device is a separate subscription.
	resp = alice.pushSubscribe(ctx, sub(endpoint2, "p256dh-2", "auth-2"))
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, _, found = pushSubByEndpoint(ctx, t, userAlicePersonID, endpoint2)
	require.True(t, found)

	// A subscription missing an endpoint or keys is rejected.
	resp = alice.pushSubscribe(ctx, sub("", "p256dh", "auth"))
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = alice.pushSubscribe(ctx, sub("https://push.test/"+rand.NonCryptoText(), "", ""))
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Dave subscribes his own device.
	resp = dave.pushSubscribe(ctx, sub(daveEndpoint, "p256dh-d", "auth-d"))
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Re-homing a shared browser is deliberate and safe (see PostPushSubscribe):
	// when a second person subscribes the SAME endpoint, ownership transfers to the
	// latest subscriber with their own keys — this is what prevents a kiosk's prior
	// user from still receiving pushes on it.
	sharedEndpoint := "https://push.test/" + rand.NonCryptoText()
	resp = dave.pushSubscribe(ctx, sub(sharedEndpoint, "p256dh-d", "auth-d"))
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = alice.pushSubscribe(ctx, sub(sharedEndpoint, "p256dh-a", "auth-a"))
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, _, found = pushSubByEndpoint(ctx, t, userDavePersonID, sharedEndpoint)
	require.False(t, found, "re-subscribe must re-home the device off the prior owner")
	p256, auth, found = pushSubByEndpoint(ctx, t, userAlicePersonID, sharedEndpoint)
	require.True(t, found)
	require.Equal(t, "p256dh-a", p256, "re-home adopts the new subscriber's keys")
	require.Equal(t, "auth-a", auth)

	// Unsubscribe is caller-scoped: Alice trying to remove Dave's endpoint is a
	// no-op for Dave's device (still present).
	resp = alice.pushUnsubscribe(ctx, api.PushUnsubscribeRequest{Endpoint: daveEndpoint})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, _, found = pushSubByEndpoint(ctx, t, userDavePersonID, daveEndpoint)
	require.True(t, found, "Alice must not be able to remove Dave's device")

	// Alice removes her first device -> gone; her second remains.
	resp = alice.pushUnsubscribe(ctx, api.PushUnsubscribeRequest{Endpoint: endpoint1})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, _, found = pushSubByEndpoint(ctx, t, userAlicePersonID, endpoint1)
	require.False(t, found)
	_, _, found = pushSubByEndpoint(ctx, t, userAlicePersonID, endpoint2)
	require.True(t, found)

	// Unsubscribing an unknown endpoint is an idempotent no-op (still 204).
	resp = alice.pushUnsubscribe(ctx, api.PushUnsubscribeRequest{Endpoint: endpoint1})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

// TestPushSubscribeConcurrentSameEndpoint hammers the read-first upsert with many
// simultaneous subscribes of the SAME brand-new endpoint (two tabs / a retry).
// The read-then-insert race must resolve idempotently — every request gets 204
// and exactly one row exists — not a 500 from the ENDPOINT unique constraint.
func TestPushSubscribeConcurrentSameEndpoint(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	alice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}
	endpoint := "https://push.test/" + rand.NonCryptoText()

	const n = 8
	var wg sync.WaitGroup
	codes := make([]int, n)
	closeErrs := make([]error, n)
	for i := range n {
		wg.Go(func() {
			req := api.PushSubscribeRequest{Endpoint: endpoint}
			req.Keys.P256dh = "p256dh"
			req.Keys.Auth = "auth"
			resp := alice.pushSubscribe(ctx, req)
			codes[i] = resp.StatusCode
			closeErrs[i] = resp.Body.Close()
		})
	}
	wg.Wait()

	// Assert on the test goroutine (require must not run in a spawned one).
	for i := range n {
		require.NoErrorf(t, closeErrs[i], "request %d body close", i)
		require.Equalf(t, http.StatusNoContent, codes[i], "request %d should be idempotent", i)
	}

	// Exactly one row for that endpoint survives the race.
	rows, err := shared.imsDBQ.PushSubscriptionsForPerson(ctx, shared.imsDBQ, userAlicePersonID)
	require.NoError(t, err)
	count := 0
	for _, r := range rows {
		if r.Endpoint == endpoint {
			count++
		}
	}
	require.Equal(t, 1, count)
}
