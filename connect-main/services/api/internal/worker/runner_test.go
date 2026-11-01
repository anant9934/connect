package worker_test

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tathastu/connect/services/api/internal/worker"
)

func TestRegistry_RegisterAndDispatch(t *testing.T) {
	registry := worker.NewRegistry()

	var dispatched atomic.Bool
	testType := "test.action"

	registry.RegisterFunc(testType, func(ctx context.Context, job *worker.Job) error {
		dispatched.Store(true)
		return nil
	})

	handler, found := registry.Get(testType)
	if !found {
		t.Fatalf("expected handler to be found for %s", testType)
	}

	job := &worker.Job{
		ID:    uuid.New(),
		Queue: worker.QueueDefault,
	}

	err := handler.Handle(context.Background(), job)
	if err != nil {
		t.Fatalf("unexpected handler error: %v", err)
	}

	if !dispatched.Load() {
		t.Fatal("expected handler function to be executed")
	}

	_, foundMissing := registry.Get("non.existent")
	if foundMissing {
		t.Fatal("expected missing handler to return found=false")
	}
}

func TestParsePayload_ValidAndInvalid(t *testing.T) {
	// 1. Valid payload
	validJSON := []byte(`{"type":"room.cleanup","data":{"maxAgeHours":48}}`)
	payload, err := worker.ParsePayload(validJSON)
	if err != nil {
		t.Fatalf("expected valid payload, got error: %v", err)
	}
	if payload.Type != "room.cleanup" {
		t.Fatalf("expected type room.cleanup, got: %s", payload.Type)
	}

	// 2. Empty bytes
	_, err = worker.ParsePayload([]byte{})
	if err == nil || !errors.Is(err, worker.ErrMalformedPayload) {
		t.Fatalf("expected ErrMalformedPayload for empty bytes, got: %v", err)
	}

	// 3. Corrupt JSON
	_, err = worker.ParsePayload([]byte(`{not-json}`))
	if err == nil || !errors.Is(err, worker.ErrMalformedPayload) {
		t.Fatalf("expected ErrMalformedPayload for corrupt json, got: %v", err)
	}

	// 4. Missing type field
	_, err = worker.ParsePayload([]byte(`{"data":{"foo":"bar"}}`))
	if err == nil || !errors.Is(err, worker.ErrMalformedPayload) {
		t.Fatalf("expected ErrMalformedPayload for missing type field, got: %v", err)
	}
}

func TestErrorCategorization_PermanentVsTransient(t *testing.T) {
	regularErr := errors.New("transient database connection reset")
	if worker.IsPermanent(regularErr) {
		t.Fatal("regular error should not be classified as permanent")
	}

	permErr := worker.MarkPermanent(errors.New("unrecoverable schema mismatch"))
	if !worker.IsPermanent(permErr) {
		t.Fatal("MarkPermanent error must return true for IsPermanent")
	}

	if !errors.Is(permErr, worker.ErrPermanent) {
		t.Fatal("MarkPermanent error must wrap ErrPermanent")
	}

	if worker.MarkPermanent(nil) != nil {
		t.Fatal("MarkPermanent(nil) must return nil")
	}
}

func TestCalculateBackoff_JitterAndBoundaries(t *testing.T) {
	base := 2 * time.Second
	max := 60 * time.Second

	// Attempt 1 should return base delay
	delay1 := worker.CalculateBackoff(1, base, max)
	if delay1 != base {
		t.Fatalf("attempt 1 should return exactly baseDelay, got %v", delay1)
	}

	// Subsequent attempts should be within [base, max]
	for attempt := 2; attempt <= 10; attempt++ {
		delay := worker.CalculateBackoff(attempt, base, max)
		if delay < base {
			t.Fatalf("attempt %d delay %v is less than base %v", attempt, delay, base)
		}
		if delay > max {
			t.Fatalf("attempt %d delay %v exceeds max %v", attempt, delay, max)
		}
	}
}

func TestCalculateBackoff_OverflowProtection(t *testing.T) {
	base := 2 * time.Second
	max := 300 * time.Second

	// Extreme attempt count should not overflow or panic, and should stay <= max
	delayLarge := worker.CalculateBackoff(100, base, max)
	if delayLarge < base || delayLarge > max {
		t.Fatalf("overflow test failed: delay %v not within [%v, %v]", delayLarge, base, max)
	}
}

func TestMetrics_AtomicOperations(t *testing.T) {
	m := worker.NewMetrics()

	m.JobsClaimed.Add(10)
	m.JobsCompleted.Add(8)
	m.JobsFailed.Add(2)
	m.JobsRetried.Add(1)
	m.JobsDeadLettered.Add(1)
	m.LeaseReclamations.Add(3)
	m.DBErrors.Add(4)
	m.ActiveInFlight.Add(5)

	snap := m.Snapshot()
	if snap.JobsClaimed != 10 {
		t.Errorf("JobsClaimed mismatch: expected 10, got %d", snap.JobsClaimed)
	}
	if snap.JobsCompleted != 8 {
		t.Errorf("JobsCompleted mismatch: expected 8, got %d", snap.JobsCompleted)
	}
	if snap.JobsFailed != 2 {
		t.Errorf("JobsFailed mismatch: expected 2, got %d", snap.JobsFailed)
	}
	if snap.JobsRetried != 1 {
		t.Errorf("JobsRetried mismatch: expected 1, got %d", snap.JobsRetried)
	}
	if snap.JobsDeadLettered != 1 {
		t.Errorf("JobsDeadLettered mismatch: expected 1, got %d", snap.JobsDeadLettered)
	}
	if snap.LeaseReclamations != 3 {
		t.Errorf("LeaseReclamations mismatch: expected 3, got %d", snap.LeaseReclamations)
	}
	if snap.DBErrors != 4 {
		t.Errorf("DBErrors mismatch: expected 4, got %d", snap.DBErrors)
	}
	if snap.ActiveInFlight != 5 {
		t.Errorf("ActiveInFlight mismatch: expected 5, got %d", snap.ActiveInFlight)
	}

	m.ActiveInFlight.Add(-5)
	if m.ActiveInFlight.Load() != 0 {
		t.Errorf("ActiveInFlight decrement failed: %d", m.ActiveInFlight.Load())
	}
}

