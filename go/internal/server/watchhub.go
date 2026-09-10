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

// The per-subscriber poke hub behind the WatchEvent stream (plan 09p, slice
// 3b.0b). It runs beside EventSourcerer rather than replacing it: the templ web
// UI still consumes SSE and will until Phase 4 (09p S7), so both publishers are
// fed from the same triggers — EventSourcerer's four Notify* methods, which are
// already the single fan-out point every one of the ~22 call sites goes through.
// Nothing at a call site changed to add this.
//
// # Why this exists at all
//
// SSE is a BROADCAST hub. It cannot tell one subscriber from another, so it
// cannot filter — it can only redact, which is what IncidentPrivacyOracle does:
// a private incident's number is replaced by a number-less "reload everything"
// poke. The residual, written down in CLAUDE.md, is that any authenticated
// subscriber can see THAT something changed in an event even when they may not
// see WHAT.
//
// That residual was never a policy decision. It is a transport consequence. A
// stream is addressed, so it filters: a poke the subscriber may not see is
// simply never sent.
//
// # Where the filter runs, and why it matters that it is here
//
// Publishing is in-memory and non-blocking: Publish fans a poke out to every
// subscriber watching that event and returns. It does NOT run the visibility
// check, because the check needs the database and Publish is called from a write
// RPC's goroutine — making a write wait on one DB query per subscriber would put
// the stream's cost on the writer's latency.
//
// Instead each subscriber's own goroutine runs the check immediately before it
// sends (see WatchSession.Next). Three things fall out of that, all of them
// wanted:
//
//   - The check is per-subscriber, which is the whole point (S2).
//   - It is per-poke rather than once at subscribe, which is what notices a
//     permission revoked or an incident made private mid-stream (S3). A stream
//     can easily outlive a permission change; checking once at subscribe would
//     make a long-lived connection a permission cache with no invalidation.
//   - It runs at the last possible moment, so it is as fresh as it can be.
//
// The unfiltered poke does sit in the subscriber's buffered channel for as long
// as it takes that goroutine to wake up. That is in-process memory only; nothing
// unfiltered ever reaches a socket.

// watchBuffer is how many pokes may queue for one subscriber before it is
// dropped. A subscriber that cannot keep up is disconnected rather than allowed
// to slow the publisher — the same trade the SSE library makes. The client
// reconnects and refetches, which is what it would have to do after any gap.
const watchBuffer = 64

// Poke is what the hub distributes: the fact that something changed, never the
// thing itself. Keeping content out of it is deliberate — content here would put
// authorization on the publish path and mean two implementations of "may this
// person see this", which is how a private incident eventually leaks.
type Poke struct {
	EventID int32
	// Exactly one of these is set.
	IncidentNumber int32
	ReportNumber   int32
}

// PokeVisibility reports whether a viewer may be told about this poke.
//
// It is a function type for the same reason IncidentPrivacyOracle is: it keeps
// internal/server a leaf package with no dependency on the store or on
// internal/incident (which imports this package). The real implementation lives
// beside the read path's own privacy rule so there is exactly one of them.
//
// An error must be treated as "no" by the caller. Failing closed on a poke costs
// the subscriber a refetch it did not know it needed; failing open costs the
// privacy guarantee.
type PokeVisibility func(ctx context.Context, claims *authz.IMSClaims, poke Poke) (bool, error)

