package worker

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrAlreadyRunning indicates that a runner instance is already actively executing.
var ErrAlreadyRunning = errors.New("worker runner is already running")

// RunnerConfig configures the background worker runtime engine.
type RunnerConfig struct {
	WorkerID          string
	Queues            []string
	Concurrency       int
	BatchSize         int
	PollInterval      time.Duration
	LeaseTTL          time.Duration
	HeartbeatInterval time.Duration
	ShutdownTimeout   time.Duration
	BaseRetryDelay    time.Duration
	MaxRetryDelay     time.Duration
	StatsLogInterval  time.Duration
}

// DefaultRunnerConfig returns production-ready default runner settings.
func DefaultRunnerConfig() RunnerConfig {
	hostname, err := os.Hostname()
	if err != nil || hostname == "" {
		hostname = "worker"
	}
	workerID := fmt.Sprintf("%s-%d-%s", hostname, os.Getpid(), uuid.New().String()[:8])

	return RunnerConfig{
		WorkerID: workerID,
		Queues: []string{
			QueueAttendanceCritical,
			QueueDefault,
			QueueWebhooks,
			QueueMediaProcessing,
		},
		Concurrency:       5,
		BatchSize:         10,
		PollInterval:      1 * time.Second,
		LeaseTTL:          30 * time.Second,
		HeartbeatInterval: 10 * time.Second, // Must be < LeaseTTL / 2
		ShutdownTimeout:   25 * time.Second,
		BaseRetryDelay:    2 * time.Second,
		MaxRetryDelay:     300 * time.Second,
		StatsLogInterval:  60 * time.Second,
	}
}

// Validate checks and sanitizes the runner configuration.
func (c *RunnerConfig) Validate() error {
	if c.WorkerID == "" {
		return errors.New("worker ID must not be empty")
	}
	if len(c.Queues) == 0 {
		c.Queues = []string{QueueDefault}
	}
	if c.Concurrency <= 0 {
		c.Concurrency = 5
	}
	if c.BatchSize <= 0 {
		c.BatchSize = 10
	}
	if c.PollInterval <= 0 {
		c.PollInterval = 1 * time.Second
	}
	if c.LeaseTTL <= 0 {
		c.LeaseTTL = 30 * time.Second
	}
	if c.HeartbeatInterval <= 0 || c.HeartbeatInterval >= c.LeaseTTL {
		c.HeartbeatInterval = c.LeaseTTL / 3
		if c.HeartbeatInterval <= 0 {
			c.HeartbeatInterval = 5 * time.Second
		}
	}
	if c.ShutdownTimeout <= 0 {
		c.ShutdownTimeout = 25 * time.Second
	}
	if c.BaseRetryDelay <= 0 {
		c.BaseRetryDelay = 2 * time.Second
	}
	if c.MaxRetryDelay <= 0 {
		c.MaxRetryDelay = 300 * time.Second
	}
	if c.StatsLogInterval <= 0 {
		c.StatsLogInterval = 60 * time.Second
	}
	return nil
}

// Runner is the supervisory background worker runtime engine.
type Runner struct {
	pool     *pgxpool.Pool
	registry *Registry
	logger   *slog.Logger
	config   RunnerConfig
	metrics  *Metrics

	started    atomic.Bool
	inFlightWG sync.WaitGroup
	stopOnce   sync.Once
	stopChan   chan struct{}
}

// NewRunner constructs a fresh background worker runner instance.
func NewRunner(pool *pgxpool.Pool, registry *Registry, logger *slog.Logger, cfg RunnerConfig) (*Runner, error) {
	if pool == nil {
		return nil, errors.New("database connection pool cannot be nil")
	}
	if registry == nil {
		return nil, errors.New("handler registry cannot be nil")
	}
	if logger == nil {
		logger = slog.Default()
	}
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid runner configuration: %w", err)
	}

	return &Runner{
		pool:     pool,
		registry: registry,
		logger:   logger.With(slog.String("component", "worker_runner"), slog.String("worker_id", cfg.WorkerID)),
		config:   cfg,
		metrics:  NewMetrics(),
		stopChan: make(chan struct{}),
	}, nil
}

// Metrics returns the active metrics collector.
func (r *Runner) Metrics() *Metrics {
	return r.metrics
}

// IsRunning returns true if the runner loop is actively running.
func (r *Runner) IsRunning() bool {
	return r.started.Load()
}

