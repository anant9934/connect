package config_test

import (
	"os"
	"strings"
	"testing"

	"github.com/tathastu/connect/services/api/internal/config"
)

func TestConfigLoadDefaults(t *testing.T) {
	_ = os.Setenv("APP_ENV", "development")
	_ = os.Setenv("PORT", "8080")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("expected config to load successfully, got: %v", err)
	}

	if cfg.Port != 8080 {
		t.Fatalf("expected port 8080, got %d", cfg.Port)
	}
	if cfg.AppEnv != config.EnvDevelopment {
		t.Fatalf("expected development env, got %s", cfg.AppEnv)
	}
}

func TestConfigProductionValidationFailsOnInsecureDefaults(t *testing.T) {
	// In production, placeholder development credentials must cause startup failure
	_ = os.Setenv("APP_ENV", "production")
	_ = os.Setenv("PORT", "8080")
	_ = os.Setenv("DATABASE_URL", "postgres://connect_app:connect_dev_password@localhost:5432/connect_db")

	_, err := config.Load()
	if err == nil {
		t.Fatal("SECURITY FAILURE: Expected production config to fail when dev credentials provided")
	}

	// Reset for subsequent tests
	_ = os.Setenv("APP_ENV", "development")
}

func TestConfigProductionCORSWildcardFails(t *testing.T) {
	_ = os.Setenv("APP_ENV", "production")
	_ = os.Setenv("DATABASE_URL", "postgres://prod_user:strong_prod_secret_123@db.prod.internal:5432/connect_db?sslmode=verify-full")
	_ = os.Setenv("REDIS_URL", "redis://:prod_redis_secret@redis.prod.internal:6379/0")
	_ = os.Setenv("CORS_ALLOWED_ORIGINS", "*")

	_, err := config.Load()
	if err == nil {
		t.Fatal("SECURITY FAILURE: Expected production config to reject CORS wildcard *")
	}

	_ = os.Setenv("APP_ENV", "development")
}

func TestConfigProductionPublicOriginFailsOnNonHTTPS(t *testing.T) {
	_ = os.Setenv("APP_ENV", "production")
	_ = os.Setenv("DATABASE_URL", "postgres://prod_user:strong_prod_secret_123@db.prod.internal:5432/connect_db?sslmode=verify-full")
	_ = os.Setenv("REDIS_URL", "redis://:prod_redis_secret@redis.prod.internal:6379/0")
	_ = os.Setenv("CORS_ALLOWED_ORIGINS", "https://connect.example.com")
	_ = os.Setenv("PUBLIC_APP_ORIGIN", "http://insecure.example.com")
	_ = os.Setenv("LIVEKIT_API_KEY", "real_production_key_12345")
	_ = os.Setenv("LIVEKIT_API_SECRET", "real_production_secret_67890")

	_, err := config.Load()
	if err == nil {
		t.Fatal("SECURITY FAILURE: Expected production config to reject non-HTTPS PUBLIC_APP_ORIGIN")
	}

	_ = os.Setenv("APP_ENV", "development")
}

func TestConfigProductionLiveKitPlaceholderFails(t *testing.T) {
	_ = os.Setenv("APP_ENV", "production")
	_ = os.Setenv("DATABASE_URL", "postgres://prod_user:strong_prod_secret_123@db.prod.internal:5432/connect_db?sslmode=verify-full")
	_ = os.Setenv("REDIS_URL", "redis://:prod_redis_secret@redis.prod.internal:6379/0")
	_ = os.Setenv("CORS_ALLOWED_ORIGINS", "https://connect.example.com")
	_ = os.Setenv("PUBLIC_APP_ORIGIN", "https://connect.example.com")
	_ = os.Setenv("LIVEKIT_API_KEY", "devkey")
	_ = os.Setenv("LIVEKIT_API_SECRET", "devsecret")

	_, err := config.Load()
	if err == nil {
		t.Fatal("SECURITY FAILURE: Expected production config to reject devkey/devsecret LiveKit credentials")
	}

	_ = os.Setenv("APP_ENV", "development")
}

