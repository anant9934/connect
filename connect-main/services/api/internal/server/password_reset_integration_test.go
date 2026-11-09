package server_test

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestWorkflowDB_PasswordResetAndMemberLogin issues reset codes as an institution admin, uses
// them once, and signs in by registration number, all as connect_app.
func TestWorkflowDB_PasswordResetAndMemberLogin(t *testing.T) {
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
	adminID, adminEmail, orgAdmin := person()
	studentID, studentEmail, student := person()
	_, otherAdminEmail, otherAdmin := person()
	stamp := time.Now().Format("150405.000000")
	slug := "reset-" + stamp[len(stamp)-6:]
	res := api.want("create org", http.StatusCreated, http.MethodPost, "/api/v1/organizations", super, map[string]any{"slug": slug, "name": "Reset U", "adminEmail": adminEmail})
	org := field(res, "organization", "id")
	api.want("create other org", http.StatusCreated, http.MethodPost, "/api/v1/organizations", super, map[string]any{"slug": slug + "-b", "name": "Other U", "adminEmail": otherAdminEmail})
	base := "/api/v1/organizations/" + org
	api.want("add student", http.StatusCreated, http.MethodPost, base+"/members", orgAdmin, map[string]any{"email": studentEmail, "role": "student", "memberIdentifier": "12215678"})

	t.Run("registration number sign-in", func(t *testing.T) {
		login := func(inst, reg, pw string) map[string]any {
			return map[string]any{"institution": inst, "registrationNumber": reg, "password": pw}
		}
		api.want("member login", http.StatusOK, http.MethodPost, "/api/v1/auth/login/member", caller{}, login(slug, "12215678", "correct-horse-battery-9"))
		api.want("wrong password", http.StatusUnauthorized, http.MethodPost, "/api/v1/auth/login/member", caller{}, login(slug, "12215678", "nope-nope-nope"))
		api.want("other institution", http.StatusUnauthorized, http.MethodPost, "/api/v1/auth/login/member", caller{}, login(slug+"-b", "12215678", "correct-horse-battery-9"))
	})

	t.Run("only this institution's admin issues codes, never for admins", func(t *testing.T) {
		path := base + "/members/" + studentID + "/password-reset"
		api.want("student cannot", http.StatusForbidden, http.MethodPost, path, student, map[string]any{})
		api.want("other tenant cannot", http.StatusForbidden, http.MethodPost, path, otherAdmin, map[string]any{})
		api.want("not for self", http.StatusConflict, http.MethodPost, base+"/members/"+adminID+"/password-reset", orgAdmin, map[string]any{})
		first := api.want("issue", http.StatusCreated, http.MethodPost, path, orgAdmin, map[string]any{})
		second := api.want("reissue", http.StatusCreated, http.MethodPost, path, orgAdmin, map[string]any{})
		reset := func(name string, want int, code string) {
			api.want(name, want, http.MethodPost, "/api/v1/auth/password/reset", caller{}, map[string]any{"code": code, "newPassword": "brand-new-password-7"})
		}
		reset("cancelled code", http.StatusBadRequest, first["code"].(string))
		reset("use code", http.StatusOK, second["code"].(string))
		reset("reuse code", http.StatusBadRequest, second["code"].(string))
		api.want("old session ended", http.StatusUnauthorized, http.MethodGet, "/api/v1/users/me/profile", student, nil)
		api.want("new password works", http.StatusOK, http.MethodPost, "/api/v1/auth/login", caller{}, map[string]any{"email": studentEmail, "password": "brand-new-password-7"})
		var stored string
		if err := admin.QueryRow(ctx, `SELECT token_hash FROM password_reset_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, studentID).Scan(&stored); err != nil || stored == second["code"] {
			t.Errorf("code must be stored only as a hash: %v", err)
		}
	})

	t.Run("self-service outside production stores a code and reveals nothing", func(t *testing.T) {
		for _, email := range []string{studentEmail, "nobody-" + stamp + "@example.test"} {
			got := api.want("forgot", http.StatusAccepted, http.MethodPost, "/api/v1/auth/password/forgot", caller{}, map[string]any{"email": email})
			if got["delivery"] != "server-log" {
				t.Errorf("delivery %v", got["delivery"])
			}
		}
		var live int
		if err := admin.QueryRow(ctx, `SELECT count(*) FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL`, studentID).Scan(&live); err != nil || live != 1 {
			t.Errorf("live codes: %d %v", live, err)
		}
	})
}
