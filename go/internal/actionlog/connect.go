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

package actionlog

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/directory"
	resourcesv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/resources/v1"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Service is the action-log domain's Connect surface (plan 09h/1c): the single admin audit read
// (ListActionLogs), retiring REST GET /actionlogs. The read is metadata-only — the audit rows never
// hold request/response bodies — and admin-gated (GlobalAdministrateDebugging). It is a
// NO_SIDE_EFFECTS read, so the action-log interceptor does not audit the audit read itself.
type Service struct {
	ImsDBQ    *store.DBQ
	UserStore directory.UserStore
}

const (
	// defaultActionLogLimit is the page size when the request carries limit == 0.
	defaultActionLogLimit = 200
	// maxActionLogLimit is the hard cap on one read; the proto's int32.lte mirrors it so an
	// over-large request is rejected at protovalidate rather than silently clamped.
	maxActionLogLimit = 1000
	// noMaxTime is the open upper bound: CREATED_AT is a unix-seconds double, so any real
	// timestamp is far below it.
	noMaxTime = 1e100
)

// ListActionLogs is the domain method behind the ListActionLogs RPC, retiring REST GET /actionlogs.
// It authorizes from the ctx claims (GlobalAdministrateDebugging, admin-only) and returns audit
// records newest-first, bounded by the request's limit (defaultActionLogLimit when 0, at most
// maxActionLogLimit) and optionally windowed by [min_time, max_time). The audit table grows by one
// row per mutating request, so an unbounded read would pull the whole table on every admin page
// load. The REST endpoint's userName/path filters were Go-side post-filters over the full range and
// are not carried (a client filters what it displays within its window); its invalid-time 400s have
// no analogue on the typed contract.
func (s Service) ListActionLogs(
	ctx context.Context,
	req *rpcv1.ListActionLogsRequest,
) (*rpcv1.ListActionLogsResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	_, globalPermissions, err := authz.EventPermissions(ctx, nil, s.ImsDBQ, *claims)
	if err != nil {
		return nil, server.InternalError("failed to compute permissions", err)
	}
	if globalPermissions&authz.GlobalAdministrateDebugging == 0 {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("the requestor does not have GlobalAdministrateDebugging permission"))
	}

	limit := req.GetLimit()
	if limit == 0 {
		limit = defaultActionLogLimit
	}
	limit = min(limit, maxActionLogLimit)
	minTime, maxTime := 0.0, noMaxTime
	if req.GetMinTime() != nil {
		minTime = conv.TimeToFloat(req.GetMinTime().AsTime())
	}
	if req.GetMaxTime() != nil {
		maxTime = conv.TimeToFloat(req.GetMaxTime().AsTime())
	}
	rows, err := s.ImsDBQ.ActionLogs(ctx, s.ImsDBQ, imsdb.ActionLogsParams{
		MinTime: minTime,
		MaxTime: maxTime,
		Limit:   limit,
	})
	if err != nil {
		return nil, server.InternalError("failed to fetch action logs", err)
	}
	out := make([]*resourcesv1.ActionLog, 0, len(rows))
	for _, row := range rows {
		out = append(out, actionLogToProto(row.ActionLog))
	}
	return &rpcv1.ListActionLogsResponse{ActionLogs: out}, nil
}

// actionLogToProto maps one stored audit row onto the resource proto. The retired REST handler built
// json.ActionLog (naming the actor user_id/user_name after the columns); the contract renames the
// actor to person_* and drops the always-empty POSITION_* columns (positions are not an implemented
// feature). Duration is formatted from the stored microseconds exactly as the REST read did.
func actionLogToProto(al imsdb.ActionLog) *resourcesv1.ActionLog {
	out := &resourcesv1.ActionLog{
		Id:              al.ID,
		CreatedAt:       timestamppb.New(conv.FloatToTime(al.CreatedAt)),
		ActionType:      al.ActionType,
		Method:          conv.EmptyToNil(al.Method.String),
		Path:            conv.EmptyToNil(al.Path.String),
		Referrer:        conv.EmptyToNil(al.Referrer.String),
		PersonName:      conv.EmptyToNil(al.UserName.String),
		ClientIpAddress: conv.EmptyToNil(al.ClientAddress.String),
	}
	if al.UserID.Valid && al.UserID.Int64 != 0 {
		personID := int32(al.UserID.Int64)
		out.PersonId = &personID
	}
	if al.HttpStatus.Valid && al.HttpStatus.Int16 != 0 {
		status := int32(al.HttpStatus.Int16)
		out.HttpStatus = &status
	}
	if al.DurationMicros.Valid {
		duration := (time.Duration(al.DurationMicros.Int64) * time.Microsecond).String()
		out.Duration = &duration
	}
	return out
}
