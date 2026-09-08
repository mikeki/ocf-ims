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

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// listPersonnel assembles the personnel listing as imsjson.Person values, the shared
// role imsjson plays throughout the read path (the ListPersonnel RPC bridges the result
// to proto in connect.go). It is the ctx-based port of the retired REST GetPersonnel
// handler and preserves its mode multiplexing exactly; only the event key changed from a
// name to an id (the contract keys events by id). The caller is already authenticated
// (the RPC rejects anon); GlobalReadPersonnel is the floor checked here.
//
// Modes, in precedence order (matching the REST handler): a non-empty query is the
// event-scoped typeahead; a non-empty personIDs is the by-id filter (the profile card, or a
// batch resolve); all is the admin/roster listing (with showAll expanding an event roster to
// everyone); the default is the cached login directory.
func (s Service) listPersonnel(
	ctx context.Context,
	claims authz.IMSClaims,
	eventID int32,
	query string,
	all, showAll bool,
	personIDs []int32,
) ([]imsjson.Person, *herr.HTTPError) {
	response := make([]imsjson.Person, 0)
	_, globalPermissions, err := authz.EventPermissions(ctx, nil, s.ImsDBQ, claims)
	if err != nil {
		return response, herr.InternalServerError("Failed to compute permissions", err).From("[EventPermissions]")
	}
	if globalPermissions&authz.GlobalReadPersonnel == 0 {
		return response, herr.Forbidden("The requestor does not have GlobalReadPersonnel permission", nil)
	}

	// Typeahead search (query) backs the search-first person picker on the incident and
	// visit attach flows and the admin People page. It returns a minimal shape (id, name,
	// handle?, wristband?, participation_type?) over active people and is gated only on
	// GlobalReadPersonnel (any logged-in user; see R4 in the plan).
	if q := strings.TrimSpace(query); q != "" {
		return s.searchPersonnel(ctx, eventID, q)
	}

	// A person_ids lookup filters the listing to exactly those people. It backs the person
	// profile card (clicking a person in an incident's People list sends that one id) and lets
	// a client resolve an incident's attached people in one call. Each row carries identity
	// (fair name + legal name) and — when an event is scoped — participation and crews in that
	// event, with email/phone included only for a personnel admin or on the caller's own row,
	// mirroring the all= listing's contact gate. Any logged-in user (GlobalReadPersonnel,
	// checked above) may see identity + participation; only an admin sees contact info.
	// protovalidate has already bounded the list (1..100 positive, unique ids).
	if len(personIDs) > 0 {
		return s.personnelByIDs(ctx, personIDs, eventID, globalPermissions, claims.PersonID())
	}

	// The admin People page requests all=true to manage every person, including inactive
	// ones (so they can be reactivated). That requires the stronger
	// GlobalAdministratePersonnel and bypasses the cached, active-only directory used by
	// login and the attach-person autocompletes. An event scopes the per-event wristband +
	// participation columns (identity is global, but those are per-event); without one those
	// fields are empty for everyone.
	if all {
		return s.listAllPersonnel(ctx, claims, eventID, showAll, globalPermissions)
	}

	people, err := s.UserStore.GetPeople(ctx)
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

// listAllPersonnel is the all=true admin/roster branch of listPersonnel. It stays admin-only
// (GlobalAdministratePersonnel) except for the event roster, which a non-admin inviter holding
// EventInviteReporters on that event may see (the People tab they manage, plan 53d).
func (s Service) listAllPersonnel(
	ctx context.Context,
	claims authz.IMSClaims,
	eventID int32,
	showAll bool,
	globalPermissions authz.GlobalPermissionMask,
) ([]imsjson.Person, *herr.HTTPError) {
	response := make([]imsjson.Person, 0)
	isPersonnelAdmin := globalPermissions&authz.GlobalAdministratePersonnel != 0

	if eventID != 0 {
		errHTTP := s.requireEvent(ctx, eventID)
		if errHTTP != nil {
			return response, errHTTP
		}
	}

	// The event roster (a named event, default view — not "show all") opens to a non-admin
	// inviter who holds EventInviteReporters on that event (a writer or crew leader, plan 53d):
	// it is the People tab they now manage. The global listing (no event) and the "show all
	// people" expansion stay admin-only — they surface every person across events, inactive
	// ones, and admin flags.
	rosterOnly := eventID != 0 && !showAll
	if !isPersonnelAdmin {
		if !rosterOnly {
			return response, herr.Forbidden("The requestor does not have GlobalAdministratePersonnel permission", nil)
		}
		perms, _, err := authz.EventPermissions(ctx, &eventID, s.ImsDBQ, claims)
		if err != nil {
			return response, herr.InternalServerError("Failed to compute permissions", err).From("[EventPermissions]")
		}
		if perms[eventID]&authz.EventInviteReporters == 0 {
			return response, herr.Forbidden("You do not have invite-reporters access to that event", nil)
		}
	}

	// Annotate each person with their crews for this event (slice 10c): one query for the
	// whole roster (avoids an N+1), grouped by person id. Empty when no event is scoped —
	// crews are per-event.
	var crewsByPerson map[int32][]imsjson.PersonCrew
	if eventID != 0 {
		m, err := crewsByPersonForEvent(ctx, s.ImsDBQ, eventID)
		if err != nil {
			return response, herr.InternalServerError("Failed to get crew memberships", err).From("[EventCrewMemberships]")
		}
		crewsByPerson = m
	}

	// With an event selected, the People page defaults to that event's roster (only people
	// with a participation row). The "Show all people" toggle sends show_all to list every
	// person instead; without an event there is no roster to scope to, so we always list
	// everyone. See slice 6j.
	if rosterOnly {
		rows, err := s.ImsDBQ.EventRoster(ctx, s.ImsDBQ, eventID)
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
				Crews:             crewsByPerson[person.ID],
			}
			// Email/phone + admin flag drive the admin-only profile/password/admin controls;
			// a non-admin inviter has none of those, so don't leak them.
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

	rows, err := s.ImsDBQ.AllPeople(ctx, s.ImsDBQ, eventID)
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
			Crews:       crewsByPerson[person.ID],
		}
		if person.ParticipationType.Valid {
			p.ParticipationType = string(person.ParticipationType.PersonEventParticipationType)
		}
		response = append(response, p)
	}
	return response, nil
}

