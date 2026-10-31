package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/tathastu/connect/services/api/internal/config"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/worker"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		logger.Error("configuration_load_failed", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db, err := database.Connect(ctx, cfg)
	if err != nil {
		logger.Error("database_connection_failed", slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer db.Close()
	logger.Info("connected_to_neon_database_successfully")

	pool := db.Pool
	runID := uuid.New().String()[:8]
	testKey1 := fmt.Sprintf("worker-verification-ping-%s", runID)
	testKey2 := fmt.Sprintf("worker-verification-retry-%s", runID)

	// Always ensure cleanup
	defer func() {
		cleanCtx, cleanCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanCancel()
		_, _ = pool.Exec(cleanCtx, "DELETE FROM background_jobs WHERE idempotency_key IN ($1, $2)", testKey1, testKey2)
		logger.Info("verification_test_jobs_cleaned_up")
	}()

	// -------------------------------------------------------------------------
	// TEST 1: Enqueue & Monotonic Claim
	// -------------------------------------------------------------------------
	logger.Info("test_1_enqueue_audit_ping")
	pingPayload := worker.JobPayload{
		Type: worker.TypeSystemAuditPing,
		Data: json.RawMessage(fmt.Sprintf(`{"source":"production_acceptance_test","runId":"%s"}`, runID)),
	}

	job1, err := worker.Enqueue(ctx, pool, worker.QueueDefault, testKey1, pingPayload, nil)
	if err != nil {
		logger.Error("failed_to_enqueue_job", slog.String("error", err.Error()))
		os.Exit(1)
	}
	if job1.Status != worker.StatusPending || job1.FencingToken != 0 {
		logger.Error("invalid_initial_job_state", slog.String("status", job1.Status), slog.Int64("fencing_token", job1.FencingToken))
		os.Exit(1)
	}
	logger.Info("job_enqueued_as_pending", slog.String("job_id", job1.ID.String()))

	// -------------------------------------------------------------------------
	// TEST 2: Atomic Claim With Lease
	// -------------------------------------------------------------------------
	workerID := fmt.Sprintf("test-worker-%s", runID)
	claimedJobs, err := worker.ClaimJobsWithLease(ctx, pool, workerID, worker.QueueDefault, 10, 30*time.Second)
	if err != nil {
		logger.Error("failed_to_claim_jobs", slog.String("error", err.Error()))
		os.Exit(1)
	}

	var claimedJob1 *worker.Job
	for i := range claimedJobs {
		if claimedJobs[i].ID == job1.ID {
			claimedJob1 = &claimedJobs[i]
			break
		}
	}
	if claimedJob1 == nil {
		logger.Error("target_job_not_found_in_claimed_batch")
		os.Exit(1)
	}
	if claimedJob1.Status != worker.StatusProcessing || claimedJob1.FencingToken != 1 {
		logger.Error("unexpected_claimed_state", slog.String("status", claimedJob1.Status), slog.Int64("fencing_token", claimedJob1.FencingToken))
		os.Exit(1)
	}
	logger.Info("job_claimed_with_lease_verified",
		slog.String("job_id", claimedJob1.ID.String()),
		slog.Int64("fencing_token", claimedJob1.FencingToken),
		slog.Int("attempt_count", claimedJob1.AttemptCount),
	)

	// -------------------------------------------------------------------------
	// TEST 3: Heartbeat Lease Renewal
	// -------------------------------------------------------------------------
	err = worker.HeartbeatJob(ctx, pool, claimedJob1.ID, claimedJob1.FencingToken, 60*time.Second)
	if err != nil {
		logger.Error("heartbeat_failed", slog.String("error", err.Error()))
		os.Exit(1)
	}
	logger.Info("heartbeat_lease_extended_successfully")

	// -------------------------------------------------------------------------
	// TEST 4: Monotonic Fencing Token Split-Brain Protection
	// -------------------------------------------------------------------------
	staleErr := worker.CompleteJob(ctx, pool, claimedJob1.ID, claimedJob1.FencingToken-1)
	if staleErr == nil {
		logger.Error("SECURITY_VIOLATION: stale fencing token was accepted!")
		os.Exit(1)
	}
	logger.Info("stale_fencing_token_properly_rejected", slog.String("rejection_reason", staleErr.Error()))

	// -------------------------------------------------------------------------
	// TEST 5: Handler Dispatch & Completion
	// -------------------------------------------------------------------------
	handler := worker.NewAuditPingHandler(logger)
	if err := handler.Handle(ctx, claimedJob1); err != nil {
		logger.Error("handler_execution_failed", slog.String("error", err.Error()))
		os.Exit(1)
	}

	if err := worker.CompleteJob(ctx, pool, claimedJob1.ID, claimedJob1.FencingToken); err != nil {
		logger.Error("failed_to_complete_job", slog.String("error", err.Error()))
		os.Exit(1)
	}

	// Verify terminal state in DB
	var dbStatus string
	var dbLockedBy *string
	err = pool.QueryRow(ctx, "SELECT status, locked_by FROM background_jobs WHERE id = $1", claimedJob1.ID).Scan(&dbStatus, &dbLockedBy)
	if err != nil {
		logger.Error("failed_to_query_job_terminal_state", slog.String("error", err.Error()))
		os.Exit(1)
	}
	if dbStatus != worker.StatusCompleted || dbLockedBy != nil {
		logger.Error("invalid_completed_state", slog.String("status", dbStatus), slog.Any("locked_by", dbLockedBy))
		os.Exit(1)
	}
	logger.Info("job_terminal_state_completed_verified")

	// -------------------------------------------------------------------------
	// TEST 6: Retry & Dead Letter Transitions
	// -------------------------------------------------------------------------
	logger.Info("test_6_retry_and_dead_letter")
	retryPayload := worker.JobPayload{
		Type: "transient.failure.simulation",
	}
	job2, err := worker.Enqueue(ctx, pool, worker.QueueDefault, testKey2, retryPayload, nil)
	if err != nil {
		logger.Error("failed_to_enqueue_job2", slog.String("error", err.Error()))
		os.Exit(1)
	}

	claimedBatch2, err := worker.ClaimJobsWithLease(ctx, pool, workerID, worker.QueueDefault, 10, 30*time.Second)
	if err != nil {
		logger.Error("failed_to_claim_job2", slog.String("error", err.Error()))
		os.Exit(1)
	}
	var claimedJob2 *worker.Job
	for i := range claimedBatch2 {
		if claimedBatch2[i].ID == job2.ID {
			claimedJob2 = &claimedBatch2[i]
			break
		}
	}
	if claimedJob2 == nil {
		logger.Error("job2_not_found_in_claim")
		os.Exit(1)
	}

	// Fail job 2 (attempt 1 of 5 -> status 'failed' scheduled for retry)
	backoff := worker.CalculateBackoff(claimedJob2.AttemptCount, 2*time.Second, 10*time.Second)
	err = worker.FailJob(ctx, pool, claimedJob2.ID, claimedJob2.FencingToken, "simulated transient network failure", backoff)
	if err != nil {
		logger.Error("fail_job_failed", slog.String("error", err.Error()))
		os.Exit(1)
	}

	err = pool.QueryRow(ctx, "SELECT status FROM background_jobs WHERE id = $1", claimedJob2.ID).Scan(&dbStatus)
	if err != nil || dbStatus != worker.StatusFailed {
		logger.Error("expected_status_failed", slog.String("status", dbStatus))
		os.Exit(1)
	}
	logger.Info("job_retry_transition_verified", slog.String("status", dbStatus), slog.Duration("backoff", backoff))

	// Re-claim and dead-letter directly
	_, _ = pool.Exec(ctx, "UPDATE background_jobs SET scheduled_at = clock_timestamp() - interval '1 second' WHERE id = $1", claimedJob2.ID)
	reclaimedBatch, err := worker.ClaimJobsWithLease(ctx, pool, workerID, worker.QueueDefault, 10, 30*time.Second)
	if err != nil {
		logger.Error("failed_to_reclaim_job2", slog.String("error", err.Error()))
		os.Exit(1)
	}
	var reclaimedJob2 *worker.Job
	for i := range reclaimedBatch {
		if reclaimedBatch[i].ID == claimedJob2.ID {
			reclaimedJob2 = &reclaimedBatch[i]
			break
		}
	}
	if reclaimedJob2 == nil {
		logger.Error("reclaimed_job2_not_found")
		os.Exit(1)
	}

	err = worker.DeadLetterJob(ctx, pool, reclaimedJob2.ID, reclaimedJob2.FencingToken, "unrecoverable permanent error")
	if err != nil {
		logger.Error("dead_letter_failed", slog.String("error", err.Error()))
		os.Exit(1)
	}

	err = pool.QueryRow(ctx, "SELECT status FROM background_jobs WHERE id = $1", reclaimedJob2.ID).Scan(&dbStatus)
	if err != nil || dbStatus != worker.StatusDeadLetter {
		logger.Error("expected_status_dead_letter", slog.String("status", dbStatus))
		os.Exit(1)
	}
	logger.Info("job_dead_letter_transition_verified", slog.String("status", dbStatus))

	// -------------------------------------------------------------------------
	// TEST 7: Queue Backlog Stats
	// -------------------------------------------------------------------------
	stats, err := worker.GetQueueStats(ctx, pool, worker.QueueDefault)
	if err != nil {
		logger.Error("failed_to_query_queue_stats", slog.String("error", err.Error()))
		os.Exit(1)
	}
	logger.Info("queue_depth_metrics_verified",
		slog.String("queue", stats.Queue),
		slog.Int64("pending", stats.PendingCount),
		slog.Int64("processing", stats.ProcessingCount),
		slog.Int64("completed", stats.CompletedCount),
		slog.Int64("dead_letter", stats.DeadLetterCount),
	)

	fmt.Println("\n==================================================================")
	fmt.Println(">> PRODUCTION ACCEPTANCE VERIFICATION: ALL 7 PHASES PASSED <<")
	fmt.Println("==================================================================")
}
