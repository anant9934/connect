package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/livekit/protocol/webhook"
	"github.com/tathastu/connect/services/api/internal/attendance"
)

type workflowTenant struct {
	orgID, batchID, sessionID, roomID, roomCode, facultyID string
}

func workflowPool(t *testing.T, ctx context.Context, env string) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv(env)
	if url == "" {
		t.Skipf("NOT VERIFIED: %s is required", env)
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func addMember(t *testing.T, ctx context.Context, admin *pgxpool.Pool, orgID, role string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := admin.Exec(ctx, `INSERT INTO users (id, email_normalized, display_name, password_hash) VALUES ($1, $2, 'Member', 'x')`, id, id+"@example.test"); err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, `INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`, orgID, id, role); err != nil {
		t.Fatal(err)
	}
	return id
}

func addTenant(t *testing.T, ctx context.Context, admin *pgxpool.Pool, start, end time.Time) workflowTenant {
	t.Helper()
	suffix := uuid.NewString()[:8]
	w := workflowTenant{roomCode: "wf-" + suffix}
	if err := admin.QueryRow(ctx, `INSERT INTO organizations (slug, name) VALUES ($1, 'Tenant') RETURNING id::text`, "org-"+suffix).Scan(&w.orgID); err != nil {
		t.Fatal(err)
	}
	w.facultyID = addMember(t, ctx, admin, w.orgID, "faculty")

	var deptID, courseID, allocationID string
	steps := []struct {
		query string
		dest  *string
		args  []any
	}{
		{`INSERT INTO departments (organization_id, code, name) VALUES ($1, 'CS', 'CS') RETURNING id::text`, &deptID, []any{w.orgID}},
		{`INSERT INTO courses (organization_id, department_id, code, title) VALUES ($1, $2, 'CS1', 'CS1') RETURNING id::text`, &courseID, nil},
		{`INSERT INTO course_batches (organization_id, course_id, name, academic_term, start_date, end_date) VALUES ($1, $2, 'A', 'T1', '2025-01-01', '2027-01-01') RETURNING id::text`, &w.batchID, nil},
		{`INSERT INTO faculty_allocations (organization_id, course_id, faculty_user_id, effective_from) VALUES ($1, $2, $3, '2025-01-01') RETURNING id::text`, &allocationID, nil},
		{`INSERT INTO class_sessions (organization_id, course_id, batch_id, faculty_allocation_id, title, scheduled_start, scheduled_end) VALUES ($1, $2, $3, $4, 'Class', $5, $6) RETURNING id::text`, &w.sessionID, nil},
		{`INSERT INTO rooms (public_code, host_user_id, organization_id, class_session_id, workspace_type) VALUES ($1, $2, $3, $4, 'institutional') RETURNING id::text`, &w.roomID, nil},
	}
	steps[1].args = []any{w.orgID, &deptID}
	steps[2].args = []any{w.orgID, &courseID}
	steps[3].args = []any{w.orgID, &courseID, w.facultyID}
	steps[4].args = []any{w.orgID, &courseID, &w.batchID, &allocationID, start, end}
	steps[5].args = []any{w.roomCode, w.facultyID, w.orgID, &w.sessionID}
	for i, s := range steps {
		if err := admin.QueryRow(ctx, s.query, s.args...).Scan(s.dest); err != nil {
			t.Fatalf("fixture step %d: %v", i, err)
		}
	}
	return w
}

func enroll(t *testing.T, ctx context.Context, admin *pgxpool.Pool, w workflowTenant) string {
	t.Helper()
	id := addMember(t, ctx, admin, w.orgID, "student")
	if _, err := admin.Exec(ctx, `INSERT INTO course_enrollments (organization_id, batch_id, student_user_id, enrolled_at) VALUES ($1, $2, $3, '2025-01-01')`, w.orgID, w.batchID, id); err != nil {
		t.Fatal(err)
	}
	return id
}

