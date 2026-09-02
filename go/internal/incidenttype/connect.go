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

package incidenttype

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"connectrpc.com/connect"
	"github.com/go-sql-driver/mysql"
	"github.com/mikeki/ocf-ims/directory"
	commonv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/common/v1"
	resourcesv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/resources/v1"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/internal/server"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// Service is the incident-type domain's Connect surface (plan 09h/1c). It holds the shared deps
// the six incident-type RPCs use, mirroring incident.Service / person.Service. api.ImsService
// composes one (built in AddConnectToMux) and delegates to it. Metrics + Types are the caches a
// write invalidates: the taxonomy feeds the dashboard's by-type/by-category aggregation (spanning
// every event), and the type list is served from an in-memory ref-data cache.
type Service struct {
	ImsDBQ    *store.DBQ
	UserStore directory.UserStore
	Metrics   *server.MetricsCache
	Types     *server.IncidentTypesCache
}

// ListIncidentTypes is the domain method behind the ListIncidentTypes RPC, retiring REST GET
// /incident_types. Gated on GlobalReadIncidentTypes; served from the shared ref-data cache.
func (s Service) ListIncidentTypes(
	ctx context.Context,
	_ *rpcv1.ListIncidentTypesRequest,
) (*rpcv1.ListIncidentTypesResponse, error) {
	_, globalPermissions, err := s.globalPerms(ctx)
	if err != nil {
		return nil, err
	}
	if globalPermissions&authz.GlobalReadIncidentTypes == 0 {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have GlobalReadIncidentTypes permission"))
	}
	types, err := s.Types.Get(ctx, func(ctx context.Context) (imsjson.IncidentTypes, error) {
		return loadIncidentTypesJSON(ctx, s.ImsDBQ)
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch incident types: %w", err))
	}
	out := make([]*resourcesv1.IncidentType, 0, len(types))
	for i := range types {
		out = append(out, incidentTypeToProto(types[i]))
	}
	return &rpcv1.ListIncidentTypesResponse{IncidentTypes: out}, nil
}

// CreateIncidentType is the domain method behind the CreateIncidentType RPC (the id==0 branch of
// the retired REST POST /incident_types multiplexer). Admin-created types are approved immediately
// with no proposer.
func (s Service) CreateIncidentType(
	ctx context.Context,
	req *rpcv1.CreateIncidentTypeRequest,
) (*rpcv1.CreateIncidentTypeResponse, error) {
	err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	it := req.GetIncidentType()
	name := strings.TrimSpace(it.GetName())
	if name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("incident type name is required for a new incident type"))
	}
	id, err := s.ImsDBQ.CreateIncidentType(ctx, s.ImsDBQ, imsdb.CreateIncidentTypeParams{
		Name:               name,
		Hidden:             it.GetHidden(),
		Group:              incidentTypeGroupFromProto(it.Group),
		Approved:           true,
		ProposedByPersonID: sql.NullInt32{},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create incident type: %w", err))
	}
	s.invalidateCaches()
	slog.Info("Created incident type", "incident_type_id", id, "name", name)
	return &rpcv1.CreateIncidentTypeResponse{IncidentTypeId: conv.MustInt32(id)}, nil
}

