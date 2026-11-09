package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/tathastu/connect/services/api/internal/model"
	"github.com/tathastu/connect/services/api/internal/ratelimit"
)

// Handlers defines the HTTP presentation layer for authentication and user accounts.
type Handlers struct {
	service      *Service
	limiter      ratelimit.Limiter
	isProduction bool
	// sso is university single sign-on; nil when not configured.
	sso *SSO
}

// NewHandlers constructs authentication endpoints.
func NewHandlers(service *Service, limiter ratelimit.Limiter, isProduction bool) *Handlers {
	return &Handlers{
		service:      service,
		limiter:      limiter,
		isProduction: isProduction,
		sso:          LoadSSOFromEnv(isProduction),
	}
}

// Signup handles POST /api/v1/auth/signup
func (h *Handlers) Signup(w http.ResponseWriter, r *http.Request) {
	clientIP := extractIP(r)
	reqID := getRequestID(r)

	// Rate limit signup by client IP (max 10 attempts per minute)
	if h.limiter != nil {
		allowed, err := h.limiter.Allow(r.Context(), fmt.Sprintf("signup:%s", clientIP), 10, time.Minute)
		if err != nil || !allowed {
			w.Header().Set("Retry-After", "60")
			model.SendJSONError(w, r, http.StatusTooManyRequests, "TOO_MANY_REQUESTS", "Too many signup attempts. Please try again later.")
			return
		}
	}

	var req SignupDTO
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "MALFORMED_REQUEST", "Invalid signup payload")
		return
	}

	result, err := h.service.Signup(r.Context(), req, clientIP, reqID)
	if err != nil {
		switch {
		case errors.Is(err, ErrEmailTaken):
			model.SendJSONError(w, r, http.StatusConflict, "EMAIL_EXISTS", err.Error())
		case errors.Is(err, ErrInvalidEmail), errors.Is(err, ErrInvalidPassword), errors.Is(err, ErrInvalidDisplayName):
			model.SendJSONError(w, r, http.StatusBadRequest, "VALIDATION_FAILED", err.Error())
		default:
			model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to process registration")
		}
		return
	}

	// Set secure HTTP-only session cookie
	SetSessionCookie(w, result.Token, h.isProduction, 7*24*time.Hour)

	model.SendJSON(w, http.StatusCreated, map[string]any{
		"user":  result.User,
		"token": result.Token,
	})
}

// Login handles POST /api/v1/auth/login
func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	clientIP := extractIP(r)
	reqID := getRequestID(r)

	var req LoginDTO
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "MALFORMED_REQUEST", "Invalid login payload")
		return
	}

	emailNormalized := strings.ToLower(strings.TrimSpace(req.Email))

	// Rate limit login by IP + normalized email (max 5 attempts per minute)
	if h.limiter != nil {
		rateKey := fmt.Sprintf("login:%s:%s", clientIP, emailNormalized)
		allowed, err := h.limiter.Allow(r.Context(), rateKey, 5, time.Minute)
		if err != nil || !allowed {
			w.Header().Set("Retry-After", "60")
			model.SendJSONError(w, r, http.StatusTooManyRequests, "TOO_MANY_REQUESTS", "Too many login attempts. Please try again later.")
			return
		}
	}

	result, err := h.service.Login(r.Context(), req, clientIP, reqID)
	if err != nil {
		if errors.Is(err, ErrAccountDisabled) {
			model.SendJSONError(w, r, http.StatusForbidden, "ACCOUNT_DISABLED", err.Error())
			return
		}
		// Uniform response for bad credentials or non-existent user
		model.SendJSONError(w, r, http.StatusUnauthorized, "INVALID_CREDENTIALS", ErrInvalidCredentials.Error())
		return
	}

	// Set secure HTTP-only session cookie
	SetSessionCookie(w, result.Token, h.isProduction, 7*24*time.Hour)

	model.SendJSON(w, http.StatusOK, map[string]any{
		"user":  result.User,
		"token": result.Token,
	})
}

