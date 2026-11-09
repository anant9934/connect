package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/tathastu/connect/services/api/internal/audit"
)

// ErrResetCodeInvalid covers unknown, used and expired codes alike.
var ErrResetCodeInvalid = errors.New("this reset code is invalid or has expired")

const (
	// resetCodeChars excludes I, L, O and U, so a code read aloud is not misheard.
	resetCodeChars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
	resetCodeLen   = 12 // 60 bits
	// SelfResetMinutes is how long a self-service code lasts.
	SelfResetMinutes = 30
	// AdminResetMinutes is how long an administrator-issued code lasts.
	AdminResetMinutes = 24 * 60
)

// GenerateResetCode returns a code formatted XXXX-XXXX-XXXX and the hash stored for it.
func GenerateResetCode() (code, hash string, err error) {
	raw := make([]byte, resetCodeLen)
	max := big.NewInt(int64(len(resetCodeChars)))
	for i := range raw {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", "", fmt.Errorf("failed to generate reset code: %w", err)
		}
		raw[i] = resetCodeChars[n.Int64()]
	}
	s := string(raw)
	return s[0:4] + "-" + s[4:8] + "-" + s[8:12], HashResetCode(s), nil
}

// NormalizeResetCode uppercases, drops separators and maps O, I and L to 0 and 1.
func NormalizeResetCode(code string) string {
	s := strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(strings.TrimSpace(code)))
	return strings.NewReplacer("O", "0", "I", "1", "L", "1").Replace(s)
}

// HashResetCode is the SHA-256 of the normalized code; only this is stored.
func HashResetCode(code string) string {
	sum := sha256.Sum256([]byte(NormalizeResetCode(code)))
	return hex.EncodeToString(sum[:])
}

func validResetCode(code string) bool {
	n := NormalizeResetCode(code)
	if len(n) != resetCodeLen {
		return false
	}
	for _, c := range n {
		if !strings.ContainsRune(resetCodeChars, c) {
			return false
		}
	}
	return true
}

// RequestPasswordReset issues a self-service code for an email address and returns it, or ""
// when no active account has that address. Callers decide how the code reaches the person;
// without an email provider the API only logs it outside production.
func (s *Service) RequestPasswordReset(ctx context.Context, email string) (string, error) {
	code, hash, err := GenerateResetCode()
	if err != nil {
		return "", err
	}
	issued, err := s.repo.IssueSelfPasswordReset(ctx, strings.ToLower(strings.TrimSpace(email)), hash, SelfResetMinutes)
	if err != nil || !issued {
		return "", err
	}
	return code, nil
}

// ResetPassword sets a new password with a one-time code and ends every session.
func (s *Service) ResetPassword(ctx context.Context, code, newPassword, clientIP, requestID string) error {
	if len(newPassword) < 8 || len(newPassword) > 128 {
		return ErrInvalidPassword
	}
	if !validResetCode(code) {
		VerifyDummyPassword(newPassword) // same cost as a real attempt
		return ErrResetCodeInvalid
	}
	newHash, err := HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("failed to hash new password: %w", err)
	}
	userID, err := s.repo.ResetPasswordWithToken(ctx, HashResetCode(code), newHash)
	if err != nil {
		return err
	}
	if userID == "" {
		return ErrResetCodeInvalid
	}
	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: audit.EventType("auth.password_reset"), Severity: "INFO", ActorID: userID,
			ClientIP: clientIP, RequestID: requestID,
		})
	}
	return nil
}

// LoginWithMemberIdentifier signs in by institution slug and registration number. Unknown
// numbers take the same path and time as a wrong password.
func (s *Service) LoginWithMemberIdentifier(ctx context.Context, orgSlug, identifier, password, clientIP, requestID string) (*SessionResult, error) {
	orgSlug, identifier = strings.TrimSpace(orgSlug), strings.TrimSpace(identifier)
	if orgSlug == "" || identifier == "" || len(orgSlug) > 64 || len(identifier) > 64 {
		VerifyDummyPassword(password)
		return nil, ErrInvalidCredentials
	}
	email, err := s.repo.EmailByMemberIdentifier(ctx, orgSlug, identifier)
	if err != nil || email == "" {
		VerifyDummyPassword(password)
		if s.auditService != nil {
			s.auditService.Record(ctx, audit.AuditParams{EventType: audit.EventLoginFailure, Severity: "WARN", ClientIP: clientIP, RequestID: requestID})
		}
		return nil, ErrInvalidCredentials
	}
	return s.Login(ctx, LoginDTO{Email: email, Password: password}, clientIP, requestID)
}
