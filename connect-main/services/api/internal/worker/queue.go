package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EnqueueJob transactionally inserts a job into the outbox.
// Because it accepts pgx.Tx, it is committed atomically alongside domain operations.
func EnqueueJob(
	ctx context.Context,
	tx pgx.Tx,
	queue string,
	idempotencyKey string,
	payload any,
	scheduledAt *time.Time,
) (*Job, error) {
	if idempotencyKey == "" {
		return nil, fmt.Errorf("idempotency key is required for transactional job enqueue")
	}
	if queue == "" {
		queue = DefaultQueue
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal job payload: %w", err)
	}

	schedTime := time.Now()
	if scheduledAt != nil {
		schedTime = *scheduledAt
	}

	query := `
		INSERT INTO background_jobs (
			queue, idempotency_key, payload, status, scheduled_at
		) VALUES (
			$1, $2, $3::jsonb, $4, $5
		)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id, queue, idempotency_key, payload, status, attempt_count, max_attempts,
		          scheduled_at, locked_by, locked_until, fencing_token, last_error, created_at, updated_at;
	`

	var j Job
	err = tx.QueryRow(ctx, query, queue, idempotencyKey, payloadBytes, StatusPending, schedTime).Scan(
		&j.ID,
		&j.Queue,
		&j.IdempotencyKey,
		&j.Payload,
		&j.Status,
		&j.AttemptCount,
		&j.MaxAttempts,
		&j.ScheduledAt,
		&j.LockedBy,
		&j.LockedUntil,
		&j.FencingToken,
		&j.LastError,
		&j.CreatedAt,
		&j.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			// Idempotent duplicate: already enqueued
			return nil, nil
		}
		return nil, fmt.Errorf("failed to enqueue transactional job: %w", err)
	}

	return &j, nil
}

// ClaimJobsWithLease atomically leases available jobs using monotonic fencing tokens.
// Uses SELECT FOR UPDATE SKIP LOCKED to prevent lock contention between parallel workers.
func ClaimJobsWithLease(
	ctx context.Context,
	pool *pgxpool.Pool,
	workerID string,
	queue string,
	batchSize int,
	leaseTTL time.Duration,
) ([]Job, error) {
	if workerID == "" {
		return nil, fmt.Errorf("worker ID is required to claim job lease")
	}
	if queue == "" {
		queue = DefaultQueue
	}
	if batchSize <= 0 {
		batchSize = 10
	}
	if leaseTTL <= 0 {
		leaseTTL = DefaultLeaseTTL
	}

	query := `
		WITH claimable AS (
			SELECT id
			FROM background_jobs
			WHERE queue = $1
			  AND (
				(status IN ('pending', 'failed') AND scheduled_at <= clock_timestamp())
				OR
				(status = 'processing' AND locked_until < clock_timestamp())
			  )
			ORDER BY scheduled_at ASC
			FOR UPDATE SKIP LOCKED
			LIMIT $2
		)
		UPDATE background_jobs j
		SET status = 'processing',
		    locked_by = $3,
		    locked_until = clock_timestamp() + $4::interval,
		    fencing_token = j.fencing_token + 1,
		    attempt_count = j.attempt_count + 1,
		    updated_at = clock_timestamp()
		FROM claimable c
		WHERE j.id = c.id
		RETURNING j.id, j.queue, j.idempotency_key, j.payload, j.status, j.attempt_count, j.max_attempts,
		          j.scheduled_at, j.locked_by, j.locked_until, j.fencing_token, j.last_error, j.created_at, j.updated_at;
	`

	ttlInterval := fmt.Sprintf("%d seconds", int(leaseTTL.Seconds()))
	rows, err := pool.Query(ctx, query, queue, batchSize, workerID, ttlInterval)
	if err != nil {
		return nil, fmt.Errorf("failed to claim job batch: %w", err)
	}
	defer rows.Close()

	var jobs []Job
	for rows.Next() {
		var j Job
		if err := rows.Scan(
			&j.ID,
			&j.Queue,
			&j.IdempotencyKey,
			&j.Payload,
			&j.Status,
			&j.AttemptCount,
			&j.MaxAttempts,
			&j.ScheduledAt,
			&j.LockedBy,
			&j.LockedUntil,
			&j.FencingToken,
			&j.LastError,
			&j.CreatedAt,
			&j.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan claimed job: %w", err)
		}
		jobs = append(jobs, j)
	}

	return jobs, nil
}

