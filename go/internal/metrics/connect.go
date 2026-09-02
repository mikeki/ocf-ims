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

package metrics

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/directory"
	resourcesv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/resources/v1"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/internal/server"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"golang.org/x/sync/errgroup"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Service is the metrics domain's Connect surface (plan 09h/1c): the single per-event dashboard read
// (GetMetrics), retiring REST GET /events/{eventName}/metrics. Cache is the per-event MetricsCache
// shared with the incident writes (they invalidate the same entry on a write, so the dashboard never
// serves a stale aggregate until the TTL); it is keyed by event *name*, which the incident writes also
// use, so GetMetrics resolves the request's event id to a name for the lookup.
type Service struct {
	ImsDBQ    *store.DBQ
	UserStore directory.UserStore
	Cache     *server.MetricsCache
}

// GetMetrics is the domain method behind the GetMetrics RPC, retiring REST GET
// /events/{eventName}/metrics. The dashboard opens to admins and per-event writers (plan 52d): writers
// get EventWriteIncidents from their PERSON__EVENT tier and admins get it via the admin bypass, so a
// single write-bit check gates both. The heavy aggregation goes through the shared per-event cache, so
// repeated loads within the TTL serve a cached payload without touching the database.
func (s Service) GetMetrics(
	ctx context.Context,
	req *rpcv1.GetMetricsRequest,
) (*rpcv1.GetMetricsResponse, error) {
	eventID := req.GetEventId()
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	perms, _, err := authz.EventPermissions(ctx, &eventID, s.ImsDBQ, *claims)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to compute permissions: %w", err))
	}
	if perms[eventID]&authz.EventWriteIncidents == 0 {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("the dashboard is restricted to administrators and event writers"))
	}

	// Resolve the event by id to get its name — the MetricsCache key. The id-keyed contract makes the
	// REST name-not-found 404 an id-not-found 404 here (an event id with no row).
	ev, err := s.ImsDBQ.Event(ctx, s.ImsDBQ, eventID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("no such event"))
	}
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to look up event: %w", err))
	}
	eventName := ev.Event.Name

	cached, err := s.Cache.Get(ctx, eventName, func(ctx context.Context) (imsjson.Metrics, error) {
		return s.computeMetrics(ctx, eventName)
	})
	if err != nil {
		return nil, server.HerrToConnect(herr.AsHTTPError(err))
	}
	return &rpcv1.GetMetricsResponse{Metrics: metricsToProto(*cached)}, nil
}

// computeMetrics resolves the event and runs the aggregate queries. It is the cache's refresher, so it
// runs at most once per TTL per event. (Ported verbatim from the retired REST GetMetrics handler.)
func (s Service) computeMetrics(ctx context.Context, eventName string) (imsjson.Metrics, error) {
	var resp imsjson.Metrics

	event, errHTTP := server.GetEventCtx(ctx, eventName, s.ImsDBQ)
	if errHTTP != nil {
		return resp, errHTTP.From("[server.GetEvent]")
	}

	var (
		incidents  []imsdb.MetricsIncidentsRow
		byCategory []imsdb.MetricsIncidentCountByCategoryRow
		byType     []imsdb.MetricsIncidentCountByTypeRow
		byArea     []imsdb.MetricsIncidentCountByAreaRow
		byRole     []imsdb.MetricsParticipationCountByEventRow
	)
	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error {
		var err error
		incidents, err = s.ImsDBQ.MetricsIncidents(groupCtx, s.ImsDBQ, event.ID)
		if err != nil {
			return herr.InternalServerError("Failed to fetch incidents", err).From("[MetricsIncidents]")
		}
		return nil
	})
	group.Go(func() error {
		var err error
		byCategory, err = s.ImsDBQ.MetricsIncidentCountByCategory(groupCtx, s.ImsDBQ, event.ID)
		if err != nil {
			return herr.InternalServerError("Failed to fetch category counts", err).From("[MetricsIncidentCountByCategory]")
		}
		return nil
	})
	group.Go(func() error {
		var err error
		byType, err = s.ImsDBQ.MetricsIncidentCountByType(groupCtx, s.ImsDBQ, event.ID)
		if err != nil {
			return herr.InternalServerError("Failed to fetch type counts", err).From("[MetricsIncidentCountByType]")
		}
		return nil
	})
	group.Go(func() error {
		var err error
		byArea, err = s.ImsDBQ.MetricsIncidentCountByArea(groupCtx, s.ImsDBQ, event.ID)
		if err != nil {
			return herr.InternalServerError("Failed to fetch area counts", err).From("[MetricsIncidentCountByArea]")
		}
		return nil
	})
	group.Go(func() error {
		var err error
		byRole, err = s.ImsDBQ.MetricsParticipationCountByEvent(groupCtx, s.ImsDBQ, event.ID)
		if err != nil {
			return herr.InternalServerError("Failed to fetch role counts", err).From("[MetricsParticipationCountByEvent]")
		}
		return nil
	})
	err := group.Wait()
	if err != nil {
		return resp, err
	}

	resp = buildMetrics(event, incidents, byCategory, byType, byArea, byRole)
	resp.GeneratedAtMS = time.Now().UnixMilli()
	return resp, nil
}

// metricsToProto maps the assembled imsjson.Metrics (read path) onto the resource proto — the throwaway
// json→wire bridge (dies with json/ when the read is rebuilt DB→proto). json's GeneratedAtMS (Unix
// millis) becomes the contract's generated_at Timestamp; the nil-when-none avg-time pointer carries
// straight across (both sides are *float64).
func metricsToProto(m imsjson.Metrics) *resourcesv1.Metrics {
	return &resourcesv1.Metrics{
		Event:                 m.Event,
		EventId:               m.EventID,
		Total:                 m.Total,
		Open:                  m.Open,
		Closed:                m.Closed,
		ByState:               metricCountsToProto(m.ByState),
		ByPriority:            metricCountsToProto(m.ByPriority),
		ByCategory:            metricCountsToProto(m.ByCategory),
		ByType:                metricCountsToProto(m.ByType),
		ByRole:                metricCountsToProto(m.ByRole),
		ByArea:                metricCountsToProto(m.ByArea),
		ByDay:                 metricDaysToProto(m.ByDay),
		OpenFollowUps:         metricRefsToProto(m.OpenFollowUps),
		AvgTimeToCloseSeconds: m.AvgTimeToCloseSeconds,
		ClosedCount:           m.ClosedCount,
		GeneratedAt:           timestamppb.New(time.UnixMilli(m.GeneratedAtMS)),
	}
}

func metricCountsToProto(cs []imsjson.MetricCount) []*resourcesv1.MetricCount {
	out := make([]*resourcesv1.MetricCount, 0, len(cs))
	for _, c := range cs {
		out = append(out, &resourcesv1.MetricCount{Key: c.Key, Label: c.Label, Count: c.Count})
	}
	return out
}

func metricDaysToProto(ds []imsjson.MetricDay) []*resourcesv1.MetricDay {
	out := make([]*resourcesv1.MetricDay, 0, len(ds))
	for _, d := range ds {
		out = append(out, &resourcesv1.MetricDay{Date: d.Date, Count: d.Count})
	}
	return out
}

func metricRefsToProto(rs []imsjson.MetricIncidentRef) []*resourcesv1.MetricIncidentRef {
	out := make([]*resourcesv1.MetricIncidentRef, 0, len(rs))
	for _, r := range rs {
		out = append(out, &resourcesv1.MetricIncidentRef{IncidentNumber: r.Number, Summary: r.Summary})
	}
	return out
}
