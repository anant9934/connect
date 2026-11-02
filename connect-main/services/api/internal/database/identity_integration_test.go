package database_test

import (
	"context"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/database"
)

func TestRequiredMigrationIsTheNewest(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("..", "..", "..", "..", "migrations", "*.sql"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no migrations found: %v", err)
	}
	sort.Strings(files)
	newest := strings.TrimSuffix(filepath.Base(files[len(files)-1]), ".sql")
	if newest != database.RequiredMigration {
		t.Fatalf("RequiredMigration is %s but the newest migration is %s", database.RequiredMigration, newest)
	}
}

// TestWorkflowDB_RuntimeIdentityChecks verifies the real roles pass and unsafe ones are refused,
// using throwaway roles so the real ones never hold a dangerous grant, even briefly.
func TestWorkflowDB_RuntimeIdentityChecks(t *testing.T) {
	adminURL, appURL, workerURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_CONNECT_APP_URL"), os.Getenv("TEST_CONNECT_WORKER_URL")
	if adminURL == "" || appURL == "" || workerURL == "" {
		t.Skip("NOT VERIFIED: TEST_DATABASE_URL, TEST_CONNECT_APP_URL and TEST_CONNECT_WORKER_URL are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, adminURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()

	open := func(rawURL string) *pgxpool.Pool {
		t.Helper()
		pool, err := pgxpool.New(ctx, rawURL)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(pool.Close)
		return pool
	}
	app, workerPool := open(appURL), open(workerURL)

	t.Run("real roles pass", func(t *testing.T) {
		if err := database.VerifyRuntimeIdentity(ctx, app, database.RoleAPI); err != nil {
			t.Errorf("API role: %v", err)
		}
		if err := database.VerifyRuntimeIdentity(ctx, workerPool, database.RoleWorker); err != nil {
			t.Errorf("worker role: %v", err)
		}
	})

	t.Run("wrong role is refused", func(t *testing.T) {
		for name, check := range map[string]func() error{
			"worker as API":   func() error { return database.VerifyRuntimeIdentity(ctx, workerPool, database.RoleAPI) },
			"API as worker":   func() error { return database.VerifyRuntimeIdentity(ctx, app, database.RoleWorker) },
			"owner as API":    func() error { return database.VerifyRuntimeIdentity(ctx, admin, database.RoleAPI) },
			"owner as worker": func() error { return database.VerifyRuntimeIdentity(ctx, admin, database.RoleWorker) },
		} {
			if err := check(); !database.IsIdentityError(err) {
				t.Errorf("%s: expected an identity error, got %v", name, err)
			}
		}
	})

	parsed, err := url.Parse(adminURL)
	if err != nil {
		t.Fatal(err)
	}
	// connectAs logs in as a throwaway role and returns the identity failure for it.
	connectAs := func(role string) error {
		t.Helper()
		roleURL := *parsed
		roleURL.User = url.UserPassword(role, "disposable")
		pool := open(roleURL.String())
		return database.VerifyRuntimeIdentity(ctx, pool, role)
	}
	create := func(attributes string) string {
		t.Helper()
		role := "unsafe_" + strings.ReplaceAll(uuid.NewString()[:8], "-", "")
		ident := pgx.Identifier{role}.Sanitize()
		if _, err := admin.Exec(ctx, `CREATE ROLE `+ident+` LOGIN PASSWORD 'disposable' `+attributes); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			cleanup := context.Background()
			_, _ = admin.Exec(cleanup, `DROP OWNED BY `+ident+` CASCADE`)
			_, _ = admin.Exec(cleanup, `DROP ROLE IF EXISTS `+ident)
		})
		return role
	}
	expectProblem := func(t *testing.T, err error, want string) {
		t.Helper()
		if !database.IsIdentityError(err) || !strings.Contains(err.Error(), want) {
			t.Errorf("expected a problem mentioning %q, got %v", want, err)
		}
		if strings.Contains(err.Error(), "disposable") {
			t.Errorf("the error exposed a password: %v", err)
		}
	}

	t.Run("superuser", func(t *testing.T) {
		expectProblem(t, connectAs(create("SUPERUSER")), "superuser")
	})
	t.Run("bypassrls", func(t *testing.T) {
		expectProblem(t, connectAs(create("BYPASSRLS")), "BYPASSRLS")
	})
	t.Run("createrole", func(t *testing.T) {
		expectProblem(t, connectAs(create("CREATEROLE")), "CREATEROLE")
	})
	t.Run("direct membership in a bypassing role", func(t *testing.T) {
		bypasser, member := create("NOLOGIN BYPASSRLS"), create("")
		if _, err := admin.Exec(ctx, `GRANT `+pgx.Identifier{bypasser}.Sanitize()+` TO `+pgx.Identifier{member}.Sanitize()); err != nil {
			t.Fatal(err)
		}
		expectProblem(t, connectAs(member), bypasser)
	})
	t.Run("membership through an intermediate role", func(t *testing.T) {
		bypasser, middle, member := create("NOLOGIN BYPASSRLS"), create("NOLOGIN"), create("")
		for _, grant := range []string{
			`GRANT ` + pgx.Identifier{bypasser}.Sanitize() + ` TO ` + pgx.Identifier{middle}.Sanitize(),
			`GRANT ` + pgx.Identifier{middle}.Sanitize() + ` TO ` + pgx.Identifier{member}.Sanitize(),
		} {
			if _, err := admin.Exec(ctx, grant); err != nil {
				t.Fatal(err)
			}
		}
		expectProblem(t, connectAs(member), bypasser)
	})
	t.Run("owning a protected table", func(t *testing.T) {
		owner := create("")
		table := "identity_probe_" + strings.ReplaceAll(uuid.NewString()[:8], "-", "")
		ident := pgx.Identifier{table}.Sanitize()
		// One transaction, so the every-table test never sees it without forced RLS.
		tx, err := admin.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx) //nolint:errcheck
		for _, stmt := range []string{
			`CREATE TABLE ` + ident + ` (id INT)`,
			`ALTER TABLE ` + ident + ` ENABLE ROW LEVEL SECURITY`,
			`ALTER TABLE ` + ident + ` FORCE ROW LEVEL SECURITY`,
			`ALTER TABLE ` + ident + ` OWNER TO ` + pgx.Identifier{owner}.Sanitize(),
		} {
			if _, err := tx.Exec(ctx, stmt); err != nil {
				t.Fatal(err)
			}
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = admin.Exec(context.Background(), `DROP TABLE IF EXISTS `+ident) })
		expectProblem(t, connectAs(owner), table)
	})

	t.Run("administrative check refuses runtime roles", func(t *testing.T) {
		if err := database.RejectRuntimeRole(ctx, app); err == nil {
			t.Error("API role was accepted for administration")
		}
		if err := database.RejectRuntimeRole(ctx, workerPool); err == nil {
			t.Error("worker role was accepted for administration")
		}
		if err := database.RejectRuntimeRole(ctx, admin); err != nil {
			t.Errorf("administrative role was refused: %v", err)
		}
	})
}
