package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/config"
)

// DB wraps a PostgreSQL connection pool.
type DB struct {
	Pool *pgxpool.Pool
}

// Connect initializes a connection pool using pgxpool with configured pool limits.
func Connect(ctx context.Context, cfg *config.Config) (*DB, error) {
	poolConfig, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse database configuration: %w", err)
	}

	poolConfig.MaxConns = cfg.DBMaxOpenConns
	poolConfig.MinConns = cfg.DBMaxIdleConns
	poolConfig.MaxConnLifetime = cfg.DBConnMaxLifetime

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database pool: %w", err)
	}

	// Verify initial ping with timeout
	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("database ping failed: %w", err)
	}

	return &DB{Pool: pool}, nil
}

// Ping verifies active database connectivity.
func (db *DB) Ping(ctx context.Context) error {
	if db == nil || db.Pool == nil {
		return fmt.Errorf("database pool not initialized")
	}
	return db.Pool.Ping(ctx)
}

// Close gracefully closes the connection pool.
func (db *DB) Close() {
	if db != nil && db.Pool != nil {
		db.Pool.Close()
	}
}

// WithAuthenticatedTx executes a callback within an isolated database transaction,
// establishing cryptographically verified PostgreSQL session context (app._user_id, app._org_id, app._sig).
// The transaction is automatically committed on success and rolled back on error or panic.
func (db *DB) WithAuthenticatedTx(
	ctx context.Context,
	tokenHash string,
	requestedOrgID *string,
	fn func(ctx context.Context, tx pgx.Tx, auth *AuthContext) error,
) (err error) {
	if db == nil || db.Pool == nil {
		return fmt.Errorf("database pool not initialized")
	}

	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		} else if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	authCtx, err := AuthenticateAndSetContext(ctx, tx, tokenHash, requestedOrgID)
	if err != nil {
		return err
	}

	if err = fn(ctx, tx, authCtx); err != nil {
		return err
	}

	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// WithSystemWorkerTx executes a background system worker task within an isolated database transaction.
// The transaction is automatically committed on success and rolled back on error or panic.
func (db *DB) WithSystemWorkerTx(
	ctx context.Context,
	fn func(ctx context.Context, tx pgx.Tx) error,
) (err error) {
	if db == nil || db.Pool == nil {
		return fmt.Errorf("database pool not initialized")
	}

	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		} else if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	if err = fn(ctx, tx); err != nil {
		return err
	}

	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}
