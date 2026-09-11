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

// Native (Expo) device registration (plan 09p 3b.0c). An Expo token is stored in
// PUSH_SUBSCRIPTION.ENDPOINT with KIND='expo' and no crypto keys, so it stays
// the device's unique identity and the upsert, the fan-out index and the prune
// path work unchanged (S4).

// RegisterPushDevice stores (or re-homes) one native device for the caller.
// Re-homing a token to whoever signed in last is what stops the previous user's
// notifications reaching a phone someone else now holds.
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
		// CREATED is left alone, as on the web path.
		err = s.ImsDBQ.UpdatePushSubscriptionByEndpoint(ctx, s.ImsDBQ, imsdb.UpdatePushSubscriptionByEndpointParams{
			PersonID: personID,
			Kind:     string(pushlib.KindExpo),
			// Null: an Expo device has no Web Push keys.
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
		// Two sign-ins racing on a new token lose to the ENDPOINT unique key;
		// the device is registered either way (same as SubscribePush).
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

// UnregisterPushDevice forgets one of the caller's native devices. Scoped to the
// caller by PERSON_ID, the same floor as UnsubscribePush.
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