// personnelByIDs is the person_ids branch of listPersonnel: the profile card (one id) and the
// batch resolve (several). It is a list FILTER, not a get — the result is exactly the requested
// people, in request order, and an id that matches no person is simply absent rather than an
// error (protovalidate already bounds the list to 1..100 positive, unique ids). Identity + picture
// go to any authenticated viewer; email/phone are gated on GlobalAdministratePersonnel or on the
// caller's own row, exactly like the all= admin listing; the admin flag stays admin-only. With an
// event scoped, each person's wristband + participation type + crews for that event are included
// (empty if they have no row for it). Three set queries regardless of how many ids: the people,
// their participation rows, and the event's crew memberships.
func (s Service) personnelByIDs(
	ctx context.Context,
	personIDs []int32,
	eventID int32,
	globalPermissions authz.GlobalPermissionMask,
	callerID int32,
) ([]imsjson.Person, *herr.HTTPError) {
	response := make([]imsjson.Person, 0, len(personIDs))
	rows, err := s.ImsDBQ.PeopleByIDs(ctx, s.ImsDBQ, personIDs)
	if err != nil {
		return response, herr.InternalServerError("Failed to get people", err).From("[PeopleByIDs]")
	}
	byID := make(map[int32]imsdb.PeopleByIDsRow, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}
	isPersonnelAdmin := globalPermissions&authz.GlobalAdministratePersonnel != 0

	// With an event scoped, include that event's participation + wristband and crews — the same
	// per-event fields the roster carries — fetched once for the whole set (no N+1). A person
	// with no participation row for the event is not an error; their per-event fields stay empty.
	var participation map[int32]imsdb.PersonEvent
	var crewsByPerson map[int32][]imsjson.PersonCrew
	if eventID != 0 {
		errHTTP := s.requireEvent(ctx, eventID)
		if errHTTP != nil {
			return response, errHTTP
		}
		peRows, err := s.ImsDBQ.PersonEventsForPeople(ctx, s.ImsDBQ, imsdb.PersonEventsForPeopleParams{
			Event:     eventID,
			PersonIds: personIDs,
		})
		if err != nil {
			return response, herr.InternalServerError("Failed to get participation", err).From("[PersonEventsForPeople]")
		}
		participation = make(map[int32]imsdb.PersonEvent, len(peRows))
		for _, pe := range peRows {
			participation[pe.PersonID] = pe
		}
		crewsByPerson, err = crewsByPersonForEvent(ctx, s.ImsDBQ, eventID)
		if err != nil {
			return response, herr.InternalServerError("Failed to get crew memberships", err).From("[EventCrewMemberships]")
		}
	}

	for _, id := range personIDs {
		person, found := byID[id]
		if !found {
			// A list filter: an unknown id is absent from the result, not a 404.
			continue
		}
		p := imsjson.Person{
			PersonID: int64(person.ID),
			Handle:   person.Handle.String,
			Name:     person.Name.String,
		}
		// A profile picture is an identification aid, not contact PII, so its URL goes to anyone
		// who can open the card (unlike email/phone below). Sent only when the person actually
		// has one; the URL points at the picture serve endpoint.
		if person.ProfilePicture.Valid && person.ProfilePicture.String != "" {
			url := personProfilePictureURL(person.ID)
			p.ProfilePictureURL = &url
		}
		// Contact info is shown to a personnel admin (like the all= listing) and to the person
		// viewing their OWN row — they need to see and self-edit their email/phone. The admin
		// flag stays admin-only (it's not self-editable and not the viewer's concern on their
		// own card).
		isSelf := callerID > 0 && person.ID == callerID
		if isPersonnelAdmin || isSelf {
			p.Email = person.Email.String
			p.Phone = person.Phone.String
		}
		if isPersonnelAdmin {
			p.IsAdmin = person.IsAdmin
		}
		if pe, enrolled := participation[person.ID]; enrolled {
			p.Wristband = pe.Wristband.String
			p.ParticipationType = string(pe.ParticipationType)
		}
		p.Crews = crewsByPerson[person.ID]
		response = append(response, p)
	}
	return response, nil
}

