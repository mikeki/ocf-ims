// SPDX-License-Identifier: Apache-2.0

package push

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"connectrpc.com/connect"
	"github.com/go-sql-driver/mysql"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/internal/person"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/conv"
	pushlib "github.com/mikeki/ocf-ims/lib/push"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// Native (Expo) device registration — plan 09p, slice 3b.0c.
//
// These share PUSH_SUBSCRIPTION with the browser subscriptions above. An Expo
// token is written to ENDPOINT with KIND='expo' and no crypto keys, so it stays
// the device's unique identity: the upsert-on-endpoint behaviour, the
// PUSH_SUBSCRIPTION_BY_PERSON fan-out index and the prune path all work
// unchanged, which is the whole reason S4 put the token in ENDPOINT rather than
// in a column of its own.

// RegisterPushDevice stores (or re-homes) one native device for the calling
// person. Registering the same install again upserts on its token.
//
// The re-homing argument from SubscribePush carries over exactly, and is if
// anything stronger here: an ExponentPushToken is minted per install by Expo, so
// a collision means the same physical device, and re-homing it to whoever signed
// in last is what stops the previous user's notifications arriving on a phone
// someone else now holds. Refusing the conflict would leak them instead.
func (s Service) RegisterPushDevice(
	ctx context.Context,
	req *rpcv1.RegisterPushDeviceRequest,
	userAgent string,
) (*rpcv1.RegisterPushDeviceResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	personID := claims.PersonID()
	token := req.GetExpoPushToken()

	ua := sql.NullString{}
	if userAgent != "" {
		ua = sql.NullString{String: userAgent, Valid: true}
	}

	_, err := s.ImsDBQ.PushSubscriptionByEndpoint(ctx, s.ImsDBQ, token)
	switch {
	case err == nil:
		// CREATED is left alone, as on the web path: it stays the device's
		// first-seen time so a future "your devices" list orders stably despite
		// a re-register on every sign-in.
		err = s.ImsDBQ.UpdatePushSubscriptionByEndpoint(ctx, s.ImsDBQ, imsdb.UpdatePushSubscriptionByEndpointParams{
			PersonID: personID,
			Kind:     string(pushlib.KindExpo),
			// Null, not empty: an Expo device has no Web Push crypto keys at
			// all, and the columns are nullable (09p S4) to say so rather than
			// to store two empty strings that look like data.
			P256dh:    sql.NullString{},
			Auth:      sql.NullString{},
			UserAgent: ua,
			Endpoint:  token,
		})
		if err != nil {
			return nil, server.InternalError("failed to update push device", err)
		}
	case errors.Is(err, sql.ErrNoRows):
		err = s.ImsDBQ.InsertPushSubscription(ctx, s.ImsDBQ, imsdb.InsertPushSubscriptionParams{
			PersonID:  personID,
			Endpoint:  token,
			Kind:      string(pushlib.KindExpo),
			P256dh:    sql.NullString{},
			Auth:      sql.NullString{},
			UserAgent: ua,
			Created:   conv.TimeToFloat(time.Now()),
		})
		// Two sign-ins racing on a brand-new token lose to the ENDPOINT unique
		// constraint; that just means the device is already registered, so it is
		// an idempotent success rather than an error (same as SubscribePush).
		var mysqlErr *mysql.MySQLError
		if errors.As(err, &mysqlErr) && mysqlErr.Number == person.DupEntryError {
			return &rpcv1.RegisterPushDeviceResponse{}, nil
		}
		if err != nil {
			return nil, server.InternalError("failed to store push device", err)
		}
	default:
		return nil, server.InternalError("failed to look up push device", err)
	}
	return &rpcv1.RegisterPushDeviceResponse{}, nil
}

// UnregisterPushDevice forgets one of the caller's native devices, addressed by
// its Expo token. Scoped to the caller (the delete keys on PERSON_ID) so a
// person can only remove their own — the same floor as UnsubscribePush.
func (s Service) UnregisterPushDevice(
	ctx context.Context,
	req *rpcv1.UnregisterPushDeviceRequest,
) (*rpcv1.UnregisterPushDeviceResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	err := s.ImsDBQ.DeletePushSubscription(ctx, s.ImsDBQ, imsdb.DeletePushSubscriptionParams{
		Endpoint: req.GetExpoPushToken(),
		PersonID: claims.PersonID(),
	})
	if err != nil {
		return nil, server.InternalError("failed to remove push device", err)
	}
	return &rpcv1.UnregisterPushDeviceResponse{}, nil
}
