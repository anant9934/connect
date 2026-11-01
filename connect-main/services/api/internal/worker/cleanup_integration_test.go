package worker

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
)

// TestWorkflowDB_RoomCleanupAsWorker runs the real handler as connect_worker.
func TestWorkflowDB_RoomCleanupAsWorker(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin := workflowPool(t, ctx, "TEST_DATABASE_URL")
	workerPool := workflowPool(t, ctx, "TEST_CONNECT_WORKER_URL")

	host := uuid.NewString()
	if _, err := admin.Exec(ctx, `INSERT INTO users (id, email_normalized, display_name, password_hash) VALUES ($1, $2, 'H', 'x')`, host, host+"@example.test"); err != nil {
		t.Fatal(err)
	}
	var roomID, scheduledID string
	if err := admin.QueryRow(ctx, `INSERT INTO rooms (public_code, host_user_id, workspace_type, created_at) VALUES ($1, $2, 'personal_commons', now() - interval '3 days') RETURNING id::text`, "CL"+uuid.NewString()[:8], host).Scan(&roomID); err != nil {
		t.Fatal(err)
	}
	if err := admin.QueryRow(ctx, `INSERT INTO rooms (public_code, host_user_id, workspace_type, status, created_at) VALUES ($1, $2, 'personal_commons', 'scheduled', now() - interval '3 days') RETURNING id::text`, "CL"+uuid.NewString()[:8], host).Scan(&scheduledID); err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, `INSERT INTO room_participants (room_id, identity, display_name, is_guest) VALUES ($1, 'guest:x', 'G', true)`, roomID); err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, `INSERT INTO room_admissions (room_id, identity, display_name, status) VALUES ($1, 'guest:y', 'W', 'pending')`, roomID); err != nil {
		t.Fatal(err)
	}

	handler := NewRoomCleanupHandler(workerPool, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := handler(ctx, &Job{ID: uuid.New(), Payload: []byte(`{"type":"room.cleanup","data":{"roomId":"` + roomID + `"}}`)}); err != nil {
		t.Fatalf("cleanup by id: %v", err)
	}
	var status, admission string
	var open int
	if err := admin.QueryRow(ctx, `SELECT r.status, (SELECT status FROM room_admissions WHERE room_id = r.id), (SELECT count(*) FROM room_participants WHERE room_id = r.id AND left_at IS NULL) FROM rooms r WHERE r.id = $1`, roomID).Scan(&status, &admission, &open); err != nil {
		t.Fatal(err)
	}
	if status != "ended" || admission != "denied" || open != 0 {
		t.Fatalf("cleanup left status=%s admission=%s open=%d", status, admission, open)
	}

	// The sweep over stale rooms must not end a meeting booked for later.
	if err := handler(ctx, &Job{ID: uuid.New(), Payload: []byte(`{"type":"room.cleanup","data":{"maxAgeHours":24}}`)}); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if err := admin.QueryRow(ctx, `SELECT status FROM rooms WHERE id = $1`, scheduledID).Scan(&status); err != nil || status != "scheduled" {
		t.Fatalf("sweep changed a scheduled meeting to %q, err=%v", status, err)
	}
}
