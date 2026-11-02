package server_test

import (
	"context"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/room"
)

// TestWorkflowDB_AdminDashboard reads an organization's state and audit log as each role, as connect_app.
func TestWorkflowDB_AdminDashboard(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	open := func(name string) *pgxpool.Pool {
		dsn := os.Getenv(name)
		if dsn == "" {
			t.Skipf("NOT VERIFIED: %s is required", name)
		}
		p, err := pgxpool.New(ctx, dsn)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(p.Close)
		return p
	}
	admin, app := open("TEST_DATABASE_URL"), open("TEST_CONNECT_APP_URL")
	room.SetGuestTokenSecret([]byte("admin-dashboard-integration-secret-0123"))
	t.Cleanup(room.ResetGuestTokenSecretForTest)
	api := apiClient{t: t, router: newRuntimeRouter(t, app, nil)}

	var orgA, orgB string
	for _, dest := range []*string{&orgA, &orgB} {
		if err := admin.QueryRow(ctx, `INSERT INTO organizations (slug, name) VALUES ($1, 'Tenant') RETURNING id::text`, "dash-"+uuid.NewString()[:8]).Scan(dest); err != nil {
			t.Fatal(err)
		}
	}
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
	_, adminA := person(orgA, "institution_admin")
	_, auditor := person(orgA, "institution_auditor")
	_, facultyA := person(orgA, "faculty")
	studentID, student := person(orgA, "student")
	suspendedID, _ := person(orgA, "student")
	_, adminB := person(orgB, "institution_admin")
	_, outsider := person("", "")

	base := "/api/v1/organizations/" + orgA

	t.Run("only overseers of this organization may read it", func(t *testing.T) {
		for _, path := range []string{"/admin/overview", "/admin/audit"} {
			api.want("admin", http.StatusOK, http.MethodGet, base+path, adminA, nil)
			api.want("auditor", http.StatusOK, http.MethodGet, base+path, auditor, nil)
			api.want("faculty", http.StatusForbidden, http.MethodGet, base+path, facultyA, nil)
			api.want("student", http.StatusForbidden, http.MethodGet, base+path, student, nil)
			api.want("other tenant's admin", http.StatusForbidden, http.MethodGet, base+path, adminB, nil)
			api.want("outsider", http.StatusForbidden, http.MethodGet, base+path, outsider, nil)
			api.want("anonymous", http.StatusUnauthorized, http.MethodGet, base+path, caller{}, nil)
		}
	})

	t.Run("counts reflect the organization and no other", func(t *testing.T) {
		api.want("suspend", http.StatusOK, http.MethodPatch, base+"/members/"+suspendedID, adminA, map[string]any{"role": "student", "status": "suspended"})
		dept := field(api.want("dept", http.StatusCreated, http.MethodPost, base+"/departments", adminA, map[string]any{"code": "D", "name": "D"}), "department", "id")
		course := field(api.want("course", http.StatusCreated, http.MethodPost, base+"/courses", adminA, map[string]any{"departmentId": dept, "code": "C1", "title": "Course"}), "course", "id")
		batch := field(api.want("batch", http.StatusCreated, http.MethodPost, base+"/batches", adminA, map[string]any{"courseId": course, "name": "A", "academicTerm": "T", "startDate": "2020-01-01", "endDate": "2035-01-01"}), "batch", "id")
		facultyID := ""
		if err := admin.QueryRow(ctx, `SELECT user_id::text FROM organization_memberships WHERE organization_id = $1 AND role = 'faculty'`, orgA).Scan(&facultyID); err != nil {
			t.Fatal(err)
		}
		allocation := field(api.want("allocation", http.StatusCreated, http.MethodPost, base+"/allocations", adminA, map[string]any{"courseId": course, "facultyUserId": facultyID}), "allocation", "id")
		api.want("enroll", http.StatusCreated, http.MethodPost, base+"/enrollments", adminA, map[string]any{"batchId": batch, "studentUserId": studentID})
		at := time.Now().Add(48 * time.Hour).UTC().Truncate(time.Second)
		api.want("class", http.StatusCreated, http.MethodPost, base+"/sessions", adminA, map[string]any{
			"courseId": course, "batchId": batch, "facultyAllocationId": allocation, "title": "Class", "timeZone": "UTC",
			"start": at.Format(time.RFC3339), "end": at.Add(time.Hour).Format(time.RFC3339),
		})

		res := api.want("overview", http.StatusOK, http.MethodGet, base+"/admin/overview", adminA, nil)
		overview, _ := res["overview"].(map[string]any)
		number := func(group, name string) float64 {
			section, _ := overview[group].(map[string]any)
			value, _ := section[name].(float64)
			return value
		}
		for _, c := range []struct {
			group, name string
			want        float64
		}{
			{"people", "active", 4}, {"people", "suspended", 1}, {"people", "faculty", 1}, {"people", "students", 1}, {"people", "administrators", 1},
			{"structure", "departments", 1}, {"structure", "courses", 1}, {"structure", "batches", 1}, {"structure", "enrollments", 1},
			{"classes", "next7Days", 1}, {"classes", "live", 0}, {"attendance30Days", "present", 0},
		} {
			if got := number(c.group, c.name); got != c.want {
				t.Errorf("%s.%s = %v, want %v", c.group, c.name, got, c.want)
			}
		}
		other := api.want("other overview", http.StatusOK, http.MethodGet, "/api/v1/organizations/"+orgB+"/admin/overview", adminB, nil)
		section, _ := other["overview"].(map[string]any)["people"].(map[string]any)
		if section["active"] != float64(1) {
			t.Errorf("another organization's people were counted: %v", section)
		}
	})

	t.Run("audit log is this organization's only, and names people without addresses", func(t *testing.T) {
		var events []map[string]any
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) { // Audit entries are written after the response.
			events = rowsOf(api.want("audit", http.StatusOK, http.MethodGet, base+"/admin/audit?event=institution.member_updated", auditor, nil), "events")
			if len(events) > 0 {
				break
			}
			time.Sleep(100 * time.Millisecond)
		}
		if len(events) != 1 {
			t.Fatalf("expected the member update, got %v", events)
		}
		if events[0]["actorName"] != "Member" || events[0]["targetName"] != "Member" || events[0]["target"] != suspendedID {
			t.Errorf("event: %v", events[0])
		}
		if _, leaked := events[0]["ipHash"]; leaked {
			t.Errorf("address exposed: %v", events[0])
		}
		if rows := rowsOf(api.want("other tenant", http.StatusOK, http.MethodGet, "/api/v1/organizations/"+orgB+"/admin/audit", adminB, nil), "events"); len(rows) != 0 {
			t.Errorf("another organization's events: %v", rows)
		}
		past := time.Now().Add(-time.Hour).Format(time.RFC3339)
		if rows := rowsOf(api.want("dated", http.StatusOK, http.MethodGet, base+"/admin/audit?to="+past, adminA, nil), "events"); len(rows) != 0 {
			t.Errorf("before the update: %v", rows)
		}
		page := api.want("page", http.StatusOK, http.MethodGet, base+"/admin/audit?limit=1", adminA, nil)
		if len(rowsOf(page, "events")) != 1 || page["total"].(float64) < 2 {
			t.Errorf("page: %v", page)
		}
		for _, bad := range []string{"?from=yesterday", "?limit=0", "?limit=x", "?offset=-1", "?event=" + strings.Repeat("x", 65)} {
			api.want("bad "+bad, http.StatusBadRequest, http.MethodGet, base+"/admin/audit"+bad, adminA, nil)
		}
	})

	t.Run("auditors read but cannot change people", func(t *testing.T) {
		api.want("auditor edits", http.StatusForbidden, http.MethodPatch, base+"/members/"+suspendedID, auditor, map[string]any{"role": "student", "status": "active"})
		api.want("student edits", http.StatusForbidden, http.MethodPatch, base+"/members/"+suspendedID, student, map[string]any{"role": "student", "status": "active"})
		api.want("other tenant edits", http.StatusForbidden, http.MethodPatch, base+"/members/"+suspendedID, adminB, map[string]any{"role": "student", "status": "active"})
		var status string
		if err := admin.QueryRow(ctx, `SELECT status FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`, orgA, suspendedID).Scan(&status); err != nil {
			t.Fatal(err)
		}
		if status != "suspended" {
			t.Errorf("status changed to %s", status)
		}
	})
}

