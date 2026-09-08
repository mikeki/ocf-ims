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

package area

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/directory"
	commonv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/common/v1"
	resourcesv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/resources/v1"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/internal/server"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// Service is the area domain's Connect surface (plan 09h/1c). It holds the deps the five area RPCs
// share, mirroring the other domain Services. api.ImsService composes one (built in AddConnectToMux)
// and delegates to it. Metrics + Areas are the caches a write invalidates: an area write can shift
// the dashboard's per-area breakdown for the event, and the per-event area list is served from an
// in-memory ref-data cache. The write RPCs are thin wrappers over the herr-returning cores ported
// from the retired REST EditAreas handler (mapped to Connect codes via server.HerrToConnect).
type Service struct {
	ImsDBQ    *store.DBQ
	UserStore directory.UserStore
	Metrics   *server.MetricsCache
	Areas     *server.AreasCache
}

// ListAreas is the domain method behind the ListAreas RPC, retiring REST GET
// /events/{eventName}/areas. A reader needs EventReadAreas on the event (or the GlobalAdministrateAreas
// bypass). Served from the shared per-event ref-data cache.
func (s Service) ListAreas(
	ctx context.Context,
	req *rpcv1.ListAreasRequest,
) (*rpcv1.ListAreasResponse, error) {
	eventID := req.GetEventId()
	_, eventPermissions, globalPermissions, err := s.authorize(ctx, eventID)
	if err != nil {
		return nil, err
	}
	if eventPermissions&authz.EventReadAreas == 0 && globalPermissions&authz.GlobalAdministrateAreas == 0 {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have EventReadAreas permission"))
	}
	areas, err := s.Areas.Get(ctx, areaCacheKey(eventID), func(ctx context.Context) (imsjson.Areas, error) {
		return loadAreasJSON(ctx, s.ImsDBQ, eventID)
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch areas: %w", err))
	}
	out := make([]*resourcesv1.Area, 0, len(areas))
	for i := range areas {
		out = append(out, areaToProto(areas[i]))
	}
	return &rpcv1.ListAreasResponse{Areas: out}, nil
}

// CreateArea is the domain method behind the CreateArea RPC (the empty-slug branch of the retired
// POST /areas multiplexer). Creating an area is allowed for an event's incident writers (so a Ranger
// can add a missing location from the incident form) as well as for area admins: a non-admin's area
// is a *proposal* (unapproved, proposer recorded), an admin's is approved immediately.
func (s Service) CreateArea(
	ctx context.Context,
	req *rpcv1.CreateAreaRequest,
) (*rpcv1.CreateAreaResponse, error) {
	eventID := req.GetEventId()
	claims, eventPermissions, globalPermissions, err := s.authorize(ctx, eventID)
	if err != nil {
		return nil, err
	}
	isAreaAdmin := globalPermissions&authz.GlobalAdministrateAreas != 0
	if !isAreaAdmin && eventPermissions&authz.EventWriteIncidents == 0 {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("the requestor may not create areas"))
	}
	slug, herrErr := s.createArea(ctx, eventID, areaMsgToJSON(req.GetArea()), isAreaAdmin, claims.PersonID())
	if herrErr != nil {
		return nil, server.HerrToConnect(herrErr)
	}
	s.invalidateAreaCaches(ctx, eventID)
	return &rpcv1.CreateAreaResponse{AreaSlug: slug}, nil
}

// UpdateArea is the domain method behind the UpdateArea RPC (the default branch of the retired
// multiplexer): rename / reparent / reorder an existing area. Admin-only.
func (s Service) UpdateArea(
	ctx context.Context,
	req *rpcv1.UpdateAreaRequest,
) (*rpcv1.UpdateAreaResponse, error) {
	eventID := req.GetEventId()
	err := s.requireAreaAdmin(ctx, eventID)
	if err != nil {
		return nil, err
	}
	areaReq := areaMsgToJSON(req.GetArea())
	areaReq.Slug = req.GetAreaSlug()
	herrErr := s.updateArea(ctx, eventID, areaReq)
	if herrErr != nil {
		return nil, server.HerrToConnect(herrErr)
	}
	s.invalidateAreaCaches(ctx, eventID)
	return &rpcv1.UpdateAreaResponse{}, nil
}

