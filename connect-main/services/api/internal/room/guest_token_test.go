package room_test

import (
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
