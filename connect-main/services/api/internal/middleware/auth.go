package middleware

import (
	"context"
	"net/http"

	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/model"
)

const userContextKey contextKey = "authenticated_user"

// UserFromContext retrieves the authenticated user from the request context if present.
func UserFromContext(ctx context.Context) (*auth.User, bool) {
	u, ok := ctx.Value(userContextKey).(*auth.User)
	return u, ok && u != nil
}

// RequireAuth ensures that the incoming request has a valid active session.
func RequireAuth(authService *auth.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := auth.ExtractSessionToken(r)
			if token == "" {
				model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
				return
			}

			user, _, err := authService.ValidateSession(r.Context(), token)
			if err != nil {
				model.SendJSONError(w, r, http.StatusUnauthorized, "SESSION_EXPIRED", "Session expired or invalid")
				return
			}

			ctx := context.WithValue(r.Context(), userContextKey, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// OptionalAuth extracts and injects authenticated user if session cookie is present, but allows guests.
func OptionalAuth(authService *auth.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := auth.ExtractSessionToken(r)
			if token != "" {
				if user, _, err := authService.ValidateSession(r.Context(), token); err == nil && user != nil {
					ctx := context.WithValue(r.Context(), userContextKey, user)
					r = r.WithContext(ctx)
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
