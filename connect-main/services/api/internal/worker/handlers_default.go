package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/attendance"
)

// AuditPingData represents the payload for system audit ping jobs.
type AuditPingData struct {
	Source    string    `json:"source"`
	Timestamp time.Time `json:"timestamp"`
	Message   string    `json:"message,omitempty"`
}

// RoomCleanupData represents parameters for room cleanup jobs.
type RoomCleanupData struct {
	MaxAgeHours int    `json:"maxAgeHours"`
	TenantID    string `json:"tenantId,omitempty"`
	RoomID      string `json:"roomId,omitempty"`
}

// AttendanceReconcileData represents parameters for attendance reconciliation.
type AttendanceReconcileData struct {
	SessionID      string    `json:"sessionId,omitempty"`
	RoomID         string    `json:"roomId,omitempty"`
	TenantID       string    `json:"tenantId,omitempty"`
	ClassSessionID string    `json:"classSessionId,omitempty"`
	Before         time.Time `json:"before,omitempty"`
}

// FilePurgeData represents parameters for purging transient files.
type FilePurgeData struct {
	FileKeys []string `json:"fileKeys"`
	TenantID string   `json:"tenantId,omitempty"`
}

// StorageDeleter defines the minimal contract needed to purge files from object storage.
type StorageDeleter interface {
	Delete(ctx context.Context, key string) error
}

// NewAuditPingHandler returns a handler for TypeSystemAuditPing.
func NewAuditPingHandler(logger *slog.Logger) HandlerFunc {
	return func(ctx context.Context, job *Job) error {
		payload, err := ParsePayload(job.Payload)
		if err != nil {
			return MarkPermanent(err)
		}

		var data AuditPingData
		if len(payload.Data) > 0 {
			if err := json.Unmarshal(payload.Data, &data); err != nil {
				return MarkPermanent(fmt.Errorf("failed to unmarshal ping data: %w", err))
			}
		}

		logger.Info("system_audit_ping_processed",
			slog.String("job_id", job.ID.String()),
			slog.String("source", data.Source),
			slog.Time("ping_timestamp", data.Timestamp),
			slog.String("message", data.Message),
			slog.Int("attempt", job.AttemptCount),
		)

		return nil
	}
}

// NewRoomCleanupHandler returns a handler for TypeRoomCleanup.
func NewRoomCleanupHandler(pool *pgxpool.Pool, logger *slog.Logger) HandlerFunc {
	return func(ctx context.Context, job *Job) error {
		payload, err := ParsePayload(job.Payload)
		if err != nil {
			return MarkPermanent(err)
		}

		var data RoomCleanupData
		if len(payload.Data) > 0 {
			_ = json.Unmarshal(payload.Data, &data)
		}

		if data.RoomID != "" {
			// 1. Ensure target room is marked ended
			query := `
				UPDATE rooms
				SET status = 'ended',
				    ended_at = COALESCE(ended_at, clock_timestamp())
				WHERE id = $1;
			`
			tag, err := pool.Exec(ctx, query, data.RoomID)
			if err != nil {
				logger.Error("room_cleanup_by_id_failed", slog.String("room_id", data.RoomID), slog.String("error", err.Error()))
				return fmt.Errorf("room cleanup by id query failed: %w", err)
			}

			// 2. Deny any lingering pending waiting room admissions
			if _, err := pool.Exec(ctx, `
				UPDATE room_admissions
				SET status = 'denied', decided_at = clock_timestamp()
				WHERE room_id = $1 AND status = 'pending';
			`, data.RoomID); err != nil {
				return fmt.Errorf("room cleanup admissions failed: %w", err)
			}

			// 3. Close open participants who never emitted leave
			if _, err := pool.Exec(ctx, `
				UPDATE room_participants
				SET left_at = clock_timestamp()
				WHERE room_id = $1 AND left_at IS NULL;
			`, data.RoomID); err != nil {
				return fmt.Errorf("room cleanup participants failed: %w", err)
			}

			logger.Info("room_cleanup_by_id_processed",
				slog.String("job_id", job.ID.String()),
				slog.String("room_id", data.RoomID),
				slog.Int64("rooms_affected", tag.RowsAffected()),
			)
			return nil
		}

		if data.MaxAgeHours <= 0 {
			data.MaxAgeHours = 24
		}

		// Reconcile and clean up stale rooms older than threshold
		query := `
			UPDATE rooms
			SET status = 'ended',
			    ended_at = COALESCE(ended_at, clock_timestamp())
			WHERE status IN ('active', 'created')
			  AND created_at < clock_timestamp() - ($1 || ' hours')::interval
			RETURNING id;
		`
		rows, err := pool.Query(ctx, query, fmt.Sprintf("%d", data.MaxAgeHours))
		if err != nil {
			logger.Error("room_cleanup_query_failed", slog.String("error", err.Error()))
			return fmt.Errorf("room cleanup query failed: %w", err)
		}
		var endedRoomIDs []string
		for rows.Next() {
			var rid string
			if err := rows.Scan(&rid); err == nil {
				endedRoomIDs = append(endedRoomIDs, rid)
			}
		}
		rows.Close()

		for _, rid := range endedRoomIDs {
			_, _ = pool.Exec(ctx, `
				UPDATE room_admissions
				SET status = 'denied', decided_at = clock_timestamp()
				WHERE room_id = $1 AND status = 'pending';
			`, rid)
			_, _ = pool.Exec(ctx, `
				UPDATE room_participants
				SET left_at = clock_timestamp()
				WHERE room_id = $1 AND left_at IS NULL;
			`, rid)
		}

		logger.Info("room_cleanup_processed",
			slog.String("job_id", job.ID.String()),
			slog.Int("rooms_deactivated", len(endedRoomIDs)),
			slog.Int("max_age_hours", data.MaxAgeHours),
		)
		return nil
	}
}

