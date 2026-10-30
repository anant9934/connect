package middleware

import (
	"net/http"
	"strings"
)

// CORS returns a middleware enforcing strict cross-origin resource sharing policies.
func CORS(allowedOrigins []string) func(http.Handler) http.Handler {
	allowedMap := make(map[string]bool, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowedMap[strings.ToLower(strings.TrimSpace(o))] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")

			// Same-origin requests (no Origin header) proceed normally
			if origin == "" {
				next.ServeHTTP(w, r)
				return
			}

			// Validate Origin against strict allowlist (no wildcards, no arbitrary reflection)
			if allowedMap[strings.ToLower(origin)] {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, X-Request-ID, X-Participant-Identity, X-Guest-Token")
				w.Header().Set("Access-Control-Max-Age", "86400") // 24 hours
				w.Header().Set("Vary", "Origin")
			}

			// Handle preflight requests
			if r.Method == http.MethodOptions {
				if allowedMap[strings.ToLower(origin)] {
					w.WriteHeader(http.StatusNoContent)
				} else {
					w.WriteHeader(http.StatusForbidden)
				}
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
