package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		fmt.Fprintln(os.Stderr, "Error: DATABASE_URL environment variable is required")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		fmt.Printf("Failed to parse config: %v\n", err)
		os.Exit(1)
	}
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		fmt.Printf("Failed to connect: %v\n", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		fmt.Printf("Ping failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("Connected to Supabase PostgreSQL!")

	// 1. Check existing migrations
	rows, err := pool.Query(ctx, "SELECT version, description, applied_at FROM schema_metadata ORDER BY applied_at")
	if err == nil {
		fmt.Println("\nAPPLIED MIGRATIONS:")
		for rows.Next() {
			var v, d string
			var t time.Time
			_ = rows.Scan(&v, &d, &t)
			fmt.Printf("  - %s (%s) applied at %s\n", v, d, t.Format(time.RFC3339))
		}
		rows.Close()
	}

	// 2. Read migration 6 file
	paths := []string{
		"../../migrations/000006_participant_distributed_locks.sql",
		"migrations/000006_participant_distributed_locks.sql",
		"connect-main/migrations/000006_participant_distributed_locks.sql",
	}
	var migration6SQL []byte
	for _, p := range paths {
		if data, err := os.ReadFile(p); err == nil {
			migration6SQL = data
			break
		}
	}
	if len(migration6SQL) == 0 {
		fmt.Println("Failed to read migration 6 SQL file")
		os.Exit(1)
	}

	fmt.Println("\nApplying Migration 000006_participant_distributed_locks.sql...")
	_, err = pool.Exec(ctx, string(migration6SQL))
	if err != nil {
		fmt.Printf("Failed to apply migration: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("SUCCESS: Migration 000006 applied cleanly!")

	// 3. Verify columns in participant_locks table
	colRows, err := pool.Query(ctx, `
		SELECT column_name, data_type, is_nullable
		FROM information_schema.columns
		WHERE table_name = 'participant_locks'
		ORDER BY column_name;
	`)
	if err != nil {
		fmt.Printf("Failed to query participant_locks columns: %v\n", err)
		os.Exit(1)
	}
	defer colRows.Close()

	fmt.Println("\nVERIFIED COLUMNS IN 'participant_locks' TABLE:")
	for colRows.Next() {
		var col, dtype, nullable string
		_ = colRows.Scan(&col, &dtype, &nullable)
		fmt.Printf("  [OK] %-20s %-20s (nullable: %s)\n", col, dtype, nullable)
	}

	// 4. Verify columns in room_participants table
	partRows, err := pool.Query(ctx, `
		SELECT column_name, data_type, is_nullable
		FROM information_schema.columns
		WHERE table_name = 'room_participants'
		  AND column_name IN ('fencing_token', 'transition_state', 'transition_op_id')
		ORDER BY column_name;
	`)
	if err != nil {
		fmt.Printf("Failed to query room_participants columns: %v\n", err)
		os.Exit(1)
	}
	defer partRows.Close()

	fmt.Println("\nVERIFIED COLUMNS IN 'room_participants' TABLE:")
	for partRows.Next() {
		var col, dtype, nullable string
		_ = partRows.Scan(&col, &dtype, &nullable)
		fmt.Printf("  [OK] %-20s %-20s (nullable: %s)\n", col, dtype, nullable)
	}
}