// TestWorkflowDB_ClassSessionAttendance drives webhook events as connect_app and
// reconciliation as connect_worker, with fixtures created by the admin connection.
func TestWorkflowDB_ClassSessionAttendance(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	admin := workflowPool(t, ctx, "TEST_DATABASE_URL")
	app := workflowPool(t, ctx, "TEST_CONNECT_APP_URL")
	workerPool := workflowPool(t, ctx, "TEST_CONNECT_WORKER_URL")

	// A fixed non-UTC offset proves evaluation depends on instants, not zones.
	ist := time.FixedZone("IST", 5*3600+1800)
	start := time.Date(2026, 1, 5, 10, 0, 0, 0, ist)
	end := start.Add(time.Hour)

	a := addTenant(t, ctx, admin, start, end)
	b := addTenant(t, ctx, admin, start, end)
	present, late, reconnected, absent := enroll(t, ctx, admin, a), enroll(t, ctx, admin, a), enroll(t, ctx, admin, a), enroll(t, ctx, admin, a)
	notEnrolled := addMember(t, ctx, admin, a.orgID, "student")
	bStudent := enroll(t, ctx, admin, b)

	if _, err := admin.Exec(ctx, `INSERT INTO attendance_policies (organization_id, version, min_present_ratio, min_partial_ratio, late_grace_seconds) VALUES ($1, 1, 0.5, 0.2, 60), ($1, 2, 0.75, 0.40, 300)`, a.orgID); err != nil {
		t.Fatal(err)
	}

	store := attendance.NewPgxSessionStore(app)
	send := func(evType, sid, userID string, joined, at time.Time) attendance.SessionEvent {
		t.Helper()
		ev := attendance.SessionEvent{
			EventID: "EV_" + uuid.NewString(), EventType: evType, RoomName: a.roomCode,
			ParticipantSID: sid, Identity: "user:" + userID, JoinedAt: joined, OccurredAt: at,
		}
		if err := store.Apply(ctx, ev); err != nil {
			t.Fatalf("webhook %s %s: %v", evType, sid, err)
		}
		return ev
	}
	m := func(n int) time.Time { return start.Add(time.Duration(n) * time.Minute) }

	joined := send(webhook.EventParticipantJoined, "PA_present", present, m(0), m(0))
	if err := store.Apply(ctx, joined); err != nil {
		t.Fatalf("duplicate delivery: %v", err)
	}
	send(webhook.EventParticipantLeft, "PA_present", present, m(0), m(60))
	send(webhook.EventParticipantLeft, "PA_late", late, m(10), m(60))
	// Disconnect and reconnect: overlapping sessions must not inflate the total.
	send(webhook.EventParticipantLeft, "PA_rc1", reconnected, m(0), m(35))
	send(webhook.EventParticipantLeft, "PA_rc2", reconnected, m(30), m(60))
	send(webhook.EventParticipantLeft, "PA_outsider", notEnrolled, m(0), m(60))
	send(webhook.EventRoomFinished, "", "", m(60), m(60))

	var sessions int
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM participant_media_sessions WHERE room_id = $1 AND participant_sid = 'PA_present'`, a.roomID).Scan(&sessions); err != nil || sessions != 1 {
		t.Fatalf("duplicate webhook created %d sessions, err=%v", sessions, err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	data, _ := json.Marshal(AttendanceReconcileData{RoomID: a.roomID, Before: end})
	payload, _ := json.Marshal(JobPayload{Type: TypeAttendanceReconcile, Data: data})
	run := func() error {
		return NewAttendanceReconcileHandler(workerPool, logger)(ctx, &Job{ID: uuid.New(), Payload: payload})
	}

	// A failure on one student must fail the job and leave no partial records.
	failTrigger := fmt.Sprintf(`
		CREATE FUNCTION wf_fail() RETURNS trigger LANGUAGE plpgsql AS $f$
		BEGIN IF NEW.student_user_id = '%s' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $f$;
		CREATE TRIGGER wf_fail BEFORE INSERT ON attendance_records FOR EACH ROW EXECUTE FUNCTION wf_fail();`, absent)
	if _, err := admin.Exec(ctx, failTrigger); err != nil {
		t.Fatal(err)
	}
	failErr := run()
	if _, err := admin.Exec(ctx, `DROP TRIGGER wf_fail ON attendance_records; DROP FUNCTION wf_fail();`); err != nil {
		t.Fatal(err)
	}
	if failErr == nil {
		t.Fatal("job must fail when a student cannot be recorded")
	}
	count := func(q string, args ...any) int {
		t.Helper()
		var n int
		if err := admin.QueryRow(ctx, q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(`SELECT count(*) FROM attendance_records WHERE class_session_id = $1`, a.sessionID); n != 0 {
		t.Fatalf("failed job left %d partial records", n)
	}

	// Retry succeeds as the restricted worker role.
	if err := run(); err != nil {
		t.Fatalf("reconcile as connect_worker: %v", err)
	}

	want := map[string]struct {
		seconds int
		status  string
	}{
		present:     {3600, "present"},
		late:        {3000, "late"},
		reconnected: {3600, "present"},
		absent:      {0, "absent"},
	}
	rows, err := admin.Query(ctx, `SELECT student_user_id::text, total_connected_seconds, attendance_status, policy_version FROM attendance_records WHERE class_session_id = $1`, a.sessionID)
	if err != nil {
		t.Fatal(err)
	}
	got := 0
	for rows.Next() {
		var id, status string
		var seconds int
		var version *int
		if err := rows.Scan(&id, &seconds, &status, &version); err != nil {
			t.Fatal(err)
		}
		w, ok := want[id]
		if !ok {
			t.Errorf("unexpected record for non-enrolled user %s", id)
			continue
		}
		if seconds != w.seconds || status != w.status || version == nil || *version != 2 {
			t.Errorf("student %s: got %d/%s/v%v, want %d/%s/v2", id, seconds, status, version, w.seconds, w.status)
		}
		got++
	}
	rows.Close()
	if got != len(want) {
		t.Fatalf("expected %d records, got %d", len(want), got)
	}

	// Re-running is idempotent and never overwrites a faculty overrule.
	if _, err := admin.Exec(ctx, `UPDATE attendance_records SET attendance_status = 'present', is_overruled = true WHERE class_session_id = $1 AND student_user_id = $2`, a.sessionID, absent); err != nil {
		t.Fatal(err)
	}
	if err := run(); err != nil {
		t.Fatalf("re-run: %v", err)
	}
	if n := count(`SELECT count(*) FROM attendance_records WHERE class_session_id = $1`, a.sessionID); n != len(want) {
		t.Fatalf("re-run changed record count to %d", n)
	}
	if n := count(`SELECT count(*) FROM attendance_records WHERE student_user_id = $1 AND attendance_status = 'present' AND is_overruled`, absent); n != 1 {
		t.Fatal("re-run overwrote a faculty overrule")
	}

	// Tenant B is untouched, and its student cannot be linked to tenant A.
	if n := count(`SELECT count(*) FROM attendance_records WHERE class_session_id = $1 OR student_user_id = $2`, b.sessionID, bStudent); n != 0 {
		t.Fatalf("tenant B gained %d records", n)
	}
	if _, err := admin.Exec(ctx, `INSERT INTO attendance_records (organization_id, batch_id, class_session_id, student_user_id) VALUES ($1, $2, $3, $4)`, a.orgID, a.batchID, a.sessionID, bStudent); err == nil {
		t.Fatal("database accepted a record for a student of another tenant")
	}
	if _, err := admin.Exec(ctx, `UPDATE rooms SET class_session_id = $1 WHERE id = $2`, b.sessionID, a.roomID); err == nil {
		t.Fatal("database linked a room to another tenant's class session")
	}

	// The API role with no auth context can neither read nor write attendance.
	var visible int
	if err := app.QueryRow(ctx, `SELECT count(*) FROM attendance_records`).Scan(&visible); err != nil {
		t.Fatal(err)
	}
	if visible != 0 {
		t.Fatalf("connect_app without context read %d attendance records", visible)
	}
	if _, err := app.Exec(ctx, `INSERT INTO attendance_records (organization_id, batch_id, class_session_id, student_user_id) VALUES ($1, $2, $3, $4)`, a.orgID, a.batchID, a.sessionID, notEnrolled); err == nil {
		t.Fatal("connect_app without context inserted attendance")
	}
}
