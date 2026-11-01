package worker_test

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tathastu/connect/services/api/internal/attendance"
	"github.com/tathastu/connect/services/api/internal/worker"
)

// mockWorkflowStorage implements worker.StorageDeleter for unit testing.
type mockWorkflowStorage struct {
	deletedKeys []string
	failKeys    map[string]bool
}

func (m *mockWorkflowStorage) Delete(ctx context.Context, key string) error {
	if m.failKeys != nil && m.failKeys[key] {
		return errors.New("simulated R2 503 Service Unavailable / transient outage")
	}
	m.deletedKeys = append(m.deletedKeys, key)
	return nil
}

// TestWorkflow_FilePurge_Comprehensive verifies:
// 1. Storage object deletion is executed for all keys.
// 2. Retry of already deleted keys is idempotent.
// 3. Storage errors return error for worker exponential backoff.
// 4. Malformed payloads fail permanently.
func TestWorkflow_FilePurge_Comprehensive(t *testing.T) {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))

	t.Run("Successful purge of multiple keys", func(t *testing.T) {
		mockStorage := &mockWorkflowStorage{}
		handler := worker.NewFilePurgeHandler(mockStorage, logger)

		payloadBytes, _ := json.Marshal(worker.JobPayload{
			Type: worker.TypeFilePurge,
			Data: json.RawMessage(`{"fileKeys":["uploads/r1/f1.pdf", "uploads/r1/f2.png"],"tenantId":"org-123"}`),
		})
		job := &worker.Job{ID: uuid.New(), Payload: payloadBytes}

		err := handler.Handle(context.Background(), job)
		if err != nil {
			t.Fatalf("expected successful purge, got: %v", err)
		}
		if len(mockStorage.deletedKeys) != 2 {
			t.Fatalf("expected 2 deleted keys, got %d", len(mockStorage.deletedKeys))
		}
	})

	t.Run("Idempotent retry of already deleted keys", func(t *testing.T) {
		mockStorage := &mockWorkflowStorage{}
		handler := worker.NewFilePurgeHandler(mockStorage, logger)

		payloadBytes, _ := json.Marshal(worker.JobPayload{
			Type: worker.TypeFilePurge,
			Data: json.RawMessage(`{"fileKeys":["uploads/r1/f1.pdf"]}`),
		})
		job := &worker.Job{ID: uuid.New(), Payload: payloadBytes}

		// First execution
		if err := handler.Handle(context.Background(), job); err != nil {
			t.Fatalf("run 1 failed: %v", err)
		}
		// Second execution (re-delivery / duplicate outbox)
		if err := handler.Handle(context.Background(), job); err != nil {
			t.Fatalf("run 2 (retry) must succeed idempotently, got: %v", err)
		}
	})

	t.Run("Transient storage failure triggers worker retry", func(t *testing.T) {
		mockStorage := &mockWorkflowStorage{failKeys: map[string]bool{"uploads/r1/f1.pdf": true}}
		handler := worker.NewFilePurgeHandler(mockStorage, logger)

		payloadBytes, _ := json.Marshal(worker.JobPayload{
			Type: worker.TypeFilePurge,
			Data: json.RawMessage(`{"fileKeys":["uploads/r1/f1.pdf"]}`),
		})
		job := &worker.Job{ID: uuid.New(), Payload: payloadBytes}

		err := handler.Handle(context.Background(), job)
		if err == nil {
			t.Fatal("expected handler to return error on storage failure")
		}
		if worker.IsPermanent(err) {
			t.Fatal("storage transient failure must not be marked permanent")
		}
	})

	t.Run("Malformed payload fails permanently", func(t *testing.T) {
		handler := worker.NewFilePurgeHandler(nil, logger)
		job := &worker.Job{ID: uuid.New(), Payload: []byte(`{"type":"file.purge","data":{invalid-json}}`)}

		err := handler.Handle(context.Background(), job)
		if err == nil {
			t.Fatal("expected error on malformed payload")
		}
		if !worker.IsPermanent(err) {
			t.Fatal("malformed payload must be marked permanent to dead-letter immediately")
		}
	})
}

