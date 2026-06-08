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
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/mikeki/ocf-ims/directory"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

type GetAreas struct {
	imsDBQ            *store.DBQ
	userStore         directory.UserStore
	cacheControlShort time.Duration
}

func (action GetAreas) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.run(req)
	if errHTTP != nil {
		errHTTP.From("[run]").WriteResponse(w)
		return
	}
	w.Header().Set("Cache-Control", fmt.Sprintf("max-age=%v, private", action.cacheControlShort.Milliseconds()/1000))
	mustWriteJSON(w, req, resp)
}

func (action GetAreas) run(req *http.Request) (imsjson.Areas, *herr.HTTPError) {
	ctx := req.Context()
	event, _, eventPermissions, errHTTP := getEventPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return nil, errHTTP.From("[getEventPermissions]")
	}
	_, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return nil, errHTTP.From("[getGlobalPermissions]")
	}
	if eventPermissions&authz.EventReadAreas == 0 && globalPermissions&authz.GlobalAdministrateAreas == 0 {
		return nil, herr.Forbidden("The requestor does not have EventReadAreas permission", nil)
	}

	areaRows, err := action.imsDBQ.Areas(ctx, action.imsDBQ, event.ID)
	if err != nil {
		return nil, herr.InternalServerError("Failed to fetch Areas", err).From("[Areas]")
	}

	resp := make(imsjson.Areas, 0, len(areaRows))
	for _, a := range areaRows {
		resp = append(resp, areaRowToJSON(a))
	}
	return resp, nil
}

type EditAreas struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
}

func (action EditAreas) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	slug, errHTTP := action.run(req)
	if errHTTP != nil {
		errHTTP.From("[run]").WriteResponse(w)
		return
	}
	if slug != "" {
		w.Header().Set("IMS-Area-Slug", slug)
	}
	herr.WriteNoContentResponse(w, "Success")
}

func (action EditAreas) run(req *http.Request) (newSlug string, errHTTP *herr.HTTPError) {
	ctx := req.Context()
	_, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return "", errHTTP.From("[getGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalAdministrateAreas == 0 {
		return "", herr.Forbidden("The requestor does not have GlobalAdministrateAreas permission", nil)
	}
	event, errHTTP := getEvent(req, req.PathValue("eventName"), action.imsDBQ)
	if errHTTP != nil {
		return "", errHTTP.From("[getEvent]")
	}
	areaReq, errHTTP := readBodyAs[imsjson.Area](req)
	if errHTTP != nil {
		return "", errHTTP.From("[readBodyAs]")
	}

	if areaReq.Slug == "" {
		return action.create(ctx, event.ID, areaReq)
	}
	return "", action.update(ctx, event.ID, areaReq)
}

func (action EditAreas) create(ctx context.Context, eventID int32, areaReq imsjson.Area) (string, *herr.HTTPError) {
	if areaReq.Name == nil || strings.TrimSpace(*areaReq.Name) == "" {
		return "", herr.BadRequest("Area name is required for a new Area", nil)
	}

	existing, err := action.imsDBQ.Areas(ctx, action.imsDBQ, eventID)
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

	slug := uniqueSlug(*areaReq.Name, taken)
	err = action.imsDBQ.CreateArea(ctx, action.imsDBQ, imsdb.CreateAreaParams{
		Event:      eventID,
		Slug:       slug,
		Name:       strings.TrimSpace(*areaReq.Name),
		ParentSlug: parent,
		SortOrder:  derefInt32(areaReq.SortOrder, 0),
	})
	if err != nil {
		return "", herr.InternalServerError("Failed to create Area", err).From("[CreateArea]")
	}
	return slug, nil
}

func (action EditAreas) update(ctx context.Context, eventID int32, areaReq imsjson.Area) *herr.HTTPError {
	existing, err := action.imsDBQ.Areas(ctx, action.imsDBQ, eventID)
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

	err = action.imsDBQ.UpdateArea(ctx, action.imsDBQ, imsdb.UpdateAreaParams{
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

func areaRowToJSON(a imsdb.Area) imsjson.Area {
	out := imsjson.Area{
		Slug:      a.Slug,
		Name:      new(a.Name),
		SortOrder: new(a.SortOrder),
	}
	if a.ParentSlug.Valid {
		out.ParentSlug = new(a.ParentSlug.String)
	}
	return out
}

func derefInt32(p *int32, fallback int32) int32 {
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

// uniqueSlug returns slugify(name), suffixing -2, -3, … until it does not
// collide with any slug in taken.
func uniqueSlug(name string, taken []string) string {
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
