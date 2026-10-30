package middleware

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/tathastu/connect/services/api/internal/model"
)

// CSRFProtection enforces origin and fetch-metadata validation for state-changing HTTP methods.
func CSRFProtection(allowedOrigins []string) func(http.Handler) http.Handler {
	allowedMap := make(map[string]bool, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowedMap[strings.ToLower(strings.TrimSpace(o))] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Safe HTTP methods (GET, HEAD, OPTIONS) do not require CSRF origin validation
			if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}

			// Sec-Fetch-Site mitigation: reject explicit cross-site state-changing requests
			if secSite := r.Header.Get("Sec-Fetch-Site"); secSite == "cross-site" {
				model.SendJSONError(w, r, http.StatusForbidden, "CSRF_DETECTED", "Cross-site request blocked")
				return
			}

			// Validate Origin header
			origin := r.Header.Get("Origin")
			if origin != "" {
				if !allowedMap[strings.ToLower(origin)] {
					model.SendJSONError(w, r, http.StatusForbidden, "INVALID_ORIGIN", "Untrusted origin for state modification")
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			// Fallback to Referer header if Origin is omitted
			referer := r.Header.Get("Referer")
			if referer != "" {
				parsed, err := url.Parse(referer)
				if err != nil {
					model.SendJSONError(w, r, http.StatusForbidden, "INVALID_REFERER", "Malformed request referer")
					return
				}
				refOrigin := strings.ToLower(parsed.Scheme + "://" + parsed.Host)
				if !allowedMap[refOrigin] {
					model.SendJSONError(w, r, http.StatusForbidden, "INVALID_REFERER", "Untrusted referer for state modification")
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			// If neither Origin nor Referer is present, allow only if no session cookie was included
			// (e.g. non-browser API test clients using pure Authorization header)
			if r.Header.Get("Cookie") != "" && strings.Contains(r.Header.Get("Cookie"), "tc_session") {
				model.SendJSONError(w, r, http.StatusForbidden, "ORIGIN_REQUIRED", "Origin or Referer required for cookie-authenticated mutation")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
