package worker

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
)

// TestWorkflowDB_HostSuccession covers a host who vanishes, a host who reconnects within the
// grace period, a co-host who disconnected, and a room with nobody eligible.
func TestWorkflowDB_HostSuccession(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin := workflowPool(t, ctx, "TEST_DATABASE_URL")
	app := workflowPool(t, ctx, "TEST_CONNECT_APP_URL")
	workerPool := workflowPool(t, ctx, "TEST_CONNECT_WORKER_URL")

	addUser := func() string {
		t.Helper()
		id := uuid.NewString()
		if _, err := admin.Exec(ctx, `INSERT INTO users (id, email_normalized, display_name, password_hash) VALUES ($1, $2, 'U', 'x')`, id, id+"@example.test"); err != nil {
			t.Fatal(err)
		}
		return id
	}
	addRoom := func(host string) string {
		t.Helper()
		var id string
		if err := admin.QueryRow(ctx, `INSERT INTO rooms (public_code, host_user_id, workspace_type) VALUES ($1, $2, 'personal_commons') RETURNING id::text`, "HS"+uuid.NewString()[:8], host).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	join := func(room, user, role string, joined time.Time) {
		t.Helper()
		if _, err := admin.Exec(ctx, `INSERT INTO room_participants (room_id, user_id, identity, display_name, role, joined_at) VALUES ($1, $2, $3, 'P', $4, $5)`, room, user, "user:"+user, role, joined); err != nil {
			t.Fatal(err)
		}
	}
	session := func(room, user string, leftAt *time.Time) {
		t.Helper()
		if _, err := admin.Exec(ctx, `INSERT INTO participant_media_sessions (room_id, participant_sid, identity, user_id, joined_at, left_at) VALUES ($1, $2, $3, $4, $5, $6)`,
			room, "PA_"+uuid.NewString()[:8], "user:"+user, user, time.Now().Add(-time.Hour), leftAt); err != nil {
			t.Fatal(err)
		}
	}
	runHandler := func(room string) {
		t.Helper()
		handler := NewHostSuccessionHandler(workerPool, slog.New(slog.NewTextHandler(io.Discard, nil)))
		payload := []byte(`{"type":"room.host_succession","data":{"roomId":"` + room + `"}}`)
		if err := handler(ctx, &Job{ID: uuid.New(), Payload: payload}); err != nil {
			t.Fatal(err)
		}
	}
	hostOf := func(room string) string {
		t.Helper()
		var host string
		if err := admin.QueryRow(ctx, `SELECT host_user_id::text FROM rooms WHERE id = $1`, room).Scan(&host); err != nil {
			t.Fatal(err)
		}
		return host
	}
	now := time.Now()
	left := now.Add(-time.Minute)

	t.Run("earliest connected co-host takes over", func(t *testing.T) {
		host, gone, first, second := addUser(), addUser(), addUser(), addUser()
		room := addRoom(host)
		join(room, host, "host", now.Add(-4*time.Hour))
		join(room, gone, "co-host", now.Add(-3*time.Hour))
		join(room, first, "co-host", now.Add(-2*time.Hour))
		join(room, second, "co-host", now.Add(-time.Hour))
		session(room, host, &left)
		session(room, gone, &left) // co-host disconnected: skipped
		session(room, first, nil)
		session(room, second, nil)

		runHandler(room)
		if got := hostOf(room); got != first {
			t.Fatalf("expected %s to take over, got %s", first, got)
		}
		var hostRows, oldRole string
		if err := admin.QueryRow(ctx, `SELECT role FROM room_participants WHERE room_id = $1 AND identity = $2`, room, "user:"+first).Scan(&hostRows); err != nil || hostRows != "host" {
			t.Fatalf("new host role %q, err=%v", hostRows, err)
		}
		if err := admin.QueryRow(ctx, `SELECT role FROM room_participants WHERE room_id = $1 AND identity = $2`, room, "user:"+host).Scan(&oldRole); err != nil || oldRole != "participant" {
			t.Fatalf("old host role %q, err=%v", oldRole, err)
		}
		var audits int
		if err := admin.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE event_type = 'room.host_succeeded' AND metadata->>'room_id' = $1`, room).Scan(&audits); err != nil || audits != 1 {
			t.Fatalf("expected one audit event, got %d, err=%v", audits, err)
		}
	})

	t.Run("host who reconnected keeps the meeting", func(t *testing.T) {
		host, co := addUser(), addUser()
		room := addRoom(host)
		join(room, host, "host", now)
		join(room, co, "co-host", now)
		session(room, host, &left)
		session(room, host, nil) // a new SID after reconnecting
		session(room, co, nil)
		runHandler(room)
		if got := hostOf(room); got != host {
			t.Fatalf("reconnected host lost the meeting to %s", got)
		}
	})

	t.Run("no eligible co-host leaves ownership in place", func(t *testing.T) {
		host, member := addUser(), addUser()
		room := addRoom(host)
		join(room, host, "host", now)
		join(room, member, "participant", now)
		session(room, host, &left)
		session(room, member, nil)
		runHandler(room)
		if got := hostOf(room); got != host {
			t.Fatalf("a regular participant became host: %s", got)
		}
	})

	t.Run("enqueue only reacts to the host", func(t *testing.T) {
		host, member := addUser(), addUser()
		room := addRoom(host)
		count := func() int {
			t.Helper()
			var n int
			if err := admin.QueryRow(ctx, `SELECT count(*) FROM background_jobs WHERE idempotency_key LIKE $1`, "host-succession-"+room+"%").Scan(&n); err != nil {
				t.Fatal(err)
			}
			return n
		}
		if _, err := app.Exec(ctx, `SELECT connect_auth.enqueue_host_succession($1::UUID, $2, 60)`, room, "user:"+member); err != nil {
			t.Fatal(err)
		}
		if n := count(); n != 0 {
			t.Fatalf("a participant leaving enqueued %d jobs", n)
		}
		for range 2 {
			if _, err := app.Exec(ctx, `SELECT connect_auth.enqueue_host_succession($1::UUID, $2, 60)`, room, "user:"+host); err != nil {
				t.Fatal(err)
			}
		}
		if n := count(); n < 1 || n > 2 {
			t.Fatalf("host leaving enqueued %d jobs", n)
		}
	})
}
