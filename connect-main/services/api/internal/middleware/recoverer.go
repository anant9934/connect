package middleware

import (
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/tathastu/connect/services/api/internal/model"
)

// Recoverer intercepts panics, logs stack traces internally, and returns a safe sanitized 500 error.
func Recoverer(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rvr := recover(); rvr != nil {
					reqID := GetRequestID(r.Context())
					stack := string(debug.Stack())

					// Log full diagnostics internally
					logger.Error("panic_recovered",
						slog.String("request_id", reqID),
						slog.String("panic", fmt.Sprintf("%v", rvr)),
						slog.String("stack", stack),
					)

					// Send sanitized, safe JSON error without revealing internal code traces
					model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "An unexpected internal error occurred")
				}
			}()

			next.ServeHTTP(w, r)
		})
	}
}
