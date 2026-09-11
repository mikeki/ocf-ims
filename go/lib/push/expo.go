// SPDX-License-Identifier: Apache-2.0

package push

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// The Expo Push Service backend (plan 09p, slice 3b.0c). Expo fronts APNs and
// FCM, so a native build's device identity is an ExponentPushToken and there are
// no VAPID keys, no crypto keys and no per-device endpoint URL.
//
// # Why this is not just "web push with a different URL"
//
// Expo delivery is asynchronous in TWO steps, and the second one is the one that
// matters (09p S5):
//
//  1. The send call returns a TICKET, not a delivery. A ticket says Expo accepted
//     the message, not that a phone got it.
//  2. The errors worth acting on — above all DeviceNotRegistered, which is the
//     Expo analogue of Web Push's 404/410 — usually appear only later, in a
//     RECEIPT fetched by ticket id.
//
// A sender that ignores receipts never learns a token is dead and will fan out
// to it forever, growing the fan-out's cost with every uninstalled app. So this
// backend checks receipts and prunes, which is what makes it a real Sender
// rather than a fire-and-forget POST.
//
// # What that costs, stated honestly
//
// Receipts are not available immediately (Expo asks for a delay, and keeps them
// for 24 h), so pending tickets are held IN MEMORY and checked later. A restart
// loses whatever was pending, and the dead token those tickets would have pruned
// survives until it produces a ticket-level error or a later receipt catches it.
// The alternative is a tickets table and a migration to go with it, which is not
// worth it for a prune that is a cost optimisation, not a correctness property:
// sending to a dead token is harmless, it is just wasted.

const (
	expoSendURL     = "https://exp.host/--/api/v2/push/send"
	expoReceiptsURL = "https://exp.host/--/api/v2/push/getReceipts"

	// deviceNotRegistered is Expo's name for a token that will never work again:
	// the app was uninstalled, or the token was reissued. The one error that
	// means "prune", exactly as 404/410 does on the web path.
	deviceNotRegistered = "DeviceNotRegistered"

	// receiptDelay is how long a ticket waits before its receipt is worth
	// asking for. Expo's guidance is on the order of fifteen minutes; asking
	// sooner mostly returns "not ready yet" and wastes a round trip.
	receiptDelay = 15 * time.Minute
	// receiptSweep is how often the pending tickets are swept for ones that have
	// come of age.
	receiptSweep = 5 * time.Minute
	// receiptBatch is Expo's maximum ids per getReceipts call.
	receiptBatch = 100

	// pendingLimit bounds the in-memory ticket queue. Past this, tickets are
	// dropped with a warning rather than allowed to grow without limit — losing
	// a prune is survivable; an unbounded queue in a long-running server is not.
	pendingLimit = 4096
)

// ExpoPushSender delivers to native devices through the Expo Push Service.
type ExpoPushSender struct {
	httpClient *http.Client
	sendURL    string
	receiptURL string

	// prune removes a subscription whose token Expo has told us is permanently
	// dead. It is a callback for the same reason the rest of this package takes
	// no store dependency: lib/push knows about push services, not about tables.
	prune func(ctx context.Context, endpoint string)

	// now, delay and sweep are injectable so the receipt path is testable in
	// milliseconds rather than in quarter-hours.
	now   func() time.Time
	delay time.Duration
	sweep time.Duration

	mu      sync.Mutex
	pending []pendingTicket
	dropped int

	stop     chan struct{}
	stopOnce sync.Once
	done     chan struct{}
}

// pendingTicket is one accepted send awaiting its receipt.
type pendingTicket struct {
	id       string
	endpoint string
	at       time.Time
}

