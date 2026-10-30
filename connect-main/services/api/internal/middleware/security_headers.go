package middleware

import (
	"net/http"
)

// SecurityHeadersConfig controls security header behaviors across environments.
type SecurityHeadersConfig struct {
	IsProduction bool
}

// SecurityHeaders applies production-grade HTTP security headers to all responses.
func SecurityHeaders(cfg SecurityHeadersConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Defend against MIME sniffing
			w.Header().Set("X-Content-Type-Options", "nosniff")

			// Defend against clickjacking
			w.Header().Set("X-Frame-Options", "DENY")

			// Referrer leak minimization
			w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")

			// Principle of Least Privilege: Restrict hardware media sensors on API & non-meeting surfaces
			w.Header().Set("Permissions-Policy", "camera=(), microphone=(), display-capture=(), geolocation=(), payment=()")

			// Process and origin isolation
			w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
			w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")

			// Restrictive Content Security Policy
			w.Header().Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self';")

			// HSTS strictly in production or over TLS
			if cfg.IsProduction || r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
				w.Header().Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
			}

			// Strip banner/fingerprinting headers
			w.Header().Del("X-Powered-By")
			w.Header().Del("Server")

			next.ServeHTTP(w, r)
		})
	}
}
