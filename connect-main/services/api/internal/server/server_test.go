package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tathastu/connect/services/api/internal/audit"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/config"
	"github.com/tathastu/connect/services/api/internal/files"
	"github.com/tathastu/connect/services/api/internal/handlers"
	"github.com/tathastu/connect/services/api/internal/livekit"
	"github.com/tathastu/connect/services/api/internal/meeting/p2p"
	"github.com/tathastu/connect/services/api/internal/model"
	"github.com/tathastu/connect/services/api/internal/notes"
	"github.com/tathastu/connect/services/api/internal/ratelimit"
	"github.com/tathastu/connect/services/api/internal/room"
	"github.com/tathastu/connect/services/api/internal/server"
)

// mockPinger implements handlers.Pinger for testing readiness health
type mockPinger struct {
	err error
}

func (m *mockPinger) Ping(_ context.Context) error {
	return m.err
}

func setupTestRouter(t *testing.T, dbErr, redisErr error) http.Handler {
	t.Helper()

	cfg := &config.Config{
		AppEnv:             config.EnvDevelopment,
		Port:               8080,
		CORSAllowedOrigins: []string{"http://localhost:3000", "https://collab.tathastu.test"},
		RateLimitEnabled:   true,
		RateLimitRPS:       50,
		TathastuIssuer:     "https://auth.aitathastu.internal",
		TathastuAudience:   "tathastu-connect-service",
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	limiter, err := ratelimit.NewDevMemoryLimiter(cfg.AppEnv)
	if err != nil {
		t.Fatalf("failed to init test limiter: %v", err)
	}

	var db handlers.Pinger
	if dbErr != nil {
		db = &mockPinger{err: dbErr}
	} else {
		db = &mockPinger{err: nil}
	}

	var rdb handlers.Pinger
	if redisErr != nil {
		rdb = &mockPinger{err: redisErr}
	} else {
		rdb = &mockPinger{err: nil}
	}

	hHandler := handlers.NewHealthHandler(db, rdb, logger)
	sHandler := handlers.NewSystemHandler("v0.1.0-test")
	aHandler := handlers.NewAssertionHandler(cfg)

	auditService := audit.NewService(nil, logger)
	authRepo := auth.NewMemoryRepository()
	authService := auth.NewService(authRepo, auditService, 12*time.Hour, 7*24*time.Hour)
	authHandler := auth.NewHandlers(authService, limiter, false)

	roomRepo := room.NewMemoryRepository()
	roomPolicy := room.NewPolicy()
	tokenService := livekit.NewTokenService("test_key", "test_secret")
	roomService := room.NewService(roomRepo, roomPolicy, auditService, tokenService, nil)
	roomHandler := room.NewHandlers(roomService, limiter, "http://localhost:3000", "http://localhost:7880")

	notesRepo := notes.NewMemoryRepository()
	notesService := notes.NewService(notesRepo, roomService, auditService)
	notesHandler := notes.NewHandler(notesService)

	filesRepo := files.NewMemoryRepository()
	filesStorage := files.NewMemoryStorageProvider()
	filesScanner := files.NewHeuristicScanner()
	filesService := files.NewService(filesRepo, filesStorage, filesScanner, roomService, auditService)
	filesHandler := files.NewHandler(filesService)

	p2pHub := p2p.NewHub(logger)
	p2pHandler := p2p.NewHandler(cfg, logger, p2pHub, roomService, authService)

	return server.BuildRouter(cfg, logger, limiter, hHandler, sHandler, aHandler, authHandler, roomHandler, notesHandler, filesHandler, authService, p2pHandler, nil, nil, nil)
}

// 1. Test Health Liveness probe
func TestLivenessEndpoint(t *testing.T) {
	router := setupTestRouter(t, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/health/live", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", w.Code)
	}

	var resp model.HealthResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if resp.Status != "ok" {
		t.Fatalf("expected status ok, got %s", resp.Status)
	}
}

// 2. Test Health Readiness probe success
func TestReadinessSuccess(t *testing.T) {
	router := setupTestRouter(t, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", w.Code)
	}
}

// 3. Test Health Readiness failure behavior (Zero leak of DB credentials/errors)
func TestReadinessDegraded(t *testing.T) {
	router := setupTestRouter(t, errors.New("connection refused to 10.0.0.5:5432 with secret_pwd"), nil)

	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 Service Unavailable, got %d", w.Code)
	}

	body := w.Body.String()
	if strings.Contains(body, "10.0.0.5") || strings.Contains(body, "secret_pwd") {
		t.Fatalf("SECURITY VIOLATION: Database error leaked in readiness response: %s", body)
	}

	var resp model.HealthResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if resp.Status != "degraded" {
		t.Fatalf("expected status degraded, got %s", resp.Status)
	}
}

// 4. Test System Status endpoint (minimal, safe diagnostics)
func TestSystemStatus(t *testing.T) {
	router := setupTestRouter(t, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/system/status", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", w.Code)
	}

	var resp model.SystemStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if resp.Status != "operational" || resp.Service != "tathastu-connect-api" {
		t.Fatalf("unexpected system status: %+v", resp)
	}
}

