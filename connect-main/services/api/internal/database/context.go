package database

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNoSessionToken is returned when establishing database auth context without a session token hash.
var ErrNoSessionToken = errors.New("token hash is required to establish database auth context")

// ErrSessionInvalid is returned when a session token hash is invalid, expired, or revoked (SQLSTATE 28000).
var ErrSessionInvalid = errors.New("invalid, expired, or revoked session token")

// ErrMembershipDenied is returned when an authenticated user does not have an active membership in the requested organization (SQLSTATE 42501 from connect_auth.authenticate_session).
var ErrMembershipDenied = errors.New("organization membership denied")

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
		return nil, ErrNoSessionToken
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
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			if pgErr.Code == "28000" {
				return nil, fmt.Errorf("%w: %w", ErrSessionInvalid, err)
			}
			if pgErr.Code == "42501" && requestedOrgID != nil {
				msg := strings.TrimSpace(pgErr.Message)
				msg = strings.TrimPrefix(msg, "ERROR:")
				msg = strings.TrimSpace(msg)
				if strings.HasPrefix(msg, "Authorization Failed:") || strings.Contains(msg, "has no active membership in Organization") {
					return nil, fmt.Errorf("%w: %w", ErrMembershipDenied, err)
				}
			}
		}
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
