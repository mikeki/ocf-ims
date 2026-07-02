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

package json

type Person struct {
	FairName  string `json:"fair_name"`
	LegalName string `json:"legal_name,omitempty"`
	// Email is sent ONLY by the admin People listing (GET /personnel?all=true, gated
	// on GlobalAdministratePersonnel) so admins can edit it; the login directory and
	// the typeahead search leave it empty, so omitempty withholds it there. Password
	// is never serialized.
	Email string `json:"email,omitempty"`
	// Phone is a contact number, collectable for anyone (including login-less
	// people). Like Email it is sent only by the admin People listing so admins can
	// view/edit it; other endpoints leave it empty and omitempty withholds it.
	Phone    string `json:"phone,omitempty"`
	Password string `json:"-"`
	IsAdmin  bool   `json:"is_admin"`
	PersonID int64  `json:"person_id,omitzero"`
	// Wristband and ParticipationType are per-event and only populated by the
	// typeahead search endpoint (GET /personnel?q=&event=); they're empty on the
	// login directory and admin listings. See docs/plans/51-people-registry.md.
	Wristband         string `json:"wristband,omitempty"`
	ParticipationType string `json:"participation_type,omitempty"`
}