// NewAttendanceReconcileHandler returns a handler for TypeAttendanceReconcile.
func NewAttendanceReconcileHandler(pool *pgxpool.Pool, logger *slog.Logger) HandlerFunc {
	return func(ctx context.Context, job *Job) error {
		payload, err := ParsePayload(job.Payload)
		if err != nil {
			return MarkPermanent(err)
		}

		var data AttendanceReconcileData
		if len(payload.Data) > 0 {
			_ = json.Unmarshal(payload.Data, &data)
		}

		targetRoomID := data.RoomID
		if targetRoomID == "" {
			targetRoomID = data.SessionID
		}

		if targetRoomID == "" {
			logger.Info("attendance_reconcile_noop_missing_target", slog.String("job_id", job.ID.String()))
			return nil
		}

		cutoff := time.Now().UTC()
		if !data.Before.IsZero() {
			cutoff = data.Before
		}

		// Phase 1: Authoritatively close all open participant intervals for the room
		closeQuery := `
			UPDATE room_participants
			SET left_at = $2
			WHERE room_id = $1 AND left_at IS NULL;
		`
		tag, err := pool.Exec(ctx, closeQuery, targetRoomID, cutoff)
		if err != nil {
			logger.Error("attendance_reconcile_close_participants_failed",
				slog.String("room_id", targetRoomID),
				slog.String("error", err.Error()),
			)
			return fmt.Errorf("failed to close open room participants: %w", err)
		}

		// Phase 2: Check if this room is associated with an academic class session
		classSessionID := data.ClassSessionID
		var orgIDStr, batchIDStr string
		var actualStart, actualEnd, schedStart, schedEnd *time.Time

		if classSessionID == "" {
			// Check if room has class_session_id in rooms table. A missing row is an error:
			// row-level security can hide it, and that must not read as "not a class".
			var csUUID *string
			if err := pool.QueryRow(ctx, `
				SELECT class_session_id::text
				FROM rooms
				WHERE id = $1
			`, targetRoomID).Scan(&csUUID); err != nil {
				return fmt.Errorf("failed to load room %s: %w", targetRoomID, err)
			}
			if csUUID != nil {
				classSessionID = *csUUID
			}
		}

		if classSessionID != "" {
			// Fetch class session metadata
			if err := pool.QueryRow(ctx, `
				SELECT organization_id::text, batch_id::text,
				       actual_start, actual_end, scheduled_start, scheduled_end
				FROM class_sessions
				WHERE id = $1
			`, classSessionID).Scan(&orgIDStr, &batchIDStr, &actualStart, &actualEnd, &schedStart, &schedEnd); err != nil {
				return fmt.Errorf("failed to load class session %s: %w", classSessionID, err)
			}

			{
				// Determine effective session boundaries
				sessionStart := cutoff.Add(-1 * time.Hour)
				if actualStart != nil && !actualStart.IsZero() {
					sessionStart = *actualStart
				} else if schedStart != nil && !schedStart.IsZero() {
					sessionStart = *schedStart
				}

				sessionEnd := cutoff
				if actualEnd != nil && !actualEnd.IsZero() {
					sessionEnd = *actualEnd
				} else if schedEnd != nil && !schedEnd.IsZero() {
					sessionEnd = *schedEnd
				}

				if !sessionEnd.After(sessionStart) {
					return MarkPermanent(fmt.Errorf("class session %s has no positive duration", classSessionID))
				}

				if err := reconcileClassSession(ctx, pool, targetRoomID, classSessionID, orgIDStr, batchIDStr, sessionStart, sessionEnd); err != nil {
					return fmt.Errorf("failed to reconcile class session %s: %w", classSessionID, err)
				}
			}
		}

		logger.Info("attendance_reconcile_processed",
			slog.String("job_id", job.ID.String()),
			slog.String("room_id", targetRoomID),
			slog.String("class_session_id", classSessionID),
			slog.Int64("participants_closed", tag.RowsAffected()),
		)
		return nil
	}
}

