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

package outcome

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

// Service is the outcome domain's Connect surface (plan 09h/1c). It holds the shared deps the six
// outcome RPCs use, mirroring incidenttype.Service. api.ImsService composes one (built in
// AddConnectToMux) and delegates to it. Outcomes is the ref-data cache a write invalidates: the
// outcome list is served from an in-memory cache. Unlike incident types, outcomes carry no group,
// so they feed no dashboard aggregation and there is no metrics cache to drop.
type Service struct {
	ImsDBQ    *store.DBQ
	UserStore directory.UserStore
	Outcomes  *server.OutcomesCache
}

// ListOutcomes is the domain method behind the ListOutcomes RPC, retiring REST GET /outcomes. Gated
// on GlobalReadOutcomes; served from the shared ref-data cache.
func (s Service) ListOutcomes(
	ctx context.Context,
	_ *rpcv1.ListOutcomesRequest,
) (*rpcv1.ListOutcomesResponse, error) {
	_, globalPermissions, err := s.globalPerms(ctx)
	if err != nil {
		return nil, err
	}
	if globalPermissions&authz.GlobalReadOutcomes == 0 {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have GlobalReadOutcomes permission"))
	}
	outcomes, err := s.Outcomes.Get(ctx, func(ctx context.Context) (imsjson.Outcomes, error) {
		return loadOutcomesJSON(ctx, s.ImsDBQ)
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch outcomes: %w", err))
	}
	out := make([]*resourcesv1.Outcome, 0, len(outcomes))
	for i := range outcomes {
		out = append(out, outcomeToProto(outcomes[i]))
	}
	return &rpcv1.ListOutcomesResponse{Outcomes: out}, nil
}

// CreateOutcome is the domain method behind the CreateOutcome RPC (the id==0 branch of the retired
// REST POST /outcomes multiplexer). Admin-created outcomes are approved immediately with no proposer.
func (s Service) CreateOutcome(
	ctx context.Context,
	req *rpcv1.CreateOutcomeRequest,
) (*rpcv1.CreateOutcomeResponse, error) {
	err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	o := req.GetOutcome()
	name := strings.TrimSpace(o.GetName())
	if name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("outcome name is required for a new outcome"))
	}
	id, err := s.ImsDBQ.CreateOutcome(ctx, s.ImsDBQ, imsdb.CreateOutcomeParams{
		Name:               name,
		Hidden:             o.GetHidden(),
		Approved:           true,
		ProposedByPersonID: sql.NullInt32{},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create outcome: %w", err))
	}
	s.Outcomes.Invalidate()
	slog.Info("Created outcome", "outcome_id", id, "name", name)
	return &rpcv1.CreateOutcomeResponse{OutcomeId: conv.MustInt32(id)}, nil
}

