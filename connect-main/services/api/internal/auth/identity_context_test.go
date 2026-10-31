package auth_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/database"
)

func TestVerifiedIdentity_ContextInjectionAndRetrieval(t *testing.T) {
	orgID := uuid.New().String()
	role := "institution_admin"

	ident := &auth.VerifiedIdentity{
		UserID:         uuid.New().String(),
		OrganizationID: &orgID,
		Role:           &role,
		IsSuperAdmin:   false,
		AuthSig:        "mock-hmac-sig",
	}

	ctx := auth.WithVerifiedIdentity(context.Background(), ident)
	retrieved := auth.GetVerifiedIdentity(ctx)

	if retrieved == nil {
		t.Fatal("expected retrieved identity to not be nil")
	}
	if retrieved.UserID != ident.UserID {
		t.Errorf("expected UserID %s, got %s", ident.UserID, retrieved.UserID)
	}
	if retrieved.OrganizationID == nil || *retrieved.OrganizationID != orgID {
		t.Errorf("expected OrgID %s, got %v", orgID, retrieved.OrganizationID)
	}
	if retrieved.Role == nil || *retrieved.Role != role {
		t.Errorf("expected Role %s, got %v", role, retrieved.Role)
	}
	if retrieved.IsSuperAdmin {
		t.Error("expected IsSuperAdmin to be false")
	}
	if retrieved.AuthSig != "mock-hmac-sig" {
		t.Errorf("expected AuthSig mock-hmac-sig, got %s", retrieved.AuthSig)
	}
}

func TestGetVerifiedIdentity_MissingContextReturnsNil(t *testing.T) {
	retrieved := auth.GetVerifiedIdentity(context.Background())
	if retrieved != nil {
		t.Errorf("expected nil for missing identity context, got %+v", retrieved)
	}
}

func TestExtractRequestedOrgID(t *testing.T) {
	validOrg := uuid.New().String()

	// 1. Header extraction
	req1 := httptest.NewRequest(http.MethodGet, "/api/v1/courses", nil)
	req1.Header.Set("X-Organization-ID", validOrg)
	extracted1 := auth.ExtractRequestedOrgID(req1)
	if extracted1 == nil || *extracted1 != validOrg {
		t.Errorf("expected header extracted org %s, got %v", validOrg, extracted1)
	}

	// 2. Query param extraction
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/courses?org_id="+validOrg, nil)
	extracted2 := auth.ExtractRequestedOrgID(req2)
	if extracted2 == nil || *extracted2 != validOrg {
		t.Errorf("expected query param extracted org %s, got %v", validOrg, extracted2)
	}

	// 3. Invalid UUID ignored
	req3 := httptest.NewRequest(http.MethodGet, "/api/v1/courses", nil)
	req3.Header.Set("X-Organization-ID", "not-a-uuid")
	extracted3 := auth.ExtractRequestedOrgID(req3)
	if extracted3 != nil {
		t.Errorf("expected invalid org UUID to be ignored, got %v", extracted3)
	}

	// 4. Missing org returns nil
	req4 := httptest.NewRequest(http.MethodGet, "/api/v1/courses", nil)
	extracted4 := auth.ExtractRequestedOrgID(req4)
	if extracted4 != nil {
		t.Errorf("expected nil for missing org, got %v", extracted4)
	}
}

func TestFromDatabaseAuthContext(t *testing.T) {
	orgID := uuid.New().String()
	role := "institution_member"

	dbCtx := &database.AuthContext{
		UserID:         uuid.New().String(),
		OrganizationID: &orgID,
		Role:           &role,
		IsSuperAdmin:   true,
		AuthSig:        "sig-12345",
	}

	mapped := auth.FromDatabaseAuthContext(dbCtx)
	if mapped == nil {
		t.Fatal("expected mapped identity to not be nil")
	}
	if mapped.UserID != dbCtx.UserID || *mapped.OrganizationID != orgID || !mapped.IsSuperAdmin || mapped.AuthSig != "sig-12345" {
		t.Errorf("mapped identity mismatch: %+v", mapped)
	}

	if auth.FromDatabaseAuthContext(nil) != nil {
		t.Error("expected nil dbCtx to map to nil")
	}
}
