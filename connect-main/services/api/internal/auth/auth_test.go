package auth_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/tathastu/connect/services/api/internal/audit"
	"github.com/tathastu/connect/services/api/internal/auth"
)

func setupTestAuthService(idleTimeout, absoluteTimeout time.Duration) (*auth.Service, auth.Repository) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	auditService := audit.NewService(nil, logger)
	repo := auth.NewMemoryRepository()
	service := auth.NewService(repo, auditService, idleTimeout, absoluteTimeout)
	return service, repo
}

// 1. Password Hashing & Constant-Time Verification
func TestPasswordHashingAndVerification(t *testing.T) {
	raw := "SecureP@ssw0rd123"
	hash, err := auth.HashPassword(raw)
	if err != nil {
		t.Fatalf("failed to hash password: %v", err)
	}

	if hash == raw {
		t.Fatal("SECURITY ERROR: hash returned plaintext")
	}

	valid, err := auth.VerifyPassword(raw, hash)
	if err != nil || !valid {
		t.Fatalf("expected valid password verification, got: %v", err)
	}

	// Wrong password
	invalid, err := auth.VerifyPassword("WrongPassword123", hash)
	if err != nil {
		t.Fatalf("unexpected verification error: %v", err)
	}
	if invalid {
		t.Fatal("SECURITY ERROR: wrong password verified as valid")
	}
}

// 2. Signup Success
func TestSignupSuccess(t *testing.T) {
	svc, _ := setupTestAuthService(12*time.Hour, 7*24*time.Hour)
	ctx := context.Background()

	res, err := svc.Signup(ctx, auth.SignupDTO{
		Email:       "test@example.com",
		Password:    "Str0ngP@ssword!",
		DisplayName: "Test User",
	}, "127.0.0.1", "req-1")

	if err != nil {
		t.Fatalf("signup failed: %v", err)
	}

	if res.User.Email != "test@example.com" {
		t.Fatalf("expected email test@example.com, got %s", res.User.Email)
	}
	if res.User.DisplayName != "Test User" {
		t.Fatalf("expected display name Test User, got %s", res.User.DisplayName)
	}
	if res.Token == "" {
		t.Fatal("expected non-empty session token")
	}
}

// 3. Duplicate Email Safe Handling
func TestDuplicateEmailSafeHandling(t *testing.T) {
	svc, _ := setupTestAuthService(12*time.Hour, 7*24*time.Hour)
	ctx := context.Background()

	_, err := svc.Signup(ctx, auth.SignupDTO{
		Email:       "duplicate@example.com",
		Password:    "Str0ngP@ssword!",
		DisplayName: "User One",
	}, "127.0.0.1", "req-1")
	if err != nil {
		t.Fatalf("first signup failed: %v", err)
	}

	// Second signup with same email (normalized)
	_, err = svc.Signup(ctx, auth.SignupDTO{
		Email:       "DUPLICATE@EXAMPLE.COM",
		Password:    "AnotherStr0ngP@ssword!",
		DisplayName: "User Two",
	}, "127.0.0.1", "req-2")

	if err == nil {
		t.Fatal("expected duplicate email error")
	}
	if !errors.Is(err, auth.ErrEmailTaken) {
		t.Fatalf("expected ErrEmailTaken, got %v", err)
	}
}

// 4. Login Success & Session Rotation
func TestLoginSuccessAndSessionRotation(t *testing.T) {
	svc, _ := setupTestAuthService(12*time.Hour, 7*24*time.Hour)
	ctx := context.Background()

	signupRes, err := svc.Signup(ctx, auth.SignupDTO{
		Email:       "login@example.com",
		Password:    "CorrectPassword123",
		DisplayName: "Login Tester",
	}, "127.0.0.1", "req-1")
	if err != nil {
		t.Fatalf("signup failed: %v", err)
	}

	loginRes, err := svc.Login(ctx, auth.LoginDTO{
		Email:    "login@example.com",
		Password: "CorrectPassword123",
	}, "127.0.0.1", "req-2")
	if err != nil {
		t.Fatalf("login failed: %v", err)
	}

	// Session rotation verification: login token must be distinct from signup token
	if loginRes.Token == signupRes.Token {
		t.Fatal("SECURITY ERROR: session was not rotated upon login")
	}

	// Validating login token succeeds
	user, session, err := svc.ValidateSession(ctx, loginRes.Token)
	if err != nil || user == nil || session == nil {
		t.Fatalf("failed to validate fresh login session: %v", err)
	}
	if user.ID != signupRes.User.ID {
		t.Fatalf("user ID mismatch: expected %s, got %s", signupRes.User.ID, user.ID)
	}
}

