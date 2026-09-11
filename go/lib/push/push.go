// SPDX-License-Identifier: Apache-2.0

// Package push is the push-delivery seam (plan 84; extended for native devices
// in 09p slice 3b.0c). It defines the thin Sender interface that the
// notification fan-out (84c) calls, a no-op backend used when push is
// unconfigured and in tests, and two real backends: WebPushSender (VAPID,
// browsers) and ExpoPushSender (the Expo Push Service, iOS and Android).
//
// A device's Kind decides which backend delivers to it, and Router is what makes
// that a routing decision rather than a branch in the fan-out: the fan-out still
// holds one Sender and calls Send once per device, exactly as it did when web
// push was the only backend.
package push

import (
	"context"
	"errors"
)

// Kind is which push service owns a device, and therefore which backend can
// deliver to it. It is stored on the subscription row (PUSH_SUBSCRIPTION.KIND).
type Kind string

const (
	// KindWeb is a browser Web Push subscription: Endpoint is the push service's
	// URL and both crypto keys are present.
	KindWeb Kind = "web"
	// KindExpo is a native Expo build: Endpoint is the ExponentPushToken[...]
	// and there are no crypto keys at all — Expo owns the APNs/FCM plumbing.
	KindExpo Kind = "expo"
)

// Subscription is a single device's push endpoint and, for a browser, the client
// keys needed to encrypt a payload to it. It mirrors the browser's
// PushSubscription and the stored PUSH_SUBSCRIPTION row, decoupling senders from
// the store package.
//
// Endpoint is the device's identity for both kinds — a push-service URL for web,
// an ExponentPushToken for Expo — which is why the unique key on it, the
// upsert-on-endpoint behaviour and the prune path all survived adding native
// devices unchanged. P256dh and Auth are empty for KindExpo; the columns are
// nullable for exactly that reason (09p S4).
type Subscription struct {
	Kind     Kind
	Endpoint string
	P256dh   string
	Auth     string
}

// Message is the content of one push. Body is shown on the lock screen; URL is
// the deep link followed on click (handled by the service worker in 84b).
type Message struct {
	Title string
	Body  string
	URL   string
}

// ErrSubscriptionGone is returned by a Sender when the push service reports the
// subscription is permanently dead (HTTP 404/410). The caller prunes the stored
// subscription on this error.
var ErrSubscriptionGone = errors.New("push subscription gone")

// Sender delivers a Message to one Subscription. Implementations must be safe for
// concurrent use; sends happen off the request path (after commit), one per
// device. A nil error means accepted by the push service, not yet delivered.
type Sender interface {
	Send(ctx context.Context, sub Subscription, msg Message) error
	// Enabled reports whether this backend can actually deliver. The no-op
	// backend returns false so callers can skip fan-out work entirely.
	Enabled() bool
}

// NoopSender is the default backend: it accepts and discards every send. Used
// when no VAPID keys are configured (push disabled) and in tests.
type NoopSender struct{}

// Send discards the message and reports success.
func (NoopSender) Send(context.Context, Subscription, Message) error { return nil }

// Enabled reports false: a NoopSender never actually delivers.
func (NoopSender) Enabled() bool { return false }

// Ensure NoopSender satisfies Sender.
var _ Sender = NoopSender{}

// Router delivers each Subscription through the backend that owns its Kind.
//
// It exists so the fan-out never learns that there is more than one push
// service. Pusher still holds a single Sender and calls Send once per device;
// adding native push moved zero decisions into it. A device whose Kind has no
// backend configured is skipped silently rather than erroring — an unconfigured
// backend is not a delivery failure, and it must not look like one to the prune
// path, which would otherwise delete a perfectly good subscription.
type Router struct {
	backends map[Kind]Sender
}

// NewRouter builds a Router over the given backends. Kinds absent from the map
// are simply not delivered to.
func NewRouter(backends map[Kind]Sender) *Router {
	return &Router{backends: backends}
}

// Send routes to the backend owning sub.Kind. An unrouted or unconfigured kind
// is a no-op, NOT an error: see the type comment.
func (r *Router) Send(ctx context.Context, sub Subscription, msg Message) error {
	backend, ok := r.backends[sub.Kind]
	if !ok || !backend.Enabled() {
		return nil
	}
	return backend.Send(ctx, sub, msg)
}

// Enabled reports whether any backend can deliver, so a deployment with neither
// web nor native push configured still skips the fan-out entirely.
func (r *Router) Enabled() bool {
	for _, backend := range r.backends {
		if backend.Enabled() {
			return true
		}
	}
	return false
}

var _ Sender = (*Router)(nil)
