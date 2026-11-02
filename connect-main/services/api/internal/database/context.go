package database

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
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
		userID  string
		orgID   *string
		role    *string
		isSuper bool
		authSig string
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

type sessionTokenHashKey struct{}

// WithSessionTokenHash records the hash of a session the auth middleware already validated.
func WithSessionTokenHash(ctx context.Context, tokenHash string) context.Context {
	return context.WithValue(ctx, sessionTokenHashKey{}, tokenHash)
}

// SessionTokenHash returns the hash recorded by WithSessionTokenHash, or "" when there is none.
func SessionTokenHash(ctx context.Context) string {
	hash, _ := ctx.Value(sessionTokenHashKey{}).(string)
	return hash
}

type guestIdentityKey struct{}

// WithGuestIdentity records a guest identity whose signed token the API already verified.
func WithGuestIdentity(ctx context.Context, identity string) context.Context {
	return context.WithValue(ctx, guestIdentityKey{}, identity)
}

// GuestIdentity returns the identity recorded by WithGuestIdentity, or "" when there is none.
func GuestIdentity(ctx context.Context) string {
	identity, _ := ctx.Value(guestIdentityKey{}).(string)
	return identity
}

// WithAuthContext runs fn in one transaction carrying the verified, transaction-local
// identity of tokenHash. The context ends with the transaction, so pooled connections
// cannot leak it. Any error, including a denied organization, rolls everything back.
func WithAuthContext(ctx context.Context, pool *pgxpool.Pool, tokenHash string, orgID *string, fn func(pgx.Tx, *AuthContext) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	auth, err := AuthenticateAndSetContext(ctx, tx, tokenHash, orgID)
	if err != nil {
		return err
	}
	if err := fn(tx, auth); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// WithRoomGuestContext runs fn in one transaction limited to a single room for a guest whose
// signed token the API has already verified. The database refuses non-participants.
func WithRoomGuestContext(ctx context.Context, pool *pgxpool.Pool, roomID, identity string, fn func(pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT connect_auth.authenticate_room_guest($1::UUID, $2)`, roomID, identity); err != nil {
		return fmt.Errorf("failed to establish guest room context: %w", err)
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// InCallerContext runs fn in the context of whoever the request authenticated: a session, or a
// guest limited to roomID. With neither it refuses, rather than run with no identity.
func InCallerContext(ctx context.Context, pool *pgxpool.Pool, roomID string, fn func(pgx.Tx) error) error {
	if tokenHash := SessionTokenHash(ctx); tokenHash != "" {
		return WithAuthContext(ctx, pool, tokenHash, nil, func(tx pgx.Tx, _ *AuthContext) error {
			return fn(tx)
		})
	}
	if identity := GuestIdentity(ctx); identity != "" {
		return WithRoomGuestContext(ctx, pool, roomID, identity, fn)
	}
	return &pgconn.PgError{Code: "42501", Message: "no caller identity"}
}