// UpdateIncidentType is the domain method behind the UpdateIncidentType RPC (the update branch of
// the retired multiplexer). It edits name / description / group by read-modify-write, leaving hidden
// alone (that is SetIncidentTypeHidden's job). Each field is applied only when present.
func (s Service) UpdateIncidentType(
	ctx context.Context,
	req *rpcv1.UpdateIncidentTypeRequest,
) (*rpcv1.UpdateIncidentTypeResponse, error) {
	err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	row, err := s.ImsDBQ.IncidentType(ctx, s.ImsDBQ, req.GetIncidentTypeId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch incident type: %w", err))
	}
	it := req.GetIncidentType()
	if it.Name != nil {
		row.IncidentType.Name = it.GetName()
	}
	if it.Description != nil {
		row.IncidentType.Description = conv.StringToSql(it.Description, 1023)
	}
	// A present group sets it (UNSPECIFIED clears); an absent group leaves the stored value.
	if it.Group != nil {
		row.IncidentType.Group = incidentTypeGroupFromProto(it.Group)
	}
	err = s.ImsDBQ.UpdateIncidentType(ctx, s.ImsDBQ, imsdb.UpdateIncidentTypeParams{
		Hidden:      row.IncidentType.Hidden,
		Name:        row.IncidentType.Name,
		ID:          row.IncidentType.ID,
		Description: row.IncidentType.Description,
		Group:       row.IncidentType.Group,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to update incident type: %w", err))
	}
	s.invalidateCaches()
	return &rpcv1.UpdateIncidentTypeResponse{}, nil
}

// ApproveIncidentType is the domain method behind the ApproveIncidentType RPC (the approved==true
// branch of the retired multiplexer): an admin approves a writer's pending proposed type.
func (s Service) ApproveIncidentType(
	ctx context.Context,
	req *rpcv1.ApproveIncidentTypeRequest,
) (*rpcv1.ApproveIncidentTypeResponse, error) {
	err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	err = s.ImsDBQ.ApproveIncidentType(ctx, s.ImsDBQ, req.GetIncidentTypeId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to approve incident type: %w", err))
	}
	s.invalidateCaches()
	return &rpcv1.ApproveIncidentTypeResponse{}, nil
}

// SetIncidentTypeHidden is the domain method behind the SetIncidentTypeHidden RPC (the hidden edit,
// split out of the retired multiplexer): retire a type from the incident-form picker, or restore it,
// without deleting it. Read-modify-write, leaving name / description / group alone.
func (s Service) SetIncidentTypeHidden(
	ctx context.Context,
	req *rpcv1.SetIncidentTypeHiddenRequest,
) (*rpcv1.SetIncidentTypeHiddenResponse, error) {
	err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	row, err := s.ImsDBQ.IncidentType(ctx, s.ImsDBQ, req.GetIncidentTypeId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch incident type: %w", err))
	}
	err = s.ImsDBQ.UpdateIncidentType(ctx, s.ImsDBQ, imsdb.UpdateIncidentTypeParams{
		Hidden:      req.GetHidden(),
		Name:        row.IncidentType.Name,
		ID:          row.IncidentType.ID,
		Description: row.IncidentType.Description,
		Group:       row.IncidentType.Group,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to set incident type hidden: %w", err))
	}
	s.invalidateCaches()
	return &rpcv1.SetIncidentTypeHiddenResponse{}, nil
}

// ProposeIncidentType is the domain method behind the ProposeIncidentType RPC, retiring REST POST
// /events/{eventName}/incident_types. A writer proposes a new (unapproved) type from the incident
// form; the route is event-scoped only to authorize the caller as a writer — the type is global. A
// name collision resolves to the existing type's id so the caller just attaches it.
func (s Service) ProposeIncidentType(
	ctx context.Context,
	req *rpcv1.ProposeIncidentTypeRequest,
) (*rpcv1.ProposeIncidentTypeResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	eventID := req.GetEventId()
	perms, _, err := authz.EventPermissions(ctx, &eventID, s.ImsDBQ, *claims)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to compute permissions: %w", err))
	}
	if perms[eventID]&authz.EventWriteIncidents == 0 {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have permission to propose incident types on this event"))
	}
	name := strings.TrimSpace(req.GetIncidentType().GetName())
	if name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("incident type name is required"))
	}
	id, err := s.ImsDBQ.CreateIncidentType(ctx, s.ImsDBQ, imsdb.CreateIncidentTypeParams{
		Name:               name,
		Hidden:             false,
		Group:              imsdb.NullIncidentTypeGroup{}, // an admin categorises on approval
		Approved:           false,
		ProposedByPersonID: sql.NullInt32{Int32: claims.PersonID(), Valid: true},
	})
	if err != nil {
		// A duplicate NAME means the type already exists (seeded, or someone else added/proposed
		// it — NAME is collation-insensitive). Resolve to that type's id so the caller just
		// attaches it, rather than failing the proposal.
		var mysqlErr *mysql.MySQLError
		const mySQLErDupEntry = 1062
		if errors.As(err, &mysqlErr) && mysqlErr.Number == mySQLErDupEntry {
			existing, lookupErr := s.ImsDBQ.IncidentTypeByName(ctx, s.ImsDBQ, name)
			if lookupErr == nil {
				return &rpcv1.ProposeIncidentTypeResponse{IncidentTypeId: existing.IncidentType.ID}, nil
			}
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to propose incident type: %w", err))
	}
	s.invalidateCaches()
	return &rpcv1.ProposeIncidentTypeResponse{IncidentTypeId: conv.MustInt32(id)}, nil
}

// globalPerms resolves the caller's claims + global permission mask from the ctx the auth
// interceptor populated. A missing claims context is Unauthenticated.
func (s Service) globalPerms(ctx context.Context) (*authz.IMSClaims, authz.GlobalPermissionMask, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, 0, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	_, globalPermissions, err := authz.EventPermissions(ctx, nil, s.ImsDBQ, *claims)
	if err != nil {
		return nil, 0, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to compute permissions: %w", err))
	}
	return claims, globalPermissions, nil
}

