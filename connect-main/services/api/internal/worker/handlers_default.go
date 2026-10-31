package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
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
}

// AttendanceReconcileData represents parameters for attendance reconciliation.
type AttendanceReconcileData struct {
	SessionID string    `json:"sessionId,omitempty"`
	Before    time.Time `json:"before,omitempty"`
}

// FilePurgeData represents parameters for purging transient files.
type FilePurgeData struct {
	FileKeys []string `json:"fileKeys"`
	TenantID string   `json:"tenantId,omitempty"`
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
		if data.MaxAgeHours <= 0 {
			data.MaxAgeHours = 24
		}

		// Reconcile and clean up stale rooms older than threshold
		query := `
			UPDATE rooms
			SET is_active = false,
			    updated_at = clock_timestamp()
			WHERE is_active = true
			  AND updated_at < clock_timestamp() - ($1 || ' hours')::interval;
		`
		tag, err := pool.Exec(ctx, query, fmt.Sprintf("%d", data.MaxAgeHours))
		if err != nil {
			logger.Error("room_cleanup_query_failed", slog.String("error", err.Error()))
			return fmt.Errorf("room cleanup query failed: %w", err)
		}

		logger.Info("room_cleanup_processed",
			slog.String("job_id", job.ID.String()),
			slog.Int64("rooms_deactivated", tag.RowsAffected()),
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

		logger.Info("attendance_reconcile_processed",
			slog.String("job_id", job.ID.String()),
			slog.String("session_id", data.SessionID),
		)
		return nil
	}
}

// NewFilePurgeHandler returns a handler for TypeFilePurge.
func NewFilePurgeHandler(logger *slog.Logger) HandlerFunc {
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

		logger.Info("file_purge_processed",
			slog.String("job_id", job.ID.String()),
			slog.Int("keys_count", len(data.FileKeys)),
		)
		return nil
	}
}

// RegisterDefaultHandlers registers all standard Connect handlers into the registry.
func RegisterDefaultHandlers(r *Registry, pool *pgxpool.Pool, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}

	r.RegisterFunc(TypeSystemAuditPing, NewAuditPingHandler(logger))
	r.RegisterFunc(TypeRoomCleanup, NewRoomCleanupHandler(pool, logger))
	r.RegisterFunc(TypeAttendanceReconcile, NewAttendanceReconcileHandler(pool, logger))
	r.RegisterFunc(TypeFilePurge, NewFilePurgeHandler(logger))
}
