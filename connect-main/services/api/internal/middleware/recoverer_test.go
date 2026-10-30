package middleware_test

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tathastu/connect/services/api/internal/middleware"
	"github.com/tathastu/connect/services/api/internal/model"
)

func TestRecovererCatchesPanicAndSanitizesError(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	// Handler that intentionally triggers a panic with sensitive internal information
	panickingHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("CRITICAL_INTERNAL_DATABASE_SECRET_KEY_EXPOSURE_SIMULATION")
	})

	stack := middleware.RequestID(middleware.Recoverer(logger)(panickingHandler))

	req := httptest.NewRequest(http.MethodGet, "/panic-route", nil)
	w := httptest.NewRecorder()

	stack.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 Internal Server Error, got %d", w.Code)
	}

	body := w.Body.String()
	if strings.Contains(body, "CRITICAL_INTERNAL_DATABASE_SECRET_KEY_EXPOSURE_SIMULATION") {
		t.Fatalf("SECURITY VIOLATION: Panic message leaked in HTTP response: %s", body)
	}

	var errResp model.ErrorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("failed to decode safe error response: %v", err)
	}

	if errResp.Error.Code != "INTERNAL_SERVER_ERROR" {
		t.Fatalf("expected INTERNAL_SERVER_ERROR code, got %s", errResp.Error.Code)
	}
	if errResp.Error.RequestID == "" || errResp.Error.RequestID == "unknown" {
		t.Fatalf("expected valid correlated RequestID, got %s", errResp.Error.RequestID)
	}
}
