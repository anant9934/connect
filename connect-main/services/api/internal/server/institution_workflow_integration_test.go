package server_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/room"
	"github.com/tathastu/connect/services/api/internal/worker"
)

func field(res map[string]any, key, name string) string {
	object, _ := res[key].(map[string]any)
	value, _ := object[name].(string)
	return value
}

func rowsOf(res map[string]any, key string) []map[string]any {
	list, _ := res[key].([]any)
	out := make([]map[string]any, 0, len(list))
	for _, item := range list {
		if row, ok := item.(map[string]any); ok {
			out = append(out, row)
		}
	}
	return out
}

// TestWorkflowDB_InstitutionWorkflow walks institution, course, faculty, enrollment, recurring
// class, meeting, attendance and report with two tenants, using connect_app and connect_worker.
func TestWorkflowDB_InstitutionWorkflow(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
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

	room.SetGuestTokenSecret([]byte("institution-integration-secret-01234567"))
	t.Cleanup(room.ResetGuestTokenSecretForTest)
	api := apiClient{t: t, router: newRuntimeRouter(t, app, nil)}

	person := func() (id, email string, who caller) {
		t.Helper()
		userID, token := api.signup()
		if err := admin.QueryRow(ctx, `SELECT email_normalized FROM users WHERE id = $1`, userID).Scan(&email); err != nil {
			t.Fatal(err)
		}
		return userID, email, caller{token: token}
	}

	superID, _, super := person()
	if _, err := admin.Exec(ctx, `INSERT INTO platform_administrators (user_id, role) VALUES ($1, 'platform_super_admin')`, superID); err != nil {
		t.Fatal(err)
	}
	_, adminEmailA, adminA := person()
	_, adminEmailB, adminB := person()
	facultyID, facultyEmail, faculty := person()
	studentID, studentEmail, student := person()
	otherID, otherEmail, otherStudent := person()
	_, _, unaffiliated := person()

	api.want("non admin creates organization", http.StatusForbidden, http.MethodPost, "/api/v1/organizations", adminA, map[string]any{"slug": "x", "name": "X", "adminEmail": adminEmailA})
	stamp := time.Now().Format("150405.000")
	stamp = strings.ReplaceAll(stamp, ".", "")
	res := api.want("create A", http.StatusCreated, http.MethodPost, "/api/v1/organizations", super, map[string]any{"slug": "a-" + stamp, "name": "Tenant A", "adminEmail": adminEmailA})
	orgA := field(res, "organization", "id")
	res = api.want("create B", http.StatusCreated, http.MethodPost, "/api/v1/organizations", super, map[string]any{"slug": "b-" + stamp, "name": "Tenant B", "adminEmail": adminEmailB})
	orgB := field(res, "organization", "id")
	base, baseB := "/api/v1/organizations/"+orgA, "/api/v1/organizations/"+orgB

	res = api.want("my organizations", http.StatusOK, http.MethodGet, "/api/v1/organizations", adminA, nil)
	if list := rowsOf(res, "organizations"); len(list) != 1 || list[0]["id"] != orgA || list[0]["role"] != "institution_admin" {
		t.Fatalf("my organizations: %v", res)
	}

	add := func(email, role string) {
		t.Helper()
		api.want("add "+role, http.StatusCreated, http.MethodPost, base+"/members", adminA, map[string]any{"email": email, "role": role})
	}
	api.want("unknown email", http.StatusNotFound, http.MethodPost, base+"/members", adminA, map[string]any{"email": "nobody@example.test", "role": "student"})
	api.want("bad role", http.StatusBadRequest, http.MethodPost, base+"/members", adminA, map[string]any{"email": facultyEmail, "role": "root"})
	api.want("other tenant adds member", http.StatusForbidden, http.MethodPost, base+"/members", adminB, map[string]any{"email": facultyEmail, "role": "faculty"})
	add(facultyEmail, "faculty")
	add(studentEmail, "student")
	add(otherEmail, "student")
	api.want("duplicate member", http.StatusConflict, http.MethodPost, base+"/members", adminA, map[string]any{"email": studentEmail, "role": "student"})
	api.want("student lists members", http.StatusForbidden, http.MethodGet, base+"/members", student, nil)
	if list := rowsOf(api.want("admin lists members", http.StatusOK, http.MethodGet, base+"/members", adminA, nil), "members"); len(list) != 4 {
		t.Errorf("expected 4 members, got %d", len(list))
	}

	api.want("faculty creates department", http.StatusForbidden, http.MethodPost, base+"/departments", faculty, map[string]any{"code": "CS", "name": "CS"})
	res = api.want("department", http.StatusCreated, http.MethodPost, base+"/departments", adminA, map[string]any{"code": "CS", "name": "Computing"})
	dept := field(res, "department", "id")
	api.want("duplicate department", http.StatusConflict, http.MethodPost, base+"/departments", adminA, map[string]any{"code": "CS", "name": "Again"})
	res = api.want("course", http.StatusCreated, http.MethodPost, base+"/courses", adminA, map[string]any{"departmentId": dept, "code": "CS101", "title": "Programming"})
	course := field(res, "course", "id")
	res = api.want("batch", http.StatusCreated, http.MethodPost, base+"/batches", adminA, map[string]any{"courseId": course, "name": "A", "academicTerm": "2026", "startDate": "2020-01-01", "endDate": "2030-12-31"})
	batch := field(res, "batch", "id")

	// Isolation between tenants
	for name, path := range map[string]string{"departments": "/departments", "courses": "/courses", "batches": "/batches", "enrollments": "/enrollments", "sessions": "/sessions", "policies": "/attendance-policies"} {
		api.want("other tenant reads "+name, http.StatusForbidden, http.MethodGet, base+path, adminB, nil)
		api.want("unaffiliated reads "+name, http.StatusForbidden, http.MethodGet, base+path, unaffiliated, nil)
	}
	api.want("reference across tenants", http.StatusBadRequest, http.MethodPost, baseB+"/courses", adminB, map[string]any{"departmentId": dept, "code": "X1", "title": "Stolen"})
	api.want("anonymous", http.StatusUnauthorized, http.MethodGet, base+"/courses", caller{}, nil)

	// Faculty and enrollment rules
	api.want("assign non-member as faculty", http.StatusBadRequest, http.MethodPost, base+"/allocations", adminA, map[string]any{"courseId": course, "facultyUserId": superID})
	res = api.want("assign faculty", http.StatusCreated, http.MethodPost, base+"/allocations", adminA, map[string]any{"courseId": course, "facultyUserId": facultyID})
	allocation := field(res, "allocation", "id")
	// The membership trigger runs before RLS and cannot lock the row for a student, so this is a 400.
	api.want("student enrolls self", http.StatusBadRequest, http.MethodPost, base+"/enrollments", student, map[string]any{"batchId": batch, "studentUserId": studentID})
	var selfEnrolled int
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM course_enrollments WHERE student_user_id = $1`, studentID).Scan(&selfEnrolled); err != nil || selfEnrolled != 0 {
		t.Fatalf("refused enrollment was stored: %d, err=%v", selfEnrolled, err)
	}
	api.want("enroll non-member", http.StatusBadRequest, http.MethodPost, base+"/enrollments", adminA, map[string]any{"batchId": batch, "studentUserId": superID})
	res = api.want("enroll", http.StatusCreated, http.MethodPost, base+"/enrollments", adminA, map[string]any{"batchId": batch, "studentUserId": studentID})
	if field(res, "enrollment", "status") != "enrolled" {
		t.Errorf("enrollment: %v", res)
	}

	// Recurring classes: three Mondays in India, which has no daylight saving.
	ist, _ := time.LoadLocation("Asia/Kolkata")
	monday := time.Now().In(ist).AddDate(0, 0, 7)
	for monday.Weekday() != time.Monday {
		monday = monday.AddDate(0, 0, 1)
	}
	start := time.Date(monday.Year(), monday.Month(), monday.Day(), 10, 0, 0, 0, ist)
	end := start.Add(time.Hour)
	body := map[string]any{
		"courseId": course, "batchId": batch, "facultyAllocationId": allocation, "title": "Lecture", "timeZone": "Asia/Kolkata",
		"start": start.Format(time.RFC3339), "end": end.Format(time.RFC3339),
		"recurrence": map[string]any{"weekdays": []int{1}, "until": start.AddDate(0, 0, 14).Format("2006-01-02")},
	}
	api.want("student schedules", http.StatusForbidden, http.MethodPost, base+"/sessions", student, body)
	res = api.want("faculty schedules", http.StatusCreated, http.MethodPost, base+"/sessions", faculty, body)
	sessions := rowsOf(res, "sessions")
	if len(sessions) != 3 {
		t.Fatalf("expected 3 classes, got %v", res)
	}
	first := sessions[0]
	sessionID, _ := first["id"].(string)
	code, _ := first["roomCode"].(string)
	if first["seriesId"] == nil || code == "" {
		t.Fatalf("session lacks series or room: %v", first)
	}

	overlap := map[string]any{"courseId": course, "batchId": batch, "facultyAllocationId": allocation, "title": "Clash", "timeZone": "Asia/Kolkata",
		"start": start.Add(30 * time.Minute).Format(time.RFC3339), "end": end.Add(30 * time.Minute).Format(time.RFC3339)}
	api.want("conflict", http.StatusConflict, http.MethodPost, base+"/sessions", adminA, overlap)
	noConflicts := func(n int, who caller, name string) {
		t.Helper()
		list := rowsOf(api.want(name, http.StatusOK, http.MethodGet, base+"/sessions", who, nil), "sessions")
		if len(list) != n {
			t.Errorf("%s: expected %d classes, got %d", name, n, len(list))
		}
	}
	noConflicts(3, faculty, "faculty calendar")
	noConflicts(3, student, "enrolled student calendar")
	noConflicts(0, otherStudent, "other student calendar")

	// Rescheduling and cancelling
	moved := start.Add(2 * time.Hour)
	// A row the caller may not update is invisible to FOR UPDATE, so these read as not found.
	api.want("student reschedules", http.StatusNotFound, http.MethodPatch, base+"/sessions/"+sessionID, student, map[string]any{"start": moved.Format(time.RFC3339), "end": moved.Add(time.Hour).Format(time.RFC3339)})
	res = api.want("faculty reschedules", http.StatusOK, http.MethodPatch, base+"/sessions/"+sessionID, faculty, map[string]any{"start": moved.Format(time.RFC3339), "end": moved.Add(time.Hour).Format(time.RFC3339)})
	var roomStart time.Time
	if err := admin.QueryRow(ctx, `SELECT scheduled_start FROM rooms WHERE public_code = $1`, code).Scan(&roomStart); err != nil || !roomStart.Equal(moved) {
		t.Errorf("room not moved with its class: %v, err=%v", roomStart, err)
	}
	last, _ := sessions[2]["id"].(string)
	lastCode, _ := sessions[2]["roomCode"].(string)
	res = api.want("cancel last", http.StatusOK, http.MethodPost, base+"/sessions/"+last+"/cancel?scope=following", faculty, nil)
	if res["cancelled"] != float64(1) {
		t.Errorf("cancel: %v", res)
	}
	api.want("cancelled room", http.StatusGone, http.MethodPost, roomPath(lastCode)+"/join", student, map[string]any{})

	// The class meeting: only its people may enter, and starting it moves the session along.
	api.want("student before start", http.StatusConflict, http.MethodPost, roomPath(code)+"/join", student, map[string]any{})
	res = api.want("faculty starts", http.StatusOK, http.MethodPost, roomPath(code)+"/join", faculty, map[string]any{})
	if res["isHost"] != true {
		t.Errorf("allocated faculty should host: %v", res)
	}
	var status string
	if err := admin.QueryRow(ctx, `SELECT status FROM class_sessions WHERE id = $1`, sessionID).Scan(&status); err != nil || status != "active" {
		t.Errorf("session status %q, err=%v", status, err)
	}
	api.want("enrolled student joins", http.StatusOK, http.MethodPost, roomPath(code)+"/join", student, map[string]any{})
	res = api.want("enrolled token", http.StatusOK, http.MethodPost, roomPath(code)+"/token", student, nil)
	api.want("unenrolled member joins", http.StatusForbidden, http.MethodPost, roomPath(code)+"/join", otherStudent, map[string]any{})
	api.want("other tenant joins", http.StatusForbidden, http.MethodPost, roomPath(code)+"/join", adminB, map[string]any{})
	api.want("guest joins class", http.StatusForbidden, http.MethodPost, roomPath(code)+"/join", caller{}, map[string]any{"displayName": "Guest"})

	if err := admin.QueryRow(ctx, `SELECT count(*)::text FROM room_participants rp JOIN rooms r ON r.id = rp.room_id WHERE r.public_code = $1 AND rp.identity = $2`, code, "user:"+otherID).Scan(&status); err != nil || status != "0" {
		t.Errorf("refused student registered: %s, err=%v", status, err)
	}

	api.want("end class", http.StatusOK, http.MethodPost, roomPath(code)+"/end", faculty, nil)
	if err := admin.QueryRow(ctx, `SELECT status FROM class_sessions WHERE id = $1`, sessionID).Scan(&status); err != nil || status != "completed" {
		t.Errorf("session status %q, err=%v", status, err)
	}

	// Attendance through the job the meeting enqueued, run as connect_worker.
	var payload []byte
	if err := admin.QueryRow(ctx, `SELECT payload FROM background_jobs WHERE idempotency_key LIKE 'attendance-reconcile-%' AND payload->'data'->>'classSessionId' = $1`, sessionID).Scan(&payload); err != nil {
		t.Fatalf("reconcile job: %v", err)
	}
	handler := worker.NewAttendanceReconcileHandler(workerPool, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := handler(ctx, &worker.Job{Payload: payload}); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	attendance := base + "/sessions/" + sessionID + "/attendance"
	rows := rowsOf(api.want("faculty report", http.StatusOK, http.MethodGet, attendance, faculty, nil), "records")
	if len(rows) != 1 || rows[0]["studentUserId"] != studentID {
		t.Fatalf("attendance: %v", rows)
	}
	if list := rowsOf(api.want("student report", http.StatusOK, http.MethodGet, attendance, student, nil), "records"); len(list) != 1 {
		t.Errorf("student should see their own record: %v", list)
	}
	if list := rowsOf(api.want("other student report", http.StatusOK, http.MethodGet, attendance, otherStudent, nil), "records"); len(list) != 0 {
		t.Errorf("another student's attendance leaked: %v", list)
	}
	api.want("other tenant report", http.StatusForbidden, http.MethodGet, attendance, adminB, nil)

	overrule := attendance + "/" + studentID + "/overrule"
	api.want("student overrules", http.StatusNotFound, http.MethodPost, overrule, student, map[string]any{"status": "present", "reason": "I was definitely there"})
	api.want("short reason", http.StatusBadRequest, http.MethodPost, overrule, faculty, map[string]any{"status": "present", "reason": "no"})
	api.want("faculty overrules", http.StatusOK, http.MethodPost, overrule, faculty, map[string]any{"status": "present", "reason": "=cmd|' /C calc'!A0 network outage"})
	var audits int
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM attendance_overrule_audit_log WHERE class_session_id = $1 AND student_user_id = $2 AND new_status = 'present'`, sessionID, studentID).Scan(&audits); err != nil || audits != 1 {
		t.Errorf("expected one overrule audit row, got %d, err=%v", audits, err)
	}

	req := httptest.NewRequest(http.MethodGet, attendance+".csv", nil)
	req.Header.Set("Authorization", "Bearer "+faculty.token)
	rec := httptest.NewRecorder()
	api.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), studentID) || !strings.Contains(rec.Body.String(), "'=cmd") {
		t.Errorf("csv export: %d %s", rec.Code, rec.Body.String())
	}

	summary := rowsOf(api.want("summary", http.StatusOK, http.MethodGet, base+"/attendance/summary?batchId="+batch, faculty, nil), "students")
	if len(summary) != 1 || summary[0]["present"] != float64(1) {
		t.Errorf("summary: %v", summary)
	}

	// Policies are versioned and tenant scoped.
	api.want("faculty creates policy", http.StatusForbidden, http.MethodPost, base+"/attendance-policies", faculty, map[string]any{"minPresentRatio": 0.8, "minPartialRatio": 0.5})
	api.want("bad ratios", http.StatusBadRequest, http.MethodPost, base+"/attendance-policies", adminA, map[string]any{"minPresentRatio": 0.5, "minPartialRatio": 0.8})
	for _, version := range []float64{1, 2} {
		res = api.want("admin creates policy", http.StatusCreated, http.MethodPost, base+"/attendance-policies", adminA, map[string]any{"minPresentRatio": 0.8, "minPartialRatio": 0.5, "lateGraceSeconds": 120})
		policy, _ := res["policy"].(map[string]any)
		if policy["version"] != version {
			t.Errorf("expected version %v: %v", version, policy)
		}
	}
	if list := rowsOf(api.want("other org has none", http.StatusOK, http.MethodGet, baseB+"/attendance-policies", adminB, nil), "policies"); len(list) != 0 {
		t.Errorf("policies leaked across tenants: %v", list)
	}

	// Revoking faculty and suspending a student end their access to future classes.
	api.want("short revoke reason", http.StatusBadRequest, http.MethodPost, base+"/allocations/"+allocation+"/revoke", adminA, map[string]any{"reason": "no"})
	api.want("suspend student", http.StatusOK, http.MethodPatch, base+"/members/"+studentID, adminA, map[string]any{"role": "student", "status": "suspended"})
	api.want("suspended student", http.StatusForbidden, http.MethodGet, base+"/sessions", student, nil)
	api.want("faculty changes own membership", http.StatusConflict, http.MethodPatch, base+"/members/"+facultyID, faculty, map[string]any{"role": "faculty", "status": "active"})
}

func roomPath(code string) string { return "/api/v1/rooms/" + code }
