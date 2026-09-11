// SPDX-License-Identifier: Apache-2.0

package server

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/golang-jwt/jwt/v5"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/stretchr/testify/require"
)

// The WatchEvent hub and stream (plan 09p slice 3b.0b). The security claims this
// slice makes are: a poke the subscriber may not see is never sent (S2), the
// check is re-run per poke rather than cached from subscribe (S3), a torn-down
// stream leaks nothing, and an expired token ends the stream. Each has a test.

// allowAll is a WatchPolicy that permits everything — the baseline for tests
// about mechanics rather than authorization.
func allowAll() WatchPolicy {
	return WatchPolicy{
		MayWatch: func(context.Context, *authz.IMSClaims, int32) error { return nil },
		Visible:  func(context.Context, *authz.IMSClaims, Poke) (bool, error) { return true, nil },
	}
}

// testClaims builds the claims the auth interceptor would have produced. An
// expired token is minted valid and then aged: AuthenticateJWT refuses to parse
// an expired one, and a real stream's claims go stale the same way.
func testClaims(t *testing.T, handle string, expiresIn time.Duration) *authz.IMSClaims {
	t.Helper()
	jwter := authz.JWTer{SecretKey: "unit-test-secret"}
	token, err := jwter.CreateAccessToken(handle, 42, nil, false, nil, time.Now().Add(time.Hour))
	require.NoError(t, err)
	claims, err := jwter.AuthenticateJWT(token)
	require.NoError(t, err)
	claims.ExpiresAt = jwt.NewNumericDate(time.Now().Add(expiresIn))
	return claims
}

// ctxWithClaims puts claims where the auth interceptor would have.
func ctxWithClaims(ctx context.Context, claims *authz.IMSClaims) context.Context {
	return context.WithValue(ctx, JWTContextKey, JWTContext{Claims: claims})
}

// collector receives what a stream sends.
type collector struct {
	mu    sync.Mutex
	sent  []*rpcv1.EventPoke
	fail  error
	ready chan struct{}
}

func newCollector() *collector { return &collector{ready: make(chan struct{}, 64)} }

func (c *collector) send(resp *rpcv1.WatchEventResponse) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.fail != nil {
		return c.fail
	}
	c.sent = append(c.sent, resp.GetPoke())
	select {
	case c.ready <- struct{}{}:
	default:
	}
	return nil
}

// all returns everything sent, heartbeats included.
func (c *collector) all() []*rpcv1.EventPoke {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]*rpcv1.EventPoke(nil), c.sent...)
}

// pokes returns only the change pokes. Every stream opens with an establishing
// heartbeat (see Stream), so tests about what was delivered ignore beats.
func (c *collector) pokes() []*rpcv1.EventPoke {
	var out []*rpcv1.EventPoke
	for _, p := range c.all() {
		if p.GetKind() != rpcv1.EventPokeKind_EVENT_POKE_KIND_HEARTBEAT {
			out = append(out, p)
		}
	}
	return out
}

// waitForPokes blocks until n non-heartbeat pokes have been sent.
func (c *collector) waitForPokes(t *testing.T, n int) {
	t.Helper()
	require.Eventually(t, func() bool { return len(c.pokes()) >= n }, 2*time.Second, time.Millisecond,
		"timed out waiting for %d pokes", n)
}

// waitForSends blocks until the stream has sent n messages, or fails the test.
func (c *collector) waitForSends(t *testing.T, n int) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		c.mu.Lock()
		got := len(c.sent)
		c.mu.Unlock()
		if got >= n {
			return
		}
		select {
		case <-c.ready:
		case <-deadline:
			t.Fatalf("timed out waiting for %d sends; got %d", n, got)
		}
	}
}

// runStream starts h.Stream in a goroutine and returns a cancel plus a channel
// carrying its final error.
func runStream(
	t *testing.T, h *WatchHub, claims *authz.IMSClaims, eventIDs []int32, c *collector,
) (context.CancelFunc, <-chan error) {
	t.Helper()
	ctx, cancel := context.WithCancel(ctxWithClaims(context.Background(), claims))
	done := make(chan error, 1)
	go func() {
		done <- h.Stream(ctx, &rpcv1.WatchEventRequest{EventIds: eventIDs}, c.send)
	}()
	// Subscribe happens synchronously at the top of Stream; wait for it so a
	// Publish from the test cannot race ahead of the subscriber existing.
	require.Eventually(t, func() bool { return h.Subscribers() == 1 }, 2*time.Second, time.Millisecond)
	return cancel, done
}

