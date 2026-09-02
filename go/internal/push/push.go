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
