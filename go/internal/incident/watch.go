// SPDX-License-Identifier: Apache-2.0

package incident

import (
	"context"
	"database/sql"
	"errors"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// The authorization half of the WatchEvent stream (plan 09p, slice 3b.0b). The
// stream mechanics live in internal/server; what lives here is the only thing
// that needs the database and the privacy rule — and it is built from the same
// primitives GetIncident and ListIncidents use (mayViewIncident, the 52f grant
// query, EventPermissions) rather than a second interpretation of them. Two
// implementations of "may this person see this" is how a private incident
// eventually leaks.

// NewWatchPolicy builds the subscribe gate and the per-poke visibility rule the
// hub consults.
func NewWatchPolicy(imsDBQ *store.DBQ) server.WatchPolicy {
	return server.WatchPolicy{
		MayWatch: mayWatchEvent(imsDBQ),
		Visible:  pokeVisible(imsDBQ),
	}
}

// mayWatchEvent is the subscribe-time gate: the event must exist, and the caller
// must either be able to read incidents in it or hold at least one per-incident
// grant there (the 52f case — a reporter with no event-wide read who was granted
// one incident still has a reason to watch).
func mayWatchEvent(imsDBQ *store.DBQ) func(context.Context, *authz.IMSClaims, int32) error {
	return func(ctx context.Context, claims *authz.IMSClaims, eventID int32) error {
		if claims == nil {
			return connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
		}
		_, err := imsDBQ.Event(ctx, imsDBQ, eventID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return connect.NewError(connect.CodeNotFound, errors.New("event not found"))
			}
			return server.InternalError("failed to fetch event", err)
		}
		if claims.PersonAdmin() {
			return nil
		}
		eventPerms, _, err := authz.EventPermissions(ctx, &eventID, imsDBQ, *claims)
		if err != nil {
			return server.InternalError("failed to compute permissions", err)
		}
		if eventPerms[eventID]&authz.EventReadIncidents != 0 {
			return nil
		}
		granted, err := imsDBQ.GrantedIncidentNumbersForPerson(ctx, imsDBQ,
			imsdb.GrantedIncidentNumbersForPersonParams{Event: eventID, PersonID: claims.PersonID()})
		if err != nil {
			return server.InternalError("failed to fetch granted incidents", err)
		}
		if len(granted) > 0 {
			return nil
		}
		return connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have EventReadIncidents permission"))
	}
}

// pokeVisible answers, for one subscriber and one poke, whether they may be told.
//
// It re-reads the incident row on every call on purpose. That is the whole point
// of S3: an incident marked private, or an access revoked, while someone is
// watching has to take effect on the next poke — not on the next reconnect.
func pokeVisible(imsDBQ *store.DBQ) server.PokeVisibility {
	return func(ctx context.Context, claims *authz.IMSClaims, poke server.Poke) (bool, error) {
		if claims == nil {
			return false, nil
		}
		eventPerms, _, err := authz.EventPermissions(ctx, &poke.EventID, imsDBQ, *claims)
		if err != nil {
			return false, err
		}
		hasEventRead := eventPerms[poke.EventID]&authz.EventReadIncidents != 0
		viewerPersonID := claims.PersonID()
		viewerIsAdmin := claims.PersonAdmin()

		if poke.IncidentNumber == 0 {
			// A report poke. Reports carry no per-resource privacy flag of their
			// own, so event-wide read is the gate, exactly as on the read path.
			// A caller who is in this event only by a per-incident grant has no
			// business being told a report changed, so a grant does not open it.
			return viewerIsAdmin || hasEventRead, nil
		}

		row, err := imsDBQ.Incident(ctx, imsDBQ, imsdb.IncidentParams{
			Event: poke.EventID, Number: poke.IncidentNumber,
		})
		if errors.Is(err, sql.ErrNoRows) {
			// It went away between the publish and this check. There is nothing
			// to tell anyone about.
			return false, nil
		}
		if err != nil {
			return false, err
		}
		hasGrant := false
		if !viewerIsAdmin {
			hasGrant, err = imsDBQ.IncidentPersonHasGrant(ctx, imsDBQ, imsdb.IncidentPersonHasGrantParams{
				Event: poke.EventID, IncidentNumber: poke.IncidentNumber, PersonID: viewerPersonID,
			})
			if err != nil {
				return false, err
			}
		}
		return mayViewIncident(row.Incident.Private, row.Incident.CreatedBy,
			viewerPersonID, viewerIsAdmin, hasEventRead, hasGrant), nil
	}
}
