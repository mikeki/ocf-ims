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
	"fmt"
	"github.com/mikeki/ocf-ims/directory"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"net/http"
	"strconv"
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
	// (id, name, handle?, wristband?, participation_type?) over active people and is
	// gated only on GlobalReadPersonnel (any logged-in user; see R4 in the plan).
	if q := strings.TrimSpace(req.FormValue("q")); q != "" {
		return action.searchPersonnel(req, q)
	}

	// A ?person_id= lookup backs the person profile card: clicking a person in an
	// incident's People list opens a card showing their details. It returns that one
	// person's identity (fair name + legal name) and — when ?event= is given — their
	// participation in that event, with email/phone included only for a personnel
	// admin, mirroring the ?all= listing's contact gate. Any logged-in user
	// (GlobalReadPersonnel, checked above) may see identity + participation, the same
	// fields the ?q= typeahead already returns; only an admin sees contact info.
	if pid := strings.TrimSpace(req.FormValue("person_id")); pid != "" {
		return action.personnelByID(req, pid, globalPermissions)
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
					Handle:            person.Handle.String,
					Name:              person.Name.String,
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
					// Whether they can sign in — a fair name alone is identity, not access.
					p.HasPassword = person.HasPassword
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
				Handle: person.Handle.String,
				Name:   person.Name.String,
				// Email + phone go only to this admin-gated listing so they can be edited.
				Email:       person.Email.String,
				Phone:       person.Phone.String,
				IsAdmin:     person.IsAdmin,
				HasPassword: person.HasPassword,
				PersonID:    int64(person.ID),
				Wristband:   person.Wristband.String,
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
			IsAdmin:  person.IsAdmin,
			PersonID: person.PersonID,
		})
	}

	return response, nil
}

// personnelByID returns a single person for the profile card. Identity (fair name
// + legal name) goes to any authenticated viewer; email/phone are gated on
// GlobalAdministratePersonnel, exactly like the ?all= admin listing. With an event
// named (?event=), the person's wristband + participation type for that event are
// included (empty if they have no row for it).
func (action GetPersonnel) personnelByID(req *http.Request, pidStr string, globalPermissions authz.GlobalPermissionMask) (GetPersonnelResponse, *herr.HTTPError) {
	response := make(GetPersonnelResponse, 0)
	pid, err := strconv.ParseInt(pidStr, 10, 32)
	if err != nil || pid <= 0 {
		return response, herr.BadRequest("Invalid person_id", err)
	}

	person, err := action.imsDBQ.PersonByID(req.Context(), action.imsDBQ, int32(pid))
	if errors.Is(err, sql.ErrNoRows) {
		return response, herr.NotFound("No such person", err)
	}
	if err != nil {
		return response, herr.InternalServerError("Failed to get person", err).From("[PersonByID]")
	}

	p := imsjson.Person{
		PersonID: int64(person.ID),
		Handle:   person.Handle.String,
		Name:     person.Name.String,
	}
	// Contact info + admin flag are admin-only, exactly like the ?all= listing.
	if globalPermissions&authz.GlobalAdministratePersonnel != 0 {
		p.Email = person.Email.String
		p.Phone = person.Phone.String
		p.IsAdmin = person.IsAdmin
	}

	// With an event scoped, include that event's participation + wristband — the same
	// per-event fields the roster/typeahead carry. A missing row is not an error.
	if eventName := strings.TrimSpace(req.FormValue("event")); eventName != "" {
		event, errHTTP := getEvent(req, eventName, action.imsDBQ)
		if errHTTP != nil {
			return response, errHTTP.From("[getEvent]")
		}
		pe, err := action.imsDBQ.PersonEvent(req.Context(), action.imsDBQ, imsdb.PersonEventParams{
			PersonID: person.ID,
			Event:    event.ID,
		})
		switch {
		case err == nil:
			p.Wristband = pe.Wristband.String
			p.ParticipationType = string(pe.ParticipationType)
		case errors.Is(err, sql.ErrNoRows):
			// No participation row for this event — leave the fields empty.
		default:
			return response, herr.InternalServerError("Failed to get participation", err).From("[PersonEvent]")
		}
	}

	response = append(response, p)
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
