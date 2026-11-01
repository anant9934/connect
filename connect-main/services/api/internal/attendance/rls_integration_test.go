package attendance

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/livekit/protocol/webhook"
)

// TestRLS_WebhookStoreUnderRuntimeRole runs the webhook store as the role under test
// (TEST_APP_DATABASE_URL) with fixtures created by TEST_DATABASE_URL. Point both at a
// disposable database with migrations applied, never at production.
func TestRLS_WebhookStoreUnderRuntimeRole(t *testing.T) {
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

	var role string
	var bypass bool
	if err := app.QueryRow(ctx, `SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user`).Scan(&role, &bypass); err != nil {
		t.Fatal(err)
	}
	t.Logf("role under test: %s bypassrls=%v", role, bypass)

	userID, code := uuid.NewString(), "rls-"+uuid.NewString()[:8]
	if _, err := admin.Exec(ctx, `INSERT INTO users (id, email_normalized, display_name, password_hash) VALUES ($1, $2, 'RLS', 'x')`, userID, code+"@example.test"); err != nil {
		t.Fatal(err)
	}
	var roomID string
	if err := admin.QueryRow(ctx, `INSERT INTO rooms (public_code, host_user_id, workspace_type) VALUES ($1, $2, 'personal_workspace') RETURNING id::text`, code, userID).Scan(&roomID); err != nil {
		t.Fatal(err)
	}

	store := NewPgxSessionStore(app)
	joined := time.Now().UTC().Add(-time.Minute).Truncate(time.Second)
	ev := SessionEvent{
		EventID: "EV_" + uuid.NewString(), EventType: webhook.EventParticipantJoined, RoomName: code,
		ParticipantSID: "PA_1", Identity: "user:" + userID, JoinedAt: joined, OccurredAt: joined,
	}

	if err := store.Apply(ctx, ev); err != nil {
		t.Fatalf("room must be visible to %s, got: %v", role, err)
	}
	if err := store.Apply(ctx, ev); err != nil {
		t.Fatalf("duplicate delivery: %v", err)
	}
	var sessions int
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM participant_media_sessions WHERE room_id = $1`, roomID).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if sessions != 1 {
		t.Fatalf("expected one session after duplicate delivery, got %d", sessions)
	}

	unknown := SessionEvent{EventID: "EV_" + uuid.NewString(), EventType: webhook.EventRoomFinished, RoomName: "missing-" + code, OccurredAt: joined}
	if err := store.Apply(ctx, unknown); !errors.Is(err, ErrUnknownRoom) {
		t.Fatalf("expected ErrUnknownRoom, got %v", err)
	}
	var outcome string
	if err := admin.QueryRow(ctx, `SELECT outcome FROM livekit_webhook_events WHERE event_id = $1`, unknown.EventID).Scan(&outcome); err != nil {
		t.Fatalf("unknown room left no durable trace: %v", err)
	}
	if outcome != "unknown_room" {
		t.Fatalf("unexpected outcome %q", outcome)
	}
}