// NewExpoPushSender builds the backend and starts its receipt sweeper. Close it
// on shutdown, or the sweeper goroutine outlives the server.
//
// base is the sweeper's root context — the process's, not any request's, since
// the sweeper outlives every request by design (actionlog.NewLogger takes one
// for the same reason). prune may be nil, which disables pruning but leaves
// delivery working: useful in a test, never in production.
func NewExpoPushSender(base context.Context, prune func(ctx context.Context, endpoint string)) *ExpoPushSender {
	s := &ExpoPushSender{
		// A bounded client so a slow or hung push service cannot pin a
		// goroutine, matching WebPushSender.
		httpClient: &http.Client{Timeout: 30 * time.Second},
		sendURL:    expoSendURL,
		receiptURL: expoReceiptsURL,
		prune:      prune,
		now:        time.Now,
		delay:      receiptDelay,
		sweep:      receiptSweep,
		stop:       make(chan struct{}),
		done:       make(chan struct{}),
	}
	go s.sweepReceipts(base)
	return s
}

// Enabled reports true: a constructed Expo sender always attempts delivery. The
// off switch is IMS_EXPO_PUSH_ENABLED, which decides whether one is built at all
// (09p S6), exactly as the VAPID keys decide for web push.
func (s *ExpoPushSender) Enabled() bool { return true }

// Close stops the receipt sweeper. Safe to call more than once.
func (s *ExpoPushSender) Close() {
	s.stopOnce.Do(func() { close(s.stop) })
	<-s.done
}

// expoSendRequest is one message in an Expo send batch. The content is
// deliberately minimal (09p S8, unchanged from 84c): a title, one line, and a
// deep link — never incident text. A native notification is MORE exposed on a
// lock screen than a browser one, not less.
type expoSendRequest struct {
	To       string            `json:"to"`
	Title    string            `json:"title,omitempty"`
	Body     string            `json:"body,omitempty"`
	Data     map[string]string `json:"data,omitempty"`
	Priority string            `json:"priority,omitempty"`
}

