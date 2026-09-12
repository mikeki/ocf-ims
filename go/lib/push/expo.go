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

// The Expo Push Service backend (plan 09p 3b.0c). Expo fronts APNs and FCM: a
// device is an ExponentPushToken, with no VAPID or per-device crypto keys.
//
// Delivery is asynchronous in two steps (S5): a send returns a TICKET, and the
// error that matters — DeviceNotRegistered, the analogue of Web Push's 404/410 —
// usually arrives later in a RECEIPT fetched by ticket id. So accepted tickets
// are held in memory and swept for receipts, and a dead token is pruned through
// a callback. A restart loses the pending tickets; that costs a prune, not a
// delivery, which is why there is no tickets table.

const (
	expoSendURL     = "https://exp.host/--/api/v2/push/send"
	expoReceiptsURL = "https://exp.host/--/api/v2/push/getReceipts"

	// deviceNotRegistered is the one receipt error that means "prune".
	deviceNotRegistered = "DeviceNotRegistered"

	// Expo asks for about fifteen minutes before a receipt is worth fetching.
	receiptDelay = 15 * time.Minute
	receiptSweep = 5 * time.Minute
	// receiptBatch is Expo's maximum ids per getReceipts call.
	receiptBatch = 100

	// pendingLimit bounds the in-memory ticket queue; past it tickets are
	// dropped (a lost prune) rather than growing without limit.
	pendingLimit = 4096
)

// ExpoPushSender delivers to native devices through the Expo Push Service.
type ExpoPushSender struct {
	httpClient *http.Client
	sendURL    string
	receiptURL string

	// prune removes a subscription whose token Expo reports as dead. A
	// callback, so lib/push takes no store dependency.
	prune func(ctx context.Context, endpoint string)

	// Injectable so the receipt path is testable in milliseconds.
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

// NewExpoPushSender builds the backend and starts its receipt sweeper; Close it
// on shutdown. base is the process context, not a request's, since the sweeper
// outlives every request. A nil prune disables pruning: for tests only.
func NewExpoPushSender(base context.Context, prune func(ctx context.Context, endpoint string)) *ExpoPushSender {
	s := &ExpoPushSender{
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

// Enabled reports true: the off switch is IMS_EXPO_PUSH_ENABLED, which decides
// whether one is built at all (09p S6).
func (s *ExpoPushSender) Enabled() bool { return true }

// Close stops the receipt sweeper. Safe to call more than once.
func (s *ExpoPushSender) Close() {
	s.stopOnce.Do(func() { close(s.stop) })
	<-s.done
}

// expoSendRequest is one message in an Expo send batch. Content stays minimal
// (09p S8): a title, one line and a deep link, never incident text.
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

// Send posts one message and inspects the ticket. A ticket-level
// DeviceNotRegistered returns ErrSubscriptionGone so the caller prunes now; an
// accepted ticket is queued for its receipt.
func (s *ExpoPushSender) Send(ctx context.Context, sub Subscription, msg Message) error {
	body, err := json.Marshal([]expoSendRequest{{
		To:       sub.Endpoint,
		Title:    msg.Title,
		Body:     msg.Body,
		Data:     map[string]string{"url": msg.URL},
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
			// The tickets are already off the queue; losing them costs a prune.
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

// redactToken keeps a device token out of the logs while leaving enough to
// correlate one.
func redactToken(endpoint string) string {
	if len(endpoint) <= 12 {
		return "…"
	}
	return endpoint[:10] + "…" + endpoint[len(endpoint)-3:]
}

var _ Sender = (*ExpoPushSender)(nil)
