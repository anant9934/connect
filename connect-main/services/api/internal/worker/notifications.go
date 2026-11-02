package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Session notification events.
const (
	NotifySessionScheduled   = "scheduled"
	NotifySessionRescheduled = "rescheduled"
	NotifySessionCancelled   = "cancelled"
	NotifySessionReminder    = "reminder"
)

// ReminderLead is how long before a class its reminder goes out.
const ReminderLead = 15 * time.Minute

// NotifySessionData names a class and what happened to it. StartsAt is the start this job was
// created for, so a reminder for a class that has since moved does nothing.
type NotifySessionData struct {
	SessionID string    `json:"sessionId"`
	Event     string    `json:"event"`
	StartsAt  time.Time `json:"startsAt"`
	Count     int       `json:"count,omitempty"`
}

// NotifyUserData is a notification to one person.
type NotifyUserData struct {
	UserID         string `json:"userId"`
	OrganizationID string `json:"organizationId,omitempty"`
	Kind           string `json:"kind"`
	Title          string `json:"title"`
	Body           string `json:"body"`
	Link           string `json:"link,omitempty"`
	DedupeKey      string `json:"dedupeKey"`
}

func sessionMessage(data NotifySessionData, title, when string) (string, string) {
	switch data.Event {
	case NotifySessionScheduled:
		if data.Count > 1 {
			return "New classes scheduled", fmt.Sprintf("%s: %d classes, starting %s.", title, data.Count, when)
		}
		return "New class scheduled", fmt.Sprintf("%s on %s.", title, when)
	case NotifySessionRescheduled:
		return "Class rescheduled", fmt.Sprintf("%s has moved to %s.", title, when)
	case NotifySessionCancelled:
		return "Class cancelled", fmt.Sprintf("%s on %s was cancelled.", title, when)
	default:
		return "Class starting soon", fmt.Sprintf("%s starts at %s.", title, when)
	}
}

// NewNotifySessionHandler tells a class's students and faculty what changed. The dedupe key makes
// retries and duplicate delivery safe.
func NewNotifySessionHandler(pool *pgxpool.Pool, logger *slog.Logger) HandlerFunc {
	return func(ctx context.Context, job *Job) error {
		payload, err := ParsePayload(job.Payload)
		if err != nil {
			return MarkPermanent(err)
		}
		var data NotifySessionData
		if err := json.Unmarshal(payload.Data, &data); err != nil || data.SessionID == "" {
			return MarkPermanent(fmt.Errorf("invalid session notification payload: %w", err))
		}

		var title, status, zone string
		var start time.Time
		err = pool.QueryRow(ctx, `SELECT title, status, time_zone, scheduled_start FROM class_sessions WHERE id = $1`, data.SessionID).Scan(&title, &status, &zone, &start)
		if err == pgx.ErrNoRows {
			return nil
		}
		if err != nil {
			return fmt.Errorf("session lookup failed: %w", err)
		}
		if data.Event == NotifySessionReminder && (status != "scheduled" || !start.Equal(data.StartsAt)) {
			logger.Info("session_reminder_skipped", slog.String("session_id", data.SessionID), slog.String("status", status))
			return nil
		}

		loc, err := time.LoadLocation(zone)
		if err != nil {
			loc = time.UTC
		}
		heading, body := sessionMessage(data, title, start.In(loc).Format("Mon 2 Jan, 15:04 MST"))
		dedupe := fmt.Sprintf("session:%s:%s:%d", data.SessionID, data.Event, data.StartsAt.Unix())
		var delivered int
		if err := pool.QueryRow(ctx, `SELECT connect_auth.notify_session_people($1::UUID, $2, $3, $4, $5)`,
			data.SessionID, "class_"+data.Event, heading, body, dedupe).Scan(&delivered); err != nil {
			return fmt.Errorf("session notification failed: %w", err)
		}
		logger.Info("session_notification_delivered", slog.String("session_id", data.SessionID), slog.String("event", data.Event), slog.Int("delivered", delivered))
		return nil
	}
}

// NotifyRoomReminderData names a personal meeting and the start this reminder was created for.
type NotifyRoomReminderData struct {
	RoomID   string    `json:"roomId"`
	StartsAt time.Time `json:"startsAt"`
}

// NewNotifyRoomReminderHandler reminds a host of a personal meeting. The room is read again when
// the job runs, so a reminder left behind by a reschedule or cancellation does nothing.
func NewNotifyRoomReminderHandler(pool *pgxpool.Pool, logger *slog.Logger) HandlerFunc {
	return func(ctx context.Context, job *Job) error {
		payload, err := ParsePayload(job.Payload)
		if err != nil {
			return MarkPermanent(err)
		}
		var data NotifyRoomReminderData
		if err := json.Unmarshal(payload.Data, &data); err != nil || data.RoomID == "" {
			return MarkPermanent(fmt.Errorf("invalid room reminder payload: %w", err))
		}
		var host, code, status, zone string
		var title *string
		var start *time.Time
		err = pool.QueryRow(ctx, `
			SELECT host_user_id::text, public_code, title, status, COALESCE(time_zone, 'UTC'), scheduled_start FROM rooms WHERE id = $1
		`, data.RoomID).Scan(&host, &code, &title, &status, &zone, &start)
		if err == pgx.ErrNoRows {
			return nil
		}
		if err != nil {
			return fmt.Errorf("room lookup failed: %w", err)
		}
		if status != "scheduled" || start == nil || !start.Equal(data.StartsAt) {
			logger.Info("room_reminder_skipped", slog.String("room_id", data.RoomID), slog.String("status", status))
			return nil
		}
		name := "Meeting " + code
		if title != nil && *title != "" {
			name = *title
		}
		loc, err := time.LoadLocation(zone)
		if err != nil {
			loc = time.UTC
		}
		_, err = pool.Exec(ctx, `
			INSERT INTO notifications (user_id, kind, title, body, link, dedupe_key)
			VALUES ($1, 'meeting_reminder', 'Meeting starting soon', $2, $3, $4)
			ON CONFLICT (user_id, dedupe_key) DO NOTHING
		`, host, fmt.Sprintf("%s starts at %s.", name, start.In(loc).Format("Mon 2 Jan, 15:04 MST")), "/room/"+code+"/preview",
			fmt.Sprintf("room:%s:reminder:%d", data.RoomID, data.StartsAt.Unix()))
		if err != nil {
			return fmt.Errorf("room reminder failed: %w", err)
		}
		return nil
	}
}

// NewNotifyUserHandler delivers one person's notification.
func NewNotifyUserHandler(pool *pgxpool.Pool) HandlerFunc {
	return func(ctx context.Context, job *Job) error {
		payload, err := ParsePayload(job.Payload)
		if err != nil {
			return MarkPermanent(err)
		}
		var data NotifyUserData
		if err := json.Unmarshal(payload.Data, &data); err != nil || data.UserID == "" || data.DedupeKey == "" {
			return MarkPermanent(fmt.Errorf("invalid user notification payload: %w", err))
		}
		_, err = pool.Exec(ctx, `
			INSERT INTO notifications (user_id, organization_id, kind, title, body, link, dedupe_key)
			VALUES ($1, NULLIF($2, '')::UUID, $3, $4, $5, NULLIF($6, ''), $7)
			ON CONFLICT (user_id, dedupe_key) DO NOTHING
		`, data.UserID, data.OrganizationID, data.Kind, data.Title, data.Body, data.Link, data.DedupeKey)
		if err != nil {
			return fmt.Errorf("user notification failed: %w", err)
		}
		return nil
	}
}
