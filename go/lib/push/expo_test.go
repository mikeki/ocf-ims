// SPDX-License-Identifier: Apache-2.0

package push

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// The Expo backend (plan 09p slice 3b.0c). The claims worth testing are the two
// that make it a real Sender rather than a fire-and-forget POST: a dead token is
// pruned, and it is pruned from the RECEIPT — which is where Expo actually
// reports it — not only from the ticket.

// expoStub is a stand-in Expo Push Service: it records what was posted and
// answers with whatever the test set up.
type expoStub struct {
	mu           sync.Mutex
	sendBodies   []map[string]any
	receiptIDs   []string
	sendResponse string
	receiptResp  string
	receiptCalls int
}

func newExpoStub(t *testing.T) (*expoStub, *ExpoPushSender, *prunes) {
	t.Helper()
	stub := &expoStub{
		sendResponse: `{"data":[{"status":"ok","id":"ticket-1"}]}`,
		receiptResp:  `{"data":{}}`,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/send", func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var batch []map[string]any
		_ = json.Unmarshal(raw, &batch)
		stub.mu.Lock()
		if len(batch) > 0 {
			stub.sendBodies = append(stub.sendBodies, batch[0])
		}
		resp := stub.sendResponse
		stub.mu.Unlock()
		_, _ = io.WriteString(w, resp)
	})
	mux.HandleFunc("/receipts", func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var req struct {
			IDs []string `json:"ids"`
		}
		_ = json.Unmarshal(raw, &req)
		stub.mu.Lock()
		stub.receiptIDs = append(stub.receiptIDs, req.IDs...)
		stub.receiptCalls++
		resp := stub.receiptResp
		stub.mu.Unlock()
		_, _ = io.WriteString(w, resp)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	pruned := &prunes{}
	sender := NewExpoPushSender(t.Context(), pruned.record)
	t.Cleanup(sender.Close)
	sender.sendURL = srv.URL + "/send"
	sender.receiptURL = srv.URL + "/receipts"
	sender.httpClient = srv.Client()
	return stub, sender, pruned
}

// prunes records the endpoints the sender asked to have pruned.
type prunes struct {
	mu        sync.Mutex
	endpoints []string
}

func (p *prunes) record(_ context.Context, endpoint string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.endpoints = append(p.endpoints, endpoint)
}

func (p *prunes) list() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.endpoints...)
}

func (s *expoStub) sent() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]map[string]any(nil), s.sendBodies...)
}

// An Expo device id. Not a credential — it is a routing address the push
// service mints per install and the client hands us in the clear.
const expoDeviceID = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"

func TestExpoSendPostsMinimalContent(t *testing.T) {
	t.Parallel()
	stub, sender, _ := newExpoStub(t)

	err := sender.Send(t.Context(),
		Subscription{Kind: KindExpo, Endpoint: expoDeviceID},
		Message{Title: "OCF IMS", Body: "You were mentioned in incident #12", URL: "/incidents/12"})
	require.NoError(t, err)

	sent := stub.sent()
	require.Len(t, sent, 1)
	require.Equal(t, expoDeviceID, sent[0]["to"])
	require.Equal(t, "You were mentioned in incident #12", sent[0]["body"])
	// 09p S8: a deep link, never incident text. A native notification is more
	// exposed on a lock screen than a browser one, not less.
	require.Equal(t, map[string]any{"url": "/incidents/12"}, sent[0]["data"])
}

// The ticket-level case: Expo already knows the token is dead. This is the exact
// analogue of a 404/410 on the web path, so it returns the same sentinel and the
// caller prunes on the spot.
func TestExpoSendReturnsSubscriptionGoneOnDeadTicket(t *testing.T) {
	t.Parallel()
	stub, sender, _ := newExpoStub(t)
	stub.sendResponse = `{"data":[{"status":"error","message":"not registered",
		"details":{"error":"DeviceNotRegistered"}}]}`

	err := sender.Send(t.Context(), Subscription{Kind: KindExpo, Endpoint: expoDeviceID}, Message{})
	require.ErrorIs(t, err, ErrSubscriptionGone)
}