// TestWorkflowDB_BrowserActivityAndEngagement reports tab visibility and reads engagement through the API.
func TestWorkflowDB_BrowserActivityAndEngagement(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	open := func(name string) *pgxpool.Pool {
		dsn := os.Getenv(name)
		if dsn == "" {
			t.Skipf("NOT VERIFIED: %s is required", name)
		}
		p, err := pgxpool.New(ctx, dsn)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(p.Close)
		return p
	}
	admin, app := open("TEST_DATABASE_URL"), open("TEST_CONNECT_APP_URL")
	room.SetGuestTokenSecret([]byte("browser-activity-integration-secret-012"))
	t.Cleanup(room.ResetGuestTokenSecretForTest)
	api := apiClient{t: t, router: newRuntimeRouter(t, app, nil)}

	var org, otherOrg string
	for _, dest := range []*string{&org, &otherOrg} {
		if err := admin.QueryRow(ctx, `INSERT INTO organizations (slug, name) VALUES ($1, 'Tenant') RETURNING id::text`, "act-"+uuid.NewString()[:8]).Scan(dest); err != nil {
			t.Fatal(err)
		}
	}
	person := func(in, role string) (string, caller) {
		t.Helper()
		id, token := api.signup()
		if _, err := admin.Exec(ctx, `INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`, in, id, role); err != nil {
			t.Fatal(err)
		}
		return id, caller{token: token}
	}
	_, orgAdmin := person(org, "institution_admin")
	facultyID, faculty := person(org, "faculty")
	studentID, student := person(org, "student")
	_, otherStudent := person(org, "student")
	_, otherAdmin := person(otherOrg, "institution_admin")

	base := "/api/v1/organizations/" + org
	dept := field(api.want("dept", http.StatusCreated, http.MethodPost, base+"/departments", orgAdmin, map[string]any{"code": "A", "name": "A"}), "department", "id")
	course := field(api.want("course", http.StatusCreated, http.MethodPost, base+"/courses", orgAdmin, map[string]any{"departmentId": dept, "code": "A1", "title": "Course"}), "course", "id")
	batch := field(api.want("batch", http.StatusCreated, http.MethodPost, base+"/batches", orgAdmin, map[string]any{"courseId": course, "name": "A", "academicTerm": "T", "startDate": "2020-01-01", "endDate": "2035-01-01"}), "batch", "id")
	allocation := field(api.want("allocation", http.StatusCreated, http.MethodPost, base+"/allocations", orgAdmin, map[string]any{"courseId": course, "facultyUserId": facultyID}), "allocation", "id")
	api.want("enroll", http.StatusCreated, http.MethodPost, base+"/enrollments", orgAdmin, map[string]any{"batchId": batch, "studentUserId": studentID})
	at := time.Now().Add(5 * time.Minute).UTC().Truncate(time.Second)
	res := api.want("class", http.StatusCreated, http.MethodPost, base+"/sessions", faculty, map[string]any{
		"courseId": course, "batchId": batch, "facultyAllocationId": allocation, "title": "Live", "timeZone": "UTC",
		"start": at.Format(time.RFC3339), "end": at.Add(time.Hour).Format(time.RFC3339),
	})
	sessions := rowsOf(res, "sessions")
	session, code := sessions[0]["id"].(string), sessions[0]["roomCode"].(string)

	report := func(who caller, visible, hidden int) map[string]any {
		t.Helper()
		return api.want("report", http.StatusOK, http.MethodPost, roomPath(code)+"/activity", who, map[string]any{"visibleSeconds": visible, "hiddenSeconds": hidden})
	}
	stored := func() (visible, hidden int) {
		t.Helper()
		if err := admin.QueryRow(ctx, `SELECT COALESCE(sum(visible_seconds), 0), COALESCE(sum(hidden_seconds), 0) FROM browser_activity WHERE user_id = $1`, studentID).Scan(&visible, &hidden); err != nil {
			t.Fatal(err)
		}
		return
	}

	api.want("not in the room yet", http.StatusForbidden, http.MethodPost, roomPath(code)+"/activity", student, map[string]any{"visibleSeconds": 5})
	api.want("host starts", http.StatusOK, http.MethodPost, roomPath(code)+"/join", faculty, map[string]any{})
	api.want("student joins", http.StatusOK, http.MethodPost, roomPath(code)+"/join", student, map[string]any{})

	if res := report(student, 20, 10); res["recorded"] != true {
		t.Errorf("not recorded: %v", res)
	}
	if v, h := stored(); v != 20 || h != 10 {
		t.Errorf("stored %d %d", v, h)
	}

	t.Run("reports cannot claim more time than has passed", func(t *testing.T) {
		report(student, 3000, 0)
		if v, h := stored(); v+h > 40 {
			t.Errorf("claimed time accepted: visible %d hidden %d", v, h)
		}
		for _, bad := range []map[string]any{{"visibleSeconds": -1}, {"hiddenSeconds": 99999}, {"visibleSeconds": "x"}} {
			api.want("bad report", http.StatusBadRequest, http.MethodPost, roomPath(code)+"/activity", student, bad)
		}
		api.want("anonymous", http.StatusUnauthorized, http.MethodPost, roomPath(code)+"/activity", caller{}, map[string]any{"visibleSeconds": 1})
		api.want("not a participant", http.StatusForbidden, http.MethodPost, roomPath(code)+"/activity", otherStudent, map[string]any{"visibleSeconds": 1})
	})

	t.Run("a personal meeting records nothing", func(t *testing.T) {
		created := api.want("personal", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", orgAdmin, map[string]any{})
		personal := field(created, "room", "publicCode")
		api.want("join personal", http.StatusOK, http.MethodPost, roomPath(personal)+"/join", orgAdmin, map[string]any{})
		res := api.want("report", http.StatusOK, http.MethodPost, roomPath(personal)+"/activity", orgAdmin, map[string]any{"visibleSeconds": 5})
		if res["recorded"] != false {
			t.Errorf("recorded in a personal meeting: %v", res)
		}
	})

	t.Run("engagement is for staff of this organization", func(t *testing.T) {
		api.want("reaction", http.StatusCreated, http.MethodPost, roomPath(code)+"/reactions", student, map[string]any{"emoji": "👍"})
		path := base + "/sessions/" + session + "/engagement"
		for _, who := range []caller{orgAdmin, faculty} {
			rows := rowsOf(api.want("staff", http.StatusOK, http.MethodGet, path, who, nil), "people")
			found := false
			for _, row := range rows {
				if row["userId"] == studentID {
					found = true
					if row["reactions"] != float64(1) || row["reported"] != true {
						t.Errorf("row: %v", row)
					}
				}
			}
			if !found {
				t.Errorf("student missing: %v", rows)
			}
		}
		api.want("student", http.StatusForbidden, http.MethodGet, path, student, nil)
		api.want("other tenant", http.StatusForbidden, http.MethodGet, path, otherAdmin, nil)
		api.want("other tenant through its own path", http.StatusForbidden, http.MethodGet, "/api/v1/organizations/"+otherOrg+"/sessions/"+session+"/engagement", otherAdmin, nil)
	})

	t.Run("policies validate rules and weights", func(t *testing.T) {
		good := map[string]any{"minPresentRatio": 0.75, "minPartialRatio": 0.4, "lateGraceSeconds": 300, "earlyLeaveGraceSeconds": 300, "durationWeight": 0.6, "engagementWeight": 0.2, "browserWeight": 0.2, "engagementTarget": 2}
		res := api.want("policy", http.StatusCreated, http.MethodPost, base+"/attendance-policies", orgAdmin, good)
		policy, _ := res["policy"].(map[string]any)
		if policy["browserWeight"] != 0.2 || policy["earlyLeaveGraceSeconds"] != float64(300) {
			t.Errorf("policy: %v", policy)
		}
		defaults := api.want("old form", http.StatusCreated, http.MethodPost, base+"/attendance-policies", orgAdmin, map[string]any{"minPresentRatio": 0.7, "minPartialRatio": 0.3})
		if p, _ := defaults["policy"].(map[string]any); p["durationWeight"] != float64(1) || p["engagementWeight"] != float64(0) {
			t.Errorf("defaults changed what a policy means: %v", p)
		}
		for name, change := range map[string]map[string]any{
			"weights over":     {"durationWeight": 0.9},
			"weights negative": {"durationWeight": 1.4, "engagementWeight": -0.6},
			"target zero":      {"engagementTarget": 0},
			"negative grace":   {"earlyLeaveGraceSeconds": -1},
		} {
			body := map[string]any{}
			for k, v := range good {
				body[k] = v
			}
			for k, v := range change {
				body[k] = v
			}
			api.want(name, http.StatusBadRequest, http.MethodPost, base+"/attendance-policies", orgAdmin, body)
		}
		api.want("faculty", http.StatusForbidden, http.MethodPost, base+"/attendance-policies", faculty, good)
	})

	t.Run("dashboards show records by role", func(t *testing.T) {
		if _, err := admin.Exec(ctx, `
			INSERT INTO attendance_records (organization_id, batch_id, class_session_id, student_user_id, total_connected_seconds, attendance_status, duration_ratio, engagement_ratio, score, calculation)
			VALUES ($1, $2, $3, $4, 3000, 'present', 0.833, 1, 0.9, '{"sessionSeconds":3600,"rules":[]}')`, org, batch, session, studentID); err != nil {
			t.Fatal(err)
		}
		summary := rowsOf(api.want("summary", http.StatusOK, http.MethodGet, base+"/attendance/summary?batchId="+batch, faculty, nil), "students")
		if len(summary) != 1 || summary[0]["durationRatio"] != 0.833 || summary[0]["engagementRatio"] != float64(1) {
			t.Errorf("summary: %v", summary)
		}
		classes := rowsOf(api.want("classes", http.StatusOK, http.MethodGet, base+"/attendance/classes?batchId="+batch, orgAdmin, nil), "classes")
		if len(classes) != 1 || classes[0]["present"] != float64(1) {
			t.Errorf("classes: %v", classes)
		}
		// A classmate sees neither the student's row nor any counts built from it.
		mine := rowsOf(api.want("other student", http.StatusOK, http.MethodGet, base+"/attendance/summary?batchId="+batch, otherStudent, nil), "students")
		if len(mine) != 0 {
			t.Errorf("classmate saw: %v", mine)
		}
		var roomID string
		if err := admin.QueryRow(ctx, `SELECT id::text FROM rooms WHERE public_code = $1`, code).Scan(&roomID); err != nil {
			t.Fatal(err)
		}
		detail := api.want("student detail", http.StatusOK, http.MethodGet, "/api/v1/meetings/"+roomID, student, nil)
		if own, _ := detail["attendance"].(map[string]any); own["status"] != "present" || own["score"] != 0.9 {
			t.Errorf("own detail: %v", detail["attendance"])
		}
		api.want("missing batch", http.StatusBadRequest, http.MethodGet, base+"/attendance/classes", orgAdmin, nil)
		api.want("other tenant", http.StatusForbidden, http.MethodGet, base+"/attendance/classes?batchId="+batch, otherAdmin, nil)
	})
}
