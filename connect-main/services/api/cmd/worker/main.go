package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/tathastu/connect/services/api/internal/config"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/worker"
)

const buildVersion = "worker-v0.1.0"

func main() {
	// 1. Structured logging setup
	logLevel := slog.LevelInfo
	if envLevel := os.Getenv("LOG_LEVEL"); envLevel == "debug" {
		logLevel = slog.LevelDebug
	} else if envLevel == "warn" {
		logLevel = slog.LevelWarn
	} else if envLevel == "error" {
		logLevel = slog.LevelError
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel}))
	slog.SetDefault(logger)

	logger.Info("connect_worker_initializing", slog.String("version", buildVersion))

	// 2. Load configuration
	cfg, err := config.Load()
	if err != nil {
		logger.Error("configuration_load_failed", slog.String("error", err.Error()))
		os.Exit(1)
	}

	// 3. Connect to PostgreSQL
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	db, err := database.Connect(ctx, cfg)
	if err != nil {
		logger.Error("database_connection_failed", slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer db.Close()
	logger.Info("database_connected_successfully")

	// 4. Initialize Registry & Register default handlers
	registry := worker.NewRegistry()
	worker.RegisterDefaultHandlers(registry, db.Pool, logger)

	// 5. Configure Runner
	runnerCfg := worker.DefaultRunnerConfig()
	if envWorkerID := os.Getenv("WORKER_ID"); envWorkerID != "" {
		runnerCfg.WorkerID = envWorkerID
	}
	if envConcurrency := os.Getenv("WORKER_CONCURRENCY"); envConcurrency != "" {
		if c, err := strconv.Atoi(envConcurrency); err == nil && c > 0 {
			runnerCfg.Concurrency = c
		}
	}
	if envBatch := os.Getenv("WORKER_BATCH_SIZE"); envBatch != "" {
		if b, err := strconv.Atoi(envBatch); err == nil && b > 0 {
			runnerCfg.BatchSize = b
		}
	}
	if envPoll := os.Getenv("WORKER_POLL_INTERVAL"); envPoll != "" {
		if d, err := time.ParseDuration(envPoll); err == nil && d > 0 {
			runnerCfg.PollInterval = d
		}
	}
	if envLease := os.Getenv("WORKER_LEASE_TTL"); envLease != "" {
		if d, err := time.ParseDuration(envLease); err == nil && d > 0 {
			runnerCfg.LeaseTTL = d
			runnerCfg.HeartbeatInterval = d / 3
		}
	}

	runner, err := worker.NewRunner(db.Pool, registry, logger, runnerCfg)
	if err != nil {
		logger.Error("failed_to_initialize_worker_runner", slog.String("error", err.Error()))
		os.Exit(1)
	}

	// 6. Graceful signal handling
	runCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	logger.Info("connect_worker_ready_and_polling",
		slog.String("worker_id", runnerCfg.WorkerID),
		slog.Int("concurrency", runnerCfg.Concurrency),
		slog.Duration("poll_interval", runnerCfg.PollInterval),
		slog.Duration("lease_ttl", runnerCfg.LeaseTTL),
	)

	// 7. Start runner (blocks until cancelled or stopped)
	if err := runner.Run(runCtx); err != nil && err != context.Canceled {
		logger.Error("worker_runner_terminated_with_error", slog.String("error", err.Error()))
		os.Exit(1)
	}

	logger.Info("connect_worker_shutdown_complete")
}