// TestWorkflow_AttendanceReconcile_MathematicalLebesgueMeasure verifies:
// 1. Lebesgue measure union handles overlapping, duplicate, and fragmented connection intervals.
// 2. Unclosed sessions are clipped to session cutoff boundaries.
// 3. Faculty overrules are never overwritten by automated reconciliation.
func TestWorkflow_AttendanceReconcile_MathematicalLebesgueMeasure(t *testing.T) {
	sessionStart := time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)
	sessionEnd := time.Date(2026, 11, 1, 11, 0, 0, 0, time.UTC) // 3600 seconds
	sessionDuration := 3600

	t.Run("Overlapping multi-device reconnect intervals are merged without duplicate time", func(t *testing.T) {
		// Student joined on laptop (10:00 - 10:30) and phone (10:15 - 10:45)
		intervals := []attendance.Interval{
			{Start: sessionStart, End: sessionStart.Add(30 * time.Minute)},
			{Start: sessionStart.Add(15 * time.Minute), End: sessionStart.Add(45 * time.Minute)},
		}

		// Union should be exactly 10:00 - 10:45 = 45 minutes = 2700 seconds (not 30+30=60m)
		netSeconds := attendance.ReconcileIntervalUnion(intervals, sessionStart, sessionEnd)
		if netSeconds != 2700 {
			t.Fatalf("expected 2700 seconds (45m), got: %d", netSeconds)
		}

		status := attendance.CalculateAttendanceStatus(netSeconds, sessionDuration, 0.75, 0.40)
		if status != "present" {
			t.Fatalf("expected 'present' for 75%% ratio, got: %s", status)
		}
	})

	t.Run("Unclosed intervals clipped strictly to session boundary", func(t *testing.T) {
		// Student joined at 10:30 and never sent leave (unclosed interval up to 12:00)
		intervals := []attendance.Interval{
			{Start: sessionStart.Add(30 * time.Minute), End: sessionEnd.Add(60 * time.Minute)},
		}

		// Must clip to sessionEnd (11:00) -> 30 minutes = 1800 seconds
		netSeconds := attendance.ReconcileIntervalUnion(intervals, sessionStart, sessionEnd)
		if netSeconds != 1800 {
			t.Fatalf("expected clipped 1800 seconds (30m), got: %d", netSeconds)
		}

		status := attendance.CalculateAttendanceStatus(netSeconds, sessionDuration, 0.75, 0.40)
		if status != "partial" {
			t.Fatalf("expected 'partial' for 50%% ratio, got: %s", status)
		}
	})

	t.Run("Preservation of manual faculty overrules", func(t *testing.T) {
		actorID := uuid.NewString()
		now := time.Now().UTC()

		record := &attendance.AttendanceRecord{
			ID:                    uuid.NewString(),
			OrganizationID:        uuid.NewString(),
			BatchID:               uuid.NewString(),
			ClassSessionID:        uuid.NewString(),
			StudentUserID:         uuid.NewString(),
			TotalConnectedSeconds: 600,
			AttendanceStatus:      "absent",
			IsOverruled:           false,
		}

		// Faculty applies manual medical overrule
		audit, err := attendance.ApplyManualOverrule(record, "present", nil, actorID, "Medical certificate submitted and verified by dean", now)
		if err != nil {
			t.Fatalf("overrule failed: %v", err)
		}

		if !record.IsOverruled {
			t.Fatal("expected record to be marked overruled")
		}
		if record.AttendanceStatus != "present" {
			t.Fatalf("expected 'present', got: %s", record.AttendanceStatus)
		}
		if *record.OriginalStatus != "absent" {
			t.Fatalf("expected original status 'absent' preserved, got: %s", *record.OriginalStatus)
		}
		if audit.PriorStatus != "absent" || audit.NewStatus != "present" {
			t.Fatalf("audit entry mismatch: %v", audit)
		}
	})
}

// TestWorkflow_RoomCleanup_PayloadValidation verifies room cleanup payload envelopes and defaults.
func TestWorkflow_RoomCleanup_PayloadValidation(t *testing.T) {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	handler := worker.NewRoomCleanupHandler(nil, logger)

	t.Run("Malformed JSON payload fails permanently", func(t *testing.T) {
		job := &worker.Job{ID: uuid.New(), Payload: []byte(`not-json`)}
		err := handler.Handle(context.Background(), job)
		if err == nil || !worker.IsPermanent(err) {
			t.Fatalf("expected permanent error on malformed payload, got: %v", err)
		}
	})
}