// A non-fatal ticket error must NOT prune: a transient failure that deleted the
// subscription would silently unsubscribe a working device.
func TestExpoSendTransientTicketErrorDoesNotPrune(t *testing.T) {
	t.Parallel()
	stub, sender, pruned := newExpoStub(t)
	stub.sendResponse = `{"data":[{"status":"error","message":"too many requests",
		"details":{"error":"MessageRateExceeded"}}]}`

	err := sender.Send(t.Context(), Subscription{Kind: KindExpo, Endpoint: expoDeviceID}, Message{})
	require.Error(t, err)
	require.NotErrorIs(t, err, ErrSubscriptionGone)
	require.Empty(t, pruned.list())
}

// 09p S5, the point of the whole receipt machinery: DeviceNotRegistered usually
// arrives ONLY in the receipt. A sender that stopped at the ticket would fan out
// to this token forever.
func TestExpoPrunesFromTheReceipt(t *testing.T) {
	t.Parallel()
	stub, sender, pruned := newExpoStub(t)
	stub.receiptResp = `{"data":{"ticket-1":{"status":"error","message":"gone",
		"details":{"error":"DeviceNotRegistered"}}}}`

	err := sender.Send(t.Context(), Subscription{Kind: KindExpo, Endpoint: expoDeviceID}, Message{})
	require.NoError(t, err, "the ticket was accepted; the bad news comes later")
	require.Empty(t, pruned.list(), "nothing is known yet at ticket time")

	// Age the ticket past the receipt delay and sweep by hand, rather than
	// waiting a quarter of an hour.
	sender.now = func() time.Time { return time.Now().Add(2 * receiptDelay) }
	sender.checkDueReceipts(t.Context())

	require.Equal(t, []string{expoDeviceID}, pruned.list(),
		"a device Expo reports as unregistered must be pruned")
	require.Equal(t, []string{"ticket-1"}, stub.receiptIDs)
}

// A receipt error that is not DeviceNotRegistered is a delivery problem, not a
// dead device, and must not prune.
func TestExpoReceiptErrorOtherThanUnregisteredDoesNotPrune(t *testing.T) {
	t.Parallel()
	stub, sender, pruned := newExpoStub(t)
	stub.receiptResp = `{"data":{"ticket-1":{"status":"error","message":"apns down",
		"details":{"error":"MessageTooBig"}}}}`

	require.NoError(t, sender.Send(t.Context(), Subscription{Kind: KindExpo, Endpoint: expoDeviceID}, Message{}))
	sender.now = func() time.Time { return time.Now().Add(2 * receiptDelay) }
	sender.checkDueReceipts(t.Context())

	require.Empty(t, pruned.list())
}

// A ticket that has not aged yet must not be asked about — that is the whole
// reason for the delay, and asking early just wastes a round trip.
func TestExpoDoesNotAskForYoungReceipts(t *testing.T) {
	t.Parallel()
	stub, sender, _ := newExpoStub(t)

	require.NoError(t, sender.Send(t.Context(), Subscription{Kind: KindExpo, Endpoint: expoDeviceID}, Message{}))
	sender.checkDueReceipts(t.Context())

	stub.mu.Lock()
	defer stub.mu.Unlock()
	require.Zero(t, stub.receiptCalls, "a fresh ticket has no receipt to fetch yet")
}

// The in-memory queue is bounded: a long-running server must not grow a ticket
// list without limit. Losing a prune is survivable; unbounded memory is not.
func TestExpoReceiptQueueIsBounded(t *testing.T) {
	t.Parallel()
	_, sender, _ := newExpoStub(t)
	for i := range pendingLimit + 50 {
		sender.queueReceipt("ticket", expoDeviceID)
		_ = i
	}
	sender.mu.Lock()
	defer sender.mu.Unlock()
	require.Len(t, sender.pending, pendingLimit)
	require.Equal(t, 50, sender.dropped)
}

func TestRedactTokenKeepsTokensOutOfLogs(t *testing.T) {
	t.Parallel()
	got := redactToken(expoDeviceID)
	require.NotContains(t, got, "xxxxxxxxxxxxxxxxxxxxxx")
	require.Contains(t, got, "…")
	require.Equal(t, "…", redactToken("short"))
}
