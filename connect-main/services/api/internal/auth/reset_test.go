package auth_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/tathastu/connect/services/api/internal/auth"
)

func TestResetCodeFormat(t *testing.T) {
	code, hash, err := auth.GenerateResetCode()
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != 14 || code[4] != '-' || code[9] != '-' {
		t.Fatalf("format %q", code)
	}
	if auth.HashResetCode(strings.ToLower(code)) != hash || auth.HashResetCode(strings.ReplaceAll(code, "-", " ")) != hash {
		t.Error("hash should ignore case and separators")
	}
	if got := auth.NormalizeResetCode(" o-i-l ab "); got != "011AB" {
		t.Errorf("normalize: %q", got)
	}
}

func TestPasswordResetFlow(t *testing.T) {
	svc, repo := setupTestAuthService(time.Hour, time.Hour)
	ctx := context.Background()
	if _, err := svc.Signup(ctx, auth.SignupDTO{Email: "student@example.edu", Password: "OldPassword1", DisplayName: "Student"}, "", ""); err != nil {
		t.Fatal(err)
	}
	old, err := svc.Login(ctx, auth.LoginDTO{Email: "student@example.edu", Password: "OldPassword1"}, "", "")
	if err != nil {
		t.Fatal(err)
	}

	if code, err := svc.RequestPasswordReset(ctx, "nobody@example.edu"); err != nil || code != "" {
		t.Fatalf("unknown address issued %q %v", code, err)
	}
	first, _ := svc.RequestPasswordReset(ctx, " Student@Example.edu ")
	code, err := svc.RequestPasswordReset(ctx, "student@example.edu")
	if err != nil || code == "" {
		t.Fatalf("issue: %q %v", code, err)
	}
	if err := svc.ResetPassword(ctx, first, "NewPassword1", "", ""); !errors.Is(err, auth.ErrResetCodeInvalid) {
		t.Errorf("an older code should be cancelled by a newer one: %v", err)
	}
	if err := svc.ResetPassword(ctx, code, "short", "", ""); !errors.Is(err, auth.ErrInvalidPassword) {
		t.Errorf("short password: %v", err)
	}
	if err := svc.ResetPassword(ctx, "not-a-code", "NewPassword1", "", ""); !errors.Is(err, auth.ErrResetCodeInvalid) {
		t.Errorf("junk code: %v", err)
	}
	if err := svc.ResetPassword(ctx, strings.ToLower(code), "NewPassword1", "", ""); err != nil {
		t.Fatalf("reset: %v", err)
	}
	if err := svc.ResetPassword(ctx, code, "Another123", "", ""); !errors.Is(err, auth.ErrResetCodeInvalid) {
		t.Errorf("reused code: %v", err)
	}
	if _, _, err := svc.ValidateSession(ctx, old.Token); err == nil {
		t.Error("old session should end after a reset")
	}
	if _, err := svc.Login(ctx, auth.LoginDTO{Email: "student@example.edu", Password: "NewPassword1"}, "", ""); err != nil {
		t.Errorf("login with new password: %v", err)
	}

	mem := repo.(*auth.MemoryRepository)
	mem.SetMemberIdentifier("anant-university", "12215678", "student@example.edu")
	if _, err := svc.LoginWithMemberIdentifier(ctx, "Anant-University", "12215678", "NewPassword1", "", ""); err != nil {
		t.Errorf("member login: %v", err)
	}
	for _, bad := range [][3]string{{"anant-university", "12215678", "wrong"}, {"anant-university", "99999999", "NewPassword1"}, {"", "12215678", "NewPassword1"}} {
		if _, err := svc.LoginWithMemberIdentifier(ctx, bad[0], bad[1], bad[2], "", ""); !errors.Is(err, auth.ErrInvalidCredentials) {
			t.Errorf("%v: %v", bad, err)
		}
	}
}
