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
	"database/sql"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/go-sql-driver/mysql"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/internal/person"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// Service is the web-push domain's Connect surface (plan 09h/1c): the two per-device subscription
// RPCs, retiring REST POST/DELETE /push/subscribe. Subscriptions are per-person and per-device, so
// they need only authentication — no event scoping. The contract flattens the browser's nested
// {endpoint, keys:{p256dh, auth}} shape to endpoint/p256dh/auth.
type Service struct {
	ImsDBQ *store.DBQ
}

// SubscribePush is the domain method behind the SubscribePush RPC, retiring REST POST /push/subscribe.
// It stores (or refreshes) one device's subscription for the calling person; re-subscribing the same
// browser upserts on its endpoint. userAgent is a best-effort device label pulled from the request at
// the RPC boundary (never required). The endpoint/keys are guaranteed non-empty by the request's
// min_len constraints.
//
// A device's endpoint is its identity. Read-first then insert-or-update (rather than an ODKU upsert)
// matches the store's convention; PERSON_ID is rewritten on update so the device re-homes to whoever
// subscribed last. Re-homing across persons is deliberate and is the *safer* branch, not an IDOR: a
// push endpoint is a per-browser, unguessable secret minted by the push service, so a collision means
// the SAME physical browser (a shared/kiosk browser where B subscribes after A). Re-homing to B stops
// A's notifications reaching a device B now holds; rejecting the conflict would instead leak A's
// notifications to B. A replay of a *stolen* endpoint gains nothing: the row takes the new caller's
// keys, so pushes encrypt to keys the original device can't decrypt (undeliverable), and the rightful
// owner re-homes it back on its next page-load re-subscribe.
func (s Service) SubscribePush(
	ctx context.Context,
	req *rpcv1.SubscribePushRequest,
	userAgent string,
) (*rpcv1.SubscribePushResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	personID := claims.PersonID()
	endpoint := req.GetEndpoint()

	ua := sql.NullString{}
	if userAgent != "" {
		ua = sql.NullString{String: userAgent, Valid: true}
	}
	now := conv.TimeToFloat(time.Now())

	_, err := s.ImsDBQ.PushSubscriptionByEndpoint(ctx, s.ImsDBQ, endpoint)
	switch {
	case err == nil:
		// CREATED is not updated — it stays the device's first-seen time so a future device list
		// orders stably despite per-page-load re-subscribes.
		err = s.ImsDBQ.UpdatePushSubscriptionByEndpoint(ctx, s.ImsDBQ, imsdb.UpdatePushSubscriptionByEndpointParams{
			PersonID:  personID,
			P256dh:    req.GetP256Dh(),
			Auth:      req.GetAuth(),
			UserAgent: ua,
			Endpoint:  endpoint,
		})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to update push subscription: %w", err))
		}
	case errors.Is(err, sql.ErrNoRows):
		err = s.ImsDBQ.InsertPushSubscription(ctx, s.ImsDBQ, imsdb.InsertPushSubscriptionParams{
			PersonID:  personID,
			Endpoint:  endpoint,
			P256dh:    req.GetP256Dh(),
			Auth:      req.GetAuth(),
			UserAgent: ua,
			Created:   now,
		})
		// A concurrent subscribe of the same brand-new endpoint (two tabs, a retry) races between the
		// read above and this insert; the loser hits the ENDPOINT unique constraint. That just means
		// the device is already subscribed, so treat it as an idempotent success rather than an error.
		var mysqlErr *mysql.MySQLError
		if errors.As(err, &mysqlErr) && mysqlErr.Number == person.DupEntryError {
			return &rpcv1.SubscribePushResponse{}, nil
		}
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to store push subscription: %w", err))
		}
	default:
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to look up push subscription: %w", err))
	}
	return &rpcv1.SubscribePushResponse{}, nil
}

// UnsubscribePush is the domain method behind the UnsubscribePush RPC, retiring REST DELETE
// /push/subscribe. It forgets one of the caller's devices, addressed by its push endpoint; scoped to
// the caller (the delete keys on PERSON_ID) so a person can only remove their own.
func (s Service) UnsubscribePush(
	ctx context.Context,
	req *rpcv1.UnsubscribePushRequest,
) (*rpcv1.UnsubscribePushResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	err := s.ImsDBQ.DeletePushSubscription(ctx, s.ImsDBQ, imsdb.DeletePushSubscriptionParams{
		Endpoint: req.GetEndpoint(),
		PersonID: claims.PersonID(),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to remove push subscription: %w", err))
	}
	return &rpcv1.UnsubscribePushResponse{}, nil
}