// ApproveArea is the domain method behind the ApproveArea RPC (the approved==true branch of the
// retired multiplexer): an admin approves a writer's pending proposed area.
func (s Service) ApproveArea(
	ctx context.Context,
	req *rpcv1.ApproveAreaRequest,
) (*rpcv1.ApproveAreaResponse, error) {
	eventID := req.GetEventId()
	err := s.requireAreaAdmin(ctx, eventID)
	if err != nil {
		return nil, err
	}
	herrErr := s.approveArea(ctx, eventID, req.GetAreaSlug())
	if herrErr != nil {
		return nil, server.HerrToConnect(herrErr)
	}
	s.invalidateAreaCaches(ctx, eventID)
	return &rpcv1.ApproveAreaResponse{}, nil
}

// MarkAreaDuplicate is the domain method behind the MarkAreaDuplicate RPC (the DuplicateOf branch of
// the retired multiplexer): a destructive merge — re-point the duplicate's incidents to the canonical
// area, then delete it. Admin-only.
func (s Service) MarkAreaDuplicate(
	ctx context.Context,
	req *rpcv1.MarkAreaDuplicateRequest,
) (*rpcv1.MarkAreaDuplicateResponse, error) {
	eventID := req.GetEventId()
	err := s.requireAreaAdmin(ctx, eventID)
	if err != nil {
		return nil, err
	}
	herrErr := s.markAreaDuplicate(ctx, eventID, req.GetAreaSlug(), req.GetCanonicalSlug())
	if herrErr != nil {
		return nil, server.HerrToConnect(herrErr)
	}
	s.invalidateAreaCaches(ctx, eventID)
	return &rpcv1.MarkAreaDuplicateResponse{}, nil
}

// authorize resolves the caller's claims + this event's permission mask + the global mask from the
// ctx the auth interceptor populated. A missing claims context is Unauthenticated.
func (s Service) authorize(
	ctx context.Context,
	eventID int32,
) (*authz.IMSClaims, authz.EventPermissionMask, authz.GlobalPermissionMask, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, 0, 0, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	perms, globalPermissions, err := authz.EventPermissions(ctx, &eventID, s.ImsDBQ, *claims)
	if err != nil {
		return nil, 0, 0, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to compute permissions: %w", err))
	}
	return claims, perms[eventID], globalPermissions, nil
}

// requireAreaAdmin enforces GlobalAdministrateAreas, the gate every operation on an existing area
// (update / approve / mark-duplicate) shares.
func (s Service) requireAreaAdmin(ctx context.Context, eventID int32) error {
	_, _, globalPermissions, err := s.authorize(ctx, eventID)
	if err != nil {
		return err
	}
	if globalPermissions&authz.GlobalAdministrateAreas == 0 {
		return connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have GlobalAdministrateAreas permission"))
	}
	return nil
}

// createArea inserts a new area (ported from the retired EditAreas.create). An admin's area is
// approved on the spot; a writer's is a proposal awaiting review, tagged with who proposed it.
func (s Service) createArea(
	ctx context.Context, eventID int32, areaReq imsjson.Area, isAreaAdmin bool, proposerID int32,
) (string, *herr.HTTPError) {
	if areaReq.Name == nil || strings.TrimSpace(*areaReq.Name) == "" {
		return "", herr.BadRequest("Area name is required for a new Area", nil)
	}

	existing, err := s.ImsDBQ.Areas(ctx, s.ImsDBQ, eventID)
	if err != nil {
		return "", herr.InternalServerError("Failed to fetch Areas", err).From("[Areas]")
	}
	taken := make([]string, 0, len(existing))
	for _, a := range existing {
		taken = append(taken, a.Slug)
	}

	parent, errHTTP := validateParent(existing, areaReq.ParentSlug, "")
	if errHTTP != nil {
		return "", errHTTP
	}

	var proposedBy sql.NullInt32
	if !isAreaAdmin {
		proposedBy = sql.NullInt32{Int32: proposerID, Valid: true}
	}

	slug := UniqueSlug(*areaReq.Name, taken)
	err = s.ImsDBQ.CreateArea(ctx, s.ImsDBQ, imsdb.CreateAreaParams{
		Event:              eventID,
		Slug:               slug,
		Name:               strings.TrimSpace(*areaReq.Name),
		ParentSlug:         parent,
		SortOrder:          DerefInt32(areaReq.SortOrder, 0),
		Approved:           isAreaAdmin,
		ProposedByPersonID: proposedBy,
	})
	if err != nil {
		return "", herr.InternalServerError("Failed to create Area", err).From("[CreateArea]")
	}
	return slug, nil
}

