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

package push

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// payload is the JSON the service worker (web/typescript/sw.ts) expects on a
// push event: it reads {title, body, url} and turns them into a notification.
type payload struct {
	Title string `json:"title,omitempty"`
	Body  string `json:"body,omitempty"`
	URL   string `json:"url,omitempty"`
}

// defaultTTL is how long the push service should hold a message for a device
// that's offline before giving up. A few hours is plenty for a Fair shift —
// stale beyond that the recipient will catch it in the in-app bell anyway.
const defaultTTL = 6 * time.Hour

// WebPushSender is the real Sender: it encrypts each Message to a device's keys
// and POSTs it, VAPID-signed, to the device's push-service endpoint (plan 84c).
// Constructed only when VAPID keys are configured; otherwise the NoopSender is
// used and nothing is delivered.
type WebPushSender struct {
	publicKey  string
	privateKey string
	subject    string
	httpClient *http.Client
}

// NewWebPushSender builds a sender from a configured VAPID key pair and contact
// subject (a mailto: or https: URL required by the VAPID spec).
func NewWebPushSender(publicKey, privateKey, subject string) *WebPushSender {
	return &WebPushSender{
		publicKey:  publicKey,
		privateKey: privateKey,
		subject:    subject,
		// A bounded client so a slow/hung push service can't pin a goroutine; the
		// per-send context (set by the caller, off the request path) bounds it too.
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// Enabled reports true: a real sender always attempts delivery.
func (s *WebPushSender) Enabled() bool { return true }

// Send encrypts msg to sub's keys and posts it to sub's endpoint. It returns
// ErrSubscriptionGone when the push service reports the device is permanently
// dead (404/410) so the caller can prune the stored subscription; any other
// non-2xx is a transient error the caller logs and drops.
func (s *WebPushSender) Send(ctx context.Context, sub Subscription, msg Message) error {
	body, err := json.Marshal(payload{Title: msg.Title, Body: msg.Body, URL: msg.URL})
	if err != nil {
		return fmt.Errorf("marshal push payload: %w", err)
	}

	resp, err := webpush.SendNotificationWithContext(ctx, body, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: webpush.Keys{
			P256dh: sub.P256dh,
			Auth:   sub.Auth,
		},
	}, &webpush.Options{
		HTTPClient:      s.httpClient,
		Subscriber:      s.subject,
		VAPIDPublicKey:  s.publicKey,
		VAPIDPrivateKey: s.privateKey,
		TTL:             int(defaultTTL.Seconds()),
		Urgency:         webpush.UrgencyHigh,
	})
	if err != nil {
		return fmt.Errorf("send web push: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	// Drain so the connection can be reused.
	_, _ = io.Copy(io.Discard, resp.Body)

	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		return ErrSubscriptionGone
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return nil
	default:
		return fmt.Errorf("push service returned %s", resp.Status)
	}
}

// Ensure WebPushSender satisfies Sender.
var _ Sender = (*WebPushSender)(nil)
