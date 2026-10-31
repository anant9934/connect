package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/tathastu/connect/services/api/internal/database"
)

type contextKey string

const (
	IdentityContextKey contextKey = "connect.auth.identity"
)

// VerifiedIdentity represents the authenticated and cryptographically bound request identity.
type VerifiedIdentity struct {
	UserID         string
	OrganizationID *string
	Role           *string
	IsSuperAdmin   bool
	AuthSig        string
}

// WithVerifiedIdentity injects the VerifiedIdentity into the standard context.
func WithVerifiedIdentity(ctx context.Context, ident *VerifiedIdentity) context.Context {
	return context.WithValue(ctx, IdentityContextKey, ident)
}

// GetVerifiedIdentity extracts the VerifiedIdentity from context. Returns nil if unauthenticated.
func GetVerifiedIdentity(ctx context.Context) *VerifiedIdentity {
	val := ctx.Value(IdentityContextKey)
	if val == nil {
		return nil
	}
	ident, ok := val.(*VerifiedIdentity)
	if !ok {
		return nil
	}
	return ident
}

// ExtractRequestedOrgID inspects request headers (X-Organization-ID) and query params for tenant scoping.
func ExtractRequestedOrgID(r *http.Request) *string {
	// 1. Header priority
	orgHeader := strings.TrimSpace(r.Header.Get("X-Organization-ID"))
	if orgHeader != "" {
		if _, err := uuid.Parse(orgHeader); err == nil {
			return &orgHeader
		}
	}

	// 2. Query param fallback
	orgQuery := strings.TrimSpace(r.URL.Query().Get("org_id"))
	if orgQuery != "" {
		if _, err := uuid.Parse(orgQuery); err == nil {
			return &orgQuery
		}
	}

	return nil
}

// FromDatabaseAuthContext maps a database.AuthContext into a VerifiedIdentity.
func FromDatabaseAuthContext(dbCtx *database.AuthContext) *VerifiedIdentity {
	if dbCtx == nil {
		return nil
	}
	return &VerifiedIdentity{
		UserID:         dbCtx.UserID,
		OrganizationID: dbCtx.OrganizationID,
		Role:           dbCtx.Role,
		IsSuperAdmin:   dbCtx.IsSuperAdmin,
		AuthSig:        dbCtx.AuthSig,
	}
}
