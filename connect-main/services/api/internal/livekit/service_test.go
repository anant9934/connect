package livekit_test

import (
	"testing"

	livekitauth "github.com/livekit/protocol/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tathastu/connect/services/api/internal/livekit"
)

func TestRoomManager_AdministrativeTokenScoping(t *testing.T) {
	apiKey := "test_api_key_adm"
	apiSecret := "test_api_secret_adm_12345"

	rm := livekit.NewRoomManager("https://livekit.example.com", apiKey, apiSecret)

	// 1. Scoped token: Must contain RoomAdmin and exact target Room name
	targetRoom := "TEST-ROOM-SCOPED-12"
	scopedToken, err := rm.GenerateAdminToken(targetRoom)
	require.NoError(t, err)
	assert.NotEmpty(t, scopedToken)

	verifier, err := livekitauth.ParseAPIToken(scopedToken)
	require.NoError(t, err)
	_, scopedClaims, err := verifier.Verify([]byte(apiSecret))
	require.NoError(t, err)

	require.NotNil(t, scopedClaims.Video)
	assert.True(t, scopedClaims.Video.RoomAdmin, "scoped admin token must have RoomAdmin privilege")
	assert.Equal(t, targetRoom, scopedClaims.Video.Room, "scoped admin token must be bound to specific room")
	assert.False(t, scopedClaims.Video.RoomCreate, "scoped token must not have RoomCreate privilege (least privilege)")
	assert.False(t, scopedClaims.Video.RoomList, "scoped token must not have RoomList privilege (least privilege)")

	// 2. Unscoped token: Used for cross-room administrative discovery (ListRooms, CreateRoom)
	unscopedToken, err := rm.GenerateAdminToken("")
	require.NoError(t, err)
	assert.NotEmpty(t, unscopedToken)

	verifierUnscoped, err := livekitauth.ParseAPIToken(unscopedToken)
	require.NoError(t, err)
	_, unscopedClaims, err := verifierUnscoped.Verify([]byte(apiSecret))
	require.NoError(t, err)

	require.NotNil(t, unscopedClaims.Video)
	assert.True(t, unscopedClaims.Video.RoomAdmin)
	assert.Empty(t, unscopedClaims.Video.Room, "unscoped token must not bind to a specific room")
	assert.True(t, unscopedClaims.Video.RoomCreate, "unscoped token enables RoomCreate")
	assert.True(t, unscopedClaims.Video.RoomList, "unscoped token enables RoomList")

	// 3. Unconfigured credentials fail closed
	emptyRM := livekit.NewRoomManager("", "", "")
	_, errEmpty := emptyRM.GenerateAdminToken(targetRoom)
	assert.Error(t, errEmpty, "generating admin token without credentials must fail")
}
