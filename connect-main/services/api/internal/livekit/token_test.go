package livekit_test

import (
	"testing"
	"time"

	livekitauth "github.com/livekit/protocol/auth"
	"github.com/tathastu/connect/services/api/internal/livekit"
)

func TestTokenGenerationParticipantGrants(t *testing.T) {
	apiKey := "test_api_key_123"
	apiSecret := "test_api_secret_456"

	tokenService := livekit.NewTokenService(apiKey, apiSecret)

	roomCode := "ABCD-EFGH-JK"
	identity := "user:11111111-2222-3333-4444-555555555555"
	displayName := "Jane Doe"

	jwtToken, err := tokenService.GenerateToken(livekit.GrantParams{
		RoomCode:    roomCode,
		Identity:    identity,
		DisplayName: displayName,
		IsHost:      false,
		ValidFor:    10 * time.Minute,
	})
	if err != nil {
		t.Fatalf("unexpected token generation error: %v", err)
	}

	if jwtToken == "" {
		t.Fatal("expected non-empty JWT token")
	}

	// Verify claims using LiveKit's token verifier
	verifier, err := livekitauth.ParseAPIToken(jwtToken)
	if err != nil {
		t.Fatalf("failed to parse access token: %v", err)
	}

	_, claims, err := verifier.Verify([]byte(apiSecret))
	if err != nil {
		t.Fatalf("token signature verification failed: %v", err)
	}

	if claims.Identity != identity {
		t.Errorf("expected identity %s, got %s", identity, claims.Identity)
	}
	if claims.Name != displayName {
		t.Errorf("expected display name %s, got %s", displayName, claims.Name)
	}
	if claims.Video == nil {
		t.Fatal("expected video grant to be present")
	}
	if claims.Video.Room != roomCode {
		t.Errorf("expected room %s, got %s", roomCode, claims.Video.Room)
	}
	if !claims.Video.RoomJoin {
		t.Errorf("expected RoomJoin to be true")
	}
	if claims.Video.RoomAdmin {
		t.Errorf("SECURITY FAILURE: non-host must NOT have RoomAdmin privilege")
	}
	if claims.Video.CanPublish != nil && *claims.Video.CanPublish {
		t.Errorf("SECURITY FAILURE: regular student/participant must NOT have CanPublish by default")
	}
	if len(claims.Video.CanPublishSources) > 0 {
		t.Errorf("SECURITY FAILURE: regular student/participant must NOT have publish sources by default, got %v", claims.Video.CanPublishSources)
	}
}

func TestTokenGenerationStudentSpeakerGrants(t *testing.T) {
	apiKey := "test_api_key_123"
	apiSecret := "test_api_secret_456"

	tokenService := livekit.NewTokenService(apiKey, apiSecret)

	roomCode := "ABCD-EFGH-JK"
	identity := "user:22222222-3333-4444-5555-666666666666"
	displayName := "Promoted Student"

	jwtToken, err := tokenService.GenerateToken(livekit.GrantParams{
		RoomCode:    roomCode,
		Identity:    identity,
		DisplayName: displayName,
		Role:        livekit.RoleSpeaker,
		IsHost:      false,
		ValidFor:    10 * time.Minute,
	})
	if err != nil {
		t.Fatalf("unexpected token generation error: %v", err)
	}

	verifier, err := livekitauth.ParseAPIToken(jwtToken)
	if err != nil {
		t.Fatalf("failed to parse access token: %v", err)
	}

	_, claims, err := verifier.Verify([]byte(apiSecret))
	if err != nil {
		t.Fatalf("token signature verification failed: %v", err)
	}

	if claims.Video.CanPublish == nil || !*claims.Video.CanPublish {
		t.Fatalf("expected speaker to receive CanPublish privilege")
	}

	// Verify speaker receives camera and microphone, but NOT screen share
	hasCamera := false
	hasMic := false
	hasScreen := false
	for _, src := range claims.Video.CanPublishSources {
		if src == livekit.TrackSourceCamera {
			hasCamera = true
		}
		if src == livekit.TrackSourceMicrophone {
			hasMic = true
		}
		if src == livekit.TrackSourceScreenShare {
			hasScreen = true
		}
	}

	if !hasCamera || !hasMic {
		t.Errorf("speaker must receive camera and microphone sources, got %v", claims.Video.CanPublishSources)
	}
	if hasScreen {
		t.Errorf("SECURITY FAILURE: student speaker must NOT receive screen share by default")
	}
	if claims.Video.RoomCreate {
		t.Errorf("speaker must NOT receive RoomCreate privilege")
	}
}

