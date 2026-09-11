// SPDX-License-Identifier: Apache-2.0

package api_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/api"
	"github.com/mikeki/ocf-ims/conf"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/gen/ocf/ims/service/v1/servicev1connect"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/store/actionlog"
	"github.com/stretchr/testify/require"
)

// WatchEvent end to end (plan 09p 3b.0b): the real handler behind the real
// interceptor chain, over HTTP, driven by the generated client. Before 3b.0a
// this would have streamed with no claims in the handler's context. No
// database: the test supplies the WatchPolicy.

// newWatchTestClient stands up AddConnectToMux with a real WatchHub whose policy
// is supplied by the test, and returns the generated client plus the hub to
// publish through.
func newWatchTestClient(t *testing.T, policy server.WatchPolicy) (
	servicev1connect.ImsServiceClient, *server.WatchHub, authz.JWTer,
) {
	t.Helper()
	cfg := conf.DefaultIMS()
	logger := actionlog.NewLogger(context.Background(), nil, false, false)
	hub := server.NewWatchHub(policy)
	mux := api.AddConnectToMux(http.NewServeMux(), cfg, nil, logger, nil, nil, hub, nil, nil, nil)

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	return servicev1connect.NewImsServiceClient(srv.Client(), srv.URL),
		hub, authz.JWTer{SecretKey: cfg.Core.JWTSecret}
}

func watchAllowAll() server.WatchPolicy {
	return server.WatchPolicy{
		MayWatch: func(context.Context, *authz.IMSClaims, int32) error { return nil },
		Visible:  func(context.Context, *authz.IMSClaims, server.Poke) (bool, error) { return true, nil },
	}
}

func bearerFor(t *testing.T, jwter authz.JWTer, handle string) string {
	t.Helper()
	token, err := jwter.CreateAccessToken(handle, 42, nil, false, nil, time.Now().Add(time.Hour))
	require.NoError(t, err)
	return "Bearer " + token
}

// The whole point of 3b.0a, proven from the outside: an authenticated streaming
// call carries its caller's claims all the way into the handler.
func TestConnectWatchEventCarriesClaimsIntoTheStream(t *testing.T) {
	t.Parallel()
	seen := make(chan string, 1)
	policy := watchAllowAll()
	policy.MayWatch = func(_ context.Context, claims *authz.IMSClaims, _ int32) error {
		if claims == nil {
			seen <- ""
			return errors.New("no claims")
		}
		seen <- claims.PersonHandle()
		return nil
	}
	client, hub, jwter := newWatchTestClient(t, policy)

	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	req := connect.NewRequest(&rpcv1.WatchEventRequest{EventIds: []int32{7}})
	req.Header().Set("Authorization", bearerFor(t, jwter, "bob"))
	stream, err := client.WatchEvent(ctx, req)
	require.NoError(t, err)
	t.Cleanup(func() { _ = stream.Close() })

	require.Equal(t, "bob", <-seen,
		"a streaming handler must see the caller's claims (the hole 3b.0a closed)")
	require.Eventually(t, func() bool { return hub.Subscribers() == 1 }, 2*time.Second, time.Millisecond)
}

// A poke published by a write reaches a watching client over the wire.
func TestConnectWatchEventDeliversAPokeOverTheWire(t *testing.T) {
	t.Parallel()
	client, hub, jwter := newWatchTestClient(t, watchAllowAll())

	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	req := connect.NewRequest(&rpcv1.WatchEventRequest{EventIds: []int32{7}})
	req.Header().Set("Authorization", bearerFor(t, jwter, "bob"))
	stream, err := client.WatchEvent(ctx, req)
	require.NoError(t, err)
	t.Cleanup(func() { _ = stream.Close() })

	// The establishing heartbeat arrives first, before anything is published.
	require.True(t, stream.Receive(), "err: %v", stream.Err())
	require.Equal(t, rpcv1.EventPokeKind_EVENT_POKE_KIND_HEARTBEAT, stream.Msg().GetPoke().GetKind())

	require.Eventually(t, func() bool { return hub.Subscribers() == 1 }, 2*time.Second, time.Millisecond)
	hub.Publish(server.Poke{EventID: 7, IncidentNumber: 12})

	require.True(t, stream.Receive(), "the client must receive the poke: %v", stream.Err())
	poke := stream.Msg().GetPoke()
	require.Equal(t, rpcv1.EventPokeKind_EVENT_POKE_KIND_INCIDENT_CHANGED, poke.GetKind())
	require.Equal(t, int32(7), poke.GetEventId())
	require.Equal(t, int32(12), poke.GetIncidentNumber())
}