func TestConfigCanonicalDomainInclusion(t *testing.T) {
	_ = os.Setenv("APP_ENV", "staging")
	_ = os.Setenv("PORT", "8080")
	_ = os.Setenv("CORS_ALLOWED_ORIGINS", "https://connect-mauve-nine.vercel.app")
	_ = os.Setenv("PUBLIC_APP_ORIGIN", "")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("expected staging config to load successfully, got: %v", err)
	}

	if cfg.PublicAppOrigin != "https://connect.aitathastu.com" {
		t.Fatalf("expected PublicAppOrigin to be canonical domain https://connect.aitathastu.com, got %s", cfg.PublicAppOrigin)
	}

	foundCanonical := false
	foundLegacy := false
	for _, o := range cfg.CORSAllowedOrigins {
		if o == "https://connect.aitathastu.com" {
			foundCanonical = true
		}
		if o == "https://connect-mauve-nine.vercel.app" {
			foundLegacy = true
		}
	}

	if !foundCanonical {
		t.Fatal("expected CORSAllowedOrigins to include canonical domain https://connect.aitathastu.com")
	}
	if !foundLegacy {
		t.Fatal("expected CORSAllowedOrigins to include legacy domain https://connect-mauve-nine.vercel.app")
	}

	_ = os.Setenv("APP_ENV", "development")
}

func clearDatabaseEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{"DATABASE_URL", "WORKER_DATABASE_URL", "MIGRATION_DATABASE_URL", "WORKER_ENABLED", "APP_ENV"} {
		t.Setenv(key, "")
	}
}

func TestLoad_WorkerEnabledRequiresItsOwnURL(t *testing.T) {
	clearDatabaseEnv(t)
	t.Setenv("WORKER_ENABLED", "true")
	t.Setenv("DATABASE_URL", "postgres://connect_app@db/x")
	if _, err := config.Load(); err == nil || !strings.Contains(err.Error(), "WORKER_DATABASE_URL") {
		t.Fatalf("expected a WORKER_DATABASE_URL error, got %v", err)
	}
}

func TestLoad_WorkerURLMustDifferFromAPIURL(t *testing.T) {
	clearDatabaseEnv(t)
	t.Setenv("WORKER_ENABLED", "true")
	t.Setenv("DATABASE_URL", "postgres://same@db/x")
	t.Setenv("WORKER_DATABASE_URL", "postgres://same@db/x")
	if _, err := config.Load(); err == nil {
		t.Fatal("identical API and worker URLs were accepted")
	}
}

func TestLoad_ProductionRefusesMigrationURL(t *testing.T) {
	clearDatabaseEnv(t)
	t.Setenv("APP_ENV", config.EnvProduction)
	t.Setenv("MIGRATION_DATABASE_URL", "postgres://admin@db/x")
	if _, err := config.Load(); err == nil || !strings.Contains(err.Error(), "MIGRATION_DATABASE_URL") {
		t.Fatalf("expected a MIGRATION_DATABASE_URL error, got %v", err)
	}
}

func TestLoadWorker_NeverUsesAPIURL(t *testing.T) {
	clearDatabaseEnv(t)
	t.Setenv("DATABASE_URL", "postgres://connect_app@db/x")
	if _, err := config.LoadWorker(); err == nil {
		t.Fatal("worker started from DATABASE_URL alone")
	}
	t.Setenv("WORKER_DATABASE_URL", "postgres://connect_worker@db/x")
	cfg, err := config.LoadWorker()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DatabaseURL != "" || cfg.WorkerDatabaseURL != "postgres://connect_worker@db/x" {
		t.Fatalf("unexpected URLs: api=%q worker=%q", cfg.DatabaseURL, cfg.WorkerDatabaseURL)
	}
}
