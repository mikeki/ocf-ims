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

package crew

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	"github.com/go-sql-driver/mysql"
	"github.com/mikeki/ocf-ims/directory"
	commonv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/common/v1"
	resourcesv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/resources/v1"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/internal/area"
	"github.com/mikeki/ocf-ims/internal/server"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// Service is the crew domain's Connect surface (plan 09h/1c). It holds the deps the seven crew RPCs
// share, mirroring the other domain Services. api.ImsService composes one (built in AddConnectToMux)
// and delegates to it. Crews is the per-event ref-data cache a write invalidates. The write RPCs are
// thin wrappers over the herr-returning cores ported from the retired REST EditCrews / EditMyCrew
// handlers (mapped to Connect codes via server.HerrToConnect) — the crew delete and the crew-leader
// self-service member edit are intricate enough to keep verbatim.
type Service struct {
	ImsDBQ    *store.DBQ
	UserStore directory.UserStore
	Crews     *server.CrewsCache
}

// ListCrews is the domain method behind the ListCrews RPC, retiring REST GET /events/{eventName}/crews.
// Crews are admin-managed only, so the whole roster is GlobalAdministrateCrews-gated. Served from the
// shared per-event ref-data cache.
func (s Service) ListCrews(
	ctx context.Context,
	req *rpcv1.ListCrewsRequest,
) (*rpcv1.ListCrewsResponse, error) {
	eventID := req.GetEventId()
	err := s.requireCrewAdmin(ctx, eventID)
	if err != nil {
		return nil, err
	}
	crews, err := s.Crews.Get(ctx, crewCacheKey(eventID), func(ctx context.Context) (imsjson.Crews, error) {
		return loadCrewsJSON(ctx, s.ImsDBQ, eventID)
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch crews: %w", err))
	}
	return &rpcv1.ListCrewsResponse{Crews: crewsToProto(crews)}, nil
}

// CreateCrew is the domain method behind the CreateCrew RPC (the empty-slug branch of the retired
// POST /crews multiplexer). Admin-only; the server generates the slug.
func (s Service) CreateCrew(
	ctx context.Context,
	req *rpcv1.CreateCrewRequest,
) (*rpcv1.CreateCrewResponse, error) {
	eventID := req.GetEventId()
	err := s.requireCrewAdmin(ctx, eventID)
	if err != nil {
		return nil, err
	}
	slug, herrErr := s.createCrew(ctx, eventID, crewMsgToJSON(req.GetCrew()))
	if herrErr != nil {
		return nil, server.HerrToConnect(herrErr)
	}
	s.Crews.InvalidateEvent(crewCacheKey(eventID))
	return &rpcv1.CreateCrewResponse{CrewSlug: slug}, nil
}

// UpdateCrew is the domain method behind the UpdateCrew RPC (the rename/reorder branch of the retired
// multiplexer). Admin-only.
func (s Service) UpdateCrew(
	ctx context.Context,
	req *rpcv1.UpdateCrewRequest,
) (*rpcv1.UpdateCrewResponse, error) {
	eventID := req.GetEventId()
	err := s.requireCrewAdmin(ctx, eventID)
	if err != nil {
		return nil, err
	}
	crewReq := crewMsgToJSON(req.GetCrew())
	crewReq.Slug = req.GetCrewSlug()
	herrErr := s.updateCrew(ctx, eventID, crewReq)
	if herrErr != nil {
		return nil, server.HerrToConnect(herrErr)
	}
	s.Crews.InvalidateEvent(crewCacheKey(eventID))
	return &rpcv1.UpdateCrewResponse{}, nil
}

// DeleteCrew is the domain method behind the DeleteCrew RPC (the delete branch of the retired
// multiplexer): remove the crew and all its membership rows. Admin-only.
func (s Service) DeleteCrew(
	ctx context.Context,
	req *rpcv1.DeleteCrewRequest,
) (*rpcv1.DeleteCrewResponse, error) {
	eventID := req.GetEventId()
	err := s.requireCrewAdmin(ctx, eventID)
	if err != nil {
		return nil, err
	}
	herrErr := s.deleteCrew(ctx, eventID, req.GetCrewSlug())
	if herrErr != nil {
		return nil, server.HerrToConnect(herrErr)
	}
	s.Crews.InvalidateEvent(crewCacheKey(eventID))
	return &rpcv1.DeleteCrewResponse{}, nil
}

// SetCrewMembership is the domain method behind the SetCrewMembership RPC (the single-member mutation
// branch of the retired multiplexer): add/update (with leader flag) or remove one person. Admin-only.
func (s Service) SetCrewMembership(
	ctx context.Context,
	req *rpcv1.SetCrewMembershipRequest,
) (*rpcv1.SetCrewMembershipResponse, error) {
	eventID := req.GetEventId()
	err := s.requireCrewAdmin(ctx, eventID)
	if err != nil {
		return nil, err
	}
	edit := imsjson.CrewMemberEdit{
		PersonID: req.GetPersonId(),
		Remove:   req.GetRemove(),
		IsLeader: req.GetIsLeader(),
	}
	herrErr := s.adminEditMember(ctx, eventID, req.GetCrewSlug(), edit)
	if herrErr != nil {
		return nil, server.HerrToConnect(herrErr)
	}
	s.Crews.InvalidateEvent(crewCacheKey(eventID))
	return &rpcv1.SetCrewMembershipResponse{}, nil
}

// ListMyCrews is the domain method behind the ListMyCrews RPC, retiring REST GET
// /events/{eventName}/crews/mine. The crew-leader self-service read: not admin-gated (any
// authenticated caller), the result is naturally scoped to the crews the caller leads (empty when
// they lead none). Not cached — the result is per-caller.
func (s Service) ListMyCrews(
	ctx context.Context,
	req *rpcv1.ListMyCrewsRequest,
) (*rpcv1.ListMyCrewsResponse, error) {
	claims, err := s.requireClaims(ctx)
	if err != nil {
		return nil, err
	}
	crews, loadErr := loadLedCrewsJSON(ctx, s.ImsDBQ, req.GetEventId(), claims.PersonID())
	if loadErr != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch crews: %w", loadErr))
	}
	return &rpcv1.ListMyCrewsResponse{Crews: crewsToProto(crews)}, nil
}

