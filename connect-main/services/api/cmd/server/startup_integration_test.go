package main

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

const startupTimeout = 40 * time.Second

func buildBinary(t *testing.T, dir, pkg string) string {
	t.Helper()
	out := filepath.Join(dir, filepath.Base(pkg))
	cmd := exec.Command("go", "build", "-o", out, pkg)
	cmd.Dir = filepath.Join("..", "..")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build %s: %v\n%s", pkg, err, output)
	}
	return out
}

// productionEnv satisfies the non-database production settings with disposable values. Only
// what is listed reaches the process, so nothing can fall back to the test environment.
func productionEnv(extra ...string) []string {
	env := []string{
		"APP_ENV=production",
		"PATH=" + os.Getenv("PATH"),
		"PUBLIC_APP_ORIGIN=https://connect.example.test",
		"CORS_ALLOWED_ORIGINS=https://connect.example.test",
		"LIVEKIT_API_KEY=disposable_key",
		"LIVEKIT_API_SECRET=disposable_secret_long_enough_for_tests",
		"STORAGE_PROVIDER=local",
		"REDIS_URL=redis://127.0.0.1:1/0",
	}
	return append(env, extra...)
}

func run(t *testing.T, binary string, env []string, args ...string) (string, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), startupTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Env = env
	output, err := cmd.CombinedOutput()
	if ctx.Err() != nil {
		t.Fatalf("%s did not exit in time:\n%s", filepath.Base(binary), output)
	}
	return string(output), err
}

func passwordOf(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.User == nil {
		return ""
	}
	password, _ := parsed.User.Password()
	return password
}

