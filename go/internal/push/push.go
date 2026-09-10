// SPDX-License-Identifier: Apache-2.0

package push

// The PostPushSubscribe and DeletePushSubscribe REST handlers (POST/DELETE /push/subscribe) were
// RETIRED in slice 1c and moved onto Connect as methods on push.Service (connect.go): SubscribePush /
// UnsubscribePush. The REST routes were deleted, not shimmed (aggressive migration, plan 09 §6). The
// request DTOs below survive only as the shapes the api/integration test helpers still construct
// before bridging them to the flattened proto requests.

// PushSubscribeRequest mirrors the browser's PushSubscription.toJSON() shape (endpoint plus a nested
// keys object). The 0e contract flattens keys to p256dh/auth on SubscribePushRequest.
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
