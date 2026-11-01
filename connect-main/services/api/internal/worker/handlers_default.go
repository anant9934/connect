package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

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
			_, _ = pool.Exec(ctx, `
				UPDATE room_admissions
				SET status = 'denied', decided_at = clock_timestamp()
				WHERE room_id = $1 AND status = 'pending';
			`, data.RoomID)

			// 3. Close open participants who never emitted leave
			_, _ = pool.Exec(ctx, `
				UPDATE room_participants
				SET left_at = clock_timestamp()
				WHERE room_id = $1 AND left_at IS NULL;
			`, data.RoomID)

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
			WHERE status != 'ended'
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
			// Check if room has class_session_id in rooms table
			var csUUID *string
			_ = pool.QueryRow(ctx, `
				SELECT class_session_id::text
				FROM rooms
				WHERE id = $1
			`, targetRoomID).Scan(&csUUID)
			if csUUID != nil {
				classSessionID = *csUUID
			}
		}

		if classSessionID != "" {
			// Fetch class session metadata
			err := pool.QueryRow(ctx, `
				SELECT organization_id::text, batch_id::text,
				       actual_start, actual_end, scheduled_start, scheduled_end
				FROM class_sessions
				WHERE id = $1
			`, classSessionID).Scan(&orgIDStr, &batchIDStr, &actualStart, &actualEnd, &schedStart, &schedEnd)

			if err == nil && orgIDStr != "" && batchIDStr != "" {
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

				sessionDurationSeconds := int(sessionEnd.Sub(sessionStart).Seconds())
				if sessionDurationSeconds <= 0 {
					sessionDurationSeconds = 3600 // 1 hour fallback
				}

				// Fetch all participants with user_id who joined this room
				pRows, pErr := pool.Query(ctx, `
					SELECT user_id::text, joined_at, left_at
					FROM room_participants
					WHERE room_id = $1 AND user_id IS NOT NULL
					ORDER BY joined_at ASC
				`, targetRoomID)

				if pErr == nil {
					userIntervals := make(map[string][]attendance.Interval)
					for pRows.Next() {
						var uid string
						var jAt, lAt time.Time
						if err := pRows.Scan(&uid, &jAt, &lAt); err == nil {
							if lAt.IsZero() {
								lAt = cutoff
							}
							userIntervals[uid] = append(userIntervals[uid], attendance.Interval{
								Start: jAt,
								End:   lAt,
							})
						}
					}
					pRows.Close()

					// Compute attendance record for each student
					for uid, ivs := range userIntervals {
						netSeconds := attendance.ReconcileIntervalUnion(ivs, sessionStart, sessionEnd)
						status := attendance.CalculateAttendanceStatus(netSeconds, sessionDurationSeconds, 0.75, 0.40)

						// Upsert into attendance_records without overwriting faculty overrules
						upsertQuery := `
							INSERT INTO attendance_records (
								organization_id, batch_id, class_session_id, student_user_id,
								total_connected_seconds, attendance_status, is_overruled,
								evaluated_at, updated_at
							) VALUES (
								$1, $2, $3, $4,
								$5, $6, false,
								NOW(), NOW()
							)
							ON CONFLICT (organization_id, class_session_id, student_user_id)
							DO UPDATE SET
								total_connected_seconds = EXCLUDED.total_connected_seconds,
								attendance_status = EXCLUDED.attendance_status,
								evaluated_at = EXCLUDED.evaluated_at,
								updated_at = EXCLUDED.updated_at
							WHERE NOT attendance_records.is_overruled;
						`
						_, upErr := pool.Exec(ctx, upsertQuery,
							orgIDStr, batchIDStr, classSessionID, uid,
							netSeconds, status,
						)
						if upErr != nil {
							logger.Warn("attendance_record_upsert_failed",
								slog.String("student_user_id", uid),
								slog.String("error", upErr.Error()),
							)
						}
					}
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

// RegisterDefaultHandlers registers all standard Connect handlers into the registry.
func RegisterDefaultHandlers(r *Registry, pool *pgxpool.Pool, storage StorageDeleter, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}

	r.RegisterFunc(TypeSystemAuditPing, NewAuditPingHandler(logger))
	r.RegisterFunc(TypeRoomCleanup, NewRoomCleanupHandler(pool, logger))
	r.RegisterFunc(TypeAttendanceReconcile, NewAttendanceReconcileHandler(pool, logger))
	r.RegisterFunc(TypeFilePurge, NewFilePurgeHandler(storage, logger))
}