// requireAdmin enforces GlobalAdministrateIncidentTypes, the gate the four admin writes share.
func (s Service) requireAdmin(ctx context.Context) error {
	_, globalPermissions, err := s.globalPerms(ctx)
	if err != nil {
		return err
	}
	if globalPermissions&authz.GlobalAdministrateIncidentTypes == 0 {
		return connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have GlobalAdministrateIncidentTypes permission"))
	}
	return nil
}

// invalidateCaches drops the caches a type write shifts: the whole metrics set (the dashboard's
// by-type/by-category aggregation spans every event) and the cached taxonomy list.
func (s Service) invalidateCaches() {
	s.Metrics.InvalidateAll()
	s.Types.Invalidate()
}

// incidentTypeToProto maps an assembled imsjson.IncidentType onto the resource proto — the
// throwaway json→wire bridge for the read path (dies with json/ when the read is rebuilt DB→proto).
func incidentTypeToProto(t imsjson.IncidentType) *resourcesv1.IncidentType {
	out := &resourcesv1.IncidentType{
		Id:          t.ID,
		Name:        t.Name,
		Description: t.Description,
		Hidden:      t.Hidden,
		Group:       incidentTypeGroupToProto(t.Group),
		Approved:    t.Approved,
	}
	if t.Proposer != nil {
		out.Proposer = &commonv1.PersonRef{
			PersonId: t.Proposer.PersonID,
			Handle:   conv.EmptyToNil(t.Proposer.Handle),
			Name:     conv.EmptyToNil(t.Proposer.Name),
		}
	}
	return out
}

// incidentTypeGroupToProto maps the stored group string (json's *string, nil = ungrouped) onto the
// optional proto enum pointer (nil = ungrouped).
func incidentTypeGroupToProto(g *string) *resourcesv1.IncidentTypeGroup {
	if g == nil || *g == "" {
		return nil
	}
	var e resourcesv1.IncidentTypeGroup
	switch imsdb.IncidentTypeGroup(*g) {
	case imsdb.IncidentTypeGroupSafety:
		e = resourcesv1.IncidentTypeGroup_INCIDENT_TYPE_GROUP_SAFETY
	case imsdb.IncidentTypeGroupConduct:
		e = resourcesv1.IncidentTypeGroup_INCIDENT_TYPE_GROUP_CONDUCT
	case imsdb.IncidentTypeGroupOperations:
		e = resourcesv1.IncidentTypeGroup_INCIDENT_TYPE_GROUP_OPERATIONS
	case imsdb.IncidentTypeGroupCompliance:
		e = resourcesv1.IncidentTypeGroup_INCIDENT_TYPE_GROUP_COMPLIANCE
	default:
		return nil
	}
	return &e
}

// incidentTypeGroupFromProto maps the optional proto group enum onto the nullable sqlc enum: a nil
// or UNSPECIFIED value is NULL (ungrouped); a defined value is the category. defined_only on the
// field means an out-of-range value can't arrive.
func incidentTypeGroupFromProto(g *resourcesv1.IncidentTypeGroup) imsdb.NullIncidentTypeGroup {
	if g == nil {
		return imsdb.NullIncidentTypeGroup{}
	}
	switch *g {
	case resourcesv1.IncidentTypeGroup_INCIDENT_TYPE_GROUP_SAFETY:
		return imsdb.NullIncidentTypeGroup{IncidentTypeGroup: imsdb.IncidentTypeGroupSafety, Valid: true}
	case resourcesv1.IncidentTypeGroup_INCIDENT_TYPE_GROUP_CONDUCT:
		return imsdb.NullIncidentTypeGroup{IncidentTypeGroup: imsdb.IncidentTypeGroupConduct, Valid: true}
	case resourcesv1.IncidentTypeGroup_INCIDENT_TYPE_GROUP_OPERATIONS:
		return imsdb.NullIncidentTypeGroup{IncidentTypeGroup: imsdb.IncidentTypeGroupOperations, Valid: true}
	case resourcesv1.IncidentTypeGroup_INCIDENT_TYPE_GROUP_COMPLIANCE:
		return imsdb.NullIncidentTypeGroup{IncidentTypeGroup: imsdb.IncidentTypeGroupCompliance, Valid: true}
	case resourcesv1.IncidentTypeGroup_INCIDENT_TYPE_GROUP_UNSPECIFIED:
		return imsdb.NullIncidentTypeGroup{}
	default:
		return imsdb.NullIncidentTypeGroup{}
	}
}
