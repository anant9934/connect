package database_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/tathastu/connect/services/api/internal/database"
)

func TestDB_UninitializedPoolHandling(t *testing.T) {
	var nilDB *database.DB
	ctx := context.Background()

	// Ping on nil DB
	if err := nilDB.Ping(ctx); err == nil || !strings.Contains(err.Error(), "not initialized") {
		t.Errorf("expected pool not initialized error, got: %v", err)
	}

	// Ping on DB with nil pool
	emptyDB := &database.DB{Pool: nil}
	if err := emptyDB.Ping(ctx); err == nil || !strings.Contains(err.Error(), "not initialized") {
		t.Errorf("expected pool not initialized error, got: %v", err)
	}

	// Close on nil DB should not panic
	nilDB.Close()
	emptyDB.Close()

	// WithAuthenticatedTx on nil DB
	err := nilDB.WithAuthenticatedTx(ctx, "test_token", nil, func(ctx context.Context, tx pgx.Tx, auth *database.AuthContext) error {
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "not initialized") {
		t.Errorf("expected pool not initialized error, got: %v", err)
	}

	// WithSystemWorkerTx on nil DB
	err = nilDB.WithSystemWorkerTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "not initialized") {
		t.Errorf("expected pool not initialized error, got: %v", err)
	}
}

func TestAuthenticateAndSetContext_EmptyTokenHash(t *testing.T) {
	ctx := context.Background()
	_, err := database.AuthenticateAndSetContext(ctx, nil, "", nil)
	if err == nil || !strings.Contains(err.Error(), "token hash is required") {
		t.Errorf("expected token hash required error, got: %v", err)
	}
}
