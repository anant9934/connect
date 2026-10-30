package room_test

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tathastu/connect/services/api/internal/room"
)

func TestGuestToken_Lifecycle(t *testing.T) {
	roomCode := "ABCD-1234-EF"
	guestIdentity := "guest:test-uuid-5678"

	// 1. Generation
	token, err := room.GenerateGuestToken(roomCode, guestIdentity, 1*time.Hour)
	require.NoError(t, err)
	assert.NotEmpty(t, token)

	// 2. Successful Verification
	ident, err := room.VerifyGuestToken(roomCode, token)
	require.NoError(t, err)
	assert.Equal(t, guestIdentity, ident)

	// 3. Room-Scope Mismatch (Token from Room A used in Room B)
	otherRoom := "WXYZ-9876-GH"
	_, errScope := room.VerifyGuestToken(otherRoom, token)
	assert.ErrorIs(t, errScope, room.ErrGuestTokenScope)

	// 4. Token Expiration
	expiredToken, err := room.GenerateGuestToken(roomCode, guestIdentity, -1*time.Minute)
	require.NoError(t, err)
	_, errExp := room.VerifyGuestToken(roomCode, expiredToken)
	assert.ErrorIs(t, errExp, room.ErrGuestTokenExpired)

	// 5. Tampered Signature
	tamperedToken := token[:len(token)-4] + "dead"
	_, errTamper := room.VerifyGuestToken(roomCode, tamperedToken)
	assert.ErrorIs(t, errTamper, room.ErrInvalidGuestToken)

	// 6. Non-Guest Identity Rejection
	_, errUser := room.GenerateGuestToken(roomCode, "user:admin", 1*time.Hour)
	assert.ErrorIs(t, errUser, room.ErrInvalidGuestToken)

	// 7. Malformed Token Structure
	_, errMalformed := room.VerifyGuestToken(roomCode, "not-a-token")
	assert.ErrorIs(t, errMalformed, room.ErrInvalidGuestToken)
}

func TestGuestToken_ProductionUninitializedFailsSafely(t *testing.T) {
	origEnv := os.Getenv("APP_ENV")
	defer func() {
		_ = os.Setenv("APP_ENV", origEnv)
		room.ResetGuestTokenSecretForTest()
	}()

	_ = os.Setenv("APP_ENV", "production")
	room.ResetGuestTokenSecretForTest()

	roomCode := "PROD-ROOM-1234"
	guestIdentity := "guest:prod-user-999"

	// Generation must fail safely when secret is uninitialized in production
	_, errGen := room.GenerateGuestToken(roomCode, guestIdentity, 1*time.Hour)
	assert.ErrorIs(t, errGen, room.ErrGuestSecretNotConfigured, "unconfigured guest secret in production must fail closed")

	// Verification must also fail safely
	dummyToken := "gst.Z3Vlc3Q6cHJvZC11c2VyLTk5OQ.PROD-ROOM-1234.9999999999.aabbcc"
	_, errVer := room.VerifyGuestToken(roomCode, dummyToken)
	assert.ErrorIs(t, errVer, room.ErrGuestSecretNotConfigured, "verification without configured secret in production must fail closed")

	// Once explicitly configured with a production secret, generation and verification succeed
	room.SetGuestTokenSecret([]byte("super-secure-production-livekit-secret-32b"))
	validToken, err := room.GenerateGuestToken(roomCode, guestIdentity, 1*time.Hour)
	require.NoError(t, err)
	assert.NotEmpty(t, validToken)

	verifiedIdentity, err := room.VerifyGuestToken(roomCode, validToken)
	require.NoError(t, err)
	assert.Equal(t, guestIdentity, verifiedIdentity)
}

func TestGuestToken_NonProductionDevFallback(t *testing.T) {
	origEnv := os.Getenv("APP_ENV")
	defer func() {
		_ = os.Setenv("APP_ENV", origEnv)
		room.ResetGuestTokenSecretForTest()
	}()

	_ = os.Setenv("APP_ENV", "development")
	room.ResetGuestTokenSecretForTest()

	roomCode := "DEV-ROOM-5678"
	guestIdentity := "guest:dev-user-111"

	// In non-production, uninitialized secret falls back to deterministic dev key
	token, err := room.GenerateGuestToken(roomCode, guestIdentity, 1*time.Hour)
	require.NoError(t, err)
	assert.NotEmpty(t, token)

	verifiedIdentity, err := room.VerifyGuestToken(roomCode, token)
	require.NoError(t, err)
	assert.Equal(t, guestIdentity, verifiedIdentity)
}