type expoTicketEnvelope struct {
	Data []struct {
		Status  string `json:"status"`
		ID      string `json:"id"`
		Message string `json:"message"`
		Details struct {
			Error string `json:"error"`
		} `json:"details"`
	} `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

// Send posts one message and inspects the ticket it gets back.
//
// A ticket-level DeviceNotRegistered returns ErrSubscriptionGone so the caller
// prunes immediately, exactly as a 404/410 does on the web path. An accepted
// ticket is queued for a receipt check, because that is where the same verdict
// usually arrives instead.
func (s *ExpoPushSender) Send(ctx context.Context, sub Subscription, msg Message) error {
	body, err := json.Marshal([]expoSendRequest{{
		To:    sub.Endpoint,
		Title: msg.Title,
		Body:  msg.Body,
		Data:  map[string]string{"url": msg.URL},
		// These notifications are all "something needs a person now"; the Fair
		// is the whole reason the app exists.
		Priority: "high",
	}})
	if err != nil {
		return fmt.Errorf("expo push: marshal: %w", err)
	}

	var envelope expoTicketEnvelope
	err = s.postJSON(ctx, s.sendURL, body, &envelope)
	if err != nil {
		return err
	}
	if len(envelope.Errors) > 0 {
		return fmt.Errorf("expo push: %s", envelope.Errors[0].Message)
	}
	if len(envelope.Data) == 0 {
		return fmt.Errorf("expo push: no ticket returned for %s", redactToken(sub.Endpoint))
	}

	ticket := envelope.Data[0]
	if ticket.Status == "error" {
		if ticket.Details.Error == deviceNotRegistered {
			return ErrSubscriptionGone
		}
		return fmt.Errorf("expo push: %s", ticket.Message)
	}
	s.queueReceipt(ticket.ID, sub.Endpoint)
	return nil
}

func (s *ExpoPushSender) queueReceipt(id, endpoint string) {
	if id == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.pending) >= pendingLimit {
		s.dropped++
		if s.dropped%pendingLimit == 1 {
			slog.Warn("expo push: receipt queue full, dropping tickets",
				"pending", len(s.pending), "droppedTotal", s.dropped)
		}
		return
	}
	s.pending = append(s.pending, pendingTicket{id: id, endpoint: endpoint, at: s.now()})
}

// sweepReceipts is the single goroutine that ages tickets and asks for verdicts.
func (s *ExpoPushSender) sweepReceipts(base context.Context) {
	defer close(s.done)
	ticker := time.NewTicker(s.sweep)
	defer ticker.Stop()
	for {
		select {
		case <-base.Done():
			return
		case <-s.stop:
			return
		case <-ticker.C:
			// A budget of one sweep interval, off the process context: this runs
			// off every request path, so no caller's deadline applies to it.
			ctx, cancel := context.WithTimeout(base, s.sweep)
			s.checkDueReceipts(ctx)
			cancel()
		}
	}
}

// takeDue removes and returns the tickets old enough to have a receipt.
func (s *ExpoPushSender) takeDue() []pendingTicket {
	cutoff := s.now().Add(-s.delay)
	s.mu.Lock()
	defer s.mu.Unlock()
	var due, keep []pendingTicket
	for _, t := range s.pending {
		if t.at.After(cutoff) {
			keep = append(keep, t)
			continue
		}
		due = append(due, t)
	}
	s.pending = keep
	return due
}

type expoReceiptEnvelope struct {
	Data map[string]struct {
		Status  string `json:"status"`
		Message string `json:"message"`
		Details struct {
			Error string `json:"error"`
		} `json:"details"`
	} `json:"data"`
}

// checkDueReceipts fetches receipts for aged tickets and prunes the tokens Expo
// says are permanently dead.
func (s *ExpoPushSender) checkDueReceipts(ctx context.Context) {
	due := s.takeDue()
	for start := 0; start < len(due); start += receiptBatch {
		end := min(start+receiptBatch, len(due))
		batch := due[start:end]

		byID := make(map[string]string, len(batch))
		ids := make([]string, 0, len(batch))
		for _, t := range batch {
			byID[t.id] = t.endpoint
			ids = append(ids, t.id)
		}
		body, err := json.Marshal(map[string][]string{"ids": ids})
		if err != nil {
			slog.Error("expo push: marshal receipt request", "err", err)
			continue
		}
		var envelope expoReceiptEnvelope
		err = s.postJSON(ctx, s.receiptURL, body, &envelope)
		if err != nil {
			// The tickets are already off the queue. Losing them costs a prune,
			// not a delivery — see the package-level note on what this backend
			// deliberately does not persist.
			slog.Warn("expo push: receipt fetch failed", "err", err, "tickets", len(ids))
			continue
		}
		for id, receipt := range envelope.Data {
			if receipt.Status != "error" {
				continue
			}
			endpoint := byID[id]
			if receipt.Details.Error != deviceNotRegistered {
				slog.Warn("expo push: delivery failed",
					"err", receipt.Message, "token", redactToken(endpoint))
				continue
			}
			slog.Info("expo push: pruning an unregistered device", "token", redactToken(endpoint))
			if s.prune != nil {
				s.prune(ctx, endpoint)
			}
		}
	}
}

// postJSON posts body and decodes the response into out.
func (s *ExpoPushSender) postJSON(ctx context.Context, url string, body []byte, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("expo push: request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("expo push: post: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("expo push service returned %s", resp.Status)
	}
	err = json.NewDecoder(resp.Body).Decode(out)
	if err != nil {
		return fmt.Errorf("expo push: decode: %w", err)
	}
	return nil
}

// redactToken keeps a token out of the logs while leaving enough to correlate
// one. A push token identifies a person's device; it is not a secret in the
// password sense, but it does not belong in a log line either.
func redactToken(endpoint string) string {
	if len(endpoint) <= 12 {
		return "…"
	}
	return endpoint[:10] + "…" + endpoint[len(endpoint)-3:]
}

var _ Sender = (*ExpoPushSender)(nil)
