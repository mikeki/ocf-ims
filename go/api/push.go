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
	"database/sql"
	"errors"
	"net/http"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// PushSubscribeRequest mirrors the browser's PushSubscription.toJSON() shape, so
// the page can POST the subscription it gets back from PushManager.subscribe()
// verbatim (plan 84). expirationTime is ignored — we re-subscribe on page load.
type PushSubscribeRequest struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// PushUnsubscribeRequest names the device to forget by its push endpoint.
type PushUnsubscribeRequest struct {
	Endpoint string `json:"endpoint"`
}

// PostPushSubscribe stores (or refreshes) one device's web-push subscription for
// the calling person. Per-person and per-device, so it needs only authentication
// — no event scoping. Re-subscribing the same browser upserts on its endpoint.
type PostPushSubscribe struct {
	imsDBQ *store.DBQ
}

func (action PostPushSubscribe) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.subscribe(req)
	if errHTTP != nil {
		errHTTP.From("[subscribe]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Success")
}

func (action PostPushSubscribe) subscribe(req *http.Request) *herr.HTTPError {
	jwtCtx, errHTTP := server.GetJwtCtx(req)
	if errHTTP != nil {
		return errHTTP.From("[server.GetJwtCtx]")
	}
	ctx := req.Context()
	personID := jwtCtx.Claims.PersonID()

	body, errHTTP := server.ReadBodyAs[PushSubscribeRequest](req)
	if errHTTP != nil {
		return errHTTP.From("[server.ReadBodyAs]")
	}
	if body.Endpoint == "" || body.Keys.P256dh == "" || body.Keys.Auth == "" {
		return herr.BadRequest("A push subscription requires an endpoint and keys", nil)
	}

	// Best-effort device label; never required.
	userAgent := sql.NullString{}
	if ua := req.UserAgent(); ua != "" {
		userAgent = sql.NullString{String: ua, Valid: true}
	}
	now := conv.TimeToFloat(time.Now())

	// A device's endpoint is its identity. Read-first then insert-or-update (rather
	// than an ODKU upsert) matches the store's convention; PERSON_ID is rewritten on
	// update so the device re-homes to whoever subscribed last.
	//
	// Re-homing across persons is deliberate and is the *safer* branch, not an IDOR:
	// a push endpoint is a per-browser, unguessable secret minted by the push
	// service, so a collision means the SAME physical browser. The real case is a
	// shared/kiosk browser — A subscribes, leaves without unsubscribing, then B logs
	// in on that browser and subscribes (same endpoint). Re-homing to B stops A's
	// notifications from being delivered to a device B now holds; rejecting the
	// conflict would instead leak A's notifications to B. A replay of a *stolen*
	// endpoint gains nothing: the row takes the new caller's encryption keys, so
	// pushes encrypt to keys the original device can't decrypt (undeliverable), no
	// notification content is exposed, and the rightful owner re-homes it back on its
	// next page-load re-subscribe. DELETE is caller-scoped (a person removes only
	// their own devices), and the endpoint is never written to the action log.
	_, err := action.imsDBQ.PushSubscriptionByEndpoint(ctx, action.imsDBQ, body.Endpoint)
	switch {
	case err == nil:
		// CREATED is not updated — it stays the device's first-seen time so the
		// future device list orders stably despite per-page-load re-subscribes.
		err = action.imsDBQ.UpdatePushSubscriptionByEndpoint(ctx, action.imsDBQ, imsdb.UpdatePushSubscriptionByEndpointParams{
			PersonID:  personID,
			P256dh:    body.Keys.P256dh,
			Auth:      body.Keys.Auth,
			UserAgent: userAgent,
			Endpoint:  body.Endpoint,
		})
		if err != nil {
			return herr.InternalServerError("Failed to update push subscription", err).From("[UpdatePushSubscriptionByEndpoint]")
		}
	case errors.Is(err, sql.ErrNoRows):
		err = action.imsDBQ.InsertPushSubscription(ctx, action.imsDBQ, imsdb.InsertPushSubscriptionParams{
			PersonID:  personID,
			Endpoint:  body.Endpoint,
			P256dh:    body.Keys.P256dh,
			Auth:      body.Keys.Auth,
			UserAgent: userAgent,
			Created:   now,
		})
		// A concurrent subscribe of the same brand-new endpoint (two tabs, a retry)
		// races between the read above and this insert; the loser hits the ENDPOINT
		// unique constraint. That just means the device is already subscribed, so
		// treat it as an idempotent success rather than a 500 — the same way person
		// creation maps a dup-key to a handled outcome.
		var mysqlErr *mysql.MySQLError
		if errors.As(err, &mysqlErr) && mysqlErr.Number == dupEntryError {
			return nil
		}
		if err != nil {
			return herr.InternalServerError("Failed to store push subscription", err).From("[InsertPushSubscription]")
		}
	default:
		return herr.InternalServerError("Failed to look up push subscription", err).From("[PushSubscriptionByEndpoint]")
	}
	return nil
}

// DeletePushSubscribe forgets one of the caller's devices, addressed by its push
// endpoint. Scoped to the caller so a person can only remove their own.
type DeletePushSubscribe struct {
	imsDBQ *store.DBQ
}

func (action DeletePushSubscribe) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.unsubscribe(req)
	if errHTTP != nil {
		errHTTP.From("[unsubscribe]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Success")
}

func (action DeletePushSubscribe) unsubscribe(req *http.Request) *herr.HTTPError {
	jwtCtx, errHTTP := server.GetJwtCtx(req)
	if errHTTP != nil {
		return errHTTP.From("[server.GetJwtCtx]")
	}
	ctx := req.Context()
	personID := jwtCtx.Claims.PersonID()

	body, errHTTP := server.ReadBodyAs[PushUnsubscribeRequest](req)
	if errHTTP != nil {
		return errHTTP.From("[server.ReadBodyAs]")
	}
	if body.Endpoint == "" {
		return herr.BadRequest("An endpoint is required to unsubscribe", nil)
	}

	err := action.imsDBQ.DeletePushSubscription(ctx, action.imsDBQ, imsdb.DeletePushSubscriptionParams{
		Endpoint: body.Endpoint,
		PersonID: personID,
	})
	if err != nil {
		return herr.InternalServerError("Failed to remove push subscription", err).From("[DeletePushSubscription]")
	}
	return nil
}
