package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// Browsers ask before sending these, and Go tests never do, so a missing method only shows in a browser.
func TestCORS_PreflightAllowsEveryMethodTheAPIRoutes(t *testing.T) {
	var handler http.Handler = http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	handler = corsForTest(handler)
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		req := httptest.NewRequest(http.MethodOptions, "/api/v1/x", nil)
		req.Header.Set("Origin", "http://localhost:3000")
		req.Header.Set("Access-Control-Request-Method", method)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if !strings.Contains(rec.Header().Get("Access-Control-Allow-Methods"), method) {
			t.Errorf("%s is not allowed: %q", method, rec.Header().Get("Access-Control-Allow-Methods"))
		}
	}
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/x", nil)
	req.Header.Set("Origin", "https://attacker.example")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Error("another origin was allowed")
	}
}

func corsForTest(next http.Handler) http.Handler {
	r := chi.NewRouter()
	r.Use(CORS([]string{"http://localhost:3000"}))
	r.Handle("/*", next)
	return r
}
