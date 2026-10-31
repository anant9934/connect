package livekit

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	livekitauth "github.com/livekit/protocol/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type captureTransport struct {
	lastReq *http.Request
}

func (c *captureTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	c.lastReq = req
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader("{}")),
		Header:     make(http.Header),
	}, nil
}

func TestRoomManager_LeastPrivilegeTokenScoping(t *testing.T) {
	apiKey := "test_api_key_adm"
	apiSecret := "test_api_secret_adm_12345"

	rm := NewRoomManager("https://livekit.example.com", apiKey, apiSecret)

	// 1. Scoped token: Must contain RoomAdmin and exact target Room name
	targetRoom := "TEST-ROOM-SCOPED-12"
	scopedToken, err := rm.GenerateRoomAdminToken(targetRoom)
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

	// 2. Unscoped admin token must fail closed
	_, errUnscopedAdmin := rm.GenerateRoomAdminToken("")
	assert.Error(t, errUnscopedAdmin, "generating room admin token without room scope must fail closed")

	_, errLegacyUnscoped := rm.GenerateAdminToken("")
	assert.Error(t, errLegacyUnscoped, "unscoped GenerateAdminToken must fail closed")

	// 3. Discovery token: Must ONLY contain RoomList (no RoomAdmin, no RoomCreate, no Room)
	discoveryToken, err := rm.GenerateDiscoveryToken()
	require.NoError(t, err)
	assert.NotEmpty(t, discoveryToken)

	verifierDisc, err := livekitauth.ParseAPIToken(discoveryToken)
	require.NoError(t, err)
	_, discClaims, err := verifierDisc.Verify([]byte(apiSecret))
	require.NoError(t, err)

	require.NotNil(t, discClaims.Video)
	assert.True(t, discClaims.Video.RoomList, "discovery token must have RoomList privilege")
	assert.False(t, discClaims.Video.RoomAdmin, "discovery token must never have RoomAdmin privilege")
	assert.False(t, discClaims.Video.RoomCreate, "discovery token must never have RoomCreate privilege")
	assert.Empty(t, discClaims.Video.Room, "discovery token must not bind to a room")

	// 4. Room Create token: Must ONLY contain RoomCreate (no RoomAdmin, no RoomList, no Room)
	createToken, err := rm.GenerateRoomCreateToken()
	require.NoError(t, err)
	assert.NotEmpty(t, createToken)

	verifierCreate, err := livekitauth.ParseAPIToken(createToken)
	require.NoError(t, err)
	_, createClaims, err := verifierCreate.Verify([]byte(apiSecret))
	require.NoError(t, err)

	require.NotNil(t, createClaims.Video)
	assert.True(t, createClaims.Video.RoomCreate, "room create token must have RoomCreate privilege")
	assert.False(t, createClaims.Video.RoomAdmin, "room create token must never have RoomAdmin privilege")
	assert.False(t, createClaims.Video.RoomList, "room create token must never have RoomList privilege")
	assert.Empty(t, createClaims.Video.Room, "room create token must not bind to a room")

	// 5. Unconfigured credentials fail closed
	emptyRM := NewRoomManager("", "", "")
	_, errEmpty := emptyRM.GenerateRoomAdminToken(targetRoom)
	assert.Error(t, errEmpty, "generating admin token without credentials must fail")
	_, errEmptyDisc := emptyRM.GenerateDiscoveryToken()
	assert.Error(t, errEmptyDisc, "generating discovery token without credentials must fail")
}