// approveArea marks a proposed area approved (ported from EditAreas.approve). The proposer is kept
// for audit.
func (s Service) approveArea(ctx context.Context, eventID int32, slug string) *herr.HTTPError {
	_, err := s.ImsDBQ.Area(ctx, s.ImsDBQ, imsdb.AreaParams{Event: eventID, Slug: slug})
	if errors.Is(err, sql.ErrNoRows) {
		return herr.NotFound("No such Area", nil)
	}
	if err != nil {
		return herr.InternalServerError("Failed to look up Area", err).From("[Area]")
	}
	err = s.ImsDBQ.ApproveArea(ctx, s.ImsDBQ, imsdb.ApproveAreaParams{Event: eventID, Slug: slug})
	if err != nil {
		return herr.InternalServerError("Failed to approve Area", err).From("[ApproveArea]")
	}
	return nil
}

// markAreaDuplicate resolves a proposed (or otherwise unwanted) area into an existing canonical one
// (ported from EditAreas.markDuplicate): every incident pointing at dupSlug is re-pointed to
// canonSlug, then dupSlug is deleted, both in one transaction so an incident is never left pointing
// at a deleted area.
func (s Service) markAreaDuplicate(ctx context.Context, eventID int32, dupSlug, canonSlug string) *herr.HTTPError {
	if canonSlug == "" {
		return herr.BadRequest("A canonical area slug is required", nil)
	}
	if canonSlug == dupSlug {
		return herr.BadRequest("An area cannot be a duplicate of itself", nil)
	}
	existing, err := s.ImsDBQ.Areas(ctx, s.ImsDBQ, eventID)
	if err != nil {
		return herr.InternalServerError("Failed to fetch Areas", err).From("[Areas]")
	}
	dupIdx := slices.IndexFunc(existing, func(a imsdb.Area) bool { return a.Slug == dupSlug })
	if dupIdx < 0 {
		return herr.NotFound("No such Area", nil)
	}
	if slices.IndexFunc(existing, func(a imsdb.Area) bool { return a.Slug == canonSlug }) < 0 {
		return herr.BadRequest("The canonical area does not exist in this event", nil)
	}
	// A duplicate with sub-areas would orphan them (AREA_PARENT FK), and a writer proposal is always
	// flat anyway — refuse rather than cascade-delete.
	if slices.ContainsFunc(existing, func(a imsdb.Area) bool {
		return a.ParentSlug.Valid && a.ParentSlug.String == dupSlug
	}) {
		return herr.BadRequest("Reparent or remove this area's sub-areas before marking it a duplicate", nil)
	}

	runErr := s.ImsDBQ.RunInTx(ctx, func(tx *sql.Tx) error {
		txErr := s.ImsDBQ.RepointIncidentsArea(ctx, tx, imsdb.RepointIncidentsAreaParams{
			ToSlug:   sql.NullString{String: canonSlug, Valid: true},
			Event:    eventID,
			FromSlug: sql.NullString{String: dupSlug, Valid: true},
		})
		if txErr != nil {
			return herr.InternalServerError("Failed to re-point incidents", txErr).From("[RepointIncidentsArea]")
		}
		txErr = s.ImsDBQ.DeleteArea(ctx, tx, imsdb.DeleteAreaParams{Event: eventID, Slug: dupSlug})
		if txErr != nil {
			return herr.InternalServerError("Failed to delete duplicate Area", txErr).From("[DeleteArea]")
		}
		return nil
	})
	if runErr != nil {
		return herr.AsHTTPError(runErr).From("[RunInTx]")
	}
	return nil
}

