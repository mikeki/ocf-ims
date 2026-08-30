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
	"time"

	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/internal/server"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// nullInt32 wraps a present int32 as a sql.NullInt32.
func nullInt32(v int32) sql.NullInt32 {
	return sql.NullInt32{Int32: v, Valid: true}
}

// createNotification inserts one notification. Self-notifications are suppressed
// (you aren't told about your own action), and a notification for nobody
// (recipient <= 0) is skipped. Callers pass the dbtx so generation rides the
// same transaction as the triggering write.
// createNotification inserts one notification. Self-notifications are suppressed
// (you aren't told about your own action), and a notification for nobody
// (recipient <= 0) is skipped. incidentNumber/reportNumber are the type-dependent
// source (a notification carries at most one). Callers pass the dbtx so
// generation rides the same transaction as the triggering write.
func createNotification(
	ctx context.Context, db *store.DBQ, dbtx imsdb.DBTX,
	recipientPersonID int32, notifType imsdb.NotificationType,
	eventID int32, incidentNumber, reportNumber, journalEntryID sql.NullInt32, actorPersonID int32,
) *herr.HTTPError {
	if recipientPersonID <= 0 || recipientPersonID == actorPersonID {
		return nil
	}
	err := db.CreateNotification(ctx, dbtx, imsdb.CreateNotificationParams{
		RecipientPersonID: recipientPersonID,
		Type:              notifType,
		Event:             eventID,
		IncidentNumber:    incidentNumber,
		ReportNumber:      reportNumber,
		JournalEntry:      journalEntryID,
		ActorPersonID:     nullInt32(actorPersonID),
		Created:           conv.TimeToFloat(time.Now()),
	})
	if err != nil {
		return herr.InternalServerError("Failed to create notification", err).From("[CreateNotification]")
	}
	return nil
}

// generateMentionNotificationsFor creates a "mentioned" notification for each
// person mentioned by a journal entry (plan 82, driven by plan 81's mention
// rows), linked to whichever source — incident or report — the entry belongs to.
// Recipients are read back from the persisted mention rows, so the IDs are valid
// and deduped; the actor (the entry's author) is skipped by createNotification.
// It returns the mentioned person IDs (as persisted, so valid and deduped per
// entry) so the caller can additionally fan out web push after commit (plan 84c);
// the IDs still include the actor, whom both the bell and the push fan-out skip.
func generateMentionNotificationsFor(
	ctx context.Context, db *store.DBQ, dbtx imsdb.DBTX,
	eventID int32, incidentNumber, reportNumber sql.NullInt32, journalEntryID, actorPersonID int32,
) ([]int32, *herr.HTTPError) {
	personIDs, err := db.JournalEntryMentionPersonIDs(ctx, dbtx, journalEntryID)
	if err != nil {
		return nil, herr.InternalServerError("Failed to read journal entry mentions", err).From("[JournalEntryMentionPersonIDs]")
	}
	for _, personID := range personIDs {
		errHTTP := createNotification(ctx, db, dbtx, personID, imsdb.NotificationTypeMentioned,
			eventID, incidentNumber, reportNumber, nullInt32(journalEntryID), actorPersonID)
		if errHTTP != nil {
			return nil, errHTTP.From("[createNotification]")
		}
	}
	return personIDs, nil
}

// generateMentionNotifications notifies the people mentioned in an incident
// journal entry and returns them for the post-commit push fan-out.
func generateMentionNotifications(
	ctx context.Context, db *store.DBQ, dbtx imsdb.DBTX,
	eventID, incidentNumber, journalEntryID, actorPersonID int32,
) ([]int32, *herr.HTTPError) {
	return generateMentionNotificationsFor(ctx, db, dbtx, eventID,
		nullInt32(incidentNumber), sql.NullInt32{}, journalEntryID, actorPersonID)
}

// generateReportMentionNotifications notifies the people mentioned in a field
// report journal entry and returns them for the post-commit push fan-out.
func generateReportMentionNotifications(
	ctx context.Context, db *store.DBQ, dbtx imsdb.DBTX,
	eventID, reportNumber, journalEntryID, actorPersonID int32,
) ([]int32, *herr.HTTPError) {
	return generateMentionNotificationsFor(ctx, db, dbtx, eventID,
		sql.NullInt32{}, nullInt32(reportNumber), journalEntryID, actorPersonID)
}

// generateAddedToIncidentNotification tells a person they were added to an
// incident's involvement (plan 82). No journal entry is associated.
func generateAddedToIncidentNotification(
	ctx context.Context, db *store.DBQ, dbtx imsdb.DBTX,
	eventID, incidentNumber, recipientPersonID, actorPersonID int32,
) *herr.HTTPError {
	errHTTP := createNotification(ctx, db, dbtx, recipientPersonID, imsdb.NotificationTypeAddedToIncident,
		eventID, nullInt32(incidentNumber), sql.NullInt32{}, sql.NullInt32{}, actorPersonID)
	if errHTTP != nil {
		return errHTTP.From("[createNotification]")
	}
	return nil
}

