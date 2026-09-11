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

// The WatchEvent stream handler (plan 09p 3b.0b): subscribe, filter, beat,
// expire, tear down. No database — WatchPolicy carries the authorization.

// heartbeatInterval sits under the 30-60 s at which Caddy and most proxies reap
// an idle connection. It is a poke rather than a transport ping so the client
// observes liveness where it observes everything else.
const heartbeatInterval = 25 * time.Second

// Stream serves one subscriber until the client goes away, the access token
// expires, or the server shuts down.
func (h *WatchHub) Stream(
	ctx context.Context,
	req *rpcv1.WatchEventRequest,
	send func(*rpcv1.WatchEventResponse) error,
) error {
	claims, ok := ClaimsFromContext(ctx)
	if !ok {
		return connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	// Catches a client that reconnected without refreshing; the loop below
	// catches a token that expires while the stream runs.
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

	// The first beat is what establishes the stream: a Connect server stream
	// writes no response headers until its first message, so without it the
	// client call would block for up to heartbeatInterval on a quiet event.
	err = send(heartbeat())
	if err != nil {
		return err
	}

	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil

		case poke, open := <-session.Pokes():
			if !open {
				return session.Reason()
			}
			err = expired(claims)
			if err != nil {
				return err
			}
			// Withholding is silent (S2): an error would tell the subscriber
			// that something they may not see just changed.
			if !session.Visible(ctx, poke) {
				continue
			}
			err = send(pokeResponse(poke))
			if err != nil {
				return err
			}

		case <-ticker.C:
			// An idle stream expires too.
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

// expired ends the stream once the token it opened with has run out (09p open
// question 4): a stream authenticates once, and a 15-minute token against the
// 30-minute WriteTimeout would otherwise spend half its life expired.
// Unauthenticated is what the client transport already answers with a refresh
// and a reconnect.
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
