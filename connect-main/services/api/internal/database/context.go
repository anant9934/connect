package database

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// AuthContext holds the verified identity context returned by PostgreSQL connect_auth.authenticate_session.
type AuthContext struct {
	UserID         string
	OrganizationID *string
	Role           *string
	IsSuperAdmin   bool
	AuthSig        string
}

// AuthenticateAndSetContext invokes the trusted PostgreSQL security definer procedure
// connect_auth.authenticate_session inside the given transaction.
// It cryptographically establishes transaction-local variables (app._user_id, app._org_id, app._sig)
// bound to the current transaction ID (pg_current_xact_id).
func AuthenticateAndSetContext(ctx context.Context, tx pgx.Tx, tokenHash string, requestedOrgID *string) (*AuthContext, error) {
	if tokenHash == "" {
		return nil, fmt.Errorf("token hash is required to establish database auth context")
	}

	query := `
		SELECT user_id, organization_id, role, is_super_admin, auth_sig
		FROM connect_auth.authenticate_session($1::VARCHAR, $2::UUID);
	`

	var (
		userID   string
		orgID    *string
		role     *string
		isSuper  bool
		authSig  string
	)

	err := tx.QueryRow(ctx, query, tokenHash, requestedOrgID).Scan(
		&userID,
		&orgID,
		&role,
		&isSuper,
		&authSig,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to authenticate database session context: %w", err)
	}

	return &AuthContext{
		UserID:         userID,
		OrganizationID: orgID,
		Role:           role,
		IsSuperAdmin:   isSuper,
		AuthSig:        authSig,
	}, nil
}
