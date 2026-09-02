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
	"database/sql"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/mikeki/ocf-ims/api"
	pushapi "github.com/mikeki/ocf-ims/internal/push"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/push"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"github.com/stretchr/testify/assert"
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

	sub := func(endpoint, p256dh, auth string) pushapi.PushSubscribeRequest {
		req := pushapi.PushSubscribeRequest{Endpoint: endpoint}
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
	resp = alice.pushUnsubscribe(ctx, pushapi.PushUnsubscribeRequest{Endpoint: daveEndpoint})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, _, found = pushSubByEndpoint(ctx, t, userDavePersonID, daveEndpoint)
	require.True(t, found, "Alice must not be able to remove Dave's device")

	// Alice removes her first device -> gone; her second remains.
	resp = alice.pushUnsubscribe(ctx, pushapi.PushUnsubscribeRequest{Endpoint: endpoint1})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	_, _, found = pushSubByEndpoint(ctx, t, userAlicePersonID, endpoint1)
	require.False(t, found)
	_, _, found = pushSubByEndpoint(ctx, t, userAlicePersonID, endpoint2)
	require.True(t, found)

	// Unsubscribing an unknown endpoint is an idempotent no-op (still 204).
	resp = alice.pushUnsubscribe(ctx, pushapi.PushUnsubscribeRequest{Endpoint: endpoint1})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

// capturedSend records one Send the spy was asked to perform.
type capturedSend struct {
	sub push.Subscription
	msg push.Message
}

// capturingSender is a push.Sender test double that records every Send and can be
// switched to report subscriptions as permanently gone (404/410), to drive the
// fan-out's prune path. Safe for concurrent use — sends arrive from the
// background deliver goroutine.
type capturingSender struct {
	mu    sync.Mutex
	sends []capturedSend
	gone  bool
}

func (s *capturingSender) Enabled() bool { return true }

func (s *capturingSender) Send(_ context.Context, sub push.Subscription, msg push.Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sends = append(s.sends, capturedSend{sub: sub, msg: msg})
	if s.gone {
		return push.ErrSubscriptionGone
	}
	return nil
}

func (s *capturingSender) setGone(gone bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.gone = gone
}

// sendsTo returns the messages sent to a given endpoint so far. Keying on the
// test's own (unique) endpoint isolates it from any other device the shared
// recipient might have.
func (s *capturingSender) sendsTo(endpoint string) []push.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []push.Message
	for _, c := range s.sends {
		if c.sub.Endpoint == endpoint {
			out = append(out, c.msg)
		}
	}
	return out
}

// TestPushFanoutDelivery exercises plan 84c's send fan-out end to end through the
// real HTTP + DB path, on a dedicated server wired with a capturing sender (the
// shared suite server uses the no-op backend). It covers the parts the unit tests
// can't: that a journal-entry @mention actually loads the recipient's stored
// subscription and sends to it, and that a subscription the push service reports
// gone is pruned from the database.
func TestPushFanoutDelivery(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	// A dedicated server so this test's pushes go to our spy, not the shared
	// suite's no-op sender, and so other parallel tests' triggers don't reach it.
	spy := &capturingSender{}
	srv := httptest.NewServer(
		api.AddToMux(nil, shared.es, shared.metricsCache, shared.cfg, shared.imsDBQ, shared.userStore, nil, shared.actionLogger, spy),
	)
	defer srv.Close()
	srvURL, err := url.Parse(srv.URL)
	require.NoError(t, err)

	admin := ApiHelper{t: t, serverURL: srvURL, jwt: jwtForAdmin(ctx, t)}
	alice := ApiHelper{t: t, serverURL: srvURL, jwt: jwtForAlice(t, ctx)}

	eventName := rand.NonCryptoText()
	_, resp := admin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	resp = admin.addWriter(ctx, eventName, userAliceHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The recipient is Bob: no other test subscribes a device for him, so his only
	// device is the one we seed here — keeping the spy's view clean.
	endpoint := "https://push.test/" + rand.NonCryptoText()
	require.NoError(t, shared.imsDBQ.InsertPushSubscription(ctx, shared.imsDBQ, imsdb.InsertPushSubscriptionParams{
		PersonID:  userBobPersonID,
		Endpoint:  endpoint,
		P256dh:    "p256dh-bob",
		Auth:      "auth-bob",
		UserAgent: sql.NullString{},
		Created:   1,
	}))

	// Alice (the author/actor) creates an incident whose journal entry @mentions
	// Bob -> Bob's device should receive exactly one push.
	num := alice.newIncidentSuccess(ctx, imsjson.Incident{
		Event: eventName,
		JournalEntries: []imsjson.JournalEntry{{
			Text:               "Paging @" + userBobHandle + " here.",
			MentionedPersonIDs: []int32{userBobPersonID},
		}},
	})

	// Fan-out runs in a background goroutine after commit, so poll for it.
	require.EventuallyWithT(t, func(c *assert.CollectT) {
		msgs := spy.sendsTo(endpoint)
		assert.Len(c, msgs, 1)
	}, 5*time.Second, 20*time.Millisecond)

	got := spy.sendsTo(endpoint)
	require.Len(t, got, 1)
	assert.Equal(t, "OCF IMS", got[0].Title)
	assert.Contains(t, got[0].Body, "incident #")
	// The deep link points at the incident we just created.
	assert.Equal(t, "/ims/app/events/"+eventName+"/incidents/"+strconv.Itoa(int(num)), got[0].URL)

	// Now the push service reports Bob's device gone: a fresh mention's fan-out
	// must prune the stored subscription.
	spy.setGone(true)
	_ = alice.newIncidentSuccess(ctx, imsjson.Incident{
		Event: eventName,
		JournalEntries: []imsjson.JournalEntry{{
			Text:               "Still need @" + userBobHandle + ".",
			MentionedPersonIDs: []int32{userBobPersonID},
		}},
	})

	require.EventuallyWithT(t, func(c *assert.CollectT) {
		_, _, found := pushSubByEndpoint(ctx, t, userBobPersonID, endpoint)
		assert.False(c, found, "a 404/410 from the push service must prune the subscription")
	}, 5*time.Second, 20*time.Millisecond)
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
			req := pushapi.PushSubscribeRequest{Endpoint: endpoint}
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