// SetMyCrewMembership is the domain method behind the SetMyCrewMembership RPC, retiring REST POST
// /events/{eventName}/crews/mine. The crew-leader self-service write: the caller must lead the named
// crew, and only adding a plain member or removing a non-leader member is allowed (leader flags stay
// an admin act). Not admin-gated.
func (s Service) SetMyCrewMembership(
	ctx context.Context,
	req *rpcv1.SetMyCrewMembershipRequest,
) (*rpcv1.SetMyCrewMembershipResponse, error) {
	claims, err := s.requireClaims(ctx)
	if err != nil {
		return nil, err
	}
	eventID := req.GetEventId()
	slug := req.GetCrewSlug()
	// The caller must lead this crew. Checking leadership also confirms the crew exists — a slug they
	// do not lead (including a nonexistent one) is forbidden, not 404, so we don't leak which crews
	// exist.
	ledSlugs, ledErr := s.ImsDBQ.CrewsLedByPerson(ctx, s.ImsDBQ, imsdb.CrewsLedByPersonParams{
		Event:    eventID,
		PersonID: claims.PersonID(),
	})
	if ledErr != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to check crew leadership: %w", ledErr))
	}
	if !slices.Contains(ledSlugs, slug) {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("you do not lead this crew"))
	}
	edit := imsjson.CrewMemberEdit{
		PersonID: req.GetPersonId(),
		Remove:   req.GetRemove(),
		IsLeader: req.GetIsLeader(),
	}
	herrErr := s.myEditMember(ctx, eventID, slug, edit)
	if herrErr != nil {
		return nil, server.HerrToConnect(herrErr)
	}
	s.Crews.InvalidateEvent(crewCacheKey(eventID))
	return &rpcv1.SetMyCrewMembershipResponse{}, nil
}

// requireClaims resolves the caller's claims from the ctx the auth interceptor populated.
func (s Service) requireClaims(ctx context.Context) (*authz.IMSClaims, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	return claims, nil
}

// requireCrewAdmin enforces GlobalAdministrateCrews, the gate every admin crew RPC shares (crews are
// admin-managed only — there is no reader/writer view of the roster).
func (s Service) requireCrewAdmin(ctx context.Context, eventID int32) error {
	claims, err := s.requireClaims(ctx)
	if err != nil {
		return err
	}
	_, globalPermissions, err := authz.EventPermissions(ctx, &eventID, s.ImsDBQ, *claims)
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("failed to compute permissions: %w", err))
	}
	if globalPermissions&authz.GlobalAdministrateCrews == 0 {
		return connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have GlobalAdministrateCrews permission"))
	}
	return nil
}