func TestWatchStreamDeliversAPoke(t *testing.T) {
	t.Parallel()
	h := NewWatchHub(allowAll())
	c := newCollector()
	cancel, done := runStream(t, h, testClaims(t, "bob", time.Hour), []int32{7}, c)
	defer cancel()

	h.Publish(Poke{EventID: 7, IncidentNumber: 12})
	c.waitForPokes(t, 1)

	got := c.pokes()[0]
	require.Equal(t, rpcv1.EventPokeKind_EVENT_POKE_KIND_INCIDENT_CHANGED, got.GetKind())
	require.Equal(t, int32(7), got.GetEventId())
	require.Equal(t, int32(12), got.GetIncidentNumber())
	require.NotNil(t, got.GetSent())

	cancel()
	require.NoError(t, <-done)
}

func TestWatchStreamIgnoresOtherEvents(t *testing.T) {
	t.Parallel()
	h := NewWatchHub(allowAll())
	c := newCollector()
	cancel, done := runStream(t, h, testClaims(t, "bob", time.Hour), []int32{7}, c)
	defer cancel()

	h.Publish(Poke{EventID: 8, IncidentNumber: 1}) // not watched
	h.Publish(Poke{EventID: 7, IncidentNumber: 2}) // watched
	c.waitForPokes(t, 1)

	pokes := c.pokes()
	require.Len(t, pokes, 1, "only the watched event's poke may arrive")
	require.Equal(t, int32(2), pokes[0].GetIncidentNumber())

	cancel()
	require.NoError(t, <-done)
}

// S2: a poke the subscriber may not see is never sent — and, just as important,
// no error or gap is sent either. Silence is the whole point: an error would
// tell the subscriber that something they may not see just changed.
func TestWatchStreamWithholdsInvisiblePokesSilently(t *testing.T) {
	t.Parallel()
	policy := allowAll()
	policy.Visible = func(_ context.Context, _ *authz.IMSClaims, poke Poke) (bool, error) {
		return poke.IncidentNumber != 99, nil // 99 is "private, not yours"
	}
	h := NewWatchHub(policy)
	c := newCollector()
	cancel, done := runStream(t, h, testClaims(t, "writer", time.Hour), []int32{7}, c)
	defer cancel()

	h.Publish(Poke{EventID: 7, IncidentNumber: 99}) // withheld
	h.Publish(Poke{EventID: 7, IncidentNumber: 12}) // delivered
	c.waitForPokes(t, 1)

	pokes := c.pokes()
	require.Len(t, pokes, 1)
	require.Equal(t, int32(12), pokes[0].GetIncidentNumber(),
		"the private incident's number must never reach the wire")

	cancel()
	require.NoError(t, <-done, "withholding a poke must not end or error the stream")
}

// S3: the check runs per poke, not once at subscribe. This is what notices an
// access revoked, or an incident marked private, while someone is watching.
func TestWatchStreamRechecksVisibilityOnEveryPoke(t *testing.T) {
	t.Parallel()
	var calls int
	var mu sync.Mutex
	policy := allowAll()
	policy.Visible = func(context.Context, *authz.IMSClaims, Poke) (bool, error) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		// Access is revoked after the first poke.
		return calls == 1, nil
	}
	h := NewWatchHub(policy)
	c := newCollector()
	cancel, done := runStream(t, h, testClaims(t, "bob", time.Hour), []int32{7}, c)
	defer cancel()

	h.Publish(Poke{EventID: 7, IncidentNumber: 1})
	c.waitForPokes(t, 1)
	h.Publish(Poke{EventID: 7, IncidentNumber: 2})
	h.Publish(Poke{EventID: 7, IncidentNumber: 3})

	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return calls == 3
	}, 2*time.Second, time.Millisecond, "every poke must be re-checked")
	require.Len(t, c.pokes(), 1, "pokes after the revocation must stop")

	cancel()
	require.NoError(t, <-done)
}