// Logout handles POST /api/v1/auth/logout
func (h *Handlers) Logout(w http.ResponseWriter, r *http.Request) {
	clientIP := extractIP(r)
	reqID := getRequestID(r)
	token := ExtractSessionToken(r)

	if token != "" {
		_ = h.service.Logout(r.Context(), token, clientIP, reqID)
	}

	ClearSessionCookie(w, h.isProduction)

	model.SendJSON(w, http.StatusOK, map[string]any{
		"success": true,
	})
}

// Session handles GET /api/v1/auth/session
func (h *Handlers) Session(w http.ResponseWriter, r *http.Request) {
	token := ExtractSessionToken(r)
	if token == "" {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}

	user, _, err := h.service.ValidateSession(r.Context(), token)
	if err != nil {
		ClearSessionCookie(w, h.isProduction)
		model.SendJSONError(w, r, http.StatusUnauthorized, "SESSION_EXPIRED", "Session expired or invalid")
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"user": ToUserDTO(user),
	})
}

// GetProfile handles GET /api/v1/users/me/profile
func (h *Handlers) GetProfile(w http.ResponseWriter, r *http.Request) {
	token := ExtractSessionToken(r)
	if token == "" {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}

	user, _, err := h.service.ValidateSession(r.Context(), token)
	if err != nil {
		ClearSessionCookie(w, h.isProduction)
		model.SendJSONError(w, r, http.StatusUnauthorized, "SESSION_EXPIRED", "Session expired or invalid")
		return
	}

	dto, err := h.service.GetProfile(r.Context(), user.ID)
	if err != nil {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "User profile not found")
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"profile": dto,
	})
}

// UpdateProfileDTO holds input for PATCH /api/v1/users/me/profile
type UpdateProfileDTO struct {
	DisplayName *string `json:"displayName"`
	AvatarID    *string `json:"avatarId"`
	AvatarURL   *string `json:"avatarUrl"`
}

// UpdateProfile handles PATCH /api/v1/users/me/profile
func (h *Handlers) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	token := ExtractSessionToken(r)
	if token == "" {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}

	user, _, err := h.service.ValidateSession(r.Context(), token)
	if err != nil {
		ClearSessionCookie(w, h.isProduction)
		model.SendJSONError(w, r, http.StatusUnauthorized, "SESSION_EXPIRED", "Session expired or invalid")
		return
	}

	var req UpdateProfileDTO
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "MALFORMED_REQUEST", "Invalid profile update payload")
		return
	}

	displayName := user.DisplayName
	if req.DisplayName != nil {
		displayName = *req.DisplayName
	}

	avatarID := user.AvatarID
	if req.AvatarID != nil {
		avatarID = *req.AvatarID
	}

	avatarURL := user.AvatarURL
	if req.AvatarURL != nil {
		// Pictures come through the upload route. An address from elsewhere would let any page
		// showing this picture be used to track who views it.
		if *req.AvatarURL != "" {
			model.SendJSONError(w, r, http.StatusBadRequest, "VALIDATION_FAILED", "Upload a picture instead of giving an address.")
			return
		}
		avatarURL = ""
	}

	updatedDTO, err := h.service.UpdateProfile(r.Context(), user.ID, displayName, avatarID, avatarURL)
	if err != nil {
		if errors.Is(err, ErrInvalidDisplayName) {
			model.SendJSONError(w, r, http.StatusBadRequest, "VALIDATION_FAILED", err.Error())
			return
		}
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to update profile")
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"profile": updatedDTO,
	})
}

// ChangePasswordDTO holds input for POST /api/v1/users/me/change-password
type ChangePasswordDTO struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

// ChangePassword handles POST /api/v1/users/me/change-password
func (h *Handlers) ChangePassword(w http.ResponseWriter, r *http.Request) {
	token := ExtractSessionToken(r)
	if token == "" {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}

	user, _, err := h.service.ValidateSession(r.Context(), token)
	if err != nil {
		ClearSessionCookie(w, h.isProduction)
		model.SendJSONError(w, r, http.StatusUnauthorized, "SESSION_EXPIRED", "Session expired or invalid")
		return
	}

	var req ChangePasswordDTO
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "MALFORMED_REQUEST", "Invalid password change payload")
		return
	}

	if err := h.service.ChangePassword(r.Context(), user.ID, req.CurrentPassword, req.NewPassword); err != nil {
		switch {
		case errors.Is(err, ErrInvalidCredentials):
			model.SendJSONError(w, r, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Current password does not match")
		case errors.Is(err, ErrInvalidPassword):
			model.SendJSONError(w, r, http.StatusBadRequest, "VALIDATION_FAILED", err.Error())
		default:
			model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to update password")
		}
		return
	}

	ClearSessionCookie(w, h.isProduction)
	model.SendJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Password updated successfully",
	})
}