// updateArea renames / reparents / reorders an existing area (ported from EditAreas.update). Each
// field is applied only when present.
func (s Service) updateArea(ctx context.Context, eventID int32, areaReq imsjson.Area) *herr.HTTPError {
	existing, err := s.ImsDBQ.Areas(ctx, s.ImsDBQ, eventID)
	if err != nil {
		return herr.InternalServerError("Failed to fetch Areas", err).From("[Areas]")
	}
	idx := slices.IndexFunc(existing, func(a imsdb.Area) bool { return a.Slug == areaReq.Slug })
	if idx < 0 {
		return herr.NotFound("No such Area", nil)
	}
	row := existing[idx]

	name := row.Name
	if areaReq.Name != nil {
		if strings.TrimSpace(*areaReq.Name) == "" {
			return herr.BadRequest("Area name may not be blank", nil)
		}
		name = strings.TrimSpace(*areaReq.Name)
	}
	parent := row.ParentSlug
	if areaReq.ParentSlug != nil {
		// "" clears the parent (top-level); any other value must be a valid top-level area in the
		// same event, and not the area itself.
		validated, errHTTP := validateParent(existing, areaReq.ParentSlug, areaReq.Slug)
		if errHTTP != nil {
			return errHTTP
		}
		parent = validated
	}
	sortOrder := row.SortOrder
	if areaReq.SortOrder != nil {
		sortOrder = *areaReq.SortOrder
	}

	err = s.ImsDBQ.UpdateArea(ctx, s.ImsDBQ, imsdb.UpdateAreaParams{
		Name:       name,
		ParentSlug: parent,
		SortOrder:  sortOrder,
		Event:      eventID,
		Slug:       areaReq.Slug,
	})
	if err != nil {
		return herr.InternalServerError("Failed to update Area", err).From("[UpdateArea]")
	}
	return nil
}

// invalidateAreaCaches drops the caches an area write shifts. The area list is keyed by event id
// (private to this Service now that the REST routes are retired); the dashboard metrics are keyed by
// event *name* (shared with the incident writes), so that key is resolved here — best-effort: if the
// lookup fails, the cached metrics expire on their TTL rather than the committed write failing.
func (s Service) invalidateAreaCaches(ctx context.Context, eventID int32) {
	s.Areas.InvalidateEvent(areaCacheKey(eventID))
	ev, err := s.ImsDBQ.Event(ctx, s.ImsDBQ, eventID)
	if err != nil {
		return
	}
	s.Metrics.InvalidateEvent(ev.Event.Name)
}

// areaCacheKey is the AreasCache key for an event. The REST handlers keyed by event name (from the
// URL); the RPCs carry the id, so the id is the key — read and write agree because both live on this
// Service.
func areaCacheKey(eventID int32) string {
	return strconv.Itoa(int(eventID))
}

// areaToProto maps an assembled imsjson.Area (read path) onto the resource proto — the throwaway
// json→wire bridge (dies with json/ when the read is rebuilt DB→proto).
func areaToProto(a imsjson.Area) *resourcesv1.Area {
	out := &resourcesv1.Area{
		Slug:       a.Slug,
		Name:       a.Name,
		ParentSlug: a.ParentSlug,
		Approved:   a.Approved,
		SortOrder:  a.SortOrder,
	}
	if a.Proposer != nil {
		out.Proposer = &commonv1.PersonRef{
			PersonId: a.Proposer.PersonID,
			Handle:   conv.EmptyToNil(a.Proposer.Handle),
			Name:     conv.EmptyToNil(a.Proposer.Name),
		}
	}
	return out
}

// areaMsgToJSON bridges an inbound resource proto (a write body) to the legacy imsjson.Area the ported
// herr cores consume. The slug carries from the proto (unset on create; the UpdateArea request's key
// is applied by the caller).
func areaMsgToJSON(a *resourcesv1.Area) imsjson.Area {
	return imsjson.Area{
		Slug:       a.GetSlug(),
		Name:       a.Name,
		ParentSlug: a.ParentSlug,
		SortOrder:  a.SortOrder,
	}
}