// A lookup failure must be treated as "not visible". Failing open here would
// mean a transient database error discloses a private incident's number.
func TestWatchStreamFailsClosedOnVisibilityError(t *testing.T) {
	t.Parallel()
	policy := allowAll()
	policy.Visible = func(context.Context, *authz.IMSClaims, Poke) (bool, error) {
		return true, errors.New("database on fire")
	}
	h := NewWatchHub(policy)
	c := newCollector()
	cancel, done := runStream(t, h, testClaims(t, "bob", time.Hour), []int32{7}, c)
	defer cancel()

	h.Publish(Poke{EventID: 7, IncidentNumber: 1})
	require.Eventually(t, func() bool { return h.Subscribers() == 1 }, time.Second, time.Millisecond)
	time.Sleep(50 * time.Millisecond) // let the poke be processed
	require.Empty(t, c.pokes(), "an error must withhold the poke, never deliver it")

	cancel()
	require.NoError(t, <-done)
}

// The subscribe gate is the one place a caller gets a real error, and it must
// stop the stream before any subscriber exists.
func TestWatchStreamSubscribeGateRejects(t *testing.T) {
	t.Parallel()
	policy := allowAll()
	policy.MayWatch = func(_ context.Context, _ *authz.IMSClaims, eventID int32) error {
		if eventID == 9 {
			return connect.NewError(connect.CodePermissionDenied, errors.New("nope"))
		}
		return nil
	}
	h := NewWatchHub(policy)
	c := newCollector()

	ctx := ctxWithClaims(context.Background(), testClaims(t, "bob", time.Hour))
	err := h.Stream(ctx, &rpcv1.WatchEventRequest{EventIds: []int32{7, 9}}, c.send)

	require.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
	require.Zero(t, h.Subscribers(), "a rejected subscribe must leave no subscriber behind")
}

func TestWatchStreamRequiresAuthentication(t *testing.T) {
	t.Parallel()
	h := NewWatchHub(allowAll())
	err := h.Stream(context.Background(), &rpcv1.WatchEventRequest{EventIds: []int32{7}}, newCollector().send)
	require.Equal(t, connect.CodeUnauthenticated, connect.CodeOf(err))
	require.Zero(t, h.Subscribers())
}

// The opening heartbeat is what establishes the stream: without it the client
// call blocks until something is published.
func TestWatchStreamOpensWithAHeartbeat(t *testing.T) {
	t.Parallel()
	h := NewWatchHub(allowAll())
	c := newCollector()
	cancel, done := runStream(t, h, testClaims(t, "bob", time.Hour), []int32{7}, c)
	defer cancel()

	c.waitForSends(t, 1)
	first := c.all()[0]
	require.Equal(t, rpcv1.EventPokeKind_EVENT_POKE_KIND_HEARTBEAT, first.GetKind(),
		"a stream must announce itself before anything is published")
	require.NotNil(t, first.GetSent())

	cancel()
	require.NoError(t, <-done)
}

// Open question 4, the reconnect case: a client that comes back without
// refreshing first never establishes a stream at all.
func TestWatchStreamRefusesAnAlreadyExpiredToken(t *testing.T) {
	t.Parallel()
	h := NewWatchHub(allowAll())
	c := newCollector()

	ctx := ctxWithClaims(context.Background(), testClaims(t, "bob", -time.Minute))
	err := h.Stream(ctx, &rpcv1.WatchEventRequest{EventIds: []int32{7}}, c.send)

	require.Equal(t, connect.CodeUnauthenticated, connect.CodeOf(err))
	require.Empty(t, c.all(), "an expired stream sends nothing at all, not even a heartbeat")
	require.Zero(t, h.Subscribers())
}

