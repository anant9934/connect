package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	MigrationAdvisoryLockID = 742910482
)

// MigrationFile represents a discovered SQL migration script.
type MigrationFile struct {
	Version  string
	FileName string
	FullPath string
}

// FindMigrationDir locates the directory containing migration files.
func FindMigrationDir() (string, error) {
	if envDir := os.Getenv("MIGRATIONS_DIR"); envDir != "" {
		if info, err := os.Stat(envDir); err == nil && info.IsDir() {
			return envDir, nil
		}
	}
	candidates := []string{
		"connect-main/migrations",
		"migrations",
		"../../migrations",
		"../migrations",
		"../../../../migrations",
		"../../../../connect-main/migrations",
	}
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && info.IsDir() {
			return c, nil
		}
	}
	return "", fmt.Errorf("could not locate migrations directory (checked: %v)", candidates)
}

// LoadMigrationFiles discovers and sorts all .sql files in the migration directory.
func LoadMigrationFiles(dir string) ([]MigrationFile, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("failed to read migrations dir: %w", err)
	}

	var files []MigrationFile
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		v := strings.TrimSuffix(entry.Name(), ".sql")
		files = append(files, MigrationFile{
			Version:  v,
			FileName: entry.Name(),
			FullPath: filepath.Join(dir, entry.Name()),
		})
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].FileName < files[j].FileName
	})

	return files, nil
}

// EnsureSchemaMetadataTable ensures the schema_metadata table exists.
func EnsureSchemaMetadataTable(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_metadata (
			version VARCHAR(128) PRIMARY KEY,
			description TEXT,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
			execution_time_ms BIGINT
		);
	`)
	return err
}

// GetAppliedMigrations returns the set of already applied migration versions.
func GetAppliedMigrations(ctx context.Context, pool *pgxpool.Pool) (map[string]time.Time, error) {
	rows, err := pool.Query(ctx, `SELECT version, applied_at FROM schema_metadata ORDER BY applied_at ASC;`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	applied := make(map[string]time.Time)
	for rows.Next() {
		var v string
		var t time.Time
		if err := rows.Scan(&v, &t); err != nil {
			return nil, err
		}
		applied[v] = t
	}
	return applied, nil
}

// RunStatus reports applied vs pending migrations.
func RunStatus(ctx context.Context, pool *pgxpool.Pool) error {
	if err := EnsureSchemaMetadataTable(ctx, pool); err != nil {
		return fmt.Errorf("failed to verify schema_metadata table: %w", err)
	}

	dir, err := FindMigrationDir()
	if err != nil {
		return err
	}

	files, err := LoadMigrationFiles(dir)
	if err != nil {
		return err
	}

	applied, err := GetAppliedMigrations(ctx, pool)
	if err != nil {
		return fmt.Errorf("failed to fetch applied migrations: %w", err)
	}

	fmt.Printf("\n=== DATABASE MIGRATION STATUS (Directory: %s) ===\n", dir)
	fmt.Printf("%-45s | %-12s | %s\n", "MIGRATION SCRIPT", "STATUS", "APPLIED AT")
	fmt.Println(strings.Repeat("-", 80))

	pendingCount := 0
	for _, f := range files {
		if appliedAt, ok := applied[f.Version]; ok {
			fmt.Printf("%-45s | \033[32mAPPLIED\033[0m      | %s\n", f.FileName, appliedAt.Format(time.RFC3339))
		} else {
			fmt.Printf("%-45s | \033[33mPENDING\033[0m      | -\n", f.FileName)
			pendingCount++
		}
	}
	fmt.Println(strings.Repeat("-", 80))
	fmt.Printf("Total: %d migrations (%d applied, %d pending)\n\n", len(files), len(files)-pendingCount, pendingCount)
	return nil
}

// RunUp executes all pending migrations with an advisory lock.
func RunUp(ctx context.Context, pool *pgxpool.Pool) error {
	if err := EnsureSchemaMetadataTable(ctx, pool); err != nil {
		return fmt.Errorf("failed to verify schema_metadata table: %w", err)
	}

	// 1. Acquire PostgreSQL session advisory lock to prevent concurrent executions
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("failed to acquire connection for migration lock: %w", err)
	}
	defer conn.Release()

	var locked bool
	err = conn.QueryRow(ctx, "SELECT pg_try_advisory_lock($1);", MigrationAdvisoryLockID).Scan(&locked)
	if err != nil || !locked {
		return fmt.Errorf("failed to acquire migration advisory lock (another migration is running or DB error: %w)", err)
	}
	defer func() {
		var unlocked bool
		_ = conn.QueryRow(context.Background(), "SELECT pg_advisory_unlock($1);", MigrationAdvisoryLockID).Scan(&unlocked)
	}()

	dir, err := FindMigrationDir()
	if err != nil {
		return err
	}

	files, err := LoadMigrationFiles(dir)
	if err != nil {
		return err
	}

	applied, err := GetAppliedMigrations(ctx, pool)
	if err != nil {
		return fmt.Errorf("failed to fetch applied migrations: %w", err)
	}

	var pending []MigrationFile
	for _, f := range files {
		if _, ok := applied[f.Version]; !ok {
			pending = append(pending, f)
		}
	}

	if len(pending) == 0 {
		fmt.Println("✓ Database is up to date. No pending migrations.")
		return nil
	}

	fmt.Printf("Found %d pending migration(s) to apply...\n", len(pending))

	for _, m := range pending {
		fmt.Printf("Applying %s...", m.FileName)
		content, err := os.ReadFile(m.FullPath)
		if err != nil {
			return fmt.Errorf("failed to read migration file %s: %w", m.FullPath, err)
		}

		start := time.Now()
		tx, err := pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("failed to begin transaction for %s: %w", m.FileName, err)
		}

		// Execute migration SQL inside transaction
		if _, err := tx.Exec(ctx, string(content)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("MIGRATION FAILED [%s]: %w", m.FileName, err)
		}

		durationMs := time.Since(start).Milliseconds()

		// Record in schema_metadata
		_, err = tx.Exec(ctx, `
			INSERT INTO schema_metadata (version, description, applied_at, execution_time_ms)
			VALUES ($1, $2, clock_timestamp(), $3)
			ON CONFLICT (version) DO UPDATE
			SET execution_time_ms = EXCLUDED.execution_time_ms;
		`, m.Version, m.FileName, durationMs)
		if err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("failed to record schema metadata for %s: %w", m.FileName, err)
		}

		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("failed to commit transaction for %s: %w", m.FileName, err)
		}

		fmt.Printf(" \033[32mDONE\033[0m (%d ms)\n", durationMs)
	}

	fmt.Println("✓ All pending migrations applied successfully.")
	return nil
}

func main() {
	cmd := "status"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		fmt.Fprintln(os.Stderr, "Error: DATABASE_URL environment variable is required")
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		log.Fatalf("Failed to parse database configuration: %v", err)
	}
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("Database ping failed: %v", err)
	}

	switch cmd {
	case "status":
		if err := RunStatus(ctx, pool); err != nil {
			log.Fatalf("Status check failed: %v", err)
		}
	case "up":
		if err := RunUp(ctx, pool); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
	default:
		fmt.Printf("Unknown command '%s'. Available commands: status, up\n", cmd)
		os.Exit(1)
	}
}
