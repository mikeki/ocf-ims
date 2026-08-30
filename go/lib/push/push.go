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

// Package push is the Web Push delivery seam (plan 84). It defines the thin
// Sender interface that the notification fan-out (84c) calls, plus a no-op
// backend used when push is unconfigured and in tests. The real VAPID-signing
// backend (webpush-go) is wired in 84c; until then every deployment uses the
// no-op sender, so nothing is pushed even though subscriptions can be stored.
package push

import (
	"context"
	"errors"
)

// Subscription is a single device's push endpoint and the client keys needed to
// encrypt a payload to it. It mirrors the browser's PushSubscription and the
// stored PUSH_SUBSCRIPTION row, decoupling senders from the store package.
type Subscription struct {
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