// WatchPolicy is everything the stream needs to know about authorization, and
// the reason the stream handler itself touches no database.
//
// Both halves are function seams for the same reason IncidentPrivacyOracle is:
// internal/server is a leaf package, and internal/incident — where the read
// path's privacy rule already lives — imports it, not the other way round. The
// real implementations are built there (incident.NewWatchPolicy) from the same
// primitives GetIncident and ListIncidents use, so there is exactly one
// interpretation of "may this person see this" in the codebase.
//
// The practical payoff is that the whole stream — subscribe, filter, heartbeat,
// expiry, teardown — is testable through the generated client against an
// httptest server with no MariaDB anywhere.
type WatchPolicy struct {
	// MayWatch is the subscribe-time gate, once per requested event. It returns
	// a connect error the caller sees. This is deliberately NOT the privacy
	// check: asking to watch an event you cannot read at all is a mistake worth
	// reporting, where a private incident inside an event you can read is a
	// secret worth keeping — and gets silence, not an error.
	MayWatch func(ctx context.Context, claims *authz.IMSClaims, eventID int32) error
	// Visible is the per-poke, per-subscriber check (S2), re-run on every poke
	// rather than cached from subscribe time (S3).
	Visible PokeVisibility
}

// Why a stream ended, when the hub ended it rather than the client. The
// subscriber's channel closing is the signal; this says which of the two it was,
// because "you fell behind, reconnect" and "the server is going away" deserve
// different codes and the client reacts to them differently.
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
		// Same stance as NewEventSourcerer: a hub with half a policy would
		// silently broadcast every poke to every subscriber, which is worse than
		// the SSE hub this replaces. Fail at boot, not in the field.
		panic("NewWatchHub requires a complete WatchPolicy")
	}
	return &WatchHub{policy: policy, subs: map[*WatchSession]struct{}{}}
}

// Publish fans a poke out to every subscriber watching its event. It never
// blocks: a subscriber whose buffer is full is closed and dropped.
//
// It is safe to call with a nil receiver, which is what lets EventSourcerer hold
// an optional *WatchHub and every existing test construct one without a stream.
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
			// The subscriber is not keeping up. Drop it rather than block the
			// writer that published this; it will reconnect and refetch.
			slog.Warn("watch: subscriber fell behind, dropping it",
				"user", sub.handle, "eventID", poke.EventID)
			delete(h.subs, sub)
			sub.end(errFellBehind)
		}
	}
}

// Close ends every live stream. It is registered on the server's shutdown hook
// beside the SSE hub's Close, so a subscriber is told to go away promptly rather
// than holding the drain open for the full grace period.
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

// Subscribers reports how many streams are currently attached. Test and
// diagnostic use — it is the cheapest way to assert that a torn-down stream
// really left.
func (h *WatchHub) Subscribers() int {
	if h == nil {
		return 0
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}

// Subscribe attaches a subscriber watching the given events. The returned
// session MUST be closed by its caller — `defer session.Close()` in the stream
// handler — or the subscriber leaks for the life of the process.
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

// WatchSession is one attached subscriber: the claims the stream opened with,
// the events it asked for, and its buffered poke channel.
type WatchSession struct {
	hub    *WatchHub
	claims *authz.IMSClaims
	handle string
	events map[int32]struct{}
	pokes  chan Poke

	closeOnce sync.Once
	// reason is written exactly once, under the hub's mutex, immediately before
	// pokes is closed — so a handler that has seen the close is guaranteed to
	// read the value that was written.
	reason error
}

// Reason says why the hub ended this stream, once its poke channel has closed.
// It is nil when the session was closed by its own handler.
func (s *WatchSession) Reason() error { return s.reason }

// Pokes is the channel a stream handler selects on. It is closed when the hub
// drops a subscriber that fell behind.
func (s *WatchSession) Pokes() <-chan Poke { return s.pokes }

// Visible runs the per-poke visibility check on the subscriber's own goroutine.
// An error is reported as "not visible" — failing closed — and logged, because a
// lookup failure must never become a disclosure.
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

// Close detaches the subscriber. It is idempotent, so the handler's deferred
// Close is safe even when the hub already dropped this subscriber for falling
// behind.
func (s *WatchSession) Close() {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	if _, live := s.hub.subs[s]; !live {
		// Already dropped by Publish or by Close, which stated the reason there.
		return
	}
	delete(s.hub.subs, s)
	s.end(nil)
}

// end detaches this subscriber with a stated reason. The caller must hold the
// hub's mutex and must already have removed the session from the map.
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