// crewsByPersonForEvent returns each person's crews for an event, keyed by person id — one
// query for the whole roster (slice 10c).
func crewsByPersonForEvent(ctx context.Context, imsDBQ *store.DBQ, eventID int32) (map[int32][]imsjson.PersonCrew, error) {
	rows, err := imsDBQ.EventCrewMemberships(ctx, imsDBQ, eventID)
	if err != nil {
		return nil, err
	}
	out := make(map[int32][]imsjson.PersonCrew)
	for _, r := range rows {
		out[r.PersonID] = append(out[r.PersonID], imsjson.PersonCrew{
			Name:     r.CrewName,
			Slug:     r.CrewSlug,
			IsLeader: r.IsLeader,
		})
	}
	return out, nil
}

// searchPersonnel runs the typeahead query. With an event scoped, each hit carries that event's
// wristband and participation type, and the wristband becomes searchable; without one, those
// per-event fields are empty.
func (s Service) searchPersonnel(ctx context.Context, eventID int32, q string) ([]imsjson.Person, *herr.HTTPError) {
	response := make([]imsjson.Person, 0)
	// D-P4: require >= 2 chars so a single keystroke doesn't dump the registry.
	if len([]rune(q)) < 2 {
		return response, nil
	}

	if eventID != 0 {
		errHTTP := s.requireEvent(ctx, eventID)
		if errHTTP != nil {
			return response, errHTTP
		}
	}

	rows, err := s.ImsDBQ.SearchPeople(ctx, s.ImsDBQ, imsdb.SearchPeopleParams{
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

// requireEvent validates that an event id exists, returning NotFound if not — the id-keyed
// analogue of the REST server.GetEvent(name) lookup the personnel modes used to guard an event
// scope. Callers hold the id already, so only the error is returned (it exists only to surface
// the 404).
func (s Service) requireEvent(ctx context.Context, eventID int32) *herr.HTTPError {
	_, err := s.ImsDBQ.Event(ctx, s.ImsDBQ, eventID)
	if errors.Is(err, sql.ErrNoRows) {
		return herr.NotFound("No such event", err)
	}
	if err != nil {
		return herr.InternalServerError("Failed to get event", err).From("[Event]")
	}
	return nil
}

// escapeLike escapes the LIKE metacharacters in user input so a typed '%' or '_' matches
// literally rather than as a wildcard (default backslash is the escape).
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}
