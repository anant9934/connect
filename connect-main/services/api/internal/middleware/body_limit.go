package middleware

import (
	"net/http"
	"strings"

	"github.com/tathastu/connect/services/api/internal/model"
)

// BodySizeLimit limits the maximum bytes readable from the HTTP request body.
func BodySizeLimit(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				limit := maxBytes
				if strings.HasSuffix(r.URL.Path, "/files/upload") {
					limit = 30 * 1024 * 1024 // 30 MB ceiling for file uploads
				}
				r.Body = http.MaxBytesReader(w, r.Body, limit)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireJSONContentType verifies that POST, PUT, and PATCH requests provide application/json Content-Type.
func RequireJSONContentType(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch {
			// If there is content, content-type must be application/json (except file uploads)
			if r.ContentLength > 0 {
				ct := r.Header.Get("Content-Type")
				if strings.HasSuffix(r.URL.Path, "/files/upload") && strings.HasPrefix(ct, "multipart/form-data") {
					next.ServeHTTP(w, r)
					return
				}
				// LiveKit webhooks use their own media type; the signature covers the body.
				if strings.HasSuffix(r.URL.Path, "/livekit/webhook") && ct == "application/webhook+json" {
					next.ServeHTTP(w, r)
					return
				}
				if ct != "application/json" && !containsPrefix(ct, "application/json;") {
					model.SendJSONError(w, r, http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json")
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

func containsPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}
