package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/tathastu/connect/services/api/internal/model"
)

func (h *Handlers) limit(w http.ResponseWriter, r *http.Request, key string, n int) bool {
	if h.limiter == nil {
		return true
	}
	allowed, err := h.limiter.Allow(r.Context(), key, n, time.Minute)
	if err != nil || !allowed {
		w.Header().Set("Retry-After", "60")
		model.SendJSONError(w, r, http.StatusTooManyRequests, "TOO_MANY_REQUESTS", "Too many attempts. Please try again in a minute.")
		return false
	}
	return true
}

// ForgotPassword handles POST /api/v1/auth/password/forgot. The answer never says whether the
// address has an account. With no email provider, a code is only issued outside production,
// where it is written to the server log for testing. In production the person is told to ask
// their institution's administrator, who can issue a code from the admin page.
func (h *Handlers) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil || strings.TrimSpace(req.Email) == "" || len(req.Email) > 320 {
		model.SendJSONError(w, r, http.StatusBadRequest, "MALFORMED_REQUEST", "Enter your email address.")
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if !h.limit(w, r, fmt.Sprintf("pw_forgot:%s", extractIP(r)), 5) {
		return
	}
	if h.isProduction {
		model.SendJSON(w, http.StatusAccepted, map[string]any{
			"delivery": "administrator",
			"message":  "Ask your institution's administrator for a reset code. Codes are not emailed yet.",
		})
		return
	}
	code, err := h.service.RequestPasswordReset(r.Context(), email)
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not start the reset.")
		return
	}
	if code != "" {
		// Development and staging only: there is no email provider to deliver it.
		slog.Warn("password_reset_code_issued_dev_only", slog.String("email", email), slog.String("code", code),
			slog.Int("valid_minutes", SelfResetMinutes))
	}
	model.SendJSON(w, http.StatusAccepted, map[string]any{
		"delivery": "server-log",
		"message":  "If this address has an account, a reset code was written to the server log (development only).",
	})
}

// ResetPassword handles POST /api/v1/auth/password/reset.
func (h *Handlers) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code        string `json:"code"`
		NewPassword string `json:"newPassword"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "MALFORMED_REQUEST", "Invalid request body.")
		return
	}
	if !h.limit(w, r, fmt.Sprintf("pw_reset:%s", extractIP(r)), 10) {
		return
	}
	err := h.service.ResetPassword(r.Context(), req.Code, req.NewPassword, extractIP(r), getRequestID(r))
	switch {
	case errors.Is(err, ErrInvalidPassword):
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_PASSWORD", "Use 8 to 128 characters.")
	case errors.Is(err, ErrResetCodeInvalid):
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_RESET_CODE", ErrResetCodeInvalid.Error())
	case err != nil:
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not reset the password.")
	default:
		model.SendJSON(w, http.StatusOK, map[string]any{"success": true})
	}
}

// MemberLogin handles POST /api/v1/auth/login/member: institution and registration number.
func (h *Handlers) MemberLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Institution        string `json:"institution"`
		RegistrationNumber string `json:"registrationNumber"`
		Password           string `json:"password"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "MALFORMED_REQUEST", "Invalid login payload")
		return
	}
	key := fmt.Sprintf("login_member:%s:%s:%s", extractIP(r), strings.ToLower(strings.TrimSpace(req.Institution)), strings.TrimSpace(req.RegistrationNumber))
	if !h.limit(w, r, key, 5) {
		return
	}
	result, err := h.service.LoginWithMemberIdentifier(r.Context(), req.Institution, req.RegistrationNumber, req.Password, extractIP(r), getRequestID(r))
	if err != nil {
		if errors.Is(err, ErrAccountDisabled) {
			model.SendJSONError(w, r, http.StatusForbidden, "ACCOUNT_DISABLED", err.Error())
			return
		}
		model.SendJSONError(w, r, http.StatusUnauthorized, "INVALID_CREDENTIALS", ErrInvalidCredentials.Error())
		return
	}
	SetSessionCookie(w, result.Token, h.isProduction, 7*24*time.Hour)
	model.SendJSON(w, http.StatusOK, map[string]any{"user": result.User, "token": result.Token})
}
