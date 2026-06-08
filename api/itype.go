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
	"fmt"
	"github.com/mikeki/ocf-ims/directory"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"net/http"
	"slices"
	"strconv"
	"time"
)

type GetIncidentTypes struct {
	imsDBQ            *store.DBQ
	userStore         directory.UserStore
	cacheControlShort time.Duration
}

func (action GetIncidentTypes) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.getIncidentTypes(req)
	if errHTTP != nil {
		errHTTP.From("[getIncidentTypes]").WriteResponse(w)
		return
	}
	w.Header().Set("Cache-Control", fmt.Sprintf("max-age=%v, private", action.cacheControlShort.Milliseconds()/1000))
	mustWriteJSON(w, req, resp)
}
func (action GetIncidentTypes) getIncidentTypes(req *http.Request) (imsjson.IncidentTypes, *herr.HTTPError) {
	response := make(imsjson.IncidentTypes, 0)
	_, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return response, errHTTP.From("[getGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalReadIncidentTypes == 0 {
		return response, herr.Forbidden("The requestor does not have GlobalReadIncidentTypes permission", nil)
	}

	err := req.ParseForm()
	if err != nil {
		return response, herr.BadRequest("Unable to parse HTTP form", err).From("[ParseForm]")
	}
	typeRows, err := action.imsDBQ.IncidentTypes(req.Context(), action.imsDBQ)
	if err != nil {
		return response, herr.InternalServerError("Failed to fetch Incident Types", err).From("[IncidentTypes]")
	}

	for _, typeRow := range typeRows {
		t := typeRow.IncidentType
		response = append(response, imsjson.IncidentType{
			ID:          t.ID,
			Name:        new(t.Name),
			Description: conv.SqlToString(t.Description),
			Hidden:      new(t.Hidden),
			Group:       groupToString(t.Group),
		})
	}
	slices.SortFunc(response, func(a, b imsjson.IncidentType) int {
		return int(a.ID) - int(b.ID)
	})

	return response, nil
}

type EditIncidentTypes struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
}

func (action EditIncidentTypes) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	newID, errHTTP := action.editIncidentTypes(req)
	if errHTTP != nil {
		errHTTP.From("[editIncidentTypes]").WriteResponse(w)
		return
	}
	if newID != nil {
		w.Header().Set("IMS-Incident-Type-ID", strconv.Itoa(int(*newID)))
	}
	herr.WriteNoContentResponse(w, "Success")
}
func (action EditIncidentTypes) editIncidentTypes(req *http.Request) (newTypeID *int32, errHTTP *herr.HTTPError) {
	_, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return nil, errHTTP.From("[getGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalAdministrateIncidentTypes == 0 {
		return nil, herr.Forbidden("The requestor does not have GlobalAdministrateIncidentTypes permission", nil)
	}
	ctx := req.Context()
	typeReq, errHTTP := readBodyAs[imsjson.IncidentType](req)
	if errHTTP != nil {
		return nil, errHTTP.From("[readBodyAs]")
	}
	if typeReq.ID == 0 {
		if typeReq.Name == nil {
			return nil, herr.BadRequest("Incident Type name is required for a new Incident Type", nil)
		}
		group, errHTTP := groupToSQL(typeReq.Group)
		if errHTTP != nil {
			return nil, errHTTP.From("[groupToSQL]")
		}
		id, err := action.imsDBQ.CreateIncidentType(ctx, action.imsDBQ,
			imsdb.CreateIncidentTypeParams{
				Name:   *typeReq.Name,
				Hidden: typeReq.Hidden != nil && *typeReq.Hidden,
				Group:  group,
			},
		)
		if err != nil {
			return nil, herr.InternalServerError("Failed to create Incident Type", err).From("[CreateIncidentTypeOrIgnore]")
		}
		newID := conv.MustInt32(id)
		return &newID, nil
	}

	typeRow, err := action.imsDBQ.IncidentType(ctx, action.imsDBQ, typeReq.ID)
	if err != nil {
		return nil, herr.InternalServerError("Failed to fetch Incident Type", err).From("[IncidentType]")
	}
	if typeReq.Name != nil {
		typeRow.IncidentType.Name = *typeReq.Name
	}
	if typeReq.Hidden != nil {
		typeRow.IncidentType.Hidden = *typeReq.Hidden
	}
	if typeReq.Description != nil {
		typeRow.IncidentType.Description = conv.StringToSql(typeReq.Description, 1023)
	}
	// A provided group ("" clears it); omitted/null leaves the existing group.
	if typeReq.Group != nil {
		group, errHTTP := groupToSQL(typeReq.Group)
		if errHTTP != nil {
			return nil, errHTTP.From("[groupToSQL]")
		}
		typeRow.IncidentType.Group = group
	}
	err = action.imsDBQ.UpdateIncidentType(ctx, action.imsDBQ, imsdb.UpdateIncidentTypeParams{
		Hidden:      typeRow.IncidentType.Hidden,
		Name:        typeRow.IncidentType.Name,
		ID:          typeRow.IncidentType.ID,
		Description: typeRow.IncidentType.Description,
		Group:       typeRow.IncidentType.Group,
	})
	if err != nil {
		return nil, herr.InternalServerError("Failed to update incident type", nil).From("[UpdateIncidentType]")
	}

	return nil, nil
}

// groupToSQL validates an optional incident-type group string and converts it to
// the nullable sqlc enum. A nil or empty pointer means "ungrouped" (NULL); an
// unrecognized value is rejected with 400.
func groupToSQL(group *string) (imsdb.NullIncidentTypeGroup, *herr.HTTPError) {
	if group == nil || *group == "" {
		return imsdb.NullIncidentTypeGroup{}, nil
	}
	g := imsdb.IncidentTypeGroup(*group)
	if !g.Valid() {
		return imsdb.NullIncidentTypeGroup{}, herr.BadRequest(
			fmt.Sprintf("Invalid incident type group: %q", *group), nil)
	}
	return imsdb.NullIncidentTypeGroup{IncidentTypeGroup: g, Valid: true}, nil
}

// groupToString converts the nullable sqlc group enum to a JSON-friendly
// *string, returning nil when the group is NULL.
func groupToString(group imsdb.NullIncidentTypeGroup) *string {
	if !group.Valid {
		return nil
	}
	return new(string(group.IncidentTypeGroup))
}