// createCrew inserts a new crew with a server-generated slug (ported from EditCrews.create).
func (s Service) createCrew(ctx context.Context, eventID int32, crewReq imsjson.Crew) (string, *herr.HTTPError) {
	if crewReq.Name == nil || strings.TrimSpace(*crewReq.Name) == "" {
		return "", herr.BadRequest("Crew name is required for a new Crew", nil)
	}
	existing, err := s.ImsDBQ.Crews(ctx, s.ImsDBQ, eventID)
	if err != nil {
		return "", herr.InternalServerError("Failed to fetch Crews", err).From("[Crews]")
	}
	taken := make([]string, 0, len(existing))
	for _, c := range existing {
		taken = append(taken, c.Slug)
	}

	slug := area.UniqueSlug(*crewReq.Name, taken)
	err = s.ImsDBQ.CreateCrew(ctx, s.ImsDBQ, imsdb.CreateCrewParams{
		Event:     eventID,
		Slug:      slug,
		Name:      strings.TrimSpace(*crewReq.Name),
		SortOrder: area.DerefInt32(crewReq.SortOrder, 0),
	})
	if err != nil {
		return "", herr.InternalServerError("Failed to create Crew", err).From("[CreateCrew]")
	}
	return slug, nil
}

// updateCrew renames / reorders an existing crew (ported from EditCrews.update).
func (s Service) updateCrew(ctx context.Context, eventID int32, crewReq imsjson.Crew) *herr.HTTPError {
	row, errHTTP := s.mustFindCrew(ctx, eventID, crewReq.Slug)
	if errHTTP != nil {
		return errHTTP
	}
	name := row.Name
	if crewReq.Name != nil {
		if strings.TrimSpace(*crewReq.Name) == "" {
			return herr.BadRequest("Crew name may not be blank", nil)
		}
		name = strings.TrimSpace(*crewReq.Name)
	}
	sortOrder := row.SortOrder
	if crewReq.SortOrder != nil {
		sortOrder = *crewReq.SortOrder
	}
	err := s.ImsDBQ.UpdateCrew(ctx, s.ImsDBQ, imsdb.UpdateCrewParams{
		Name:      name,
		SortOrder: sortOrder,
		Event:     eventID,
		Slug:      crewReq.Slug,
	})
	if err != nil {
		return herr.InternalServerError("Failed to update Crew", err).From("[UpdateCrew]")
	}
	return nil
}

// deleteCrew removes a crew and all its membership rows in one transaction (ported from
// EditCrews.delete; the CREW_MEMBERSHIP FK references CREW, so members must go first).
func (s Service) deleteCrew(ctx context.Context, eventID int32, slug string) *herr.HTTPError {
	_, errHTTP := s.mustFindCrew(ctx, eventID, slug)
	if errHTTP != nil {
		return errHTTP
	}
	runErr := s.ImsDBQ.RunInTx(ctx, func(tx *sql.Tx) error {
		txErr := s.ImsDBQ.RemoveAllCrewMembers(ctx, tx, imsdb.RemoveAllCrewMembersParams{
			Event:    eventID,
			CrewSlug: slug,
		})
		if txErr != nil {
			return herr.InternalServerError("Failed to clear crew membership", txErr).From("[RemoveAllCrewMembers]")
		}
		txErr = s.ImsDBQ.DeleteCrew(ctx, tx, imsdb.DeleteCrewParams{Event: eventID, Slug: slug})
		if txErr != nil {
			return herr.InternalServerError("Failed to delete Crew", txErr).From("[DeleteCrew]")
		}
		return nil
	})
	if runErr != nil {
		return herr.AsHTTPError(runErr).From("[RunInTx]")
	}
	return nil
}

// adminEditMember adds, updates, or removes one person's membership in a crew (ported from
// EditCrews.editMember): the admin path, which may set/clear the leader flag.
func (s Service) adminEditMember(ctx context.Context, eventID int32, slug string, edit imsjson.CrewMemberEdit) *herr.HTTPError {
	_, errHTTP := s.mustFindCrew(ctx, eventID, slug)
	if errHTTP != nil {
		return errHTTP
	}
	if edit.PersonID == 0 {
		return herr.BadRequest("A person id is required to change crew membership", nil)
	}
	if edit.Remove {
		err := s.ImsDBQ.RemoveCrewMember(ctx, s.ImsDBQ, imsdb.RemoveCrewMemberParams{
			Event:    eventID,
			CrewSlug: slug,
			PersonID: edit.PersonID,
		})
		if err != nil {
			return herr.InternalServerError("Failed to remove crew member", err).From("[RemoveCrewMember]")
		}
		return nil
	}
	// AddCrewMember upserts: it adds the person if new and (re)sets their leader flag, so the same
	// call covers "add member" and "toggle leader".
	err := s.ImsDBQ.AddCrewMember(ctx, s.ImsDBQ, imsdb.AddCrewMemberParams{
		Event:    eventID,
		CrewSlug: slug,
		PersonID: edit.PersonID,
		IsLeader: edit.IsLeader,
	})
	if err != nil {
		var mysqlErr *mysql.MySQLError
		if errors.As(err, &mysqlErr) && mysqlErr.Number == mySQLErNoReferencedRow {
			return herr.NotFound("No such person", err)
		}
		return herr.InternalServerError("Failed to add crew member", err).From("[AddCrewMember]")
	}
	return nil
}