// reconcileClassSession evaluates every enrolled student atomically, so a failure
// retries the whole session and faculty overrules are never overwritten.
func reconcileClassSession(ctx context.Context, pool *pgxpool.Pool, roomID, classSessionID, orgID, batchID string, sessionStart, sessionEnd time.Time) error {
	policy, err := loadAttendancePolicy(ctx, pool, orgID)
	if err != nil {
		return err
	}
	intervals, err := loadConnectionIntervals(ctx, pool, roomID, sessionEnd)
	if err != nil {
		return err
	}

	rows, err := pool.Query(ctx, `
		SELECT student_user_id::text
		FROM course_enrollments
		WHERE organization_id = $1 AND batch_id = $2 AND $3::timestamptz <@ valid_during
	`, orgID, batchID, sessionStart)
	if err != nil {
		return err
	}
	enrolled, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}

	var policyVersion *int
	if policy.Version > 0 {
		policyVersion = &policy.Version
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, r := range attendance.EvaluateEnrollment(enrolled, intervals, policy, sessionStart, sessionEnd) {
		if _, err := tx.Exec(ctx, `
			INSERT INTO attendance_records (
				organization_id, batch_id, class_session_id, student_user_id,
				total_connected_seconds, attendance_status, is_overruled, policy_version,
				evaluated_at, updated_at
			) VALUES ($1, $2, $3, $4, $5, $6, false, $7, NOW(), NOW())
			ON CONFLICT (organization_id, class_session_id, student_user_id)
			DO UPDATE SET
				total_connected_seconds = EXCLUDED.total_connected_seconds,
				attendance_status = EXCLUDED.attendance_status,
				policy_version = EXCLUDED.policy_version,
				evaluated_at = EXCLUDED.evaluated_at,
				updated_at = EXCLUDED.updated_at
			WHERE NOT attendance_records.is_overruled
		`, orgID, batchID, classSessionID, r.StudentUserID, r.ConnectedSeconds, r.Status, policyVersion); err != nil {
			return fmt.Errorf("student %s: %w", r.StudentUserID, err)
		}
	}
	return tx.Commit(ctx)
}

// loadAttendancePolicy returns the organization's latest policy version or the platform default.
func loadAttendancePolicy(ctx context.Context, pool *pgxpool.Pool, orgID string) (attendance.Policy, error) {
	var p attendance.Policy
	err := pool.QueryRow(ctx, `
		SELECT version, min_present_ratio::float8, min_partial_ratio::float8, late_grace_seconds
		FROM attendance_policies
		WHERE organization_id = $1
		ORDER BY version DESC
		LIMIT 1
	`, orgID).Scan(&p.Version, &p.MinPresentRatio, &p.MinPartialRatio, &p.LateGraceSeconds)
	if errors.Is(err, pgx.ErrNoRows) {
		return attendance.PlatformDefaultPolicy, nil
	}
	return p, err
}

