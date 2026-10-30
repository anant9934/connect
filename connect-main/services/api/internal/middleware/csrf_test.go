package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tathastu/connect/services/api/internal/middleware"
)

func TestCSRFProtection_PermittedAndBlockedPaths(t *testing.T) {
	allowedOrigins := []string{
		"https://connect.aitathastu.com",
		"http://localhost:3000",
	}

	csrfMiddleware := middleware.CSRFProtection(allowedOrigins)
	successHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK"))
	})
	handler := csrfMiddleware(successHandler)

	tests := []struct {
		name           string
		method         string
		origin         string
		referer        string
		secFetchSite   string
		cookie         string
		authorization  string
		expectedStatus int
	}{
		{
			name:           "Safe method GET allowed without Origin/Referer",
			method:         http.MethodGet,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Safe method OPTIONS allowed without Origin/Referer",
			method:         http.MethodOptions,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "POST with Sec-Fetch-Site cross-site is rejected",
			method:         http.MethodPost,
			secFetchSite:   "cross-site",
			origin:         "https://connect.aitathastu.com",
			expectedStatus: http.StatusForbidden,
		},
		{
			name:           "POST with valid allowed Origin succeeds",
			method:         http.MethodPost,
			origin:         "https://connect.aitathastu.com",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "POST with untrusted Origin is rejected",
			method:         http.MethodPost,
			origin:         "https://evil-attacker.com",
			expectedStatus: http.StatusForbidden,
		},
		{
			name:           "POST with valid Referer succeeds when Origin omitted",
			method:         http.MethodPost,
			referer:        "https://connect.aitathastu.com/room/123",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "POST with untrusted Referer is rejected",
			method:         http.MethodPost,
			referer:        "https://malicious.example.com/phish",
			expectedStatus: http.StatusForbidden,
		},
		{
			name:           "POST with ambient production __Host-tc_session cookie without Origin is rejected",
			method:         http.MethodPost,
			cookie:         "__Host-tc_session=jwt-session-token",
			expectedStatus: http.StatusForbidden,
		},
		{
			name:           "POST with ambient dev tc_session cookie without Origin is rejected",
			method:         http.MethodPost,
			cookie:         "tc_session=jwt-session-token",
			expectedStatus: http.StatusForbidden,
		},
		{
			name:           "POST with ambient tc_guest_ cookie without Origin is rejected",
			method:         http.MethodPost,
			cookie:         "tc_guest_ABCD1234=gst.token.here",
			expectedStatus: http.StatusForbidden,
		},
		{
			name:           "POST with Bearer token only (native mobile / API / webhook) without Origin succeeds",
			method:         http.MethodPost,
			authorization:  "Bearer valid-api-or-mobile-token",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "POST with no cookies and no Origin (pure automated client) succeeds",
			method:         http.MethodPost,
			expectedStatus: http.StatusOK,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "/api/v1/rooms/test/token", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.referer != "" {
				req.Header.Set("Referer", tc.referer)
			}
			if tc.secFetchSite != "" {
				req.Header.Set("Sec-Fetch-Site", tc.secFetchSite)
			}
			if tc.cookie != "" {
				req.Header.Set("Cookie", tc.cookie)
			}
			if tc.authorization != "" {
				req.Header.Set("Authorization", tc.authorization)
			}

			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			if rr.Code != tc.expectedStatus {
				t.Errorf("[%s] expected status %d, got %d (body: %s)", tc.name, tc.expectedStatus, rr.Code, rr.Body.String())
			}
		})
	}
}