// notificationToJSON maps a stored, enriched row to its API shape. The recipient
// (callerPersonID / callerIsAdmin) is passed so a private incident's summary can be
// withheld from a recipient who may no longer view it.
func notificationToJSON(row imsdb.NotificationsForPersonRow, callerPersonID int32, callerIsAdmin bool) imsjson.Notification {
	actor := row.ActorName.String
	if actor == "" {
		actor = row.ActorHandle.String
	}
	// Withhold a private incident's summary from a recipient who can't currently see
	// it — not an admin, not the creator, and not currently granted access (e.g. the
	// incident was made private, or their grant was revoked, after the notification).
	incidentSummary := row.IncidentSummary.String
	if row.IncidentPrivate.Valid && row.IncidentPrivate.Bool && !callerIsAdmin &&
		!(row.IncidentCreatedBy.Valid && row.IncidentCreatedBy.Int32 == callerPersonID) &&
		!row.IncidentRecipientHasGrant {
		incidentSummary = ""
	}
	return imsjson.Notification{
		ID:              row.ID,
		Type:            string(row.Type),
		Event:           row.EventName.String,
		IncidentNumber:  conv.SqlToInt32(row.IncidentNumber),
		IncidentSummary: incidentSummary,
		ReportNumber:    conv.SqlToInt32(row.ReportNumber),
		ReportSummary:   row.ReportSummary.String,
		JournalEntryID:  conv.SqlToInt32(row.JournalEntry),
		Actor:           actor,
		Created:         conv.FloatToTime(row.Created),
		Read:            row.ReadAt.Valid,
	}
}

// GetNotifications returns the current user's recent notifications plus their
// unread count. It is per-person (the caller's own), so it needs only
// authentication — no event scoping.
type GetNotifications struct {
	imsDBQ            *store.DBQ
	userStore         directory.UserStore
	cacheControlShort time.Duration
}

func (action GetNotifications) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	resp, errHTTP := action.getNotifications(req)
	if errHTTP != nil {
		errHTTP.From("[getNotifications]").WriteResponse(w)
		return
	}
	w.Header().Set("Cache-Control", fmt.Sprintf("max-age=%v, private", action.cacheControlShort.Milliseconds()/1000))
	server.MustWriteJSON(w, req, resp)
}

func (action GetNotifications) getNotifications(req *http.Request) (imsjson.NotificationList, *herr.HTTPError) {
	var empty imsjson.NotificationList
	jwtCtx, errHTTP := server.GetJwtCtx(req)
	if errHTTP != nil {
		return empty, errHTTP.From("[server.GetJwtCtx]")
	}
	ctx := req.Context()
	personID := jwtCtx.Claims.PersonID()

	rows, err := action.imsDBQ.NotificationsForPerson(ctx, action.imsDBQ, personID)
	if err != nil {
		return empty, herr.InternalServerError("Failed to fetch notifications", err).From("[NotificationsForPerson]")
	}
	unread, err := action.imsDBQ.UnreadNotificationCountForPerson(ctx, action.imsDBQ, personID)
	if err != nil {
		return empty, herr.InternalServerError("Failed to count notifications", err).From("[UnreadNotificationCountForPerson]")
	}

	resp := imsjson.NotificationList{
		Notifications: make([]imsjson.Notification, 0, len(rows)),
		Unread:        unread,
	}
	for _, row := range rows {
		resp.Notifications = append(resp.Notifications, notificationToJSON(row, personID, jwtCtx.Claims.PersonAdmin()))
	}
	return resp, nil
}

// MarkNotificationsRead marks the caller's notifications read: all of them, or a
// single one when {notificationId} is present in the path. Scoped to the caller,
// so a user can only mark their own.
type MarkNotificationsRead struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
}

func (action MarkNotificationsRead) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.markRead(req)
	if errHTTP != nil {
		errHTTP.From("[markRead]").WriteResponse(w)
		return
	}
	herr.WriteNoContentResponse(w, "Success")
}

func (action MarkNotificationsRead) markRead(req *http.Request) *herr.HTTPError {
	jwtCtx, errHTTP := server.GetJwtCtx(req)
	if errHTTP != nil {
		return errHTTP.From("[server.GetJwtCtx]")
	}
	ctx := req.Context()
	personID := jwtCtx.Claims.PersonID()
	now := sql.NullFloat64{Float64: conv.TimeToFloat(time.Now()), Valid: true}

	// A single notification when addressed by ID; otherwise mark all unread.
	if idStr := req.PathValue("notificationId"); idStr != "" {
		id, err := conv.ParseInt32(idStr)
		if err != nil {
			return herr.BadRequest("Invalid notification ID", err).From("[ParseInt32]")
		}
		err = action.imsDBQ.MarkNotificationRead(ctx, action.imsDBQ, imsdb.MarkNotificationReadParams{
			ReadAt:            now,
			ID:                id,
			RecipientPersonID: personID,
		})
		if err != nil {
			return herr.InternalServerError("Failed to mark notification read", err).From("[MarkNotificationRead]")
		}
		return nil
	}

	err := action.imsDBQ.MarkAllNotificationsRead(ctx, action.imsDBQ, imsdb.MarkAllNotificationsReadParams{
		ReadAt:            now,
		RecipientPersonID: personID,
	})
	if err != nil {
		return herr.InternalServerError("Failed to mark notifications read", err).From("[MarkAllNotificationsRead]")
	}
	return nil
}
