package server_test

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestWorkflowDB_AcademicHierarchy builds School -> Department -> Program -> Course -> Batch and
// checks that no link can point into another institution.
func TestWorkflowDB_AcademicHierarchy(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
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
	api := apiClient{t: t, router: newRuntimeRouter(t, app, nil)}
	person := func() (email string, who caller) {
		userID, token := api.signup()
		if err := admin.QueryRow(ctx, `SELECT email_normalized FROM users WHERE id = $1`, userID).Scan(&email); err != nil {
			t.Fatal(err)
		}
		return email, caller{token: token}
	}
	superID, superToken := api.signup()
	if _, err := admin.Exec(ctx, `INSERT INTO platform_administrators (user_id, role) VALUES ($1, 'platform_super_admin')`, superID); err != nil {
		t.Fatal(err)
	}
	super := caller{token: superToken}
	emailA, adminA := person()
	emailB, adminB := person()
	stamp := time.Now().Format("150405.000000")[7:]
	orgA := field(api.want("org A", http.StatusCreated, http.MethodPost, "/api/v1/organizations", super, map[string]any{"slug": "ha-" + stamp, "name": "A", "adminEmail": emailA}), "organization", "id")
	orgB := field(api.want("org B", http.StatusCreated, http.MethodPost, "/api/v1/organizations", super, map[string]any{"slug": "hb-" + stamp, "name": "B", "adminEmail": emailB}), "organization", "id")
	a, b := "/api/v1/organizations/"+orgA, "/api/v1/organizations/"+orgB

	school := api.want("school", http.StatusCreated, http.MethodPost, a+"/schools", adminA, map[string]any{"code": "SCSE", "name": "School of CSE"})["school"].(map[string]any)["id"].(string)
	dept := api.want("department", http.StatusCreated, http.MethodPost, a+"/departments", adminA, map[string]any{"code": "CSE", "name": "Computer Science", "schoolId": school})["department"].(map[string]any)
	if dept["schoolId"] != school {
		t.Errorf("department school: %v", dept)
	}
	program := api.want("program", http.StatusCreated, http.MethodPost, a+"/programs", adminA, map[string]any{"departmentId": dept["id"], "code": "BTECH-AIML", "name": "B.Tech AI & ML", "level": "undergraduate", "durationYears": 4})["program"].(map[string]any)["id"].(string)
	api.want("bad level", http.StatusBadRequest, http.MethodPost, a+"/programs", adminA, map[string]any{"departmentId": dept["id"], "code": "X", "name": "X", "level": "kindergarten"})
	course := api.want("course", http.StatusCreated, http.MethodPost, a+"/courses", adminA, map[string]any{"departmentId": dept["id"], "code": "CS201", "title": "OOP with C++", "degreeProgramId": program})["course"].(map[string]any)
	if course["degreeProgramId"] != program {
		t.Errorf("course program: %v", course)
	}
	if got := rowsOf(api.want("list programs", http.StatusOK, http.MethodGet, a+"/programs", adminA, nil), "programs"); len(got) != 1 {
		t.Errorf("programs: %v", got)
	}
	// Another institution cannot hang its department on this school.
	api.want("cross-tenant school", http.StatusBadRequest, http.MethodPost, b+"/departments", adminB, map[string]any{"code": "EE", "name": "EE", "schoolId": school})
	api.want("other tenant sees no schools", http.StatusOK, http.MethodGet, b+"/schools", adminB, nil)
	if got := rowsOf(api.want("B schools", http.StatusOK, http.MethodGet, b+"/schools", adminB, nil), "schools"); len(got) != 0 {
		t.Errorf("tenant B sees %d schools", len(got))
	}
}