// Run starts the worker loops, listens to the context, and blocks until the context is cancelled
// or Stop() is called, performing a clean, graceful shutdown of all in-flight jobs.
func (r *Runner) Run(ctx context.Context) error {
	if !r.started.CompareAndSwap(false, true) {
		return ErrAlreadyRunning
	}
	defer r.started.Store(false)

	r.logger.Info("worker_runner_starting",
		slog.Int("concurrency", r.config.Concurrency),
		slog.Int("batch_size", r.config.BatchSize),
		slog.Duration("poll_interval", r.config.PollInterval),
		slog.Duration("lease_ttl", r.config.LeaseTTL),
		slog.Duration("heartbeat_interval", r.config.HeartbeatInterval),
		slog.Any("queues", r.config.Queues),
	)

	// Semaphores for concurrency control
	sem := make(chan struct{}, r.config.Concurrency)

	// Background ticker for periodic stats logging
	go r.periodicStatsLogger(ctx)

	// Polling loop
	pollTicker := time.NewTicker(r.config.PollInterval)
	defer pollTicker.Stop()

	var consecutiveDBErrors int

	for {
		select {
		case <-ctx.Done():
			r.logger.Info("worker_runner_shutdown_signal_received", slog.String("reason", ctx.Err().Error()))
			return r.drainInFlight(r.config.ShutdownTimeout)

		case <-r.stopChan:
			r.logger.Info("worker_runner_stopped_programmatically")
			return r.drainInFlight(r.config.ShutdownTimeout)

		default:
			// Attempt to claim and dispatch jobs across priority queues
			claimedAny, err := r.pollAndDispatch(ctx, sem)
			if err != nil {
				consecutiveDBErrors++
				r.metrics.DBErrors.Add(1)
				backoffWait := time.Duration(consecutiveDBErrors) * 2 * time.Second
				if backoffWait > 30*time.Second {
					backoffWait = 30 * time.Second
				}
				r.logger.Error("worker_db_poll_failed",
					slog.String("error", err.Error()),
					slog.Int("consecutive_failures", consecutiveDBErrors),
					slog.Duration("backoff", backoffWait),
				)

				select {
				case <-time.After(backoffWait):
				case <-ctx.Done():
					return r.drainInFlight(r.config.ShutdownTimeout)
				case <-r.stopChan:
					return r.drainInFlight(r.config.ShutdownTimeout)
				}
				continue
			}

			consecutiveDBErrors = 0

			// If no jobs were found in any queue, wait for the poll ticker
			if !claimedAny {
				select {
				case <-pollTicker.C:
				case <-ctx.Done():
					return r.drainInFlight(r.config.ShutdownTimeout)
				case <-r.stopChan:
					return r.drainInFlight(r.config.ShutdownTimeout)
				}
			}
		}
	}
}

// Stop initiates runner shutdown programmatically.
func (r *Runner) Stop() {
	r.stopOnce.Do(func() {
		close(r.stopChan)
	})
}

// pollAndDispatch iterates through registered queues, respects available capacity, and dispatches jobs.
func (r *Runner) pollAndDispatch(ctx context.Context, sem chan struct{}) (bool, error) {
	claimedAny := false

	for _, queue := range r.config.Queues {
		// Determine available slots
		availableSlots := r.config.Concurrency - len(sem)
		if availableSlots <= 0 {
			// All workers currently busy
			return claimedAny, nil
		}

		limit := availableSlots
		if limit > r.config.BatchSize {
			limit = r.config.BatchSize
		}

		jobs, err := ClaimJobsWithLease(
			ctx,
			r.pool,
			r.config.WorkerID,
			queue,
			limit,
			r.config.LeaseTTL,
		)
		if err != nil {
			return false, fmt.Errorf("queue claim failed for %s: %w", queue, err)
		}

		if len(jobs) == 0 {
			continue
		}

		claimedAny = true
		r.metrics.JobsClaimed.Add(uint64(len(jobs)))

		r.logger.Info("jobs_claimed",
			slog.String("queue", queue),
			slog.Int("count", len(jobs)),
			slog.Int("in_flight_before", len(sem)),
		)

		for i := range jobs {
			job := jobs[i]
			sem <- struct{}{} // Acquire concurrency slot
			r.inFlightWG.Add(1)
			r.metrics.ActiveInFlight.Add(1)

			go func(j Job) {
				defer func() {
					<-sem // Release slot
					r.metrics.ActiveInFlight.Add(-1)
					r.inFlightWG.Done()
				}()

				r.processJob(ctx, j)
			}(job)
		}
	}

	return claimedAny, nil
}

