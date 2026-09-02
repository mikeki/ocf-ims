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
	"fmt"
	"regexp"
	"slices"
	"strings"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// The GetAreas and EditAreas REST handlers (GET+POST /events/{eventName}/areas) were RETIRED in slice
// 1c and moved onto Connect as methods on area.Service (connect.go); the POST multiplexer was
// decomposed into CreateArea / UpdateArea / ApproveArea / MarkAreaDuplicate per the 0e contract split.
// The REST routes were deleted, not shimmed (aggressive migration, plan 09 §6). What remains here is
// the read builder (loadAreasJSON / areaRowToJSON, the cache refresher) and the slug + parent helpers
// the Connect write cores reuse.

// loadAreasJSON reads one event's areas and builds the JSON list. It is the areas cache refresher, so
// cached readers only ever read the shared (never mutated) slice.
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
