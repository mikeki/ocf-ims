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

package person

// The SetPersonAdmin REST handler (POST /personnel/{personId}/admin) was RETIRED in slice 1c when
// it moved onto Connect as person.Service.SetPersonAdmin (connect_admin.go), which the
// ImsService.SetPersonAdmin RPC delegates to. The REST route was deleted, not shimmed (aggressive
// migration, plan 09 §6). Only the caller-is-an-admin gate + last-admin guard moved; both are
// unchanged.

// SetPersonAdminRequest is kept as the integration-test bridge type (the role imsjson plays
// elsewhere): the api/integration setPersonAdmin helper still builds it and the helper converts it
// to the proto request.
type SetPersonAdminRequest struct {
	IsAdmin bool `json:"is_admin"`
}