// S2, over the wire: a writer watching an event never receives the poke for a
// private incident they may not see — and gets no error either, so they cannot
// infer that something was withheld.
func TestConnectWatchEventNeverSendsAnInvisiblePoke(t *testing.T) {
	t.Parallel()
	policy := watchAllowAll()
	policy.Visible = func(_ context.Context, claims *authz.IMSClaims, poke server.Poke) (bool, error) {
		// Incident 99 is private and belongs to someone else.
		return !(poke.IncidentNumber == 99 && claims.PersonHandle() != "admin"), nil
	}
	client, hub, jwter := newWatchTestClient(t, policy)

	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	req := connect.NewRequest(&rpcv1.WatchEventRequest{EventIds: []int32{7}})
	req.Header().Set("Authorization", bearerFor(t, jwter, "writer"))
	stream, err := client.WatchEvent(ctx, req)
	require.NoError(t, err)
	t.Cleanup(func() { _ = stream.Close() })

	require.True(t, stream.Receive(), "err: %v", stream.Err()) // establishing heartbeat
	require.Eventually(t, func() bool { return hub.Subscribers() == 1 }, 2*time.Second, time.Millisecond)
	hub.Publish(server.Poke{EventID: 7, IncidentNumber: 99}) // must never arrive
	hub.Publish(server.Poke{EventID: 7, IncidentNumber: 12}) // must arrive

	require.True(t, stream.Receive(), "err: %v", stream.Err())
	require.Equal(t, int32(12), stream.Msg().GetPoke().GetIncidentNumber(),
		"the private incident's number must never reach the wire; the next poke arrives in its place")
}

// The subscribe gate's rejection reaches the client as a real Connect error.
func TestConnectWatchEventSubscribeDenied(t *testing.T) {
	t.Parallel()
	policy := watchAllowAll()
	policy.MayWatch = func(context.Context, *authz.IMSClaims, int32) error {
		return connect.NewError(connect.CodePermissionDenied, errors.New("no read on that event"))
	}
	client, hub, jwter := newWatchTestClient(t, policy)

	req := connect.NewRequest(&rpcv1.WatchEventRequest{EventIds: []int32{7}})
	req.Header().Set("Authorization", bearerFor(t, jwter, "nosy"))
	stream, err := client.WatchEvent(context.Background(), req)
	require.NoError(t, err, "the stream opens; the error arrives on the first receive")
	t.Cleanup(func() { _ = stream.Close() })

	require.False(t, stream.Receive())
	require.Equal(t, connect.CodePermissionDenied, connect.CodeOf(stream.Err()))
	require.Zero(t, hub.Subscribers())
}

// An anonymous streaming call must be rejected, not served. Under the old
// pass-through interceptor this handler would have had no claims either way —
// which is exactly why this assertion is worth making from the outside.
func TestConnectWatchEventAnonymousIsUnauthenticated(t *testing.T) {
	t.Parallel()
	client, hub, _ := newWatchTestClient(t, watchAllowAll())

	stream, err := client.WatchEvent(context.Background(),
		connect.NewRequest(&rpcv1.WatchEventRequest{EventIds: []int32{7}}))
	require.NoError(t, err)
	t.Cleanup(func() { _ = stream.Close() })

	require.False(t, stream.Receive())
	require.Equal(t, connect.CodeUnauthenticated, connect.CodeOf(stream.Err()))
	require.Zero(t, hub.Subscribers())
}

// protovalidate runs on a streaming request too: an empty event list is refused
// before the handler sees it.
func TestConnectWatchEventValidatesTheRequest(t *testing.T) {
	t.Parallel()
	client, _, jwter := newWatchTestClient(t, watchAllowAll())

	req := connect.NewRequest(&rpcv1.WatchEventRequest{})
	req.Header().Set("Authorization", bearerFor(t, jwter, "bob"))
	stream, err := client.WatchEvent(context.Background(), req)
	require.NoError(t, err)
	t.Cleanup(func() { _ = stream.Close() })

	require.False(t, stream.Receive())
	require.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(stream.Err()))
}

// A client hanging up must detach the subscriber server-side. This is the
// goroutine-leak guard from the 09p brief, observed from the client end.
func TestConnectWatchEventClientHangupDetachesTheSubscriber(t *testing.T) {
	t.Parallel()
	client, hub, jwter := newWatchTestClient(t, watchAllowAll())

	ctx, cancel := context.WithCancel(t.Context())
	req := connect.NewRequest(&rpcv1.WatchEventRequest{EventIds: []int32{7}})
	req.Header().Set("Authorization", bearerFor(t, jwter, "bob"))
	stream, err := client.WatchEvent(ctx, req)
	require.NoError(t, err)
	require.Eventually(t, func() bool { return hub.Subscribers() == 1 }, 2*time.Second, time.Millisecond)

	cancel()
	_ = stream.Close()

	require.Eventually(t, func() bool { return hub.Subscribers() == 0 }, 5*time.Second, time.Millisecond,
		"a client going away must tear the subscriber down")
}
