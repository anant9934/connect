package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/livekit/protocol/webhook"
	"github.com/tathastu/connect/services/api/internal/attendance"
)

// TestWorkflowDB_AttendanceQueueLifecycle runs enqueue, claim, retry and completion through
// the real Runner as connect_worker, rather than calling the handler directly.
func TestWorkflowDB_AttendanceQueueLifecycle(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	admin := workflowPool(t, ctx, "TEST_DATABASE_URL")
	app := workflowPool(t, ctx, "TEST_CONNECT_APP_URL")
	workerPool := workflowPool(t, ctx, "TEST_CONNECT_WORKER_URL")

	start := time.Date(2026, 1, 6, 10, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	w := addTenant(t, ctx, admin, start, end)
	student := enroll(t, ctx, admin, w)

	err := attendance.NewPgxSessionStore(app).Apply(ctx, attendance.SessionEvent{
		EventID: "EV_" + uuid.NewString(), EventType: webhook.EventParticipantLeft, RoomName: w.roomCode,
		ParticipantSID: "PA_queue", Identity: "user:" + student, JoinedAt: start, OccurredAt: end,
	})
	if err != nil {
		t.Fatal(err)
	}

	suffix := uuid.NewString()[:8]
	trigger := fmt.Sprintf(`
		CREATE FUNCTION q_fail_%[1]s() RETURNS trigger LANGUAGE plpgsql AS $f$
		BEGIN IF NEW.student_user_id = '%[2]s' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $f$;
		CREATE TRIGGER q_fail_%[1]s BEFORE INSERT ON attendance_records FOR EACH ROW EXECUTE FUNCTION q_fail_%[1]s();`, suffix, student)
	if _, err := admin.Exec(ctx, trigger); err != nil {
		t.Fatal(err)
	}
	dropTrigger := fmt.Sprintf(`DROP TRIGGER IF EXISTS q_fail_%[1]s ON attendance_records; DROP FUNCTION IF EXISTS q_fail_%[1]s();`, suffix)
	t.Cleanup(func() { _, _ = admin.Exec(context.Background(), dropTrigger) })

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	registry := NewRegistry()
	registry.RegisterFunc(TypeAttendanceReconcile, NewAttendanceReconcileHandler(workerPool, logger))
	cfg := DefaultRunnerConfig()
	cfg.Queues = []string{QueueAttendanceCritical}
	cfg.PollInterval = 100 * time.Millisecond
	cfg.BaseRetryDelay = 100 * time.Millisecond
	cfg.MaxRetryDelay = time.Second
	runner, err := NewRunner(workerPool, registry, logger, cfg)
	if err != nil {
		t.Fatal(err)
	}

	enqueue := func(roomID, key string) {
		t.Helper()
		data, _ := json.Marshal(AttendanceReconcileData{RoomID: roomID, Before: end})
		// A repeated key is reported by Enqueue either way; the row count below is the proof.
		_, _ = Enqueue(ctx, workerPool, QueueAttendanceCritical, key, JobPayload{Type: TypeAttendanceReconcile, Data: data}, nil)
	}
	jobState := func(key string) (status string, attempts int) {
		t.Helper()
		if err := admin.QueryRow(ctx, `SELECT status, attempt_count FROM background_jobs WHERE idempotency_key = $1`, key).Scan(&status, &attempts); err != nil {
			t.Fatalf("job %s: %v", key, err)
		}
		return status, attempts
	}
	waitFor := func(what string, done func() bool) {
		t.Helper()
		deadline := time.Now().Add(30 * time.Second)
		for !done() {
			if time.Now().After(deadline) {
				t.Fatalf("timed out waiting for %s", what)
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
	records := func() (n int, status string) {
		t.Helper()
		if err := admin.QueryRow(ctx, `SELECT count(*), COALESCE(max(attendance_status), '') FROM attendance_records WHERE class_session_id = $1 AND student_user_id = $2`, w.sessionID, student).Scan(&n, &status); err != nil {
			t.Fatal(err)
		}
		return n, status
	}

	key := "queue-test-" + suffix
	enqueue(w.roomID, key)
	enqueue(w.roomID, key)
	var rows int
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM background_jobs WHERE idempotency_key = $1`, key).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("duplicate enqueue produced %d jobs, err=%v", rows, err)
	}

	runCtx, stop := context.WithCancel(ctx)
	runDone := make(chan error, 1)
	go func() { runDone <- runner.Run(runCtx) }()
	t.Cleanup(func() {
		stop()
		<-runDone
	})

	// The first attempts fail while the trigger exists: retried, nothing partially written.
	waitFor("a failed attempt", func() bool { _, attempts := jobState(key); return attempts >= 1 })
	if status, _ := jobState(key); status == StatusCompleted {
		t.Fatal("job completed despite the injected failure")
	}
	if n, _ := records(); n != 0 {
		t.Fatalf("failed attempt left %d records", n)
	}

	if _, err := admin.Exec(ctx, dropTrigger); err != nil {
		t.Fatal(err)
	}
	waitFor("retry to complete", func() bool { status, _ := jobState(key); return status == StatusCompleted })
	if n, status := records(); n != 1 || status != "present" {
		t.Fatalf("after retry: %d records, status %q", n, status)
	}

	// Delivering the same work under a new key must not duplicate or change the record.
	second := "queue-test-dup-" + suffix
	enqueue(w.roomID, second)
	waitFor("duplicate delivery", func() bool { status, _ := jobState(second); return status == StatusCompleted })
	if n, status := records(); n != 1 || status != "present" {
		t.Fatalf("after duplicate delivery: %d records, status %q", n, status)
	}

	// A job that can never succeed stops retrying once its attempts run out.
	poison := "queue-test-poison-" + suffix
	enqueue("not-a-uuid", poison)
	if _, err := admin.Exec(ctx, `UPDATE background_jobs SET max_attempts = 2 WHERE idempotency_key = $1`, poison); err != nil {
		t.Fatal(err)
	}
	waitFor("dead letter", func() bool { status, _ := jobState(poison); return status == StatusDeadLetter })
}
