package worker

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestRLS_AttendanceJobSeesRoomUnderRuntimeRole runs the reconcile handler as the role
// under test on a disposable database. A hidden room must surface as an error.
func TestRLS_AttendanceJobSeesRoomUnderRuntimeRole(t *testing.T) {
	adminURL, appURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_APP_DATABASE_URL")
	if adminURL == "" || appURL == "" {
		t.Skip("NOT VERIFIED: TEST_DATABASE_URL and TEST_APP_DATABASE_URL are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	admin, err := pgxpool.New(ctx, adminURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	app, err := pgxpool.New(ctx, appURL)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()

	userID, code := uuid.NewString(), "rlsjob-"+uuid.NewString()[:8]
	if _, err := admin.Exec(ctx, `INSERT INTO users (id, email_normalized, display_name, password_hash) VALUES ($1, $2, 'RLS', 'x')`, userID, code+"@example.test"); err != nil {
		t.Fatal(err)
	}
	var roomID string
	if err := admin.QueryRow(ctx, `INSERT INTO rooms (public_code, host_user_id, workspace_type) VALUES ($1, $2, 'personal_workspace') RETURNING id::text`, code, userID).Scan(&roomID); err != nil {
		t.Fatal(err)
	}

	data, _ := json.Marshal(AttendanceReconcileData{RoomID: roomID})
	payload, _ := json.Marshal(JobPayload{Type: TypeAttendanceReconcile, Data: data})
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	if err := NewAttendanceReconcileHandler(app, logger)(ctx, &Job{ID: uuid.New(), Payload: payload}); err != nil {
		t.Fatalf("attendance job cannot process a real room under this role: %v", err)
	}
}
