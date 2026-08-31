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
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/internal/server"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

type GetAreas struct {
	ImsDBQ            *store.DBQ
	UserStore         directory.UserStore
	Cache             *server.AreasCache
	CacheControlShort time.Duration
}

func (action GetAreas) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.run(req)
	if errHTTP != nil {
		errHTTP.From("[run]").WriteResponse(w)
		return
	}
	w.Header().Set("Cache-Control", fmt.Sprintf("max-age=%v, private", action.CacheControlShort.Milliseconds()/1000))
	server.MustWriteJSON(w, req, resp)
}

func (action GetAreas) run(req *http.Request) (imsjson.Areas, *herr.HTTPError) {
	ctx := req.Context()
	event, _, eventPermissions, errHTTP := server.GetEventPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return nil, errHTTP.From("[server.GetEventPermissions]")
	}
	_, globalPermissions, errHTTP := server.GetGlobalPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return nil, errHTTP.From("[server.GetGlobalPermissions]")
	}
	if eventPermissions&authz.EventReadAreas == 0 && globalPermissions&authz.GlobalAdministrateAreas == 0 {
		return nil, herr.Forbidden("The requestor does not have EventReadAreas permission", nil)
	}

	// An event's area list is read on every incident form load but changes rarely,
	// so it is served from an in-memory cache (refDataCacheTTL) keyed by event
	// name; EditAreas invalidates it on every write. The refresher captures the
	// resolved event id.
	resp, err := action.Cache.Get(ctx, req.PathValue("eventName"), func(ctx context.Context) (imsjson.Areas, error) {
		return loadAreasJSON(ctx, action.ImsDBQ, event.ID)
	})
	if err != nil {
		return nil, herr.InternalServerError("Failed to fetch Areas", err).From("[cache.get]")
	}
	return resp, nil
}

// loadAreasJSON reads one event's areas and builds the JSON list. It is the areas
// cache refresher, so cached readers only ever read the shared (never mutated)
// slice.
func loadAreasJSON(ctx context.Context, imsDBQ *store.DBQ, eventID int32) (imsjson.Areas, error) {
	areaRows, err := imsDBQ.AreasWithProposer(ctx, imsDBQ, eventID)
	if err != nil {
		return nil, err
	}
	resp := make(imsjson.Areas, 0, len(areaRows))
	for _, a := range areaRows {
		resp = append(resp, areaRowToJSON(a))
	}
	return resp, nil
}

type EditAreas struct {
	ImsDBQ    *store.DBQ
	UserStore directory.UserStore
	Metrics   *server.MetricsCache
	Areas     *server.AreasCache
}

func (action EditAreas) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	slug, errHTTP := action.run(req)
	if errHTTP != nil {
		errHTTP.From("[run]").WriteResponse(w)
		return
	}
	// Any area create / approve / merge / rename can shift the dashboard's
	// per-area breakdown for this event. The path event name is the cache key.
	action.Metrics.InvalidateEvent(req.PathValue("eventName"))
	// Drop the cached area list too so the change shows on the next read.
	action.Areas.InvalidateEvent(req.PathValue("eventName"))
	if slug != "" {
		w.Header().Set("IMS-Area-Slug", slug)
	}
	herr.WriteNoContentResponse(w, "Success")
}