// loadConnectionIntervals prefers webhook-sourced sessions and falls back to API-recorded
// participants for rooms with no webhook data. Open sessions are clipped to the session end.
func loadConnectionIntervals(ctx context.Context, pool *pgxpool.Pool, roomID string, sessionEnd time.Time) (map[string][]attendance.Interval, error) {
	collect := func(query string) (map[string][]attendance.Interval, error) {
		rows, err := pool.Query(ctx, query, roomID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		intervals := make(map[string][]attendance.Interval)
		for rows.Next() {
			var uid string
			var joinedAt time.Time
			var leftAt *time.Time
			if err := rows.Scan(&uid, &joinedAt, &leftAt); err != nil {
				return nil, err
			}
			end := sessionEnd
			if leftAt != nil {
				end = *leftAt
			}
			intervals[uid] = append(intervals[uid], attendance.Interval{Start: joinedAt, End: end})
		}
		return intervals, rows.Err()
	}

	intervals, err := collect(`
		SELECT user_id::text, joined_at, left_at
		FROM participant_media_sessions
		WHERE room_id = $1 AND user_id IS NOT NULL
	`)
	if err != nil || len(intervals) > 0 {
		return intervals, err
	}
	return collect(`
		SELECT user_id::text, joined_at, left_at
		FROM room_participants
		WHERE room_id = $1 AND user_id IS NOT NULL
	`)
}

// NewFilePurgeHandler returns a handler for TypeFilePurge that purges storage objects.
func NewFilePurgeHandler(storage StorageDeleter, logger *slog.Logger) HandlerFunc {
	return func(ctx context.Context, job *Job) error {
		payload, err := ParsePayload(job.Payload)
		if err != nil {
			return MarkPermanent(err)
		}

		var data FilePurgeData
		if len(payload.Data) > 0 {
			if err := json.Unmarshal(payload.Data, &data); err != nil {
				return MarkPermanent(fmt.Errorf("invalid file purge payload: %w", err))
			}
		}

		if len(data.FileKeys) == 0 {
			logger.Warn("file_purge_empty_keys", slog.String("job_id", job.ID.String()))
			return nil
		}

		var deletedCount int
		for _, key := range data.FileKeys {
			if key == "" {
				continue
			}
			if storage != nil {
				if err := storage.Delete(ctx, key); err != nil {
					logger.Error("file_purge_storage_delete_failed",
						slog.String("job_id", job.ID.String()),
						slog.String("key", key),
						slog.String("error", err.Error()),
					)
					return fmt.Errorf("failed to purge file key %q from storage: %w", key, err)
				}
			}
			deletedCount++
		}

		logger.Info("file_purge_processed",
			slog.String("job_id", job.ID.String()),
			slog.Int("keys_count", len(data.FileKeys)),
			slog.Int("deleted_count", deletedCount),
			slog.String("tenant_id", data.TenantID),
		)
		return nil
	}
}

// HostSuccessionData identifies the room whose host left.
type HostSuccessionData struct {
	RoomID string `json:"roomId"`
}

// NewHostSuccessionHandler promotes a connected co-host if the host has not returned.
func NewHostSuccessionHandler(pool *pgxpool.Pool, logger *slog.Logger) func(ctx context.Context, job *Job) error {
	return func(ctx context.Context, job *Job) error {
		var data HostSuccessionData
		payload, err := ParsePayload(job.Payload)
		if err != nil {
			return MarkPermanent(err)
		}
		if err := json.Unmarshal(payload.Data, &data); err != nil || data.RoomID == "" {
			return MarkPermanent(fmt.Errorf("invalid host succession payload: %w", err))
		}
		var successor *string
		if err := pool.QueryRow(ctx, `SELECT connect_auth.succeed_room_host($1::UUID)`, data.RoomID).Scan(&successor); err != nil {
			return fmt.Errorf("host succession failed: %w", err)
		}
		if successor != nil {
			logger.Info("room_host_succeeded", slog.String("room_id", data.RoomID), slog.String("identity", *successor))
		}
		return nil
	}
}

// RegisterDefaultHandlers registers all standard Connect handlers into the registry.
func RegisterDefaultHandlers(r *Registry, pool *pgxpool.Pool, storage StorageDeleter, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}

	r.RegisterFunc(TypeSystemAuditPing, NewAuditPingHandler(logger))
	r.RegisterFunc(TypeRoomCleanup, NewRoomCleanupHandler(pool, logger))
	r.RegisterFunc(TypeAttendanceReconcile, NewAttendanceReconcileHandler(pool, logger))
	r.RegisterFunc(TypeFilePurge, NewFilePurgeHandler(storage, logger))
	r.RegisterFunc(TypeRoomHostSuccession, NewHostSuccessionHandler(pool, logger))
	r.RegisterFunc(TypeNotifySession, NewNotifySessionHandler(pool, logger))
	r.RegisterFunc(TypeNotifyUser, NewNotifyUserHandler(pool))
}
