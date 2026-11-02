package database

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminDatabaseURL returns the migration and administration connection string. Tools never fall
// back to a runtime setting, so they cannot run against whatever the environment happens to hold.
func AdminDatabaseURL() (string, error) {
	adminURL := os.Getenv("MIGRATION_DATABASE_URL")
	if adminURL == "" {
		return "", errors.New("MIGRATION_DATABASE_URL is required; administrative tools do not use DATABASE_URL or WORKER_DATABASE_URL")
	}
	if adminURL == os.Getenv("DATABASE_URL") || adminURL == os.Getenv("WORKER_DATABASE_URL") {
		return "", errors.New("MIGRATION_DATABASE_URL must not be a runtime connection string")
	}
	return adminURL, nil
}

type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// RejectRuntimeRole refuses a connection authenticated as an API or worker role.
func RejectRuntimeRole(ctx context.Context, q rowQuerier) error {
	var currentUser, sessionUser string
	if err := q.QueryRow(ctx, `SELECT current_user::text, session_user::text`).Scan(&currentUser, &sessionUser); err != nil {
		return fmt.Errorf("could not determine the connected role: %w", err)
	}
	for _, role := range []string{currentUser, sessionUser} {
		if role == RoleAPI || role == RoleWorker {
			return fmt.Errorf("administrative tools must not connect as runtime role %s; set MIGRATION_DATABASE_URL to the migration role", role)
		}
	}
	return nil
}

// ConnectAdmin opens a pool for administrative tools after checking the connected role.
func ConnectAdmin(ctx context.Context) (*DB, error) {
	adminURL, err := AdminDatabaseURL()
	if err != nil {
		return nil, err
	}
	pool, err := pgxpool.New(ctx, adminURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to admin database pool: %w", err)
	}
	checkCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := RejectRuntimeRole(checkCtx, pool); err != nil {
		pool.Close()
		return nil, err
	}
	return &DB{Pool: pool}, nil
}
