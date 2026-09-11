// SPDX-License-Identifier: Apache-2.0

package incident

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// The authorization half of WatchEvent (plan 09p 3b.0b), built from the same
// primitives the read path uses so there is one interpretation of "may this
// person see this". The stream mechanics live in internal/server.

const anyReportRead = authz.EventReadAllReports | authz.EventReadOwnReports | authz.EventReadCrewReports

// NewWatchPolicy builds the subscribe gate and the per-poke visibility rule.
func NewWatchPolicy(imsDBQ *store.DBQ) server.WatchPolicy {
	return server.WatchPolicy{
		MayWatch: mayWatchEvent(imsDBQ),
		Visible:  pokeVisible(imsDBQ),
	}
}

// mayWatchEvent admits a caller who can read something in the event: incidents,
// reports (any of the three report-read bits), or at least one granted incident
// (52f).
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
		if eventPerms[eventID]&(authz.EventReadIncidents|anyReportRead) != 0 {
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
			errors.New("the requestor may not read incidents or reports in this event"))
	}
}

// pokeVisible re-reads permissions and the row on every poke (09p S3), so an
// incident marked private or an access revoked mid-stream takes effect on the
// next poke. It applies the read path's own rules: mayViewIncident for an
// incident, GetReport's all / own / crew scoping for a report.
func pokeVisible(imsDBQ *store.DBQ) server.PokeVisibility {
	return func(ctx context.Context, claims *authz.IMSClaims, poke server.Poke) (bool, error) {
		if claims == nil {
			return false, nil
		}
		eventPerms, _, err := authz.EventPermissions(ctx, &poke.EventID, imsDBQ, *claims)
		if err != nil {
			return false, err
		}
		perms := eventPerms[poke.EventID]
		if poke.IncidentNumber != 0 {
			return incidentPokeVisible(ctx, imsDBQ, claims, perms, poke)
		}
		return reportPokeVisible(ctx, imsDBQ, claims, perms, poke)
	}
}

func incidentPokeVisible(
	ctx context.Context, imsDBQ *store.DBQ, claims *authz.IMSClaims, perms authz.EventPermissionMask, poke server.Poke,
) (bool, error) {
	row, err := imsDBQ.Incident(ctx, imsDBQ, imsdb.IncidentParams{
		Event: poke.EventID, Number: poke.IncidentNumber,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// Gone between the publish and this check; nothing to tell.
		return false, nil
	}
	if err != nil {
		return false, err
	}
	viewerPersonID := claims.PersonID()
	viewerIsAdmin := claims.PersonAdmin()
	hasGrant := false
	if !viewerIsAdmin {
		hasGrant, err = imsDBQ.IncidentPersonHasGrant(ctx, imsDBQ, imsdb.IncidentPersonHasGrantParams{
			Event: poke.EventID, IncidentNumber: poke.IncidentNumber, PersonID: viewerPersonID,
		})
		if err != nil {
			return false, err
		}
	}
	hasEventRead := perms&authz.EventReadIncidents != 0
	return mayViewIncident(row.Incident.Private, row.Incident.CreatedBy,
		viewerPersonID, viewerIsAdmin, hasEventRead, hasGrant), nil
}

// reportPokeVisible mirrors GetReport: "all" sees every report; otherwise the
// caller must own it (own) or lead its author's crew (crew). A caller admitted
// to the stream by incident read alone gets no report pokes.
func reportPokeVisible(
	ctx context.Context, imsDBQ *store.DBQ, claims *authz.IMSClaims, perms authz.EventPermissionMask, poke server.Poke,
) (bool, error) {
	if perms&authz.EventReadAllReports != 0 {
		return true, nil
	}
	if perms&(authz.EventReadOwnReports|authz.EventReadCrewReports) == 0 {
		return false, nil
	}
	report, entries, errHTTP := fetchReport(ctx, imsDBQ, poke.EventID, poke.ReportNumber, false)
	if errHTTP != nil {
		if errHTTP.Code == http.StatusNotFound {
			return false, nil
		}
		return false, errHTTP
	}
	if perms&authz.EventReadOwnReports != 0 &&
		ownsReport(report.Report, entries, claims.PersonID(), claims.PersonHandle()) {
		return true, nil
	}
	if perms&authz.EventReadCrewReports != 0 {
		crew, errHTTP := crewReportNumberSet(ctx, imsDBQ, poke.EventID, claims.PersonID())
		if errHTTP != nil {
			return false, errHTTP
		}
		return crew[poke.ReportNumber], nil
	}
	return false, nil
}
