package worker

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/livekit/protocol/webhook"
	"github.com/tathastu/connect/services/api/internal/attendance"
)

// TestWorkflowDB_WorkerRestartRecovery simulates a worker dying mid-job: it claims a job and
// never reports back. A new Runner must take over after the lease expires, and the dead
// worker's late completion must be rejected by the fencing token.
func TestWorkflowDB_WorkerRestartRecovery(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	admin := workflowPool(t, ctx, "TEST_DATABASE_URL")
	app := workflowPool(t, ctx, "TEST_CONNECT_APP_URL")
	workerPool := workflowPool(t, ctx, "TEST_CONNECT_WORKER_URL")

	start := time.Date(2026, 1, 7, 10, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	w := addTenant(t, ctx, admin, start, end)
	student := enroll(t, ctx, admin, w)
	if err := attendance.NewPgxSessionStore(app).Apply(ctx, attendance.SessionEvent{
		EventID: "EV_" + uuid.NewString(), EventType: webhook.EventParticipantLeft, RoomName: w.roomCode,
		ParticipantSID: "PA_restart", Identity: "user:" + student, JoinedAt: start, OccurredAt: end,
	}); err != nil {
		t.Fatal(err)
	}

	queue := "restart-test-" + uuid.NewString()[:8]
	key := "restart-" + uuid.NewString()[:8]
	data, _ := json.Marshal(AttendanceReconcileData{RoomID: w.roomID, Before: end})
	if _, err := Enqueue(ctx, workerPool, queue, key, JobPayload{Type: TypeAttendanceReconcile, Data: data}, nil); err != nil {
		t.Fatal(err)
	}

	claimed, err := ClaimJobsWithLease(ctx, workerPool, "worker-that-dies", queue, 1, 500*time.Millisecond)
	if err != nil || len(claimed) != 1 {
		t.Fatalf("claim: %d jobs, err=%v", len(claimed), err)
	}
	dead := claimed[0]

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	registry := NewRegistry()
	registry.RegisterFunc(TypeAttendanceReconcile, NewAttendanceReconcileHandler(workerPool, logger))
	cfg := DefaultRunnerConfig()
	cfg.Queues = []string{queue}
	cfg.PollInterval = 100 * time.Millisecond
	runner, err := NewRunner(workerPool, registry, logger, cfg)
	if err != nil {
		t.Fatal(err)
	}
	runCtx, stop := context.WithCancel(ctx)
	runDone := make(chan error, 1)
	go func() { runDone <- runner.Run(runCtx) }()
	t.Cleanup(func() {
		stop()
		<-runDone
	})

	deadline := time.Now().Add(20 * time.Second)
	var status string
	for {
		if err := admin.QueryRow(ctx, `SELECT status FROM background_jobs WHERE id = $1`, dead.ID).Scan(&status); err != nil {
			t.Fatal(err)
		}
		if status == StatusCompleted {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("job was not recovered after its lease expired, status %q", status)
		}
		time.Sleep(50 * time.Millisecond)
	}

	var records int
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM attendance_records WHERE class_session_id = $1 AND student_user_id = $2`, w.sessionID, student).Scan(&records); err != nil || records != 1 {
		t.Fatalf("expected one attendance record, got %d, err=%v", records, err)
	}
	if err := CompleteJob(ctx, workerPool, dead.ID, dead.FencingToken); err == nil {
		t.Fatal("the dead worker's stale completion was accepted")
	}
	if err := FailJob(ctx, workerPool, dead.ID, dead.FencingToken, "late failure", time.Second); err == nil {
		t.Fatal("the dead worker's stale failure was accepted")
	}
	if err := admin.QueryRow(ctx, `SELECT status FROM background_jobs WHERE id = $1`, dead.ID).Scan(&status); err != nil || status != StatusCompleted {
		t.Fatalf("stale worker changed the job: %q, err=%v", status, err)
	}
}