// TestWorkflowDB_ProcessStartupEnforcesRoles starts the real binaries the way a service does.
func TestWorkflowDB_ProcessStartupEnforcesRoles(t *testing.T) {
	adminURL, appURL, workerURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_CONNECT_APP_URL"), os.Getenv("TEST_CONNECT_WORKER_URL")
	if adminURL == "" || appURL == "" || workerURL == "" {
		t.Skip("NOT VERIFIED: TEST_DATABASE_URL, TEST_CONNECT_APP_URL and TEST_CONNECT_WORKER_URL are required")
	}
	dir := t.TempDir()
	server := buildBinary(t, dir, "./cmd/server")
	workerBin := buildBinary(t, dir, "./cmd/worker")
	inspect := buildBinary(t, dir, "./cmd/inspect_db")
	migrate := buildBinary(t, dir, "./cmd/run_migration")
	backfill := buildBinary(t, dir, "./cmd/backfill_tenancy")

	secrets := []string{passwordOf(adminURL), passwordOf(appURL), passwordOf(workerURL)}
	refused := func(t *testing.T, name, binary, want string, env []string, args ...string) {
		t.Helper()
		output, err := run(t, binary, env, args...)
		if err == nil {
			t.Errorf("%s: started, expected a refusal:\n%s", name, output)
		}
		if !strings.Contains(output, want) {
			t.Errorf("%s: expected %q in:\n%s", name, want, output)
		}
		for _, secret := range secrets {
			if secret != "" && strings.Contains(output, secret) {
				t.Errorf("%s: output contains a database password", name)
			}
		}
	}

	t.Run("API refuses unsafe connections", func(t *testing.T) {
		refused(t, "owner", server, "database_identity_rejected", productionEnv("DATABASE_URL="+adminURL))
		refused(t, "worker role", server, "database_identity_rejected", productionEnv("DATABASE_URL="+workerURL))
	})

	t.Run("worker settings fail closed", func(t *testing.T) {
		refused(t, "missing URL", server, "WORKER_DATABASE_URL", productionEnv("DATABASE_URL="+appURL, "WORKER_ENABLED=true"))
		refused(t, "owner", server, "database_identity_rejected", productionEnv("DATABASE_URL="+appURL, "WORKER_ENABLED=true", "WORKER_DATABASE_URL="+adminURL))
		refused(t, "API role, by another URL", server, "database_identity_rejected", productionEnv("DATABASE_URL="+appURL, "WORKER_ENABLED=true", "WORKER_DATABASE_URL="+appURL+"&application_name=other"))
		refused(t, "same URL", server, "must not be the same", productionEnv("DATABASE_URL="+appURL, "WORKER_ENABLED=true", "WORKER_DATABASE_URL="+appURL))
		refused(t, "migration URL on a runtime service", server, "MIGRATION_DATABASE_URL", productionEnv("DATABASE_URL="+appURL, "MIGRATION_DATABASE_URL="+adminURL))
	})

	t.Run("standalone worker refuses unsafe connections", func(t *testing.T) {
		refused(t, "API URL only", workerBin, "WORKER_DATABASE_URL", productionEnv("DATABASE_URL="+appURL))
		refused(t, "owner", workerBin, "database_identity_rejected", productionEnv("WORKER_DATABASE_URL="+adminURL))
		refused(t, "API role", workerBin, "database_identity_rejected", productionEnv("WORKER_DATABASE_URL="+appURL))
	})

	t.Run("production passes both identity checks with the right roles", func(t *testing.T) {
		// Redis is deliberately unreachable, so the process stops right after the database checks.
		output, _ := run(t, server, productionEnv("DATABASE_URL="+appURL, "WORKER_ENABLED=true", "WORKER_DATABASE_URL="+workerURL))
		for _, role := range []string{"connect_app", "connect_worker"} {
			if !strings.Contains(output, `"msg":"database_identity_verified","role":"`+role+`"`) {
				t.Errorf("no verified identity for %s:\n%s", role, output)
			}
		}
		if strings.Contains(output, "database_identity_rejected") {
			t.Errorf("a correct configuration was rejected:\n%s", output)
		}
	})

	t.Run("API and worker serve and shut down cleanly in one process", func(t *testing.T) {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		port := listener.Addr().(*net.TCPAddr).Port
		_ = listener.Close()

		var output bytes.Buffer
		cmd := exec.Command(server)
		cmd.Stdout, cmd.Stderr = &output, &output
		cmd.Env = []string{
			"APP_ENV=development", "PATH=" + os.Getenv("PATH"), fmt.Sprintf("PORT=%d", port),
			"REDIS_URL=redis://127.0.0.1:1/0", "LIVEKIT_API_SECRET=disposable_secret_long_enough_for_tests",
			"DATABASE_URL=" + appURL, "WORKER_ENABLED=true", "WORKER_DATABASE_URL=" + workerURL, "WORKER_POLL_INTERVAL=200ms",
		}
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()

		healthy := false
		for deadline := time.Now().Add(startupTimeout); time.Now().Before(deadline) && !healthy; time.Sleep(200 * time.Millisecond) {
			res, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/health/live", port))
			if err == nil {
				healthy = res.StatusCode == http.StatusOK
				_ = res.Body.Close()
			}
		}
		if !healthy {
			_ = cmd.Process.Kill()
			<-done
			t.Fatalf("server never became healthy:\n%s", output.String())
		}
		if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
			t.Fatal(err)
		}
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("unclean exit: %v\n%s", err, output.String())
			}
		case <-time.After(startupTimeout):
			_ = cmd.Process.Kill()
			t.Fatalf("server did not stop:\n%s", output.String())
		}
		for _, want := range []string{"inproc_worker_started", "inproc_worker_drained_successfully", "server_and_worker_shutdown_completed_cleanly"} {
			if !strings.Contains(output.String(), want) {
				t.Errorf("expected %s in:\n%s", want, output.String())
			}
		}
	})

	t.Run("standalone worker starts with its own role", func(t *testing.T) {
		var output bytes.Buffer
		cmd := exec.Command(workerBin)
		cmd.Stdout, cmd.Stderr = &output, &output
		cmd.Env = productionEnv("WORKER_DATABASE_URL="+workerURL, "WORKER_POLL_INTERVAL=200ms")
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()
		time.Sleep(3 * time.Second)
		_ = cmd.Process.Signal(syscall.SIGTERM)
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("unclean exit: %v\n%s", err, output.String())
			}
		case <-time.After(startupTimeout):
			_ = cmd.Process.Kill()
			t.Fatalf("worker did not stop:\n%s", output.String())
		}
		for _, want := range []string{"database_identity_verified", "connect_worker_ready_and_polling"} {
			if !strings.Contains(output.String(), want) {
				t.Errorf("expected %s in:\n%s", want, output.String())
			}
		}
	})

	t.Run("administrative tools use only the migration setting", func(t *testing.T) {
		base := []string{"PATH=" + os.Getenv("PATH")}
		for name, binary := range map[string]string{"inspect_db": inspect, "run_migration": migrate, "backfill_tenancy": backfill} {
			refused(t, name+" with runtime settings only", binary, "MIGRATION_DATABASE_URL is required", append(base, "DATABASE_URL="+adminURL, "WORKER_DATABASE_URL="+adminURL))
			refused(t, name+" with the API role", binary, "must not connect as runtime role connect_app", append(base, "MIGRATION_DATABASE_URL="+appURL))
			refused(t, name+" with the worker role", binary, "must not connect as runtime role connect_worker", append(base, "MIGRATION_DATABASE_URL="+workerURL))
			refused(t, name+" sharing the API URL", binary, "must not be a runtime connection string", append(base, "MIGRATION_DATABASE_URL="+adminURL, "DATABASE_URL="+adminURL))
		}
		output, err := run(t, inspect, append(base, "MIGRATION_DATABASE_URL="+adminURL))
		if err != nil {
			t.Errorf("inspect_db refused the administrative role: %v\n%s", err, output)
		}
		output, err = run(t, migrate, append(base, "MIGRATION_DATABASE_URL="+adminURL), "status")
		if err != nil {
			t.Errorf("run_migration status refused the administrative role: %v\n%s", err, output)
		}
	})
}
