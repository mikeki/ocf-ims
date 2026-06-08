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
	"fmt"
	"github.com/mikeki/ocf-ims/directory"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"net/http"
	"time"
)

type GetPersonnel struct {
	imsDBQ            *store.DBQ
	userStore         directory.UserStore
	cacheControlShort time.Duration
}

type GetPersonnelResponse []imsjson.Person

func (action GetPersonnel) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.getPersonnel(req)
	if errHTTP != nil {
		errHTTP.From("[getPersonnel]").WriteResponse(w)
		return
	}
	w.Header().Set("Cache-Control", fmt.Sprintf("max-age=%v, private", action.cacheControlShort.Milliseconds()/1000))
	mustWriteJSON(w, req, resp)
}
func (action GetPersonnel) getPersonnel(req *http.Request) (GetPersonnelResponse, *herr.HTTPError) {
	response := make(GetPersonnelResponse, 0)
	_, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return response, errHTTP.From("[getGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalReadPersonnel == 0 {
		return response, herr.Forbidden("The requestor does not have GlobalReadPersonnel permission", nil)
	}

	people, err := action.userStore.GetPeople(req.Context())
	if err != nil {
		return response, herr.InternalServerError("Failed to get personnel", err).From("[GetPeople]")
	}

	for _, person := range people {
		response = append(response, imsjson.Person{
			Handle: person.Handle,
			// Don't send email addresses in the API.
			// This is also done as a backstop in imsjson.Person itself, with `json:"-"`
			Email: "",
			// Don't send passwords in the API
			// This is also done as a backstop in imsjson.Person itself, with `json:"-"`
			Password: "",
			Status:   person.Status,
			Onsite:   person.Onsite,
			IsAdmin:  person.IsAdmin,
			PersonID: person.PersonID,
		})
	}

	return response, nil
}
