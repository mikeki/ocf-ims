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
	"fmt"
	"github.com/mikeki/ocf-ims/directory"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"net/http"
	"strings"
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

	// Typeahead search (?q=) backs the search-first person picker on the incident
	// and visit attach flows and the admin People page. It returns a minimal shape
	// (id, name, handle?, wristband?, participation_type?) over active people and is
	// gated only on GlobalReadPersonnel (any logged-in user; see R4 in the plan).
	if q := strings.TrimSpace(req.FormValue("q")); q != "" {
		return action.searchPersonnel(req, q)
	}

	// The admin People page requests ?all=true to manage every person, including
	// inactive ones (so they can be reactivated). That requires the stronger
	// GlobalAdministratePersonnel and bypasses the cached, active-only directory
	// used by login and the attach-person autocompletes. An optional ?event= scopes
	// the per-event wristband + participation columns (identity is global, but those
	// are per-event); without it those fields are empty for everyone.
	if strings.EqualFold(req.FormValue("all"), "true") {
		if globalPermissions&authz.GlobalAdministratePersonnel == 0 {
			return response, herr.Forbidden("The requestor does not have GlobalAdministratePersonnel permission", nil)
		}
		var eventID int32
		if eventName := strings.TrimSpace(req.FormValue("event")); eventName != "" {
			event, errHTTP := getEvent(req, eventName, action.imsDBQ)
			if errHTTP != nil {
				return response, errHTTP.From("[getEvent]")
			}
			eventID = event.ID
		}
		rows, err := action.imsDBQ.AllPeople(req.Context(), action.imsDBQ, eventID)
		if err != nil {
			return response, herr.InternalServerError("Failed to get personnel", err).From("[AllPeople]")
		}
		for _, person := range rows {
			p := imsjson.Person{
				Handle: person.Handle.String,
				Name:   person.Name.String,
				// Email goes only to this admin-gated listing so it can be edited.
				Email:     person.Email.String,
				Status:    person.Status,
				Onsite:    person.OnSite,
				IsAdmin:   person.IsAdmin,
				PersonID:  int64(person.ID),
				Wristband: person.Wristband.String,
			}
			if person.ParticipationType.Valid {
				p.ParticipationType = string(person.ParticipationType.PersonEventParticipationType)
			}
			response = append(response, p)
		}
		return response, nil
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

// searchPersonnel runs the typeahead query. With an event named (?event=), each
// hit carries that event's wristband and participation type, and the wristband
// becomes searchable; without one, those per-event fields are empty.
func (action GetPersonnel) searchPersonnel(req *http.Request, q string) (GetPersonnelResponse, *herr.HTTPError) {
	response := make(GetPersonnelResponse, 0)
	// D-P4: require >= 2 chars so a single keystroke doesn't dump the registry.
	if len([]rune(q)) < 2 {
		return response, nil
	}

	var eventID int32
	if eventName := strings.TrimSpace(req.FormValue("event")); eventName != "" {
		event, errHTTP := getEvent(req, eventName, action.imsDBQ)
		if errHTTP != nil {
			return response, errHTTP.From("[getEvent]")
		}
		eventID = event.ID
	}

	rows, err := action.imsDBQ.SearchPeople(req.Context(), action.imsDBQ, imsdb.SearchPeopleParams{
		Event: eventID,
		Query: sql.NullString{String: "%" + escapeLike(q) + "%", Valid: true},
	})
	if err != nil {
		return response, herr.InternalServerError("Failed to search personnel", err).From("[SearchPeople]")
	}
	for _, row := range rows {
		person := imsjson.Person{
			PersonID:  int64(row.ID),
			Handle:    row.Handle.String,
			Name:      row.Name.String,
			Wristband: row.Wristband.String,
		}
		if row.ParticipationType.Valid {
			person.ParticipationType = string(row.ParticipationType.PersonEventParticipationType)
		}
		response = append(response, person)
	}
	return response, nil
}

// escapeLike escapes the LIKE metacharacters in user input so a typed '%' or '_'
// matches literally rather than as a wildcard (default backslash is the escape).
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}
