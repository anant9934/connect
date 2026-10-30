package auth

import (
	"context"
	"testing"
	"time"
)

func TestProfileUpdateAndRetrieval(t *testing.T) {
	repo := NewMemoryRepository()
	service := NewService(repo, nil, 15*time.Minute, 24*time.Hour)
	ctx := context.Background()

	// 1. Create user
	signupRes, err := service.Signup(ctx, SignupDTO{
		Email:       "anant.kumar@example.com",
		Password:    "SecurePassword123!",
		DisplayName: "Anant",
	}, "127.0.0.1", "test-req-1")
	if err != nil {
		t.Fatalf("signup failed: %v", err)
	}

	userID := signupRes.User.ID

	// 2. Get initial profile
	profile, err := service.GetProfile(ctx, userID)
	if err != nil {
		t.Fatalf("get profile failed: %v", err)
	}
	if profile.DisplayName != "Anant" {
		t.Errorf("expected displayName 'Anant', got '%s'", profile.DisplayName)
	}
	if !profile.EmailPasswordConnected {
		t.Errorf("expected EmailPasswordConnected to be true")
	}
	if profile.GoogleConnected {
		t.Errorf("expected GoogleConnected to be false")
	}

	// 3. Update profile with display name and bundled avatar
	updated, err := service.UpdateProfile(ctx, userID, "Anant Kumar", "avatar_01", "")
	if err != nil {
		t.Fatalf("update profile failed: %v", err)
	}
	if updated.DisplayName != "Anant Kumar" {
		t.Errorf("expected updated name 'Anant Kumar', got '%s'", updated.DisplayName)
	}
	if updated.AvatarID != "avatar_01" {
		t.Errorf("expected avatarId 'avatar_01', got '%s'", updated.AvatarID)
	}

	// 4. Validate empty name rejection
	_, err = service.UpdateProfile(ctx, userID, "", "avatar_01", "")
	if err == nil {
		t.Errorf("expected error for empty display name")
	}

	// 5. Update preferences
	prefs := map[string]any{
		"defaultMicOn":    false,
		"defaultCameraOn": true,
		"appearance":      "Light",
	}
	err = service.UpdatePreferences(ctx, userID, prefs)
	if err != nil {
		t.Fatalf("update preferences failed: %v", err)
	}

	reloaded, err := service.GetProfile(ctx, userID)
	if err != nil {
		t.Fatalf("reload profile failed: %v", err)
	}
	if reloaded.Preferences["appearance"] != "Light" {
		t.Errorf("expected appearance 'Light', got '%v'", reloaded.Preferences["appearance"])
	}

	// 6. Change password
	err = service.ChangePassword(ctx, userID, "WrongOldPassword", "NewSecurePassword456!")
	if err == nil {
		t.Errorf("expected error for incorrect current password")
	}

	err = service.ChangePassword(ctx, userID, "SecurePassword123!", "NewSecurePassword456!")
	if err != nil {
		t.Fatalf("change password failed: %v", err)
	}

	// Login with new password should succeed
	loginRes, err := service.Login(ctx, LoginDTO{
		Email:    "anant.kumar@example.com",
		Password: "NewSecurePassword456!",
	}, "127.0.0.1", "test-req-2")
	if err != nil {
		t.Fatalf("login with new password failed: %v", err)
	}
	if loginRes.User.DisplayName != "Anant Kumar" {
		t.Errorf("expected login user displayName 'Anant Kumar', got '%s'", loginRes.User.DisplayName)
	}
}