// 5. Wrong Password & Unknown User (Enumeration Protection)
func TestLoginWrongPasswordAndUnknownUser(t *testing.T) {
	svc, _ := setupTestAuthService(12*time.Hour, 7*24*time.Hour)
	ctx := context.Background()

	_, _ = svc.Signup(ctx, auth.SignupDTO{
		Email:       "exists@example.com",
		Password:    "SecretPass123",
		DisplayName: "Existing",
	}, "127.0.0.1", "req-1")

	// 5a. Wrong password
	_, errWrong := svc.Login(ctx, auth.LoginDTO{
		Email:    "exists@example.com",
		Password: "WrongPassword",
	}, "127.0.0.1", "req-2")
	if !errors.Is(errWrong, auth.ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials for wrong password, got: %v", errWrong)
	}

	// 5b. Unknown user (must return identical generic error)
	_, errUnknown := svc.Login(ctx, auth.LoginDTO{
		Email:    "nonexistent@example.com",
		Password: "RandomPassword",
	}, "127.0.0.1", "req-3")
	if !errors.Is(errUnknown, auth.ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials for unknown user, got: %v", errUnknown)
	}
}

// 6. Session Expiry (Absolute and Idle)
func TestSessionExpiryAndIdleTimeout(t *testing.T) {
	// 50ms absolute timeout, 20ms idle timeout
	svc, repo := setupTestAuthService(20*time.Millisecond, 50*time.Millisecond)
	ctx := context.Background()

	res, err := svc.Signup(ctx, auth.SignupDTO{
		Email:       "expiry@example.com",
		Password:    "Str0ngPassword123",
		DisplayName: "Expiring User",
	}, "127.0.0.1", "req-1")
	if err != nil {
		t.Fatalf("signup failed: %v", err)
	}

	// Immediate validation works
	_, _, err = svc.ValidateSession(ctx, res.Token)
	if err != nil {
		t.Fatalf("immediate validation should succeed, got %v", err)
	}

	// Wait for idle timeout
	time.Sleep(30 * time.Millisecond)
	_, _, err = svc.ValidateSession(ctx, res.Token)
	if !errors.Is(err, auth.ErrSessionExpired) {
		t.Fatalf("expected session idle expiry, got: %v", err)
	}

	_ = repo
}

// 7. Session Revocation & Logout
func TestSessionRevocationAndLogout(t *testing.T) {
	svc, _ := setupTestAuthService(12*time.Hour, 7*24*time.Hour)
	ctx := context.Background()

	res, err := svc.Signup(ctx, auth.SignupDTO{
		Email:       "logout@example.com",
		Password:    "Password12345",
		DisplayName: "Logout User",
	}, "127.0.0.1", "req-1")
	if err != nil {
		t.Fatalf("signup failed: %v", err)
	}

	// Validate works before logout
	_, _, err = svc.ValidateSession(ctx, res.Token)
	if err != nil {
		t.Fatalf("session should be valid, got: %v", err)
	}

	// Logout
	err = svc.Logout(ctx, res.Token, "127.0.0.1", "req-logout")
	if err != nil {
		t.Fatalf("logout failed: %v", err)
	}

	// Validate after logout must fail
	_, _, err = svc.ValidateSession(ctx, res.Token)
	if !errors.Is(err, auth.ErrSessionExpired) {
		t.Fatalf("expected ErrSessionExpired after logout, got: %v", err)
	}
}

// 8. Tampered Token / Invalid Cookie Handling
func TestTamperedSessionToken(t *testing.T) {
	svc, _ := setupTestAuthService(12*time.Hour, 7*24*time.Hour)
	ctx := context.Background()

	_, _, err := svc.ValidateSession(ctx, "malformed-tampered-token-12345")
	if !errors.Is(err, auth.ErrSessionNotFound) {
		t.Fatalf("expected ErrSessionNotFound for tampered token, got: %v", err)
	}
}