// Open question 4: a stream authenticates once and outlives its token; the
// claims the handler holds go stale underneath it.
func TestWatchStreamEndsWhenTheTokenExpiresMidStream(t *testing.T) {
	t.Parallel()
	h := NewWatchHub(allowAll())
	c := newCollector()
	claims := testClaims(t, "bob", time.Hour)
	cancel, done := runStream(t, h, claims, []int32{7}, c)
	defer cancel()
	c.waitForSends(t, 1) // the establishing heartbeat

	// The token the stream opened with runs out.
	claims.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Second))
	h.Publish(Poke{EventID: 7, IncidentNumber: 1})

	err := <-done
	require.Equal(t, connect.CodeUnauthenticated, connect.CodeOf(err))
	require.Empty(t, c.pokes(), "nothing is delivered on an expired token")
	require.Eventually(t, func() bool { return h.Subscribers() == 0 }, 2*time.Second, time.Millisecond)
}

// "a cancelled context tears the subscriber down and leaks no goroutine" — the
// acceptance test named in the 09p brief.
func TestWatchStreamCancellationTearsDownTheSubscriber(t *testing.T) {
	t.Parallel()
	h := NewWatchHub(allowAll())
	c := newCollector()
	cancel, done := runStream(t, h, testClaims(t, "bob", time.Hour), []int32{7}, c)

	require.Equal(t, 1, h.Subscribers())
	cancel()

	require.NoError(t, <-done, "a client going away is not an error")
	require.Zero(t, h.Subscribers(), "the subscriber must be detached, not merely idle")
}

// A subscriber that stops reading must be dropped rather than allowed to block
// the write that published the poke.
func TestWatchHubDropsASubscriberThatFallsBehind(t *testing.T) {
	t.Parallel()
	h := NewWatchHub(allowAll())
	session := h.Subscribe(testClaims(t, "slow", time.Hour), []int32{7})
	require.Equal(t, 1, h.Subscribers())

	// Nothing is draining this session, so overrun its buffer.
	for i := range watchBuffer + 5 {
		h.Publish(Poke{EventID: 7, IncidentNumber: int32(i + 1)})
	}

	require.Zero(t, h.Subscribers(), "the hub must drop a subscriber it cannot feed")
	require.Equal(t, connect.CodeResourceExhausted, connect.CodeOf(session.Reason()))
	// The handler's deferred Close must be safe after the hub already dropped it.
	require.NotPanics(t, session.Close)
}

func TestWatchHubCloseEndsEveryStream(t *testing.T) {
	t.Parallel()
	h := NewWatchHub(allowAll())
	c := newCollector()
	cancel, done := runStream(t, h, testClaims(t, "bob", time.Hour), []int32{7}, c)
	defer cancel()

	h.Close()

	err := <-done
	require.Equal(t, connect.CodeUnavailable, connect.CodeOf(err),
		"shutdown is Unavailable, not the fell-behind ResourceExhausted")
	require.Zero(t, h.Subscribers())
}

func TestWatchHubRequiresACompletePolicy(t *testing.T) {
	t.Parallel()
	require.Panics(t, func() { NewWatchHub(WatchPolicy{}) })
	require.Panics(t, func() {
		NewWatchHub(WatchPolicy{MayWatch: func(context.Context, *authz.IMSClaims, int32) error { return nil }})
	})
}

// A nil hub is what every existing EventSourcerer test has, and a publish
// through it must be a no-op rather than a panic.
func TestNilWatchHubPublishIsANoOp(t *testing.T) {
	t.Parallel()
	var h *WatchHub
	require.NotPanics(t, func() { h.Publish(Poke{EventID: 7, IncidentNumber: 1}) })
	require.Zero(t, h.Subscribers())
	require.NotPanics(t, h.Close)
}

func TestReportPokeCarriesItsNumber(t *testing.T) {
	t.Parallel()
	h := NewWatchHub(allowAll())
	c := newCollector()
	cancel, done := runStream(t, h, testClaims(t, "bob", time.Hour), []int32{7}, c)
	defer cancel()

	h.Publish(Poke{EventID: 7, ReportNumber: 3})
	c.waitForPokes(t, 1)

	got := c.pokes()[0]
	require.Equal(t, rpcv1.EventPokeKind_EVENT_POKE_KIND_REPORT_CHANGED, got.GetKind())
	require.Equal(t, int32(3), got.GetReportNumber())

	cancel()
	require.NoError(t, <-done)
}