func (action EditAreas) run(req *http.Request) (newSlug string, errHTTP *herr.HTTPError) {
	ctx := req.Context()
	event, jwtCtx, eventPermissions, errHTTP := server.GetEventPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return "", errHTTP.From("[server.GetEventPermissions]")
	}
	_, globalPermissions, errHTTP := server.GetGlobalPermissions(req, action.ImsDBQ, action.UserStore)
	if errHTTP != nil {
		return "", errHTTP.From("[server.GetGlobalPermissions]")
	}
	areaReq, errHTTP := server.ReadBodyAs[imsjson.Area](req)
	if errHTTP != nil {
		return "", errHTTP.From("[server.ReadBodyAs]")
	}
	isAreaAdmin := globalPermissions&authz.GlobalAdministrateAreas != 0

	if areaReq.Slug == "" {
		// Creating a new area is allowed for incident editors (so a Ranger can
		// add a missing location on the fly from the incident form) as well as
		// for area admins. A non-admin's area is a *proposal* (unapproved) that
		// an admin reviews later; an admin's area is approved immediately.
		if !isAreaAdmin && eventPermissions&authz.EventWriteIncidents == 0 {
			return "", herr.Forbidden("The requestor may not create Areas", nil)
		}
		return action.create(ctx, event.ID, areaReq, isAreaAdmin, jwtCtx.Claims.PersonID())
	}
	// Every operation on an existing area (rename / reparent / reorder, approve,
	// mark-duplicate) stays admin-only.
	if !isAreaAdmin {
		return "", herr.Forbidden("The requestor does not have GlobalAdministrateAreas permission", nil)
	}
	switch {
	case areaReq.DuplicateOf != nil:
		// Mark a proposed area a duplicate of an existing one: re-point its
		// incidents to the canonical area, then delete it.
		return "", action.markDuplicate(ctx, event.ID, areaReq.Slug, *areaReq.DuplicateOf)
	case areaReq.Approved != nil && *areaReq.Approved:
		return "", action.approve(ctx, event.ID, areaReq.Slug)
	default:
		return "", action.update(ctx, event.ID, areaReq)
	}
}