// processJob coordinates heartbeat renewal, execution, error categorization, and state transitions.
func (r *Runner) processJob(parentCtx context.Context, job Job) {
	startTime := time.Now()
	jobLogger := r.logger.With(
		slog.String("job_id", job.ID.String()),
		slog.String("queue", job.Queue),
		slog.String("idempotency_key", job.IdempotencyKey),
		slog.Int("attempt", job.AttemptCount),
		slog.Int64("fencing_token", job.FencingToken),
	)

	jobCtx, cancelJob := context.WithCancel(parentCtx)
	defer cancelJob()

	// 1. Start concurrent heartbeat supervisor
	heartbeatDone := make(chan struct{})
	defer close(heartbeatDone)

	go func() {
		hbTicker := time.NewTicker(r.config.HeartbeatInterval)
		defer hbTicker.Stop()

		for {
			select {
			case <-heartbeatDone:
				return
			case <-hbTicker.C:
				hbCtx, hbCancel := context.WithTimeout(context.Background(), 5*time.Second)
				err := HeartbeatJob(hbCtx, r.pool, job.ID, job.FencingToken, r.config.LeaseTTL)
				hbCancel()

				if err != nil {
					jobLogger.Warn("heartbeat_extension_failed",
						slog.String("error", err.Error()),
						slog.String("action", "cancelling_job_execution"),
					)
					cancelJob() // Lease expired or lost; stop handler execution immediately
					return
				}
			}
		}
	}()

	// 2. Safely execute job with panic recovery
	var execErr error
	func() {
		defer func() {
			if rec := recover(); rec != nil {
				execErr = fmt.Errorf("job execution panicked: %v", rec)
				jobLogger.Error("job_execution_panicked", slog.Any("panic", rec))
			}
		}()

		payload, err := ParsePayload(job.Payload)
		if err != nil {
			execErr = fmt.Errorf("%w: %v", ErrPermanent, err)
			return
		}

		handler, found := r.registry.Get(payload.Type)
		if !found {
			execErr = fmt.Errorf("%w: %s", ErrPermanent, payload.Type)
			return
		}

		execErr = handler.Handle(jobCtx, &job)
	}()

	duration := time.Since(startTime)

	// 3. Process outcome using monotonic fencing tokens
	opCtx, opCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer opCancel()

	if execErr == nil {
		if err := CompleteJob(opCtx, r.pool, job.ID, job.FencingToken); err != nil {
			r.metrics.DBErrors.Add(1)
			jobLogger.Error("failed_to_mark_job_completed", slog.String("error", err.Error()))
		} else {
			r.metrics.JobsCompleted.Add(1)
			jobLogger.Info("job_completed_successfully", slog.Duration("duration_ms", duration))
		}
		return
	}

	// Job failed: evaluate retryability
	r.metrics.JobsFailed.Add(1)
	jobLogger.Warn("job_execution_failed",
		slog.String("error", execErr.Error()),
		slog.Duration("duration_ms", duration),
	)

	if IsPermanent(execErr) {
		if err := DeadLetterJob(opCtx, r.pool, job.ID, job.FencingToken, execErr.Error()); err != nil {
			r.metrics.DBErrors.Add(1)
			jobLogger.Error("failed_to_dead_letter_job", slog.String("error", err.Error()))
		} else {
			r.metrics.JobsDeadLettered.Add(1)
			jobLogger.Warn("job_permanently_failed_dead_lettered")
		}
		return
	}

	// Retryable error: compute exponential backoff with full jitter
	retryDelay := CalculateBackoff(job.AttemptCount, r.config.BaseRetryDelay, r.config.MaxRetryDelay)
	if err := FailJob(opCtx, r.pool, job.ID, job.FencingToken, execErr.Error(), retryDelay); err != nil {
		r.metrics.DBErrors.Add(1)
		jobLogger.Error("failed_to_record_job_failure", slog.String("error", err.Error()))
	} else {
		if job.AttemptCount >= job.MaxAttempts {
			r.metrics.JobsDeadLettered.Add(1)
			jobLogger.Warn("job_exhausted_max_attempts_dead_lettered", slog.Int("max_attempts", job.MaxAttempts))
		} else {
			r.metrics.JobsRetried.Add(1)
			jobLogger.Info("job_scheduled_for_retry",
				slog.Duration("retry_delay", retryDelay),
				slog.Int("next_attempt", job.AttemptCount+1),
			)
		}
	}
}

// drainInFlight waits for all active jobs to complete up to the shutdown timeout.
func (r *Runner) drainInFlight(timeout time.Duration) error {
	r.logger.Info("waiting_for_in_flight_jobs",
		slog.Int64("in_flight", r.metrics.ActiveInFlight.Load()),
		slog.Duration("timeout", timeout),
	)

	done := make(chan struct{})
	go func() {
		r.inFlightWG.Wait()
		close(done)
	}()

	select {
	case <-done:
		r.logger.Info("all_in_flight_jobs_drained_successfully")
	case <-time.After(timeout):
		remaining := r.metrics.ActiveInFlight.Load()
		r.logger.Warn("shutdown_timeout_reached_with_active_jobs", slog.Int64("abandoned", remaining))
	}

	r.metrics.LogSummary(r.logger)
	return nil
}

// periodicStatsLogger logs periodic snapshots of worker performance and queue stats.
func (r *Runner) periodicStatsLogger(ctx context.Context) {
	ticker := time.NewTicker(r.config.StatsLogInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-r.stopChan:
			return
		case <-ticker.C:
			r.metrics.LogSummary(r.logger)

			// Also query database for queue depth of active queues
			for _, q := range r.config.Queues {
				statsCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				stats, err := GetQueueStats(statsCtx, r.pool, q)
				cancel()
				if err != nil {
					r.logger.Debug("failed_to_query_queue_stats", slog.String("queue", q), slog.String("error", err.Error()))
					continue
				}

				if stats.PendingCount > 0 || stats.ProcessingCount > 0 || stats.DeadLetterCount > 0 {
					r.logger.Info("queue_backlog_metrics",
						slog.String("queue", q),
						slog.Int64("pending", stats.PendingCount),
						slog.Int64("processing", stats.ProcessingCount),
						slog.Int64("failed", stats.FailedCount),
						slog.Int64("dead_letter", stats.DeadLetterCount),
						slog.Duration("oldest_pending_age", stats.OldestPendingAge),
					)
				}
			}
		}
	}
}
