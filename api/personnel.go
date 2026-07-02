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
	jwtCtx, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return response, errHTTP.From("[getGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalReadPersonnel == 0 {
		return response, herr.Forbidden("The requestor does not have GlobalReadPersonnel permission", nil)
	}

	// Typeahead search (?q=) backs the search-first person picker on the incident
	// and visit attach flows and the admin People page. It returns a minimal shape
	// (id, legal name, fair name?, wristband?, participation_type?) over active people and is
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
		isPersonnelAdmin := globalPermissions&authz.GlobalAdministratePersonnel != 0
		showAll := strings.EqualFold(req.FormValue("showAll"), "true")

		var eventID int32
		if eventName := strings.TrimSpace(req.FormValue("event")); eventName != "" {
			event, errHTTP := getEvent(req, eventName, action.imsDBQ)
			if errHTTP != nil {
				return response, errHTTP.From("[getEvent]")
			}
			eventID = event.ID
		}

		// The event roster (a named event, default view — not "show all") opens to a
		// non-admin inviter who holds EventInviteReporters on that event (a writer or
		// crew leader, plan 53d): it is the People tab they now manage. The global
		// listing (no event) and the "show all people" expansion stay admin-only —
		// they surface every person across events, inactive ones, and admin flags.
		rosterOnly := eventID != 0 && !showAll
		if !isPersonnelAdmin {
			if !rosterOnly {
				return response, herr.Forbidden("The requestor does not have GlobalAdministratePersonnel permission", nil)
			}
			perms, _, err := authz.EventPermissions(req.Context(), &eventID, action.imsDBQ, *jwtCtx.Claims)
			if err != nil {
				return response, herr.InternalServerError("Failed to compute permissions", err).From("[EventPermissions]")
			}
			if perms[eventID]&authz.EventInviteReporters == 0 {
				return response, herr.Forbidden("You do not have invite-reporters access to that event", nil)
			}
		}

		// With an event selected, the People page defaults to that event's roster
		// (only people with a participation row). The "Show all people" toggle sends
		// ?showAll=true to list every person instead; without an event there is no
		// roster to scope to, so we always list everyone. See slice 6j.
		if rosterOnly {
			rows, err := action.imsDBQ.EventRoster(req.Context(), action.imsDBQ, eventID)
			if err != nil {
				return response, herr.InternalServerError("Failed to get personnel", err).From("[EventRoster]")
			}
			for _, person := range rows {
				p := imsjson.Person{
					FairName:          person.FairName.String,
					LegalName:         person.LegalName.String,
					PersonID:          int64(person.ID),
					Wristband:         person.Wristband.String,
					ParticipationType: string(person.ParticipationType),
				}
				// Email/phone + admin flag drive the admin-only profile/password/admin
				// controls; a non-admin inviter has none of those, so don't leak them.
				if isPersonnelAdmin {
					p.Email = person.Email.String
					p.Phone = person.Phone.String
					p.IsAdmin = person.IsAdmin
				}
				response = append(response, p)
			}
			return response, nil
		}

		rows, err := action.imsDBQ.AllPeople(req.Context(), action.imsDBQ, eventID)
		if err != nil {
			return response, herr.InternalServerError("Failed to get personnel", err).From("[AllPeople]")
		}
		for _, person := range rows {
			p := imsjson.Person{
				FairName:  person.FairName.String,
				LegalName: person.LegalName.String,
				// Email + phone go only to this admin-gated listing so they can be edited.
				Email:     person.Email.String,
				Phone:     person.Phone.String,
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
			FairName: person.FairName,
			// Don't send email addresses in the API.
			// This is also done as a backstop in imsjson.Person itself, with `json:"-"`
			Email: "",
			// Don't send passwords in the API
			// This is also done as a backstop in imsjson.Person itself, with `json:"-"`
			Password: "",
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
			FairName:  row.FairName.String,
			LegalName: row.LegalName.String,
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