// UpdatePreferencesDTO holds input for POST /api/v1/users/me/preferences
type UpdatePreferencesDTO struct {
	Preferences map[string]any `json:"preferences"`
}

// UpdatePreferences handles POST /api/v1/users/me/preferences
func (h *Handlers) UpdatePreferences(w http.ResponseWriter, r *http.Request) {
	token := ExtractSessionToken(r)
	if token == "" {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}

	user, _, err := h.service.ValidateSession(r.Context(), token)
	if err != nil {
		ClearSessionCookie(w, h.isProduction)
		model.SendJSONError(w, r, http.StatusUnauthorized, "SESSION_EXPIRED", "Session expired or invalid")
		return
	}

	var req UpdatePreferencesDTO
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&req); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "MALFORMED_REQUEST", "Invalid preferences payload")
		return
	}

	if err := h.service.UpdatePreferences(r.Context(), user.ID, req.Preferences); err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to save preferences")
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"preferences": req.Preferences,
	})
}

// GoogleAuthDTO holds input for Google authentication
type GoogleAuthDTO struct {
	IDToken string `json:"idToken"`
}

// GoogleAuth handles POST /api/v1/auth/google
func (h *Handlers) GoogleAuth(w http.ResponseWriter, r *http.Request) {
	clientIP := extractIP(r)
	reqID := getRequestID(r)

	// Rate limit Google login attempts (max 10 per minute per IP)
	if h.limiter != nil {
		allowed, err := h.limiter.Allow(r.Context(), fmt.Sprintf("google_auth:%s", clientIP), 10, time.Minute)
		if err != nil || !allowed {
			w.Header().Set("Retry-After", "60")
			model.SendJSONError(w, r, http.StatusTooManyRequests, "TOO_MANY_REQUESTS", "Too many authentication attempts. Please try again later.")
			return
		}
	}

	var req GoogleAuthDTO
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&req); err != nil || req.IDToken == "" {
		model.SendJSONError(w, r, http.StatusBadRequest, "MALFORMED_REQUEST", "Missing or invalid idToken")
		return
	}

	result, err := h.service.GoogleAuth(r.Context(), req.IDToken, clientIP, reqID)
	if err != nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "GOOGLE_AUTH_FAILED", err.Error())
		return
	}

	SetSessionCookie(w, result.Token, h.isProduction, 7*24*time.Hour)

	model.SendJSON(w, http.StatusOK, map[string]any{
		"user":  result.User,
		"token": result.Token,
	})
}

// LinkGoogle handles POST /api/v1/users/me/link-google
func (h *Handlers) LinkGoogle(w http.ResponseWriter, r *http.Request) {
	token := ExtractSessionToken(r)
	if token == "" {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}

	user, _, err := h.service.ValidateSession(r.Context(), token)
	if err != nil {
		ClearSessionCookie(w, h.isProduction)
		model.SendJSONError(w, r, http.StatusUnauthorized, "SESSION_EXPIRED", "Session expired or invalid")
		return
	}

	var req GoogleAuthDTO
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&req); err != nil || req.IDToken == "" {
		model.SendJSONError(w, r, http.StatusBadRequest, "MALFORMED_REQUEST", "Missing or invalid idToken")
		return
	}

	if err := h.service.LinkGoogle(r.Context(), user.ID, req.IDToken); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "LINK_FAILED", err.Error())
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"success":         true,
		"googleConnected": true,
	})
}

func extractIP(r *http.Request) string {
	remote := r.RemoteAddr
	if idx := strings.LastIndex(remote, ":"); idx != -1 {
		return remote[:idx]
	}
	return remote
}

func getRequestID(r *http.Request) string {
	if reqID := r.Header.Get("X-Request-ID"); reqID != "" {
		return reqID
	}
	return "req_unknown"
}
