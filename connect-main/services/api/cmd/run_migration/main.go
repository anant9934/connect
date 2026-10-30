package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	dbURL := "postgres://postgres.zvlfwhjkjcctvsbrxjhc:aMazon%4020999999999999999@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require"
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dbURL)
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

	// 2. Read migration 5 file
	migration5SQL, err := os.ReadFile("../../migrations/000005_user_profile_and_providers.sql")
	if err != nil {
		// Try relative to workspace root
		migration5SQL, err = os.ReadFile("migrations/000005_user_profile_and_providers.sql")
		if err != nil {
			migration5SQL, err = os.ReadFile("e:/Tathastu connect/migrations/000005_user_profile_and_providers.sql")
		}
	}
	if err != nil {
		fmt.Printf("Failed to read migration 5 SQL file: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("\nApplying Migration 000005_user_profile_and_providers.sql...")
	_, err = pool.Exec(ctx, string(migration5SQL))
	if err != nil {
		fmt.Printf("Failed to apply migration: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("SUCCESS: Migration 000005 applied cleanly!")

	// 3. Verify columns now present in users table
	colRows, err := pool.Query(ctx, `
		SELECT column_name, data_type, is_nullable
		FROM information_schema.columns
		WHERE table_name = 'users'
		  AND column_name IN ('avatar_id', 'avatar_url', 'google_id', 'auth_provider', 'preferences', 'email_verified')
		ORDER BY column_name;
	`)
	if err != nil {
		fmt.Printf("Failed to query columns: %v\n", err)
		os.Exit(1)
	}
	defer colRows.Close()

	fmt.Println("\nVERIFIED NEW COLUMNS IN 'users' TABLE:")
	for colRows.Next() {
		var col, dtype, nullable string
		_ = colRows.Scan(&col, &dtype, &nullable)
		fmt.Printf("  [OK] %-20s %-20s (nullable: %s)\n", col, dtype, nullable)
	}
}