// myEditMember adds a plain member or removes a non-leader member (ported from EditMyCrew.editMember):
// the crew-leader self-service path. Leader flags are never touched here — an add never promotes, and
// a fellow leader may not be removed (that stays an admin act).
func (s Service) myEditMember(ctx context.Context, eventID int32, slug string, edit imsjson.CrewMemberEdit) *herr.HTTPError {
	if edit.PersonID == 0 {
		return herr.BadRequest("A person id is required to change crew membership", nil)
	}
	if edit.Remove {
		isLeader, err := s.ImsDBQ.CrewMembership(ctx, s.ImsDBQ, imsdb.CrewMembershipParams{
			Event:    eventID,
			CrewSlug: slug,
			PersonID: edit.PersonID,
		})
		switch {
		case errors.Is(err, sql.ErrNoRows):
			// Already not a member — nothing to do (idempotent).
			return nil
		case err != nil:
			return herr.InternalServerError("Failed to look up crew member", err).From("[CrewMembership]")
		}
		if isLeader {
			return herr.Forbidden("Crew leaders are managed by an admin and can't be removed here", nil)
		}
		err = s.ImsDBQ.RemoveCrewMember(ctx, s.ImsDBQ, imsdb.RemoveCrewMemberParams{
			Event:    eventID,
			CrewSlug: slug,
			PersonID: edit.PersonID,
		})
		if err != nil {
			return herr.InternalServerError("Failed to remove crew member", err).From("[RemoveCrewMember]")
		}
		return nil
	}
	// Add as a plain member without disturbing an existing membership's leader flag
	// (AddCrewMemberIfAbsent no-ops on an existing row). A missing person surfaces as the FK
	// violation → 404, like the admin path.
	err := s.ImsDBQ.AddCrewMemberIfAbsent(ctx, s.ImsDBQ, imsdb.AddCrewMemberIfAbsentParams{
		Event:    eventID,
		CrewSlug: slug,
		PersonID: edit.PersonID,
	})
	if err != nil {
		var mysqlErr *mysql.MySQLError
		if errors.As(err, &mysqlErr) && mysqlErr.Number == mySQLErNoReferencedRow {
			return herr.NotFound("No such person", err)
		}
		return herr.InternalServerError("Failed to add crew member", err).From("[AddCrewMemberIfAbsent]")
	}
	return nil
}

// mustFindCrew returns the crew row or a 404 when it does not exist in the event (ported from
// EditCrews.mustFindCrew).
func (s Service) mustFindCrew(ctx context.Context, eventID int32, slug string) (imsdb.Crew, *herr.HTTPError) {
	existing, err := s.ImsDBQ.Crews(ctx, s.ImsDBQ, eventID)
	if err != nil {
		return imsdb.Crew{}, herr.InternalServerError("Failed to fetch Crews", err).From("[Crews]")
	}
	idx := slices.IndexFunc(existing, func(c imsdb.Crew) bool { return c.Slug == slug })
	if idx < 0 {
		return imsdb.Crew{}, herr.NotFound("No such Crew", nil)
	}
	return existing[idx], nil
}

// crewCacheKey is the CrewsCache key for an event. The REST handlers keyed by event name (from the
// URL); the RPCs carry the id, so the id is the key — read and write agree because both live on this
// Service.
func crewCacheKey(eventID int32) string {
	return strconv.Itoa(int(eventID))
}

// crewsToProto maps an assembled imsjson.Crews (read path) onto the resource protos — the throwaway
// json→wire bridge (dies with json/ when the read is rebuilt DB→proto).
func crewsToProto(crews imsjson.Crews) []*resourcesv1.Crew {
	out := make([]*resourcesv1.Crew, 0, len(crews))
	for i := range crews {
		c := crews[i]
		members := make([]*resourcesv1.CrewMember, 0, len(c.Members))
		for _, m := range c.Members {
			members = append(members, &resourcesv1.CrewMember{
				Person: &commonv1.PersonRef{
					PersonId: m.PersonID,
					Handle:   conv.EmptyToNil(m.Handle),
					Name:     conv.EmptyToNil(m.Name),
				},
				IsLeader: m.IsLeader,
			})
		}
		out = append(out, &resourcesv1.Crew{
			Slug:    conv.EmptyToNil(c.Slug),
			Name:    c.Name,
			Members: members,
		})
	}
	return out
}

// crewMsgToJSON bridges an inbound resource proto (a write body) to the legacy imsjson.Crew the ported
// herr cores consume. Only the writable fields (slug/name) carry; members are read-only. The slug is
// unset on create; the UpdateCrew request's key is applied by the caller.
func crewMsgToJSON(c *resourcesv1.Crew) imsjson.Crew {
	return imsjson.Crew{
		Slug: c.GetSlug(),
		Name: c.Name,
	}
}