// CompleteJob marks a job as completed if the fencing token matches.
func CompleteJob(ctx context.Context, pool *pgxpool.Pool, jobID uuid.UUID, fencingToken int64) error {
	query := `
		UPDATE background_jobs
		SET status = 'completed',
		    locked_by = NULL,
		    locked_until = NULL,
		    updated_at = clock_timestamp()
		WHERE id = $1 AND fencing_token = $2 AND status = 'processing';
	`
	tag, err := pool.Exec(ctx, query, jobID, fencingToken)
	if err != nil {
		return fmt.Errorf("failed to complete job: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("fencing token mismatch or job not in processing state (lease lost)")
	}
	return nil
}

// FailJob marks a job as failed (or dead_letter if attempt_count >= max_attempts).
func FailJob(ctx context.Context, pool *pgxpool.Pool, jobID uuid.UUID, fencingToken int64, lastErr string, retryDelay time.Duration) error {
	query := `
		UPDATE background_jobs
		SET status = CASE WHEN attempt_count >= max_attempts THEN 'dead_letter' ELSE 'failed' END,
		    last_error = $3,
		    scheduled_at = clock_timestamp() + $4::interval,
		    locked_by = NULL,
		    locked_until = NULL,
		    updated_at = clock_timestamp()
		WHERE id = $1 AND fencing_token = $2 AND status = 'processing';
	`
	delayInterval := fmt.Sprintf("%d seconds", int(retryDelay.Seconds()))
	tag, err := pool.Exec(ctx, query, jobID, fencingToken, lastErr, delayInterval)
	if err != nil {
		return fmt.Errorf("failed to record job failure: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("fencing token mismatch or job not in processing state (lease lost)")
	}
	return nil
}

// HeartbeatJob extends the lease on an active job, guarded by fencing token.
func HeartbeatJob(ctx context.Context, pool *pgxpool.Pool, jobID uuid.UUID, fencingToken int64, extensionTTL time.Duration) error {
	query := `
		UPDATE background_jobs
		SET locked_until = clock_timestamp() + $3::interval,
		    updated_at = clock_timestamp()
		WHERE id = $1 AND fencing_token = $2 AND status = 'processing';
	`
	ttlInterval := fmt.Sprintf("%d seconds", int(extensionTTL.Seconds()))
	tag, err := pool.Exec(ctx, query, jobID, fencingToken, ttlInterval)
	if err != nil {
		return fmt.Errorf("failed to heartbeat job: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("fencing token mismatch or job lease expired")
	}
	return nil
}

// DeadLetterJob forces a job immediately into dead_letter status without consuming further attempts.
// Guarded by monotonic fencing token and processing status.
func DeadLetterJob(ctx context.Context, pool *pgxpool.Pool, jobID uuid.UUID, fencingToken int64, lastErr string) error {
	query := `
		UPDATE background_jobs
		SET status = 'dead_letter',
		    last_error = $3,
		    locked_by = NULL,
		    locked_until = NULL,
		    updated_at = clock_timestamp()
		WHERE id = $1 AND fencing_token = $2 AND status = 'processing';
	`
	tag, err := pool.Exec(ctx, query, jobID, fencingToken, lastErr)
	if err != nil {
		return fmt.Errorf("failed to dead-letter job: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("fencing token mismatch or job not in processing state (lease lost)")
	}
	return nil
}

// Enqueue inserts a background job using connection pool directly (when no transaction exists).
func Enqueue(
	ctx context.Context,
	pool *pgxpool.Pool,
	queue string,
	idempotencyKey string,
	payload any,
	scheduledAt *time.Time,
) (*Job, error) {
	if idempotencyKey == "" {
		return nil, fmt.Errorf("idempotency key is required for job enqueue")
	}
	if queue == "" {
		queue = DefaultQueue
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal job payload: %w", err)
	}

	schedTime := time.Now()
	if scheduledAt != nil {
		schedTime = *scheduledAt
	}

	query := `
		INSERT INTO background_jobs (
			queue, idempotency_key, payload, status, scheduled_at
		) VALUES (
			$1, $2, $3::jsonb, $4, $5
		)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id, queue, idempotency_key, payload, status, attempt_count, max_attempts,
		          scheduled_at, locked_by, locked_until, fencing_token, last_error, created_at, updated_at;
	`

	var j Job
	err = pool.QueryRow(ctx, query, queue, idempotencyKey, payloadBytes, StatusPending, schedTime).Scan(
		&j.ID,
		&j.Queue,
		&j.IdempotencyKey,
		&j.Payload,
		&j.Status,
		&j.AttemptCount,
		&j.MaxAttempts,
		&j.ScheduledAt,
		&j.LockedBy,
		&j.LockedUntil,
		&j.FencingToken,
		&j.LastError,
		&j.CreatedAt,
		&j.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			// Idempotent duplicate: already enqueued
			return nil, nil
		}
		return nil, fmt.Errorf("failed to enqueue job: %w", err)
	}

	return &j, nil
}

// QueueStats provides operational depth metrics for an individual queue.
type QueueStats struct {
	Queue            string
	PendingCount     int64
	ProcessingCount  int64
	FailedCount      int64
	DeadLetterCount  int64
	CompletedCount   int64
	OldestPendingAge time.Duration
}

// GetQueueStats queries PostgreSQL for real-time queue depth and backlog statistics.
func GetQueueStats(ctx context.Context, pool *pgxpool.Pool, queue string) (*QueueStats, error) {
	if queue == "" {
		queue = DefaultQueue
	}

	query := `
		SELECT
			COALESCE(COUNT(*) FILTER (WHERE status = 'pending'), 0) AS pending_count,
			COALESCE(COUNT(*) FILTER (WHERE status = 'processing'), 0) AS processing_count,
			COALESCE(COUNT(*) FILTER (WHERE status = 'failed'), 0) AS failed_count,
			COALESCE(COUNT(*) FILTER (WHERE status = 'dead_letter'), 0) AS dead_letter_count,
			COALESCE(COUNT(*) FILTER (WHERE status = 'completed'), 0) AS completed_count,
			COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - MIN(scheduled_at) FILTER (WHERE status = 'pending'))), 0) AS oldest_pending_sec
		FROM background_jobs
		WHERE queue = $1;
	`

	var stats QueueStats
	stats.Queue = queue
	var oldestSec float64

	err := pool.QueryRow(ctx, query, queue).Scan(
		&stats.PendingCount,
		&stats.ProcessingCount,
		&stats.FailedCount,
		&stats.DeadLetterCount,
		&stats.CompletedCount,
		&oldestSec,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch queue stats: %w", err)
	}

	if oldestSec > 0 {
		stats.OldestPendingAge = time.Duration(oldestSec * float64(time.Second))
	}

	return &stats, nil
}

// EnqueueJobWriteOnly enqueues in tx without reading the row back, for roles such as
// connect_app that may insert jobs but must not read the queue.
func EnqueueJobWriteOnly(ctx context.Context, tx pgx.Tx, queue, idempotencyKey string, payload any) error {
	if idempotencyKey == "" {
		return fmt.Errorf("idempotency key is required for transactional job enqueue")
	}
	if queue == "" {
		queue = DefaultQueue
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal job payload: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO background_jobs (queue, idempotency_key, payload, status, scheduled_at)
		VALUES ($1, $2, $3::jsonb, $4, $5)
	`, queue, idempotencyKey, payloadBytes, StatusPending, time.Now())
	return err
}
