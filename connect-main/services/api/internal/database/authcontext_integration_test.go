package database_test

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/database"
)

type tenantFixture struct {
	orgID, token, deptID string
}

func newTenant(t *testing.T, ctx context.Context, admin *pgxpool.Pool) tenantFixture {
	t.Helper()
	s := uuid.NewString()
	f := tenantFixture{token: uuid.NewString() + uuid.NewString()[:28]}
	userID := uuid.NewString()
	if err := admin.QueryRow(ctx, `INSERT INTO organizations (slug, name) VALUES ($1, 'T') RETURNING id::text`, "ctx-"+s[:12]).Scan(&f.orgID); err != nil {
		t.Fatal(err)
	}
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO users (id, email_normalized, display_name, password_hash) VALUES ($1, $2, 'U', 'x')`, []any{userID, s + "@example.test"}},
		{`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'institution_admin')`, []any{f.orgID, userID}},
		{`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, []any{userID, f.token}},
	} {
		if _, err := admin.Exec(ctx, q.sql, q.args...); err != nil {
			t.Fatal(err)
		}
	}
	if err := admin.QueryRow(ctx, `INSERT INTO departments (organization_id, code, name) VALUES ($1, 'D', 'D') RETURNING id::text`, f.orgID).Scan(&f.deptID); err != nil {
		t.Fatal(err)
	}
	return f
}

func visibleDepartments(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT id::text FROM departments`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// TestWorkflowDB_AuthContextIsolation runs as connect_app with a single-connection pool,
// so any context leaking between transactions would be observed directly.
func TestWorkflowDB_AuthContextIsolation(t *testing.T) {
	adminURL, appURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_CONNECT_APP_URL")
	if adminURL == "" || appURL == "" {
		t.Skip("NOT VERIFIED: TEST_DATABASE_URL and TEST_CONNECT_APP_URL are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	admin, err := pgxpool.New(ctx, adminURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	cfg, err := pgxpool.ParseConfig(appURL)
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxConns = 1
	app, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()

	a, b := newTenant(t, ctx, admin), newTenant(t, ctx, admin)

	seesOnly := func(t *testing.T, f tenantFixture, orgID string) {
		t.Helper()
		if err := database.WithAuthContext(ctx, app, f.token, &orgID, func(tx pgx.Tx, _ *database.AuthContext) error {
			ids, err := visibleDepartments(ctx, tx)
			if err != nil {
				return err
			}
			if len(ids) != 1 || ids[0] != f.deptID {
				t.Errorf("expected only own department %s, saw %v", f.deptID, ids)
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("own tenant only", func(t *testing.T) {
		seesOnly(t, a, a.orgID)
		seesOnly(t, b, b.orgID)
	})

	t.Run("no context sees nothing after pooled reuse", func(t *testing.T) {
		seesOnly(t, a, a.orgID)
		ids, err := visibleDepartments(ctx, app)
		if err != nil {
			t.Fatal(err)
		}
		if len(ids) != 0 {
			t.Fatalf("context leaked through the pool: %v", ids)
		}
	})

	t.Run("cross tenant membership denied", func(t *testing.T) {
		err := database.WithAuthContext(ctx, app, a.token, &b.orgID, func(pgx.Tx, *database.AuthContext) error {
			t.Error("callback ran for a tenant the user does not belong to")
			return nil
		})
		if err == nil {
			t.Fatal("expected denial")
		}
	})

	t.Run("invalid and empty tokens rejected", func(t *testing.T) {
		for _, token := range []string{"", "not-a-real-token"} {
			if err := database.WithAuthContext(ctx, app, token, &a.orgID, func(pgx.Tx, *database.AuthContext) error { return nil }); err == nil {
				t.Errorf("token %q accepted", token)
			}
		}
	})

	t.Run("forged settings are rejected", func(t *testing.T) {
		tx, err := app.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `SELECT set_config('app._user_id', $1, true), set_config('app._org_id', $1, true), set_config('app._sig', 'forged', true), set_config('app._nonce', 'n', true), set_config('app._xid', pg_current_xact_id()::text, true), set_config('app._exp', '9999999999', true)`, a.orgID); err != nil {
			t.Fatal(err)
		}
		ids, err := visibleDepartments(ctx, tx)
		if err != nil {
			t.Fatal(err)
		}
		if len(ids) != 0 {
			t.Fatalf("forged context exposed %v", ids)
		}
	})

	t.Run("callback error rolls back", func(t *testing.T) {
		sentinel := errors.New("boom")
		err := database.WithAuthContext(ctx, app, a.token, &a.orgID, func(tx pgx.Tx, _ *database.AuthContext) error {
			if _, err := tx.Exec(ctx, `UPDATE departments SET name = 'changed' WHERE id = $1`, a.deptID); err != nil {
				return err
			}
			return sentinel
		})
		if !errors.Is(err, sentinel) {
			t.Fatalf("got %v", err)
		}
		var name string
		if err := admin.QueryRow(ctx, `SELECT name FROM departments WHERE id = $1`, a.deptID).Scan(&name); err != nil {
			t.Fatal(err)
		}
		if name != "D" {
			t.Fatalf("rollback failed, name=%s", name)
		}
	})

	t.Run("concurrent tenants stay separate", func(t *testing.T) {
		cfg2, _ := pgxpool.ParseConfig(appURL)
		cfg2.MaxConns = 4
		pool, err := pgxpool.NewWithConfig(ctx, cfg2)
		if err != nil {
			t.Fatal(err)
		}
		defer pool.Close()
		var wg sync.WaitGroup
		for i := range 40 {
			f := a
			if i%2 == 1 {
				f = b
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				org := f.orgID
				if err := database.WithAuthContext(ctx, pool, f.token, &org, func(tx pgx.Tx, _ *database.AuthContext) error {
					ids, err := visibleDepartments(ctx, tx)
					if err != nil {
						return err
					}
					if len(ids) != 1 || ids[0] != f.deptID {
						t.Errorf("cross-tenant result: %v", ids)
					}
					return nil
				}); err != nil {
					t.Error(err)
				}
			}()
		}
		wg.Wait()
	})
}