func TestRunnerConfig_ValidationAndDefaults(t *testing.T) {
	cfg := worker.DefaultRunnerConfig()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("DefaultRunnerConfig must be valid: %v", err)
	}

	if cfg.Concurrency <= 0 {
		t.Errorf("invalid default concurrency: %d", cfg.Concurrency)
	}
	if cfg.LeaseTTL <= cfg.HeartbeatInterval {
		t.Errorf("lease TTL %v must be greater than heartbeat interval %v", cfg.LeaseTTL, cfg.HeartbeatInterval)
	}

	// Empty worker ID must fail validation
	invalidCfg := cfg
	invalidCfg.WorkerID = ""
	if err := invalidCfg.Validate(); err == nil {
		t.Fatal("expected validation error for empty worker ID")
	}

	// Normalization of zero values
	zeroCfg := worker.RunnerConfig{WorkerID: "w-1"}
	if err := zeroCfg.Validate(); err != nil {
		t.Fatalf("zero config with worker ID should normalize without error: %v", err)
	}
	if zeroCfg.Concurrency != 5 {
		t.Errorf("expected normalized concurrency 5, got %d", zeroCfg.Concurrency)
	}
	if len(zeroCfg.Queues) == 0 {
		t.Errorf("expected normalized default queue")
	}
}

func TestDefaultHandlers_SystemAuditPing(t *testing.T) {
	logger := slog.Default()
	handler := worker.NewAuditPingHandler(logger)

	pingPayload, _ := json.Marshal(worker.JobPayload{
		Type: worker.TypeSystemAuditPing,
		Data: json.RawMessage(`{"source":"unit_test","message":"ping verification"}`),
	})

	job := &worker.Job{
		ID:           uuid.New(),
		Queue:        worker.QueueDefault,
		Payload:      pingPayload,
		AttemptCount: 1,
	}

	err := handler.Handle(context.Background(), job)
	if err != nil {
		t.Fatalf("expected audit ping handler to succeed, got: %v", err)
	}
}

func TestDefaultHandlers_MalformedPayload(t *testing.T) {
	logger := slog.Default()
	handler := worker.NewAuditPingHandler(logger)

	job := &worker.Job{
		ID:      uuid.New(),
		Payload: []byte(`invalid json`),
	}

	err := handler.Handle(context.Background(), job)
	if err == nil {
		t.Fatal("expected malformed payload to return error")
	}
	if !worker.IsPermanent(err) {
		t.Fatal("malformed payload error must be permanent")
	}
}

type mockStorageDeleter struct {
	deletedKeys []string
	failKey     string
}

func (m *mockStorageDeleter) Delete(ctx context.Context, key string) error {
	if m.failKey != "" && key == m.failKey {
		return errors.New("simulated storage delete failure")
	}
	m.deletedKeys = append(m.deletedKeys, key)
	return nil
}

func TestDefaultHandlers_FilePurge(t *testing.T) {
	logger := slog.Default()
	mockStorage := &mockStorageDeleter{}
	handler := worker.NewFilePurgeHandler(mockStorage, logger)

	purgePayload, _ := json.Marshal(worker.JobPayload{
		Type: worker.TypeFilePurge,
		Data: json.RawMessage(`{"fileKeys":["uploads/room-1/sample.pdf"],"tenantId":"org-1"}`),
	})

	job := &worker.Job{
		ID:      uuid.New(),
		Payload: purgePayload,
	}

	err := handler.Handle(context.Background(), job)
	if err != nil {
		t.Fatalf("expected file purge handler to succeed, got: %v", err)
	}

	if len(mockStorage.deletedKeys) != 1 || mockStorage.deletedKeys[0] != "uploads/room-1/sample.pdf" {
		t.Fatalf("expected storage to delete uploads/room-1/sample.pdf, got: %v", mockStorage.deletedKeys)
	}

	// Test storage failure propagation for worker retries
	mockFailingStorage := &mockStorageDeleter{failKey: "uploads/room-1/sample.pdf"}
	failingHandler := worker.NewFilePurgeHandler(mockFailingStorage, logger)
	failErr := failingHandler.Handle(context.Background(), job)
	if failErr == nil {
		t.Fatal("expected file purge handler to fail when storage returns error")
	}
}

func TestRunnerConfig_FreeTierConservativeSettings(t *testing.T) {
	cfg := worker.RunnerConfig{
		WorkerID:     "free-tier-inproc",
		Concurrency:  1,
		BatchSize:    1,
		PollInterval: 5 * time.Second,
		LeaseTTL:     30 * time.Second,
	}

	if err := cfg.Validate(); err != nil {
		t.Fatalf("free tier config must be valid: %v", err)
	}

	if cfg.Concurrency != 1 {
		t.Errorf("expected concurrency 1, got %d", cfg.Concurrency)
	}
	if cfg.BatchSize != 1 {
		t.Errorf("expected batch size 1, got %d", cfg.BatchSize)
	}
	if cfg.PollInterval != 5*time.Second {
		t.Errorf("expected poll interval 5s, got %v", cfg.PollInterval)
	}
	if cfg.HeartbeatInterval != 10*time.Second {
		t.Errorf("expected heartbeat interval 10s (LeaseTTL / 3), got %v", cfg.HeartbeatInterval)
	}
}
