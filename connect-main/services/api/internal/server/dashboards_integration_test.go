package server_test

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestWorkflowDB_DashboardSummaries reads the history summary and the institution health card.
func TestWorkflowDB_DashboardSummaries(t *testing.T) {
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
	person := func() (id, email string, who caller) {
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
	_, adminEmail, orgAdmin := person()
	_, memberEmail, member := person()
	stamp := time.Now().Format("150405.000000")
	res := api.want("org", http.StatusCreated, http.MethodPost, "/api/v1/organizations", super, map[string]any{"slug": "dash-" + stamp[len(stamp)-6:], "name": "Dash U", "adminEmail": adminEmail})
	org := field(res, "organization", "id")
	api.want("add member", http.StatusCreated, http.MethodPost, "/api/v1/organizations/"+org+"/members", orgAdmin, map[string]any{"email": memberEmail, "role": "student"})

	code := field(api.want("room", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", member, map[string]any{}), "room", "publicCode")
	api.want("join", http.StatusOK, http.MethodPost, roomPath(code)+"/join", member, map[string]any{})
	summary := api.want("summary", http.StatusOK, http.MethodGet, "/api/v1/meetings/summary", member, nil)["summary"].(map[string]any)
	if summary["meetings"] != 1.0 {
		t.Errorf("summary: %v", summary)
	}

	health := api.want("admin health", http.StatusOK, http.MethodGet, "/api/v1/organizations/"+org+"/admin/health", orgAdmin, nil)["health"].(map[string]any)
	if health["members"] != 2.0 || health["databaseBytes"] != nil {
		t.Errorf("institution admins see their own counts, not database internals: %v", health)
	}
	api.want("students cannot", http.StatusForbidden, http.MethodGet, "/api/v1/organizations/"+org+"/admin/health", member, nil)
	if sup := api.want("super admin", http.StatusOK, http.MethodGet, "/api/v1/organizations/"+org+"/admin/health", super, nil)["health"].(map[string]any); sup["databaseBytes"] == nil {
		t.Errorf("super admins also see database size: %v", sup)
	}
}
