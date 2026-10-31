package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		fmt.Fprintln(os.Stderr, "Error: DATABASE_URL environment variable is required")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
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
	fmt.Println("SUCCESSFULLY CONNECTED TO SUPABASE POSTGRESQL!")

	// Inspect columns of users table
	rows, err := pool.Query(ctx, `
		SELECT column_name, data_type, is_nullable
		FROM information_schema.columns
		WHERE table_name = 'users'
		ORDER BY ordinal_position;
	`)
	if err != nil {
		fmt.Printf("Query error: %v\n", err)
		os.Exit(1)
	}
	defer rows.Close()

	fmt.Println("\nCOLUMNS IN 'users' TABLE:")
	for rows.Next() {
		var col, dtype, nullable string
		if err := rows.Scan(&col, &dtype, &nullable); err != nil {
			fmt.Printf("Scan error: %v\n", err)
			continue
		}
		fmt.Printf("  - %-20s %-20s (nullable: %s)\n", col, dtype, nullable)
	}

	// Query existing users
	var count int
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&count)
	fmt.Printf("\nTOTAL REGISTERED USERS: %d\n", count)

	uRows, err := pool.Query(ctx, "SELECT id, email_normalized, display_name FROM users LIMIT 10")
	if err == nil {
		fmt.Println("SAMPLE USERS:")
		for uRows.Next() {
			var id, email, name string
			_ = uRows.Scan(&id, &email, &name)
			fmt.Printf("  - ID: %s | Email: %s | Name: %s\n", id, email, name)
		}
		uRows.Close()
	}
}