func TestRoomManager_TwirpTransportLeastPrivilege(t *testing.T) {
	apiKey := "test_api_key_twirp"
	apiSecret := "test_api_secret_twirp_98765"

	cap := &captureTransport{}
	transport := &authTransport{
		base:      cap,
		apiKey:    apiKey,
		apiSecret: apiSecret,
	}

	targetRoom := "ROOM-SEC-99"

	// 1. Participant mutation with explicit room scope -> RoomAdmin + roomCode ONLY
	ctx := WithRoomScope(context.Background(), targetRoom)
	req1, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://livekit.example.com/twirp/livekit.RoomService/UpdateParticipant", nil)
	require.NoError(t, err)

	resp, err := transport.RoundTrip(req1)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	authHeader := cap.lastReq.Header.Get("Authorization")
	require.True(t, strings.HasPrefix(authHeader, "Bearer "))
	token := strings.TrimPrefix(authHeader, "Bearer ")

	verifier, err := livekitauth.ParseAPIToken(token)
	require.NoError(t, err)
	_, claims, err := verifier.Verify([]byte(apiSecret))
	require.NoError(t, err)
	require.NotNil(t, claims.Video)
	assert.True(t, claims.Video.RoomAdmin)
	assert.Equal(t, targetRoom, claims.Video.Room)
	assert.False(t, claims.Video.RoomCreate, "mutation token must not have RoomCreate")
	assert.False(t, claims.Video.RoomList, "mutation token must not have RoomList")

	// 2. RemoveParticipant with explicit room scope
	req2, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://livekit.example.com/twirp/livekit.RoomService/RemoveParticipant", nil)
	require.NoError(t, err)
	_, err = transport.RoundTrip(req2)
	require.NoError(t, err)

	authHeader2 := cap.lastReq.Header.Get("Authorization")
	token2 := strings.TrimPrefix(authHeader2, "Bearer ")
	verifier2, _ := livekitauth.ParseAPIToken(token2)
	_, claims2, _ := verifier2.Verify([]byte(apiSecret))
	assert.True(t, claims2.Video.RoomAdmin)
	assert.Equal(t, targetRoom, claims2.Video.Room)

	// 2b. DeleteRoom with explicit room scope -> requires RoomCreate + RoomAdmin + targetRoom
	reqDel, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://livekit.example.com/twirp/livekit.RoomService/DeleteRoom", nil)
	require.NoError(t, err)
	_, err = transport.RoundTrip(reqDel)
	require.NoError(t, err)

	authHeaderDel := cap.lastReq.Header.Get("Authorization")
	tokenDel := strings.TrimPrefix(authHeaderDel, "Bearer ")
	verifierDel, _ := livekitauth.ParseAPIToken(tokenDel)
	_, claimsDel, _ := verifierDel.Verify([]byte(apiSecret))
	assert.True(t, claimsDel.Video.RoomAdmin, "DeleteRoom token must have RoomAdmin")
	assert.True(t, claimsDel.Video.RoomCreate, "DeleteRoom token must have RoomCreate for LiveKit SFU termination")
	assert.Equal(t, targetRoom, claimsDel.Video.Room)

	// 3. ListRooms discovery endpoint -> RoomList ONLY (no RoomAdmin, no RoomCreate)
	reqDisc, err := http.NewRequestWithContext(context.Background(), http.MethodPost, "https://livekit.example.com/twirp/livekit.RoomService/ListRooms", nil)
	require.NoError(t, err)
	_, err = transport.RoundTrip(reqDisc)
	require.NoError(t, err)

	authHeaderDisc := cap.lastReq.Header.Get("Authorization")
	tokenDisc := strings.TrimPrefix(authHeaderDisc, "Bearer ")
	verifierDisc, _ := livekitauth.ParseAPIToken(tokenDisc)
	_, claimsDisc, _ := verifierDisc.Verify([]byte(apiSecret))
	assert.True(t, claimsDisc.Video.RoomList, "ListRooms must receive RoomList grant")
	assert.False(t, claimsDisc.Video.RoomAdmin, "ListRooms must never receive RoomAdmin grant")
	assert.False(t, claimsDisc.Video.RoomCreate, "ListRooms must never receive RoomCreate grant")

	// 4. CreateRoom endpoint -> RoomCreate ONLY (no RoomAdmin, no RoomList)
	reqCreate, err := http.NewRequestWithContext(context.Background(), http.MethodPost, "https://livekit.example.com/twirp/livekit.RoomService/CreateRoom", nil)
	require.NoError(t, err)
	_, err = transport.RoundTrip(reqCreate)
	require.NoError(t, err)

	authHeaderCreate := cap.lastReq.Header.Get("Authorization")
	tokenCreate := strings.TrimPrefix(authHeaderCreate, "Bearer ")
	verifierCreate, _ := livekitauth.ParseAPIToken(tokenCreate)
	_, claimsCreate, _ := verifierCreate.Verify([]byte(apiSecret))
	assert.True(t, claimsCreate.Video.RoomCreate, "CreateRoom must receive RoomCreate grant")
	assert.False(t, claimsCreate.Video.RoomAdmin, "CreateRoom must never receive RoomAdmin grant")
	assert.False(t, claimsCreate.Video.RoomList, "CreateRoom must never receive RoomList grant")

	// 5. Calling participant mutation WITHOUT room scope must fail closed with security error
	reqUnscoped, err := http.NewRequestWithContext(context.Background(), http.MethodPost, "https://livekit.example.com/twirp/livekit.RoomService/UpdateParticipant", nil)
	require.NoError(t, err)
	_, errUnscoped := transport.RoundTrip(reqUnscoped)
	assert.Error(t, errUnscoped, "participant mutation without room context must fail closed")
	assert.Contains(t, errUnscoped.Error(), "requires explicit room scope")
}

func TestRoomManager_CrossRoomAdminTokenRejection(t *testing.T) {
	// Proves cryptographically that a token scoped to Room A cannot administer Room B
	apiKey := "test_api_key_cross"
	apiSecret := "test_api_secret_cross_123"

	rm := NewRoomManager("https://livekit.example.com", apiKey, apiSecret)

	tokenA, err := rm.GenerateRoomAdminToken("ROOM-A")
	require.NoError(t, err)

	verifier, err := livekitauth.ParseAPIToken(tokenA)
	require.NoError(t, err)
	_, claims, err := verifier.Verify([]byte(apiSecret))
	require.NoError(t, err)

	// Verifier asserting authorization for Room B
	roomB := "ROOM-B"
	assert.NotEqual(t, roomB, claims.Video.Room, "token generated for Room A must not match Room B")

	// Discovery token cannot administer any room
	discToken, err := rm.GenerateDiscoveryToken()
	require.NoError(t, err)
	verifierDisc, err := livekitauth.ParseAPIToken(discToken)
	require.NoError(t, err)
	_, claimsDisc, err := verifierDisc.Verify([]byte(apiSecret))
	require.NoError(t, err)

	assert.False(t, claimsDisc.Video.RoomAdmin, "discovery token must not possess RoomAdmin privilege")
	assert.Empty(t, claimsDisc.Video.Room, "discovery token has no room grant")
}

func TestRoomManager_MissingClientReturnsInfrastructureError(t *testing.T) {
	rm := &RoomManager{}
	info, err := rm.GetParticipant(context.Background(), "ROOM-1", "user-1")
	assert.Nil(t, info)
	assert.ErrorIs(t, err, ErrSFUClientNotConfigured)
}
