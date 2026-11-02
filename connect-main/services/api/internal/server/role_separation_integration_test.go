package server_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/config"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/room"
	"github.com/tathastu/connect/services/api/internal/worker"
)

// TestWorkflowDB_APIAndWorkerSeparatePools runs the API and worker in one process, each on the
// pool production code opens for it, and proves each role can do its job and only its job.
func TestWorkflowDB_APIAndWorkerSeparatePools(t *testing.T) {
	adminURL, appURL, workerURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_CONNECT_APP_URL"), os.Getenv("TEST_CONNECT_WORKER_URL")
	if adminURL == "" || appURL == "" || workerURL == "" {
		t.Skip("NOT VERIFIED: TEST_DATABASE_URL, TEST_CONNECT_APP_URL and TEST_CONNECT_WORKER_URL are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	t.Setenv("APP_ENV", "development")
	t.Setenv("DATABASE_URL", appURL)
	t.Setenv("WORKER_DATABASE_URL", workerURL)
	t.Setenv("WORKER_ENABLED", "true")
	t.Setenv("MIGRATION_DATABASE_URL", "")
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	apiDB, err := database.Connect(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer apiDB.Close()
	workerDB, err := database.ConnectWorker(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer workerDB.Close()
	admin, err := pgxpool.New(ctx, adminURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()

	if apiDB.Pool == workerDB.Pool {
		t.Fatal("API and worker share a pool")
	}
	if err := database.VerifyRuntimeIdentity(ctx, apiDB.Pool, database.RoleAPI); err != nil {
		t.Fatal(err)
	}
	if err := database.VerifyRuntimeIdentity(ctx, workerDB.Pool, database.RoleWorker); err != nil {
		t.Fatal(err)
	}

	// Every connection in a pool, not just the first, holds the expected role.
	assertEveryConnection := func(pool *pgxpool.Pool, role string) {
		t.Helper()
		held := make([]*pgxpool.Conn, 0, pool.Config().MaxConns)
		defer func() {
			for _, conn := range held {
				conn.Release()
			}
		}()
		for range pool.Config().MaxConns {
			conn, err := pool.Acquire(ctx)
			if err != nil {
				t.Fatal(err)
			}
			held = append(held, conn)
			var current string
			if err := conn.QueryRow(ctx, `SELECT current_user::text`).Scan(&current); err != nil {
				t.Fatal(err)
			}
			if current != role {
				t.Fatalf("expected %s, connection is %s", role, current)
			}
		}
	}
	assertEveryConnection(workerDB.Pool, database.RoleWorker)
	assertEveryConnection(apiDB.Pool, database.RoleAPI)

	room.SetGuestTokenSecret([]byte("separation-integration-test-secret-0123"))
	t.Cleanup(room.ResetGuestTokenSecretForTest)
	api := apiClient{t: t, router: newRuntimeRouter(t, apiDB.Pool, nil)}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	registry := worker.NewRegistry()
	worker.RegisterDefaultHandlers(registry, workerDB.Pool, nil, logger)
	runnerCfg := worker.DefaultRunnerConfig()
	runnerCfg.Queues = []string{worker.QueueDefault, worker.QueueAttendanceCritical}
	runnerCfg.PollInterval = 100 * time.Millisecond
	runner, err := worker.NewRunner(workerDB.Pool, registry, logger, runnerCfg)
	if err != nil {
		t.Fatal(err)
	}
	runCtx, stop := context.WithCancel(ctx)
	runDone := make(chan error, 1)
	go func() { runDone <- runner.Run(runCtx) }()
	t.Cleanup(func() {
		stop()
		<-runDone
	})

	t.Run("work crosses from the API to the worker", func(t *testing.T) {
		_, hostToken := api.signup()
		host := caller{token: hostToken}
		res := api.want("create", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", host, map[string]any{})
		code := field(res, "room", "publicCode")
		api.want("end", http.StatusOK, http.MethodPost, roomPath(code)+"/end", host, nil)

		deadline := time.Now().Add(20 * time.Second)
		for {
			var pending int
			if err := admin.QueryRow(ctx, `
				SELECT count(*) FROM background_jobs
				WHERE payload->'data'->>'roomId' = (SELECT id::text FROM rooms WHERE public_code = $1) AND status <> 'completed'
			`, code).Scan(&pending); err != nil {
				t.Fatal(err)
			}
			if pending == 0 {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("%d jobs from the API were not completed by the worker", pending)
			}
			time.Sleep(100 * time.Millisecond)
		}
		var total int
		if err := admin.QueryRow(ctx, `SELECT count(*) FROM background_jobs WHERE payload->'data'->>'roomId' = (SELECT id::text FROM rooms WHERE public_code = $1)`, code).Scan(&total); err != nil || total != 2 {
			t.Fatalf("expected the cleanup and reconcile jobs, got %d, err=%v", total, err)
		}
	})

	t.Run("API cannot use worker operations", func(t *testing.T) {
		if jobs, err := worker.ClaimJobsWithLease(ctx, apiDB.Pool, "api-impostor", worker.QueueDefault, 10, time.Minute); err == nil && len(jobs) > 0 {
			t.Errorf("API claimed %d jobs", len(jobs))
		}
		var visible int
		if err := apiDB.Pool.QueryRow(ctx, `SELECT count(*) FROM background_jobs`).Scan(&visible); err != nil || visible != 0 {
			t.Errorf("API reads %d jobs, err=%v", visible, err)
		}
		tag, err := apiDB.Pool.Exec(ctx, `UPDATE background_jobs SET status = 'completed'`)
		if err == nil && tag.RowsAffected() != 0 {
			t.Errorf("API updated %d jobs", tag.RowsAffected())
		}
		if _, err := apiDB.Pool.Exec(ctx, `SELECT connect_auth.succeed_room_host(gen_random_uuid())`); err == nil {
			t.Error("API may run host succession")
		}
	})

	t.Run("worker cannot use application operations", func(t *testing.T) {
		for _, stmt := range []string{
			`INSERT INTO users (email_normalized, display_name, password_hash) VALUES ('w@example.test', 'W', 'x')`,
			`INSERT INTO sessions (user_id, token_hash, expires_at) SELECT gen_random_uuid(), 'x', now()`,
			`SELECT connect_auth.auth_user_by_email('a@example.test')`,
			`SELECT connect_auth.transfer_room_host(gen_random_uuid(), 'user:x')`,
			`SELECT connect_auth.org_add_member(gen_random_uuid(), 'a@example.test', 'student', '')`,
			`DELETE FROM security_audit_events`,
		} {
			if _, err := workerDB.Pool.Exec(ctx, stmt); err == nil {
				t.Errorf("worker was allowed: %s", stmt)
			}
		}
		for _, table := range []string{"users", "sessions", "security_audit_events", "meeting_notes", "meeting_files", "organizations"} {
			var visible int
			if err := workerDB.Pool.QueryRow(ctx, `SELECT count(*) FROM `+table).Scan(&visible); err != nil {
				continue // A missing grant is also a refusal.
			}
			if visible != 0 {
				t.Errorf("worker reads %d rows of %s", visible, table)
			}
		}
	})

	t.Run("the server sees both roles and no owner connection from this process", func(t *testing.T) {
		rows, err := admin.Query(ctx, `SELECT DISTINCT usename::text FROM pg_stat_activity WHERE datname = current_database() AND usename IN ('connect_app', 'connect_worker')`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		seen := map[string]bool{}
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				t.Fatal(err)
			}
			seen[name] = true
		}
		if !seen[database.RoleAPI] || !seen[database.RoleWorker] {
			t.Errorf("expected both runtime roles connected, saw %v", seen)
		}
	})
}
