// SPDX-License-Identifier: Apache-2.0

package server

import (
	"context"
	"errors"
	"log/slog"
	"sync"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/lib/authz"
)

// The per-subscriber poke hub behind WatchEvent (plan 09p 3b.0b). It runs
// beside the SSE hub, fed from the same Notify* triggers, until the templ UI
// retires (S7). Where SSE must redact a private incident's number (a broadcast
// cannot tell subscribers apart), this hub filters: each subscriber's own
// goroutine runs the visibility check just before it sends, so nothing
// unfiltered reaches a socket and a write RPC never waits on a database query
// per watcher.

// watchBuffer is how many pokes may queue for one subscriber before it is
// dropped rather than allowed to block the publisher.
const watchBuffer = 64

// Poke says that something changed, never what: content here would put
// authorization on the publish path.
type Poke struct {
	EventID int32
	// Exactly one of these is set.
	IncidentNumber int32
	ReportNumber   int32
}

// PokeVisibility reports whether a viewer may be told about a poke. A function
// seam, like IncidentPrivacyOracle, so this package stays free of the store; the
// implementation lives beside the read path's rule in internal/incident. An
// error is treated as "no".
type PokeVisibility func(ctx context.Context, claims *authz.IMSClaims, poke Poke) (bool, error)

// WatchPolicy is everything the stream needs to know about authorization, which
// is what keeps the handler free of the database and testable through the
// generated client against httptest.
type WatchPolicy struct {
	// MayWatch is the subscribe-time gate, once per requested event. Its error
	// reaches the caller; a withheld poke, by contrast, is silent.
	MayWatch func(ctx context.Context, claims *authz.IMSClaims, eventID int32) error
	// Visible is the per-poke, per-subscriber check (S2), re-run on every poke
	// rather than cached from subscribe time (S3).
	Visible PokeVisibility
}

// Why the hub ended a stream; the client reacts to the two differently.
var (
	errFellBehind = connect.NewError(connect.CodeResourceExhausted,
		errors.New("the stream fell behind; reconnect"))
	errShuttingDown = connect.NewError(connect.CodeUnavailable,
		errors.New("the server is shutting down; reconnect"))
)

// WatchHub tracks the live subscribers and fans pokes out to them.
type WatchHub struct {
	policy WatchPolicy

	mu   sync.Mutex
	subs map[*WatchSession]struct{}
}

func NewWatchHub(policy WatchPolicy) *WatchHub {
	if policy.MayWatch == nil || policy.Visible == nil {
		// Half a policy would broadcast every poke to everyone. Fail at boot.
		panic("NewWatchHub requires a complete WatchPolicy")
	}
	return &WatchHub{policy: policy, subs: map[*WatchSession]struct{}{}}
}

// Publish fans a poke out to every subscriber watching its event without
// blocking: a subscriber whose buffer is full is dropped. Safe on a nil hub, so
// EventSourcerer can hold an optional one.
func (h *WatchHub) Publish(poke Poke) {
	if h == nil || poke.EventID == 0 {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for sub := range h.subs {
		if !sub.watching(poke.EventID) {
			continue
		}
		select {
		case sub.pokes <- poke:
		default:
			// Drop it rather than block the writer; it reconnects and refetches.
			slog.Warn("watch: subscriber fell behind, dropping it",
				"user", sub.handle, "eventID", poke.EventID)
			delete(h.subs, sub)
			sub.end(errFellBehind)
		}
	}
}

// Close ends every live stream. Registered on the shutdown hook beside the SSE
// hub's Close.
func (h *WatchHub) Close() {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for sub := range h.subs {
		delete(h.subs, sub)
		sub.end(errShuttingDown)
	}
}

// Subscribers reports how many streams are attached (tests and diagnostics).
func (h *WatchHub) Subscribers() int {
	if h == nil {
		return 0
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}

// Subscribe attaches a subscriber. The caller must Close the session or it
// leaks for the life of the process.
func (h *WatchHub) Subscribe(claims *authz.IMSClaims, eventIDs []int32) *WatchSession {
	events := make(map[int32]struct{}, len(eventIDs))
	for _, id := range eventIDs {
		events[id] = struct{}{}
	}
	sub := &WatchSession{
		hub:    h,
		claims: claims,
		handle: claims.PersonHandle(),
		events: events,
		pokes:  make(chan Poke, watchBuffer),
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.subs[sub] = struct{}{}
	return sub
}

// WatchSession is one attached subscriber.
type WatchSession struct {
	hub    *WatchHub
	claims *authz.IMSClaims
	handle string
	events map[int32]struct{}
	pokes  chan Poke

	closeOnce sync.Once
	// reason is written once, before pokes is closed, so a reader that saw the
	// close sees the reason.
	reason error
}

// Reason says why the hub ended this stream; nil when the handler closed it.
func (s *WatchSession) Reason() error { return s.reason }

// Pokes is the channel a stream handler selects on. It is closed when the hub
// ends the stream.
func (s *WatchSession) Pokes() <-chan Poke { return s.pokes }

// Visible runs the per-poke check. An error is logged and treated as "not
// visible".
func (s *WatchSession) Visible(ctx context.Context, poke Poke) bool {
	ok, err := s.hub.policy.Visible(ctx, s.claims, poke)
	if err != nil {
		slog.Error("watch: visibility lookup failed; withholding the poke",
			"user", s.handle, "eventID", poke.EventID,
			"incidentNumber", poke.IncidentNumber, "reportNumber", poke.ReportNumber,
			"err", err)
		return false
	}
	return ok
}

// Close detaches the subscriber. Idempotent, so a deferred Close is safe after
// the hub already dropped the session.
func (s *WatchSession) Close() {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	if _, live := s.hub.subs[s]; !live {
		return
	}
	delete(s.hub.subs, s)
	s.end(nil)
}

// end detaches with a reason. The caller holds the hub's mutex and has removed
// the session from the map.
func (s *WatchSession) end(reason error) {
	s.closeOnce.Do(func() {
		s.reason = reason
		close(s.pokes)
	})
}

func (s *WatchSession) watching(eventID int32) bool {
	_, ok := s.events[eventID]
	return ok
}
