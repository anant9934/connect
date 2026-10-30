package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const (
	CookieProduction = "__Host-tc_session"
	CookieDev        = "tc_session"
)

// GenerateSessionToken creates a 256-bit cryptographically secure random session token.
func GenerateSessionToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("failed to generate secure session entropy: %w", err)
	}
	return hex.EncodeToString(bytes), nil
}

// HashSessionToken computes a SHA-256 hash of the session token for database storage.
// Raw tokens are never persisted to the database.
func HashSessionToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// SetSessionCookie sets the secure HTTP-only cookie on the client response.
func SetSessionCookie(w http.ResponseWriter, token string, isProduction bool, maxAge time.Duration) {
	cookieName := CookieProduction
	if !isProduction {
		cookieName = CookieDev
	}

	// #nosec G124 -- Cookie Secure attribute is dynamically enforced based on isProduction environment
	// nosemgrep: go.lang.security.audit.net.cookie-missing-secure.cookie-missing-secure
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   isProduction,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(maxAge.Seconds()),
	})
}

// ClearSessionCookie clears both possible session cookie names.
func ClearSessionCookie(w http.ResponseWriter, isProduction bool) {
	cookieNames := []string{CookieProduction, CookieDev}
	for _, name := range cookieNames {
		// #nosec G124 -- Cookie Secure attribute is dynamically enforced based on isProduction environment
		// nosemgrep: go.lang.security.audit.net.cookie-missing-secure.cookie-missing-secure
		http.SetCookie(w, &http.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			HttpOnly: true,
			Secure:   isProduction,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   -1,
			Expires:  time.Unix(0, 0),
		})
	}
}

// ExtractSessionToken extracts the raw session token from incoming cookies or Authorization header.
func ExtractSessionToken(r *http.Request) string {
	// 1. Try production cookie __Host-tc_session
	if cookie, err := r.Cookie(CookieProduction); err == nil && cookie.Value != "" {
		return strings.TrimSpace(cookie.Value)
	}

	// 2. Try development cookie tc_session
	if cookie, err := r.Cookie(CookieDev); err == nil && cookie.Value != "" {
		return strings.TrimSpace(cookie.Value)
	}

	// 3. Fallback to Authorization: Bearer <token> for programmatic/testing clients
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	}

	return ""
}
