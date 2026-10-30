package livekit

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/livekit/protocol/auth"
	proto "github.com/livekit/protocol/livekit"
)

type roomScopeKey struct{}

// WithRoomScope binds the server-authoritative room identifier to the context for Twirp RPC administration.
func WithRoomScope(ctx context.Context, roomCode string) context.Context {
	return context.WithValue(ctx, roomScopeKey{}, roomCode)
}

func roomScopeFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(roomScopeKey{}).(string); ok {
		return v
	}
	return ""
}

// authTransport injects short-lived LiveKit administrative JWTs into Twirp HTTP requests.
type authTransport struct {
	base      http.RoundTripper
	apiKey    string
	apiSecret string
}

func (t *authTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	roomCode := roomScopeFromContext(req.Context())

	at := auth.NewAccessToken(t.apiKey, t.apiSecret)
	vg := &auth.VideoGrant{
		RoomAdmin: true,
	}

	// Least-Privilege Scoping:
	// LiveKit SFU requires VideoGrant.Room == req.Room for participant mutations
	// (UpdateParticipant, RemoveParticipant, MutePublishedTrack).
	// Global room creation and listing grants are omitted when scoped to a room.
	if roomCode != "" {
		vg.Room = roomCode
	} else {
		// Unscoped transport used exclusively for cross-room administrative discovery (e.g. ListRooms)
		vg.RoomCreate = true
		vg.RoomList = true
	}

	at.AddGrant(vg).SetValidFor(2 * time.Minute)

	token, err := at.ToJWT()
	if err != nil {
		return nil, fmt.Errorf("failed to generate administrative token for LiveKit API: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	return t.base.RoundTrip(req)
}

// RoomManager provides authoritative server-side room lifecycle controls against LiveKit SFU.
type RoomManager struct {
	client    proto.RoomService
	apiKey    string
	apiSecret string
}

// NewRoomManager constructs a RoomManager instance targeting the configured LiveKit SFU.
func NewRoomManager(livekitURL, apiKey, apiSecret string) *RoomManager {
	if apiKey == "" || apiSecret == "" || livekitURL == "" {
		return &RoomManager{
			apiKey:    apiKey,
			apiSecret: apiSecret,
		}
	}

	// Normalize WebSocket URL to HTTP URL for Twirp RPC
	httpURL := strings.Replace(livekitURL, "wss://", "https://", 1)
	// nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket
	httpURL = strings.Replace(httpURL, "ws://", "http://", 1)

	httpClient := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &authTransport{
			base:      http.DefaultTransport,
			apiKey:    apiKey,
			apiSecret: apiSecret,
		},
	}

	return &RoomManager{
		client:    proto.NewRoomServiceProtobufClient(httpURL, httpClient),
		apiKey:    apiKey,
		apiSecret: apiSecret,
	}
}

// GenerateAdminToken creates an administrative token with room-scoped or global grants.
func (m *RoomManager) GenerateAdminToken(roomCode string) (string, error) {
	if m.apiKey == "" || m.apiSecret == "" {
		return "", errors.New("livekit credentials not configured")
	}
	at := auth.NewAccessToken(m.apiKey, m.apiSecret)
	vg := &auth.VideoGrant{
		RoomAdmin: true,
	}
	if roomCode != "" {
		vg.Room = roomCode
	} else {
		vg.RoomCreate = true
		vg.RoomList = true
	}
	at.AddGrant(vg).SetValidFor(2 * time.Minute)
	return at.ToJWT()
}

// TerminateRoom instructs LiveKit SFU to immediately disconnect all participants and delete the room.
func (m *RoomManager) TerminateRoom(ctx context.Context, roomCode string) error {
	if m.client == nil {
		return nil // Non-blocking if credentials unconfigured in mock/offline test mode
	}

	scopedCtx := WithRoomScope(ctx, roomCode)
	_, err := m.client.DeleteRoom(scopedCtx, &proto.DeleteRoomRequest{
		Room: roomCode,
	})
	if err != nil {
		// If room already closed or absent, treat as success
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			return nil
		}
		return fmt.Errorf("livekit delete room failed: %w", err)
	}
	return nil
}

// RemoveParticipant instructs LiveKit SFU to immediately disconnect a participant from the room.
func (m *RoomManager) RemoveParticipant(ctx context.Context, roomCode, identity string) error {
	if m.client == nil {
		return nil
	}

	scopedCtx := WithRoomScope(ctx, roomCode)
	_, err := m.client.RemoveParticipant(scopedCtx, &proto.RoomParticipantIdentity{
		Room:     roomCode,
		Identity: identity,
	})
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			return nil
		}
		return fmt.Errorf("livekit remove participant failed: %w", err)
	}
	return nil
}

// MuteParticipantTrack instructs LiveKit SFU to mute a specific audio or video track published by a participant.
func (m *RoomManager) MuteParticipantTrack(ctx context.Context, roomCode, identity, trackSid string) error {
	if m.client == nil {
		return nil
	}

	scopedCtx := WithRoomScope(ctx, roomCode)
	_, err := m.client.MutePublishedTrack(scopedCtx, &proto.MuteRoomTrackRequest{
		Room:     roomCode,
		Identity: identity,
		TrackSid: trackSid,
		Muted:    true,
	})
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			return nil
		}
		return fmt.Errorf("livekit mute track failed: %w", err)
	}
	return nil
}

// UpdateParticipantPermissions instructs LiveKit SFU to authoritatively update a participant's
// publishing, subscribing, and track source permissions in real-time.
func (m *RoomManager) UpdateParticipantPermissions(
	ctx context.Context,
	roomCode, identity string,
	permission *proto.ParticipantPermission,
) error {
	if m.client == nil {
		return nil
	}

	scopedCtx := WithRoomScope(ctx, roomCode)
	_, err := m.client.UpdateParticipant(scopedCtx, &proto.UpdateParticipantRequest{
		Room:       roomCode,
		Identity:   identity,
		Permission: permission,
	})
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			return nil
		}
		return fmt.Errorf("livekit update participant permissions failed: %w", err)
	}
	return nil
}

// PromoteToSpeaker grants camera and microphone publishing permissions to a participant in real-time.
func (m *RoomManager) PromoteToSpeaker(ctx context.Context, roomCode, identity string) error {
	return m.UpdateParticipantPermissions(ctx, roomCode, identity, &proto.ParticipantPermission{
		CanSubscribe:   true,
		CanPublish:     true,
		CanPublishData: true,
		CanPublishSources: []proto.TrackSource{
			proto.TrackSource_CAMERA,
			proto.TrackSource_MICROPHONE,
		},
	})
}

// DemoteToParticipant revokes publishing permissions from a participant in real-time.
func (m *RoomManager) DemoteToParticipant(ctx context.Context, roomCode, identity string) error {
	return m.UpdateParticipantPermissions(ctx, roomCode, identity, &proto.ParticipantPermission{
		CanSubscribe:     true,
		CanPublish:       false,
		CanPublishData:   true,
		CanPublishSources: nil,
	})
}
