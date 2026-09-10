// SPDX-License-Identifier: Apache-2.0

package server

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/lib/authz"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// The WatchEvent stream handler (plan 09p, slice 3b.0b). It lives here rather
// than in a domain package because, with WatchPolicy carrying both authorization
// questions, what is left is pure stream mechanics: subscribe, filter, beat,
// expire, tear down. No database, no domain types.

// heartbeatInterval is how often an otherwise-silent stream says it is alive.
// Caddy and most proxies reap an idle connection at 30-60 s, so this sits under
// the shortest of those with room to spare. It is modelled as a poke rather than
// a transport-level ping so a client observes liveness in the same place it
// observes everything else.
const heartbeatInterval = 25 * time.Second

// Stream serves one WatchEvent subscriber until the client goes away, the access
// token expires, or the server shuts down.
func (h *WatchHub) Stream(
	ctx context.Context,
	req *rpcv1.WatchEventRequest,
	send func(*rpcv1.WatchEventResponse) error,
) error {
	claims, ok := ClaimsFromContext(ctx)
	if !ok {
		return connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	// An already-expired token never establishes a stream in the first place.
	// The two checks inside the loop below catch a token that expires while the
	// stream runs; this one catches the client that reconnected without
	// refreshing first.
	err := expired(claims)
	if err != nil {
		return err
	}
	for _, eventID := range req.GetEventIds() {
		err = h.policy.MayWatch(ctx, claims, eventID)
		if err != nil {
			return err
		}
	}

	session := h.Subscribe(claims, req.GetEventIds())
	defer session.Close()

	// Beat once, immediately, before waiting for anything.
	//
	// This is not politeness — it is what establishes the stream. A Connect
	// server stream writes no response headers until its first message, so
	// connect-go's client call does not return until the server sends
	// something: without this, WatchEvent would block a client for up to 25
	// seconds on a quiet event and it could not tell "connecting" from
	// "connected and idle". Any proxy with a response-header timeout shorter
	// than the heartbeat would kill the connection before it ever produced a
	// byte, too.
	//
	// The SSE hub already solved this and it is worth naming: EventSourcerer
	// sets ReplayAll and hands every new subscriber an InitialEvent the moment
	// it attaches. Same problem, same answer.
	err = send(heartbeat())
	if err != nil {
		return err
	}

	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			// The client went away, or the request was cancelled. The deferred
			// Close detaches the subscriber, so nothing is left behind.
			return nil

		case poke, open := <-session.Pokes():
			if !open {
				// The hub ended this stream — it fell behind, or the server is
				// shutting down. Either way the client reconnects and refetches,
				// which is what it would have to do after any gap anyway.
				return session.Reason()
			}
			err = expired(claims)
			if err != nil {
				return err
			}
			// The per-poke re-check (09p S2/S3). Failing it is silence, not an
			// error: a subscriber must not be able to learn that a poke was
			// withheld, or the filter leaks exactly what it exists to hide.
			if !session.Visible(ctx, poke) {
				continue
			}
			err = send(pokeResponse(poke))
			if err != nil {
				return err
			}

		case <-ticker.C:
			// An idle stream expires too, which is why the check is here as well
			// as on the poke path — a subscriber told nothing for an hour would
			// otherwise hold an expired token indefinitely.
			err = expired(claims)
			if err != nil {
				return err
			}
			err = send(heartbeat())
			if err != nil {
				return err
			}
		}
	}
}

// expired ends the stream when the access token it opened with has run out (09p
// open question 4). A stream authenticates ONCE, from the headers it opened with
// (see AuthInterceptor) — and with a 15-minute access token against the
// 30-minute WriteTimeout in cmd/serve.go, a stream that runs its full life would
// spend half of it holding an expired token. Unauthenticated is the code the
// client's transport already knows how to answer: refresh, then reconnect.
func expired(claims *authz.IMSClaims) error {
	if claims.ExpiresAt == nil || time.Now().Before(claims.ExpiresAt.Time) {
		return nil
	}
	return connect.NewError(connect.CodeUnauthenticated,
		errors.New("the access token expired; refresh and reconnect"))
}

func pokeResponse(poke Poke) *rpcv1.WatchEventResponse {
	out := &rpcv1.EventPoke{EventId: poke.EventID, Sent: timestamppb.Now()}
	switch {
	case poke.IncidentNumber != 0:
		out.Kind = rpcv1.EventPokeKind_EVENT_POKE_KIND_INCIDENT_CHANGED
		out.IncidentNumber = &poke.IncidentNumber
	case poke.ReportNumber != 0:
		out.Kind = rpcv1.EventPokeKind_EVENT_POKE_KIND_REPORT_CHANGED
		out.ReportNumber = &poke.ReportNumber
	}
	return &rpcv1.WatchEventResponse{Poke: out}
}

func heartbeat() *rpcv1.WatchEventResponse {
	return &rpcv1.WatchEventResponse{Poke: &rpcv1.EventPoke{
		Kind: rpcv1.EventPokeKind_EVENT_POKE_KIND_HEARTBEAT,
		Sent: timestamppb.Now(),
	}}
}