// UpdateOutcome is the domain method behind the UpdateOutcome RPC (the update branch of the retired
// multiplexer). It edits the name by read-modify-write, leaving hidden alone (that is
// SetOutcomeHidden's job). Name is applied only when present.
func (s Service) UpdateOutcome(
	ctx context.Context,
	req *rpcv1.UpdateOutcomeRequest,
) (*rpcv1.UpdateOutcomeResponse, error) {
	err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	row, err := s.ImsDBQ.Outcome(ctx, s.ImsDBQ, req.GetOutcomeId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch outcome: %w", err))
	}
	o := req.GetOutcome()
	if o.Name != nil {
		row.Outcome.Name = o.GetName()
	}
	err = s.ImsDBQ.UpdateOutcome(ctx, s.ImsDBQ, imsdb.UpdateOutcomeParams{
		Hidden: row.Outcome.Hidden,
		Name:   row.Outcome.Name,
		ID:     row.Outcome.ID,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to update outcome: %w", err))
	}
	s.Outcomes.Invalidate()
	return &rpcv1.UpdateOutcomeResponse{}, nil
}

// ApproveOutcome is the domain method behind the ApproveOutcome RPC (the approved==true branch of
// the retired multiplexer): an admin approves a writer's pending proposed outcome.
func (s Service) ApproveOutcome(
	ctx context.Context,
	req *rpcv1.ApproveOutcomeRequest,
) (*rpcv1.ApproveOutcomeResponse, error) {
	err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	err = s.ImsDBQ.ApproveOutcome(ctx, s.ImsDBQ, req.GetOutcomeId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to approve outcome: %w", err))
	}
	s.Outcomes.Invalidate()
	return &rpcv1.ApproveOutcomeResponse{}, nil
}

// SetOutcomeHidden is the domain method behind the SetOutcomeHidden RPC (the hidden edit, split out
// of the retired multiplexer): retire an outcome from the incident-form picker, or restore it,
// without deleting it. Read-modify-write, leaving name alone.
func (s Service) SetOutcomeHidden(
	ctx context.Context,
	req *rpcv1.SetOutcomeHiddenRequest,
) (*rpcv1.SetOutcomeHiddenResponse, error) {
	err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	row, err := s.ImsDBQ.Outcome(ctx, s.ImsDBQ, req.GetOutcomeId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch outcome: %w", err))
	}
	err = s.ImsDBQ.UpdateOutcome(ctx, s.ImsDBQ, imsdb.UpdateOutcomeParams{
		Hidden: req.GetHidden(),
		Name:   row.Outcome.Name,
		ID:     row.Outcome.ID,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to set outcome hidden: %w", err))
	}
	s.Outcomes.Invalidate()
	return &rpcv1.SetOutcomeHiddenResponse{}, nil
}

// ProposeOutcome is the domain method behind the ProposeOutcome RPC, retiring REST POST
// /events/{eventName}/outcomes. A writer proposes a new (unapproved) outcome from the incident form;
// the route is event-scoped only to authorize the caller as a writer — the outcome is global. A name
// collision resolves to the existing outcome's id so the caller just attaches it.
func (s Service) ProposeOutcome(
	ctx context.Context,
	req *rpcv1.ProposeOutcomeRequest,
) (*rpcv1.ProposeOutcomeResponse, error) {
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
			errors.New("the requestor does not have permission to propose outcomes on this event"))
	}
	name := strings.TrimSpace(req.GetOutcome().GetName())
	if name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("outcome name is required"))
	}
	id, err := s.ImsDBQ.CreateOutcome(ctx, s.ImsDBQ, imsdb.CreateOutcomeParams{
		Name:               name,
		Hidden:             false,
		Approved:           false,
		ProposedByPersonID: sql.NullInt32{Int32: claims.PersonID(), Valid: true},
	})
	if err != nil {
		// A duplicate NAME means the outcome already exists (seeded, or someone else added/proposed
		// it — NAME is collation-insensitive). Resolve to that outcome's id so the caller just
		// attaches it, rather than failing the proposal.
		var mysqlErr *mysql.MySQLError
		const mySQLErDupEntry = 1062
		if errors.As(err, &mysqlErr) && mysqlErr.Number == mySQLErDupEntry {
			existing, lookupErr := s.ImsDBQ.OutcomeByName(ctx, s.ImsDBQ, name)
			if lookupErr == nil {
				return &rpcv1.ProposeOutcomeResponse{OutcomeId: existing.Outcome.ID}, nil
			}
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to propose outcome: %w", err))
	}
	s.Outcomes.Invalidate()
	return &rpcv1.ProposeOutcomeResponse{OutcomeId: conv.MustInt32(id)}, nil
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

// requireAdmin enforces GlobalAdministrateOutcomes, the gate the four admin writes share.
func (s Service) requireAdmin(ctx context.Context) error {
	_, globalPermissions, err := s.globalPerms(ctx)
	if err != nil {
		return err
	}
	if globalPermissions&authz.GlobalAdministrateOutcomes == 0 {
		return connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have GlobalAdministrateOutcomes permission"))
	}
	return nil
}

// outcomeToProto maps an assembled imsjson.Outcome onto the resource proto — the throwaway json→wire
// bridge for the read path (dies with json/ when the read is rebuilt DB→proto).
func outcomeToProto(o imsjson.Outcome) *resourcesv1.Outcome {
	out := &resourcesv1.Outcome{
		Id:       o.ID,
		Name:     o.Name,
		Hidden:   o.Hidden,
		Approved: o.Approved,
	}
	if o.Proposer != nil {
		out.Proposer = &commonv1.PersonRef{
			PersonId: o.Proposer.PersonID,
			Handle:   conv.EmptyToNil(o.Proposer.Handle),
			Name:     conv.EmptyToNil(o.Proposer.Name),
		}
	}
	return out
}
