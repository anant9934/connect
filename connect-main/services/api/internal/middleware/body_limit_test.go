package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tathastu/connect/services/api/internal/middleware"
)

func TestRequireJSONContentType_WebhookMediaTypeScopedToWebhookRoute(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	cases := []struct {
		path string
		want int
	}{
		{"/api/v1/livekit/webhook", http.StatusOK},
		{"/api/v1/rooms/", http.StatusUnsupportedMediaType},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/webhook+json")
		rec := httptest.NewRecorder()
		middleware.RequireJSONContentType(next).ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Errorf("%s: got %d, want %d", tc.path, rec.Code, tc.want)
		}
	}
}