func (action EditAreas) create(
	ctx context.Context, eventID int32, areaReq imsjson.Area, isAreaAdmin bool, proposerID int32,
) (string, *herr.HTTPError) {
	if areaReq.Name == nil || strings.TrimSpace(*areaReq.Name) == "" {
		return "", herr.BadRequest("Area name is required for a new Area", nil)
	}

	existing, err := action.ImsDBQ.Areas(ctx, action.ImsDBQ, eventID)
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

	// An admin's area is approved on the spot; a writer's is a proposal awaiting
	// an admin's review, tagged with who proposed it.
	var proposedBy sql.NullInt32
	if !isAreaAdmin {
		proposedBy = sql.NullInt32{Int32: proposerID, Valid: true}
	}

	slug := UniqueSlug(*areaReq.Name, taken)
	err = action.ImsDBQ.CreateArea(ctx, action.ImsDBQ, imsdb.CreateAreaParams{
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

// approve marks a proposed area approved. The proposer is kept for audit.
func (action EditAreas) approve(ctx context.Context, eventID int32, slug string) *herr.HTTPError {
	_, err := action.ImsDBQ.Area(ctx, action.ImsDBQ, imsdb.AreaParams{Event: eventID, Slug: slug})
	if errors.Is(err, sql.ErrNoRows) {
		return herr.NotFound("No such Area", nil)
	}
	if err != nil {
		return herr.InternalServerError("Failed to look up Area", err).From("[Area]")
	}
	err = action.ImsDBQ.ApproveArea(ctx, action.ImsDBQ, imsdb.ApproveAreaParams{Event: eventID, Slug: slug})
	if err != nil {
		return herr.InternalServerError("Failed to approve Area", err).From("[ApproveArea]")
	}
	return nil
}

// markDuplicate resolves a proposed (or otherwise unwanted) area into an existing
// canonical one: every incident pointing at dupSlug is re-pointed to canonSlug,
// then dupSlug is deleted. Both happen in one transaction so an incident is never
// left pointing at a deleted area.
func (action EditAreas) markDuplicate(ctx context.Context, eventID int32, dupSlug, canonSlug string) *herr.HTTPError {
	if canonSlug == "" {
		return herr.BadRequest("A canonical area slug is required", nil)
	}
	if canonSlug == dupSlug {
		return herr.BadRequest("An area cannot be a duplicate of itself", nil)
	}
	existing, err := action.ImsDBQ.Areas(ctx, action.ImsDBQ, eventID)
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
	// A duplicate with sub-areas would orphan them (AREA_PARENT FK), and a writer
	// proposal is always flat anyway — refuse rather than cascade-delete.
	if slices.ContainsFunc(existing, func(a imsdb.Area) bool {
		return a.ParentSlug.Valid && a.ParentSlug.String == dupSlug
	}) {
		return herr.BadRequest("Reparent or remove this area's sub-areas before marking it a duplicate", nil)
	}

	runErr := action.ImsDBQ.RunInTx(ctx, func(tx *sql.Tx) error {
		txErr := action.ImsDBQ.RepointIncidentsArea(ctx, tx, imsdb.RepointIncidentsAreaParams{
			ToSlug:   sql.NullString{String: canonSlug, Valid: true},
			Event:    eventID,
			FromSlug: sql.NullString{String: dupSlug, Valid: true},
		})
		if txErr != nil {
			return herr.InternalServerError("Failed to re-point incidents", txErr).From("[RepointIncidentsArea]")
		}
		txErr = action.ImsDBQ.DeleteArea(ctx, tx, imsdb.DeleteAreaParams{Event: eventID, Slug: dupSlug})
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

func (action EditAreas) update(ctx context.Context, eventID int32, areaReq imsjson.Area) *herr.HTTPError {
	existing, err := action.ImsDBQ.Areas(ctx, action.ImsDBQ, eventID)
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
		// "" clears the parent (top-level); any other value must be a valid
		// top-level area in the same event, and not the area itself.
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

	err = action.ImsDBQ.UpdateArea(ctx, action.ImsDBQ, imsdb.UpdateAreaParams{
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

// validateParent resolves an optional parent-slug request value to a nullable
// SQL string. A nil pointer or "" means top-level (NULL). Otherwise the parent
// must be an existing area in the same event, must not be the area itself, and
// (single-level hierarchy for the beta) must itself be top-level.
func validateParent(existing []imsdb.Area, parentSlug *string, selfSlug string) (sql.NullString, *herr.HTTPError) {
	if parentSlug == nil || *parentSlug == "" {
		return sql.NullString{}, nil
	}
	if *parentSlug == selfSlug {
		return sql.NullString{}, herr.BadRequest("An area may not be its own parent", nil)
	}
	idx := slices.IndexFunc(existing, func(a imsdb.Area) bool { return a.Slug == *parentSlug })
	if idx < 0 {
		return sql.NullString{}, herr.BadRequest(
			fmt.Sprintf("Parent area %q does not exist in this event", *parentSlug), nil)
	}
	if existing[idx].ParentSlug.Valid {
		return sql.NullString{}, herr.BadRequest(
			"Areas may be nested only one level deep", nil)
	}
	return sql.NullString{String: *parentSlug, Valid: true}, nil
}

func areaRowToJSON(a imsdb.AreasWithProposerRow) imsjson.Area {
	out := imsjson.Area{
		Slug:      a.Slug,
		Name:      new(a.Name),
		SortOrder: new(a.SortOrder),
		Approved:  new(a.Approved),
	}
	if a.ParentSlug.Valid {
		out.ParentSlug = new(a.ParentSlug.String)
	}
	if a.ProposedByPersonID.Valid {
		out.Proposer = &imsjson.Mention{
			PersonID: a.ProposedByPersonID.Int32,
			Handle:   a.ProposerHandle.String,
			Name:     a.ProposerName.String,
		}
	}
	return out
}

func DerefInt32(p *int32, fallback int32) int32 {
	if p == nil {
		return fallback
	}
	return *p
}

var slugNonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

// slugify turns a display name into a URL/identifier-friendly slug: lowercased,
// with every run of non-alphanumeric characters collapsed to a single hyphen
// and leading/trailing hyphens trimmed. An empty result falls back to "area".
func slugify(name string) string {
	s := slugNonAlnum.ReplaceAllString(strings.ToLower(name), "-")
	s = strings.Trim(s, "-")
	if s == "" {
		return "area"
	}
	return s
}

// UniqueSlug returns slugify(name), suffixing -2, -3, … until it does not
// collide with any slug in taken.
func UniqueSlug(name string, taken []string) string {
	base := slugify(name)
	if !slices.Contains(taken, base) {
		return base
	}
	for i := 2; ; i++ {
		candidate := fmt.Sprintf("%s-%d", base, i)
		if !slices.Contains(taken, candidate) {
			return candidate
		}
	}
}
