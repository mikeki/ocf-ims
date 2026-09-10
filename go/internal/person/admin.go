// SPDX-License-Identifier: Apache-2.0

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
