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

// AttendanceSweepNotBefore is when automatic finalisation started. Classes that ended earlier
// keep whatever attendance records they already have; the sweep never recalculates them.
var AttendanceSweepNotBefore = time.Date(2026, 11, 4, 0, 0, 0, 0, time.UTC)

const (
	// attendanceSweepGraceSeconds waits after a class's scheduled end before finalising, so a
	// class that runs a little long is not cut off.
	attendanceSweepGraceSeconds = 600
	// AttendanceSweepInterval is how often ended classes are looked for.
	AttendanceSweepInterval = 5 * time.Minute
)

// dueSession is a class whose attendance should now be calculated.
type dueSession struct {
	RoomID         string
	ClassSessionID string
}

// reconcileJobFor builds the idempotent reconcile job for a due class. The key is per class, so
// repeated sweeps never queue the same class twice.
func reconcileJobFor(s dueSession, now time.Time) (string, JobPayload, error) {
	data, err := json.Marshal(AttendanceReconcileData{
		RoomID:         s.RoomID,
		SessionID:      s.RoomID,
		ClassSessionID: s.ClassSessionID,
		Before:         now,
	})
	if err != nil {
		return "", JobPayload{}, err
	}
	return "attendance-sweep-" + s.ClassSessionID, JobPayload{Type: TypeAttendanceReconcile, Data: data, CreatedAt: now}, nil
}

// SweepAttendanceOnce queues attendance calculation for every class that has ended without it,
// whether or not the host pressed "End for all". It returns how many classes were found.
func SweepAttendanceOnce(ctx context.Context, pool *pgxpool.Pool, now time.Time) (int, error) {
	rows, err := pool.Query(ctx,
		`SELECT room_id::text, class_session_id::text FROM connect_auth.attendance_due_sessions($1, $2)`,
		attendanceSweepGraceSeconds, AttendanceSweepNotBefore)
	if err != nil {
		return 0, fmt.Errorf("failed to find classes awaiting attendance: %w", err)
	}
	due, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (dueSession, error) {
		var s dueSession
		err := row.Scan(&s.RoomID, &s.ClassSessionID)
		return s, err
	})
	if err != nil {
		return 0, err
	}
	for _, s := range due {
		key, payload, err := reconcileJobFor(s, now)
		if err != nil {
			return 0, err
		}
		if _, err := Enqueue(ctx, pool, QueueAttendanceCritical, key, payload, nil); err != nil {
			return 0, fmt.Errorf("failed to queue attendance for class %s: %w", s.ClassSessionID, err)
		}
	}
	return len(due), nil
}

// RunAttendanceSweep sweeps shortly after start and then every interval until ctx ends.
func RunAttendanceSweep(ctx context.Context, pool *pgxpool.Pool, logger *slog.Logger, interval time.Duration) {
	timer := time.NewTimer(30 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			found, err := SweepAttendanceOnce(ctx, pool, time.Now().UTC())
			if err != nil {
				logger.Warn("attendance_sweep_failed", slog.String("error", err.Error()))
			} else if found > 0 {
				logger.Info("attendance_sweep_queued", slog.Int("classes", found))
			}
			timer.Reset(interval)
		}
	}
}
