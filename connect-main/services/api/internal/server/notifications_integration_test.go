package server_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/room"
	"github.com/tathastu/connect/services/api/internal/worker"
)

// TestWorkflowDB_Notifications schedules through the API as connect_app and runs the jobs it
// enqueued as connect_worker, then reads the results as each person.
func TestWorkflowDB_Notifications(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	open := func(name string) *pgxpool.Pool {
		url := os.Getenv(name)
		if url == "" {
			t.Skipf("NOT VERIFIED: %s is required", name)
		}
		p, err := pgxpool.New(ctx, url)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(p.Close)
		return p
	}
	admin, app, workerPool := open("TEST_DATABASE_URL"), open("TEST_CONNECT_APP_URL"), open("TEST_CONNECT_WORKER_URL")
	room.SetGuestTokenSecret([]byte("notifications-integration-secret-012345"))
	t.Cleanup(room.ResetGuestTokenSecretForTest)
	api := apiClient{t: t, router: newRuntimeRouter(t, app, nil)}

	person := func(org, role string) (string, caller) {
		t.Helper()
		id, token := api.signup()
		if org != "" {
			if _, err := admin.Exec(ctx, `INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`, org, id, role); err != nil {
				t.Fatal(err)
			}
		}
		return id, caller{token: token}
	}
	var org string
	if err := admin.QueryRow(ctx, `INSERT INTO organizations (slug, name) VALUES ($1, 'Tenant') RETURNING id::text`, "notify-"+uuid.NewString()[:8]).Scan(&org); err != nil {
		t.Fatal(err)
	}
	_, adminUser := person(org, "institution_admin")
	facultyID, faculty := person(org, "faculty")
	studentID, student := person(org, "student")
	_, otherStudent := person(org, "student")
	_, outsider := person("", "")

	base := "/api/v1/organizations/" + org
	dept := field(api.want("dept", http.StatusCreated, http.MethodPost, base+"/departments", adminUser, map[string]any{"code": "N", "name": "N"}), "department", "id")
	course := field(api.want("course", http.StatusCreated, http.MethodPost, base+"/courses", adminUser, map[string]any{"departmentId": dept, "code": "N1", "title": "T"}), "course", "id")
	batch := field(api.want("batch", http.StatusCreated, http.MethodPost, base+"/batches", adminUser, map[string]any{"courseId": course, "name": "A", "academicTerm": "T", "startDate": "2020-01-01", "endDate": "2035-01-01"}), "batch", "id")
	allocation := field(api.want("allocation", http.StatusCreated, http.MethodPost, base+"/allocations", adminUser, map[string]any{"courseId": course, "facultyUserId": facultyID}), "allocation", "id")
	api.want("enroll", http.StatusCreated, http.MethodPost, base+"/enrollments", adminUser, map[string]any{"batchId": batch, "studentUserId": studentID})

	start := time.Now().Add(72 * time.Hour).UTC().Truncate(time.Second)
	res := api.want("schedule", http.StatusCreated, http.MethodPost, base+"/sessions", adminUser, map[string]any{
		"courseId": course, "batchId": batch, "facultyAllocationId": allocation, "title": "Algebra", "timeZone": "Asia/Kolkata",
		"start": start.Format(time.RFC3339), "end": start.Add(time.Hour).Format(time.RFC3339),
	})
	session := rowsOf(res, "sessions")[0]["id"].(string)

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	sessionHandler := worker.NewNotifySessionHandler(workerPool, logger)
	userHandler := worker.NewNotifyUserHandler(workerPool)
	// Runs the stored job, the way the queue would, and returns its payload.
	runJob := func(key string, scheduledAtFuture bool) {
		t.Helper()
		var payload []byte
		var runAt time.Time
		if err := admin.QueryRow(ctx, `SELECT payload, scheduled_at FROM background_jobs WHERE idempotency_key = $1`, key).Scan(&payload, &runAt); err != nil {
			t.Fatalf("job %s: %v", key, err)
		}
		if scheduledAtFuture != runAt.After(time.Now()) {
			t.Errorf("job %s is scheduled at %v", key, runAt)
		}
		var parsed struct {
			Type string `json:"type"`
		}
		_ = json.Unmarshal(payload, &parsed)
		handler := sessionHandler
		if parsed.Type == worker.TypeNotifyUser {
			handler = userHandler
		}
		if err := handler(ctx, &worker.Job{ID: uuid.New(), Payload: payload}); err != nil {
			t.Fatalf("job %s: %v", key, err)
		}
	}
	list := func(who caller) []map[string]any {
		t.Helper()
		return rowsOf(api.want("list", http.StatusOK, http.MethodGet, "/api/v1/notifications", who, nil), "notifications")
	}
	keyFor := func(event string, at time.Time) string {
		return "notify-session-" + session + "-" + event + "-" + itoa(at.Unix())
	}

	t.Run("scheduling notifies the class and nobody else", func(t *testing.T) {
		runJob(keyFor(worker.NotifySessionScheduled, start), false)
		for name, who := range map[string]caller{"student": student, "faculty": faculty} {
			rows := list(who)
			if len(rows) != 1 || rows[0]["title"] != "New class scheduled" || rows[0]["link"] == nil {
				t.Errorf("%s: %v", name, rows)
			}
		}
		for name, who := range map[string]caller{"other student": otherStudent, "outsider": outsider, "admin": adminUser} {
			if rows := list(who); len(rows) != 0 {
				t.Errorf("%s was notified: %v", name, rows)
			}
		}
	})

	t.Run("retries and duplicate delivery do not repeat a notice", func(t *testing.T) {
		runJob(keyFor(worker.NotifySessionScheduled, start), false)
		if rows := list(student); len(rows) != 1 {
			t.Errorf("a retry repeated the notice: %v", rows)
		}
	})

	t.Run("a reminder is held until shortly before the class, and only for the current start", func(t *testing.T) {
		var runAt time.Time
		if err := admin.QueryRow(ctx, `SELECT scheduled_at FROM background_jobs WHERE idempotency_key = $1`, keyFor(worker.NotifySessionReminder, start)).Scan(&runAt); err != nil {
			t.Fatal(err)
		}
		if !runAt.Equal(start.Add(-worker.ReminderLead)) {
			t.Errorf("reminder scheduled at %v for a class at %v", runAt, start)
		}
		moved := start.Add(2 * time.Hour)
		api.want("reschedule", http.StatusOK, http.MethodPatch, base+"/sessions/"+session, faculty, map[string]any{"start": moved.Format(time.RFC3339), "end": moved.Add(time.Hour).Format(time.RFC3339)})
		runJob(keyFor(worker.NotifySessionRescheduled, moved), false)
		rows := list(student)
		if len(rows) != 2 || rows[0]["title"] != "Class rescheduled" {
			t.Errorf("after reschedule: %v", rows)
		}
		// The reminder for the old time does nothing; the one for the new time delivers.
		runJob(keyFor(worker.NotifySessionReminder, start), true)
		if rows := list(student); len(rows) != 2 {
			t.Errorf("a stale reminder was delivered: %v", rows)
		}
		runJob(keyFor(worker.NotifySessionReminder, moved), true)
		rows = list(student)
		if len(rows) != 3 || rows[0]["title"] != "Class starting soon" {
			t.Errorf("after reminder: %v", rows)
		}
		api.want("cancel", http.StatusOK, http.MethodPost, base+"/sessions/"+session+"/cancel", faculty, nil)
		var cancelKey string
		if err := admin.QueryRow(ctx, `SELECT idempotency_key FROM background_jobs WHERE idempotency_key LIKE $1`, "notify-session-"+session+"-cancelled-%").Scan(&cancelKey); err != nil {
			t.Fatal(err)
		}
		runJob(cancelKey, false)
		if rows := list(student); len(rows) != 4 || rows[0]["title"] != "Class cancelled" {
			t.Errorf("after cancel: %v", rows)
		}
	})

	t.Run("people read and mark only their own", func(t *testing.T) {
		rows := list(student)
		id := rows[0]["id"].(string)
		api.want("another person", http.StatusNotFound, http.MethodPost, "/api/v1/notifications/"+id+"/read", otherStudent, nil)
		api.want("bad id", http.StatusNotFound, http.MethodPost, "/api/v1/notifications/not-a-uuid/read", student, nil)
		api.want("anonymous", http.StatusUnauthorized, http.MethodGet, "/api/v1/notifications", caller{}, nil)
		res := api.want("unread", http.StatusOK, http.MethodGet, "/api/v1/notifications?unread=true", student, nil)
		if res["unread"] != float64(4) {
			t.Errorf("unread: %v", res["unread"])
		}
		api.want("read one", http.StatusOK, http.MethodPost, "/api/v1/notifications/"+id+"/read", student, nil)
		res = api.want("unread after", http.StatusOK, http.MethodGet, "/api/v1/notifications", student, nil)
		if res["unread"] != float64(3) {
			t.Errorf("unread after one: %v", res["unread"])
		}
		api.want("page", http.StatusBadRequest, http.MethodGet, "/api/v1/notifications?before=-1", student, nil)
		api.want("read all", http.StatusOK, http.MethodPost, "/api/v1/notifications/read-all", student, nil)
		res = api.want("unread none", http.StatusOK, http.MethodGet, "/api/v1/notifications", student, nil)
		if res["unread"] != float64(0) {
			t.Errorf("unread after all: %v", res["unread"])
		}
		if rows := list(faculty); len(rows) == 0 || rows[0]["readAt"] != nil {
			t.Errorf("marking one person's read changed another's: %v", rows)
		}
	})

	t.Run("the database refuses what the API role must not do", func(t *testing.T) {
		var visible int
		if err := app.QueryRow(ctx, `SELECT count(*) FROM notifications`).Scan(&visible); err != nil || visible != 0 {
			t.Errorf("no context sees %d, err=%v", visible, err)
		}
		if _, err := app.Exec(ctx, `INSERT INTO notifications (user_id, kind, title, dedupe_key) VALUES ($1, 'x', 'x', 'x')`, studentID); err == nil {
			t.Error("the API role created a notification")
		}
		if _, err := app.Exec(ctx, `SELECT connect_auth.notify_session_people($1::UUID, 'x', 'x', 'x', 'x')`, session); err == nil {
			t.Error("the API role sent a class notification")
		}
	})
}

func itoa(value int64) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}