// 5. Test Request Body Size Limit Rejection
func TestRequestBodySizeLimit(t *testing.T) {
	router := setupTestRouter(t, nil, nil)

	// Create oversized payload exceeding 1MB
	oversized := bytes.Repeat([]byte("A"), 1024*1024+100)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/collab/validate-assertion", bytes.NewReader(oversized))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusRequestEntityTooLarge && w.Code != http.StatusBadRequest {
		t.Fatalf("expected 413 or 400 for oversized payload, got %d", w.Code)
	}
}

// 6. Test Malformed JSON Rejection
func TestMalformedJSONRejection(t *testing.T) {
	router := setupTestRouter(t, nil, nil)

	malformed := []byte(`{"iss": "test", broken_json`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/collab/validate-assertion", bytes.NewReader(malformed))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request, got %d", w.Code)
	}

	var errResp model.ErrorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("expected safe structured json error: %v", err)
	}
	if errResp.Error.Code != "MALFORMED_JSON" {
		t.Fatalf("expected MALFORMED_JSON error code, got %s", errResp.Error.Code)
	}
}

// 7. Test Unknown Field Rejection (Anti-Mass-Assignment)
func TestUnknownFieldRejection(t *testing.T) {
	router := setupTestRouter(t, nil, nil)

	// Malicious client injecting unexpected privileges or fields
	payload := []byte(`{
		"iss": "https://auth.aitathastu.internal",
		"aud": "tathastu-connect-service",
		"sub": "user_123",
		"exp": 9999999999,
		"nbf": 1000000000,
		"iat": 1000000000,
		"jti": "uuid-nonce-123",
		"purpose": "collab_session",
		"contextRef": "ctx_456",
		"isAdmin": true,
		"role": "superadmin"
	}`)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/collab/validate-assertion", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on unknown fields, got %d", w.Code)
	}

	var errResp model.ErrorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("expected structured error: %v", err)
	}
	if errResp.Error.Code != "UNKNOWN_FIELD" {
		t.Fatalf("expected UNKNOWN_FIELD code, got %s", errResp.Error.Code)
	}
}

// 8. Test Security Headers Policy
func TestSecurityHeaders(t *testing.T) {
	router := setupTestRouter(t, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/health/live", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	headers := w.Header()

	if headers.Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("missing or invalid X-Content-Type-Options: %s", headers.Get("X-Content-Type-Options"))
	}
	if headers.Get("X-Frame-Options") != "DENY" {
		t.Errorf("missing or invalid X-Frame-Options: %s", headers.Get("X-Frame-Options"))
	}
	if headers.Get("Referrer-Policy") != "strict-origin-when-cross-origin" {
		t.Errorf("missing or invalid Referrer-Policy: %s", headers.Get("Referrer-Policy"))
	}
	if !strings.Contains(headers.Get("Content-Security-Policy"), "default-src 'self'") {
		t.Errorf("missing default-src in Content-Security-Policy: %s", headers.Get("Content-Security-Policy"))
	}
	if headers.Get("Cross-Origin-Opener-Policy") != "same-origin" {
		t.Errorf("missing Cross-Origin-Opener-Policy: %s", headers.Get("Cross-Origin-Opener-Policy"))
	}
	if headers.Get("X-Powered-By") != "" {
		t.Errorf("X-Powered-By should be removed")
	}
}

// 9. Test CORS Rejection & Allowlist
func TestCORSOriginValidation(t *testing.T) {
	router := setupTestRouter(t, nil, nil)

	// Case A: Disallowed origin
	reqBad := httptest.NewRequest(http.MethodOptions, "/api/v1/system/status", nil)
	reqBad.Header.Set("Origin", "https://malicious-attacker.com")
	wBad := httptest.NewRecorder()
	router.ServeHTTP(wBad, reqBad)

	if wBad.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for unapproved origin, got %d", wBad.Code)
	}
	if wBad.Header().Get("Access-Control-Allow-Origin") == "https://malicious-attacker.com" {
		t.Fatalf("SECURITY VIOLATION: Malicious origin reflected in Access-Control-Allow-Origin")
	}

	// Case B: Allowed origin
	reqGood := httptest.NewRequest(http.MethodOptions, "/api/v1/system/status", nil)
	reqGood.Header.Set("Origin", "http://localhost:3000")
	wGood := httptest.NewRecorder()
	router.ServeHTTP(wGood, reqGood)

	if wGood.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for preflight, got %d", wGood.Code)
	}
	if wGood.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Fatalf("expected allowed origin in header, got %s", wGood.Header().Get("Access-Control-Allow-Origin"))
	}
}

// 10. Test Valid Assertion Handoff
func TestValidAssertionHandoff(t *testing.T) {
	router := setupTestRouter(t, nil, nil)

	validPayload := map[string]any{
		"iss":        "https://auth.aitathastu.internal",
		"aud":        "tathastu-connect-service",
		"sub":        "researcher-dr-sharma-99",
		"exp":        time.Now().Add(5 * time.Minute).Unix(),
		"nbf":        time.Now().Add(-1 * time.Minute).Unix(),
		"iat":        time.Now().Unix(),
		"jti":        "nonce-uuid-7711",
		"purpose":    "collab_session",
		"contextRef": "matched-graph-node-404",
	}

	raw, _ := json.Marshal(validPayload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/collab/validate-assertion", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for valid assertion, got %d: %s", w.Code, w.Body.String())
	}
}
