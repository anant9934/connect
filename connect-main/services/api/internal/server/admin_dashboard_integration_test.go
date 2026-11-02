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