func TestTokenGenerationCoHostGrants(t *testing.T) {
	apiKey := "test_api_key_123"
	apiSecret := "test_api_secret_456"

	tokenService := livekit.NewTokenService(apiKey, apiSecret)

	roomCode := "ABCD-EFGH-JK"
	identity := "user:33333333-4444-5555-6666-777777777777"
	displayName := "Teaching Assistant CoHost"

	jwtToken, err := tokenService.GenerateToken(livekit.GrantParams{
		RoomCode:    roomCode,
		Identity:    identity,
		DisplayName: displayName,
		Role:        livekit.RoleCoHost,
		IsHost:      false,
		ValidFor:    10 * time.Minute,
	})
	if err != nil {
		t.Fatalf("unexpected token generation error: %v", err)
	}

	verifier, err := livekitauth.ParseAPIToken(jwtToken)
	if err != nil {
		t.Fatalf("failed to parse access token: %v", err)
	}

	_, claims, err := verifier.Verify([]byte(apiSecret))
	if err != nil {
		t.Fatalf("token signature verification failed: %v", err)
	}

	if claims.Video.CanPublish == nil || !*claims.Video.CanPublish {
		t.Fatalf("expected co-host to receive CanPublish privilege")
	}

	hasScreen := false
	for _, src := range claims.Video.CanPublishSources {
		if src == livekit.TrackSourceScreenShare {
			hasScreen = true
		}
	}
	if !hasScreen {
		t.Errorf("co-host must receive screen share capability")
	}
}

func TestTokenCrossRoomRejection(t *testing.T) {
	apiKey := "test_api_key_123"
	apiSecret := "test_api_secret_456"

	tokenService := livekit.NewTokenService(apiKey, apiSecret)

	roomA := "ROOM-AAAA-11"
	roomB := "ROOM-BBBB-22"

	jwtToken, err := tokenService.GenerateToken(livekit.GrantParams{
		RoomCode: roomA,
		Identity: "user:student-1",
	})
	if err != nil {
		t.Fatalf("unexpected token generation error: %v", err)
	}

	verifier, err := livekitauth.ParseAPIToken(jwtToken)
	if err != nil {
		t.Fatalf("failed to parse access token: %v", err)
	}

	_, claims, err := verifier.Verify([]byte(apiSecret))
	if err != nil {
		t.Fatalf("token signature verification failed: %v", err)
	}

	if claims.Video.Room != roomA {
		t.Errorf("expected room %s, got %s", roomA, claims.Video.Room)
	}
	if claims.Video.Room == roomB {
		t.Errorf("SECURITY FAILURE: token for Room A must NOT match Room B")
	}
}

func TestTokenGenerationHostGrants(t *testing.T) {
	apiKey := "test_api_key_123"
	apiSecret := "test_api_secret_456"

	tokenService := livekit.NewTokenService(apiKey, apiSecret)

	roomCode := "ABCD-EFGH-JK"
	identity := "user:99999999-8888-7777-6666-555555555555"
	displayName := "Host Organizer"

	jwtToken, err := tokenService.GenerateToken(livekit.GrantParams{
		RoomCode:    roomCode,
		Identity:    identity,
		DisplayName: displayName,
		IsHost:      true,
		ValidFor:    10 * time.Minute,
	})
	if err != nil {
		t.Fatalf("unexpected token generation error: %v", err)
	}

	verifier, err := livekitauth.ParseAPIToken(jwtToken)
	if err != nil {
		t.Fatalf("failed to parse access token: %v", err)
	}

	_, claims, err := verifier.Verify([]byte(apiSecret))
	if err != nil {
		t.Fatalf("token signature verification failed: %v", err)
	}

	if !claims.Video.RoomCreate {
		t.Errorf("expected host to receive RoomCreate privilege")
	}
	if claims.Video.RoomAdmin {
		t.Errorf("SECURITY POLICY: browser token must NOT receive RoomAdmin; moderation is backend-governed")
	}
	if claims.Video.RoomRecord {
		t.Errorf("SECURITY POLICY: recording is explicitly deferred in Phase 2")
	}
}

func TestTokenGenerationFailsWithoutCredentials(t *testing.T) {
	tokenService := livekit.NewTokenService("", "")
	_, err := tokenService.GenerateToken(livekit.GrantParams{
		RoomCode: "ABCD-EFGH-JK",
		Identity: "user:123",
	})
	if err == nil {
		t.Fatal("expected error when credentials missing")
	}
}
