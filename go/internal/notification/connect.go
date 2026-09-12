// SPDX-License-Identifier: Apache-2.0

package notification

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/directory"
	resourcesv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/resources/v1"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/internal/server"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Service is the notification domain's Connect surface (plan 09h/1c): the three per-caller
// notification RPCs (list + mark-all-read + mark-one-read), retiring REST GET /notifications and POST
// /notifications/read[/{id}]. They are per-person (the caller's own), so they need only
// authentication — no event scoping. The notification-*generation* helpers in notification.go are a
// separate, internal surface (called by the incident/report writes) and are untouched.
type Service struct {
	ImsDBQ    *store.DBQ
	UserStore directory.UserStore
}

// ListNotifications is the domain method behind the ListNotifications RPC, retiring REST GET
// /notifications. It returns the caller's recent notifications plus their unread count (the nav badge
// and list from one call).
func (s Service) ListNotifications(
	ctx context.Context,
	_ *rpcv1.ListNotificationsRequest,
) (*rpcv1.ListNotificationsResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	personID := claims.PersonID()
	rows, err := s.ImsDBQ.NotificationsForPerson(ctx, s.ImsDBQ, personID)
	if err != nil {
		return nil, server.InternalError("failed to fetch notifications", err)
	}
	unread, err := s.ImsDBQ.UnreadNotificationCountForPerson(ctx, s.ImsDBQ, personID)
	if err != nil {
		return nil, server.InternalError("failed to count notifications", err)
	}
	out := make([]*resourcesv1.Notification, 0, len(rows))
	for _, row := range rows {
		out = append(out, notificationToProto(notificationToJSON(row, personID, claims.PersonAdmin())))
	}
	return &rpcv1.ListNotificationsResponse{Notifications: out, Unread: unread}, nil
}

// MarkAllNotificationsRead is the domain method behind the MarkAllNotificationsRead RPC, retiring REST
// POST /notifications/read. Scoped to the caller — a user can only mark their own read.
func (s Service) MarkAllNotificationsRead(
	ctx context.Context,
	_ *rpcv1.MarkAllNotificationsReadRequest,
) (*rpcv1.MarkAllNotificationsReadResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	err := s.ImsDBQ.MarkAllNotificationsRead(ctx, s.ImsDBQ, imsdb.MarkAllNotificationsReadParams{
		ReadAt:            nowNullFloat(),
		RecipientPersonID: claims.PersonID(),
	})
	if err != nil {
		return nil, server.InternalError("failed to mark notifications read", err)
	}
	return &rpcv1.MarkAllNotificationsReadResponse{}, nil
}

// MarkNotificationRead is the domain method behind the MarkNotificationRead RPC, retiring REST POST
// /notifications/{id}/read. Scoped to the caller (the update keys on RecipientPersonID), so a user can
// only mark their own read.
func (s Service) MarkNotificationRead(
	ctx context.Context,
	req *rpcv1.MarkNotificationReadRequest,
) (*rpcv1.MarkNotificationReadResponse, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	err := s.ImsDBQ.MarkNotificationRead(ctx, s.ImsDBQ, imsdb.MarkNotificationReadParams{
		ReadAt:            nowNullFloat(),
		ID:                req.GetNotificationId(),
		RecipientPersonID: claims.PersonID(),
	})
	if err != nil {
		return nil, server.InternalError("failed to mark notification read", err)
	}
	return &rpcv1.MarkNotificationReadResponse{}, nil
}

// nowNullFloat is the current time as the store's read-at value.
func nowNullFloat() sql.NullFloat64 {
	return sql.NullFloat64{Float64: conv.TimeToFloat(time.Now()), Valid: true}
}

// notificationToProto maps an assembled imsjson.Notification (which already applied the private-
// incident summary withholding) onto the resource proto — the throwaway json→wire bridge for the read
// path (dies with json/ when the read is rebuilt DB→proto).
func notificationToProto(n imsjson.Notification) *resourcesv1.Notification {
	return &resourcesv1.Notification{
		Id:              n.ID,
		Type:            notificationTypeToProto(n.Type),
		Event:           n.Event,
		IncidentNumber:  n.IncidentNumber,
		IncidentSummary: conv.EmptyToNil(n.IncidentSummary),
		ReportNumber:    n.ReportNumber,
		ReportSummary:   conv.EmptyToNil(n.ReportSummary),
		JournalEntryId:  n.JournalEntryID,
		Actor:           conv.EmptyToNil(n.Actor),
		Created:         timestamppb.New(n.Created),
		Read:            n.Read,
	}
}

// notificationTypeToProto maps the stored NOTIFICATION.TYPE string (json's Type) onto the proto enum.
func notificationTypeToProto(t string) resourcesv1.NotificationType {
	switch imsdb.NotificationType(t) {
	case imsdb.NotificationTypeMentioned:
		return resourcesv1.NotificationType_NOTIFICATION_TYPE_MENTIONED
	case imsdb.NotificationTypeAddedToIncident:
		return resourcesv1.NotificationType_NOTIFICATION_TYPE_ADDED_TO_INCIDENT
	case imsdb.NotificationTypeReportRequested:
		return resourcesv1.NotificationType_NOTIFICATION_TYPE_REPORT_REQUESTED
	default:
		return resourcesv1.NotificationType_NOTIFICATION_TYPE_UNSPECIFIED
	}
}
