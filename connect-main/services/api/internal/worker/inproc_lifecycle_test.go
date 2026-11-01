package worker_test

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tathastu/connect/services/api/internal/config"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/handlers"
	"github.com/tathastu/connect/services/api/internal/worker"
)

// TestInProcWorker_LifecycleAndAPIResponsiveness verifies that:
// 1. Worker runs in-process alongside HTTP endpoints.
// 2. HTTP endpoints remain responsive while background jobs are executing.
// 3. Worker stops cleanly during shutdown without dropping in-flight jobs.
func TestInProcWorker_LifecycleAndAPIResponsiveness(t *testing.T) {
	cfg, err := config.Load()
	if err != nil || cfg.DatabaseURL == "" || cfg.DatabaseURL == "postgres://connect_app:connect_dev_password@localhost:5432/connect_db?sslmode=disable" {
		t.Skip("Skipping live database test: valid DATABASE_URL not available")
	}

	cfg.DBMaxIdleConns = 1
	cfg.DBMaxOpenConns = 5

	if testing.Short() {
		t.Skip("Skipping live database test in short mode")
	}

	connCtx, connCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer connCancel()

	db, err := database.Connect(connCtx, cfg)
	if err != nil {
		t.Skipf("Skipping live database test (database unreachable): %v", err)
	}
	defer db.Close()
	pool := db.Pool

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))

	// 1. Setup mock health handler
	healthHandler := handlers.NewHealthHandler(&database.DB{Pool: pool}, nil, logger)
	ts := httptest.NewServer(http.HandlerFunc(healthHandler.Live))
	defer ts.Close()

	// 2. Setup runner configuration for in-process free tier
	runnerCfg := worker.DefaultRunnerConfig()
	runnerCfg.WorkerID = fmt.Sprintf("test-inproc-%s", uuid.New().String()[:8])
	runnerCfg.Concurrency = 1
	runnerCfg.BatchSize = 1
	runnerCfg.PollInterval = 1 * time.Second
	runnerCfg.LeaseTTL = 15 * time.Second
	runnerCfg.HeartbeatInterval = 5 * time.Second

	registry := worker.NewRegistry()
	var jobExecuted bool
	runID := uuid.New().String()[:8]
	testKey := fmt.Sprintf("test-inproc-job-%s", runID)

	registry.RegisterFunc(worker.TypeSystemAuditPing, func(ctx context.Context, job *worker.Job) error {
		time.Sleep(50 * time.Millisecond)
		jobExecuted = true
		return nil
	})

	runner, err := worker.NewRunner(pool, registry, logger, runnerCfg)
	if err != nil {
		t.Fatalf("failed to create runner: %v", err)
	}

	// 3. Prevent duplicate startup test
	workerCtx, workerCancel := context.WithCancel(context.Background())
	defer workerCancel()

	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		_ = runner.Run(workerCtx)
	}()

	time.Sleep(50 * time.Millisecond)
	if !runner.IsRunning() {
		t.Fatal("expected runner to be running")
	}

	// Verify duplicate Run call returns ErrAlreadyRunning
	dupErr := runner.Run(workerCtx)
	if dupErr != worker.ErrAlreadyRunning {
		t.Fatalf("expected ErrAlreadyRunning, got: %v", dupErr)
	}

	// 4. Enqueue a job with fresh context
	enqueueCtx, enqueueCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer enqueueCancel()

	pingPayload := worker.JobPayload{
		Type: worker.TypeSystemAuditPing,
		Data: json.RawMessage(fmt.Sprintf(`{"source":"test","runId":"%s"}`, runID)),
	}
	_, err = worker.Enqueue(enqueueCtx, pool, worker.QueueDefault, testKey, pingPayload, nil)
	if err != nil {
		t.Fatalf("failed to enqueue job: %v", err)
	}
	defer func() {
		cleanCtx, cleanCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanCancel()
		_, _ = pool.Exec(cleanCtx, "DELETE FROM background_jobs WHERE idempotency_key = $1", testKey)
	}()

	// 5. Test HTTP API responsiveness while job is in-flight / polling
	for i := 0; i < 5; i++ {
		start := time.Now()
		resp, err := http.Get(ts.URL)
		if err != nil {
			t.Fatalf("HTTP request failed: %v", err)
		}
		resp.Body.Close()
		dur := time.Since(start)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected HTTP 200, got %d", resp.StatusCode)
		}
		if dur > 500*time.Millisecond {
			t.Fatalf("HTTP probe latency too high (%v)", dur)
		}
		time.Sleep(50 * time.Millisecond)
	}

	// 6. Wait for job execution
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if jobExecuted {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !jobExecuted {
		t.Fatal("expected in-process background worker to claim and execute the job")
	}

	// 7. Verify clean shutdown
	workerCancel()
	runner.Stop()
	select {
	case <-workerDone:
		// Succeeded
	case <-time.After(5 * time.Second):
		t.Fatal("in-process worker failed to drain within timeout")
	}

	if runner.IsRunning() {
		t.Fatal("expected runner to not be running after shutdown")
	}
}
