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

package api

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"time"

	"github.com/mikeki/ocf-ims/lib/push"
	"github.com/mikeki/ocf-ims/store"
)

// pushTitle is the lock-screen title for every IMS push. The body carries the
// (deliberately minimal) detail; see Pusher for the privacy stance.
const pushTitle = "OCF IMS"

// pushFanoutTimeout bounds one fan-out goroutine's total work (loading a
// recipient's devices and POSTing to each push service). It runs off the request
// path with its own context, so the already-returned HTTP request never waits.
const pushFanoutTimeout = 30 * time.Second

// Pusher fans web-push notifications out to a recipient's subscribed devices
// (plan 84c). It is the push sibling of EventSourcerer: the same notification
// triggers that drive the in-app bell (plan 82) and SSE additionally hand off to
// a Pusher *after the DB commit*, which delivers from a background goroutine so a
// slow/flaky push service never sits inside a request or a transaction.
//
// Content is kept minimal on purpose — a body like "You were mentioned in
// incident #12" and a deep link, never the incident's text — because the OS
// notification can surface on a lock screen visible to bystanders. The recipient
// taps through to the access-gated page for the real content.
type Pusher struct {
	imsDBQ *store.DBQ
	sender push.Sender
}

// NewPusher builds a Pusher over the given send backend. When push is
// unconfigured the backend is a push.NoopSender (Enabled() == false), so every
// fan-out short-circuits before touching the database.
func NewPusher(imsDBQ *store.DBQ, sender push.Sender) *Pusher {
	return &Pusher{imsDBQ: imsDBQ, sender: sender}
}

// notifyMentionedInIncident pushes to everyone mentioned in an incident's journal
// entries. recipientIDs may contain duplicates and the actor; both are filtered.
// Call it after the commit: it never blocks and fans out from a goroutine.
func (p *Pusher) notifyMentionedInIncident(ctx context.Context, eventName string, incidentNumber int32, recipientIDs []int32, actorPersonID int32) {
	p.fanOut(ctx, recipientIDs, actorPersonID, push.Message{
		Title: pushTitle,
		Body:  fmt.Sprintf("You were mentioned in incident #%d", incidentNumber),
		URL:   incidentAppURL(eventName, incidentNumber),
	})
}

// notifyMentionedInReport pushes to everyone mentioned in a field report's
// journal entries.
func (p *Pusher) notifyMentionedInReport(ctx context.Context, eventName string, reportNumber int32, recipientIDs []int32, actorPersonID int32) {
	p.fanOut(ctx, recipientIDs, actorPersonID, push.Message{
		Title: pushTitle,
		Body:  fmt.Sprintf("You were mentioned in field report #%d", reportNumber),
		URL:   reportAppURL(eventName, reportNumber),
	})
}

// notifyAddedToIncident pushes to a person just added to an incident's
// involvement.
func (p *Pusher) notifyAddedToIncident(ctx context.Context, eventName string, incidentNumber, recipientPersonID, actorPersonID int32) {
	p.fanOut(ctx, []int32{recipientPersonID}, actorPersonID, push.Message{
		Title: pushTitle,
		Body:  fmt.Sprintf("You were added to incident #%d", incidentNumber),
		URL:   incidentAppURL(eventName, incidentNumber),
	})
}

// fanOut filters recipients (dropping the actor, non-positive IDs, and dupes) and,
// if any remain and the backend can actually deliver, hands off to a background
// goroutine. It never blocks the caller.
func (p *Pusher) fanOut(ctx context.Context, recipientIDs []int32, actorPersonID int32, msg push.Message) {
	if p == nil || p.sender == nil || !p.sender.Enabled() {
		return
	}
	recipients := dedupeRecipients(recipientIDs, actorPersonID)
	if len(recipients) == 0 {
		return
	}
	go p.deliver(ctx, recipients, msg)
}

// dedupeRecipients normalizes a raw recipient list: it drops the actor (you
// aren't pushed about your own action — createNotification suppresses the same
// self-case for the in-app bell), drops non-positive IDs, and removes duplicates
// while preserving first-seen order.
func dedupeRecipients(recipientIDs []int32, actorPersonID int32) []int32 {
	seen := make(map[int32]bool, len(recipientIDs))
	recipients := make([]int32, 0, len(recipientIDs))
	for _, id := range recipientIDs {
		if id <= 0 || id == actorPersonID || seen[id] {
			continue
		}
		seen[id] = true
		recipients = append(recipients, id)
	}
	return recipients
}

// deliver runs in its own goroutine off the request path: for each recipient it
// loads their devices and sends, pruning any the push service reports as gone.
// Errors are logged, never propagated — push is best-effort.
func (p *Pusher) deliver(reqCtx context.Context, recipients []int32, msg push.Message) {
	// A panic here would otherwise take down the whole process, since this runs
	// outside the request's RecoverFromPanic middleware.
	defer func() {
		if r := recover(); r != nil {
			slog.Error("push: panic in fan-out goroutine", "recover", r)
		}
	}()

	// Keep the request's context values but drop its cancellation: this runs after
	// the handler has returned, so the request context is already being cancelled.
	// A fresh timeout then bounds the work so a stuck push service can't pin this
	// goroutine forever.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(reqCtx), pushFanoutTimeout)
	defer cancel()

	for _, personID := range recipients {
		subs, err := p.imsDBQ.PushSubscriptionsForPerson(ctx, p.imsDBQ, personID)
		if err != nil {
			slog.Error("push: failed to load subscriptions", "personID", personID, "err", err)
			continue
		}
		for _, row := range subs {
			sendErr := p.sender.Send(ctx, push.Subscription{
				Endpoint: row.Endpoint,
				P256dh:   row.P256dh,
				Auth:     row.Auth,
			}, msg)
			switch {
			case sendErr == nil:
				// Accepted by the push service.
			case errors.Is(sendErr, push.ErrSubscriptionGone):
				// The device is permanently gone; prune it so we stop trying.
				delErr := p.imsDBQ.DeletePushSubscriptionByEndpoint(ctx, p.imsDBQ, row.Endpoint)
				if delErr != nil {
					slog.Error("push: failed to prune dead subscription", "personID", personID, "err", delErr)
				}
			default:
				slog.Warn("push: send failed", "personID", personID, "err", sendErr)
			}
		}
	}
}

// incidentAppURL / reportAppURL build the web-app deep link the service worker
// opens on click, matching the in-app bell's notificationHref (ims.ts). The event
// name is a single path segment, so it's percent-escaped as one.
func incidentAppURL(eventName string, incidentNumber int32) string {
	return fmt.Sprintf("/ims/app/events/%s/incidents/%d", url.PathEscape(eventName), incidentNumber)
}

func reportAppURL(eventName string, reportNumber int32) string {
	return fmt.Sprintf("/ims/app/events/%s/reports/%d", url.PathEscape(eventName), reportNumber)
}
