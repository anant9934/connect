package p2p

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tathastu/connect/services/api/internal/config"
)

func TestP2PHub_RegisterAndRoles(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := NewHub(logger)
	roomCode := "test-room-123"

	// Mock WebSocket server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				break
			}
		}
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	// Peer 1: Host connects
	conn1, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn1.Close()

	peer1, err := hub.Register(roomCode, PeerInfo{
		Identity: "user:host-1",
		IsHost:   true,
	}, conn1)
	require.NoError(t, err)
	assert.Equal(t, "impolite", peer1.Info.Role, "First host peer should be assigned impolite role")

	// Peer 2: Guest connects
	conn2, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn2.Close()

	peer2, err := hub.Register(roomCode, PeerInfo{
		Identity: "guest:user-2",
		IsHost:   false,
	}, conn2)
	require.NoError(t, err)
	assert.Equal(t, "polite", peer2.Info.Role, "Guest peer paired with host should be assigned polite role")

	// Peer 3 attempts to join: MUST be rejected with ErrRoomFull (strict 1:1 eligibility)
	conn3, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn3.Close()

	_, err = hub.Register(roomCode, PeerInfo{
		Identity: "guest:user-3",
		IsHost:   false,
	}, conn3)
	assert.ErrorIs(t, err, ErrRoomFull, "3rd participant must be rejected from P2P room")

	// Unregister peer 2
	hub.Unregister(roomCode, peer2.Info.Identity)

	// Now another peer can register
	peer3, err := hub.Register(roomCode, PeerInfo{
		Identity: "guest:user-3",
		IsHost:   false,
	}, conn3)
	require.NoError(t, err)
	assert.Equal(t, "polite", peer3.Info.Role)
}

func TestP2P_ValidateMessage(t *testing.T) {
	tests := []struct {
		name    string
		msg     SignalingMessage
		wantErr bool
	}{
		{
			name: "Valid SDP offer",
			msg: SignalingMessage{
				Type: MsgTypeOffer,
				SDP:  "v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\n",
			},
			wantErr: false,
		},
		{
			name: "Invalid SDP offer missing v=0",
			msg: SignalingMessage{
				Type: MsgTypeOffer,
				SDP:  "o=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\n",
			},
			wantErr: true,
		},
		{
			name: "Empty SDP offer",
			msg: SignalingMessage{
				Type: MsgTypeOffer,
				SDP:  "",
			},
			wantErr: true,
		},
		{
			name: "Valid ICE Candidate",
			msg: SignalingMessage{
				Type:      MsgTypeCandidate,
				Candidate: rawJSON(`{"candidate":"candidate:1 1 UDP ...","sdpMid":"0","sdpMLineIndex":0}`),
			},
			wantErr: false,
		},
		{
			name: "Empty ICE Candidate",
			msg: SignalingMessage{
				Type:      MsgTypeCandidate,
				Candidate: nil,
			},
			wantErr: true,
		},
		{
			name: "Valid Renegotiate",
			msg: SignalingMessage{
				Type: MsgTypeRenegotiate,
			},
			wantErr: false,
		},
		{
			name: "Unknown message type",
			msg: SignalingMessage{
				Type: "random_unknown_type",
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateMessage(&tt.msg)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestP2P_RateLimiter(t *testing.T) {
	peer := &Peer{
		window: time.Now(),
	}

	for i := 0; i < maxRatePerSec; i++ {
		assert.True(t, peer.allowMessage(), "Message under limit should be permitted")
	}

	assert.False(t, peer.allowMessage(), "Message over limit should be rejected")
}

func TestP2P_OriginCheck(t *testing.T) {
	cfg := &config.Config{
		AppEnv:             config.EnvProduction,
		CORSAllowedOrigins: []string{"https://connect.aitathastu.com"},
		PublicAppOrigin:    "https://connect.aitathastu.com",
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := NewHub(logger)
	handler := NewHandler(cfg, logger, hub, nil, nil)

	// Valid origin
	req1 := httptest.NewRequest("GET", "/api/v1/rooms/ABC-123/p2p/ws", nil)
	req1.Header.Set("Origin", "https://connect.aitathastu.com")
	assert.True(t, handler.upgrader.CheckOrigin(req1), "Production origin should be accepted")

	// Invalid origin (malicious)
	req2 := httptest.NewRequest("GET", "/api/v1/rooms/ABC-123/p2p/ws", nil)
	req2.Header.Set("Origin", "https://evil-attacker.com")
	assert.False(t, handler.upgrader.CheckOrigin(req2), "Untrusted origin should be rejected")
}

func rawJSON(s string) *json.RawMessage {
	raw := json.RawMessage([]byte(s))
	return &raw
}
