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

// authTransport injects short-lived, least-privilege LiveKit administrative JWTs into Twirp HTTP requests.
type authTransport struct {
	base      http.RoundTripper
	apiKey    string
	apiSecret string
}

func (t *authTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	path := req.URL.Path
	roomCode := roomScopeFromContext(req.Context())

	at := auth.NewAccessToken(t.apiKey, t.apiSecret)
	vg := &auth.VideoGrant{}

	switch {
	case strings.HasSuffix(path, "/ListRooms"):
		// Discovery privilege only; never grant administrative or mutation access
		vg.RoomList = true

	case strings.HasSuffix(path, "/CreateRoom"):
		// Creation privilege only; never grant administrative or listing access
		vg.RoomCreate = true

	case strings.HasSuffix(path, "/UpdateParticipant"),
		strings.HasSuffix(path, "/RemoveParticipant"),
		strings.HasSuffix(path, "/MutePublishedTrack"),
		strings.HasSuffix(path, "/DeleteRoom"),
		strings.HasSuffix(path, "/GetParticipant"),
		strings.HasSuffix(path, "/ListParticipants"),
		strings.HasSuffix(path, "/UpdateSubscriptions"),
		strings.HasSuffix(path, "/SendData"):
		// Room mutations require strictly bound room context; fail closed if absent
		if roomCode == "" {
			return nil, fmt.Errorf("security violation: livekit operation %s requires explicit room scope", path)
		}
		vg.Room = roomCode
		vg.RoomAdmin = true

	default:
		// Any other operation must be room-scoped; unscoped operations fail closed
		if roomCode == "" {
			return nil, fmt.Errorf("security violation: unscoped livekit administrative request denied for %s", path)
		}
		vg.Room = roomCode
		vg.RoomAdmin = true
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

// NewRoomManagerWithTransport constructs a RoomManager instance with a custom HTTP roundtripper for mocking and testing.
func NewRoomManagerWithTransport(livekitURL, apiKey, apiSecret string, baseTransport http.RoundTripper) *RoomManager {
	if apiKey == "" || apiSecret == "" || livekitURL == "" {
		return &RoomManager{
			apiKey:    apiKey,
			apiSecret: apiSecret,
		}
	}
	if baseTransport == nil {
		baseTransport = http.DefaultTransport
	}

	// Normalize WebSocket URL to HTTP URL for Twirp RPC
	httpURL := strings.Replace(livekitURL, "wss://", "https://", 1)
	// nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket
	httpURL = strings.Replace(httpURL, "ws://", "http://", 1)

	httpClient := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &authTransport{
			base:      baseTransport,
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

// NewRoomManager constructs a RoomManager instance targeting the configured LiveKit SFU.
func NewRoomManager(livekitURL, apiKey, apiSecret string) *RoomManager {
	return NewRoomManagerWithTransport(livekitURL, apiKey, apiSecret, http.DefaultTransport)
}

// GenerateDiscoveryToken creates a least-privilege token restricted strictly to listing rooms.
func (m *RoomManager) GenerateDiscoveryToken() (string, error) {
	if m.apiKey == "" || m.apiSecret == "" {
		return "", errors.New("livekit credentials not configured")
	}
	at := auth.NewAccessToken(m.apiKey, m.apiSecret)
	at.AddGrant(&auth.VideoGrant{
		RoomList: true,
	}).SetValidFor(2 * time.Minute)
	return at.ToJWT()
}

// GenerateRoomCreateToken creates a least-privilege token restricted strictly to creating rooms.
func (m *RoomManager) GenerateRoomCreateToken() (string, error) {
	if m.apiKey == "" || m.apiSecret == "" {
		return "", errors.New("livekit credentials not configured")
	}
	at := auth.NewAccessToken(m.apiKey, m.apiSecret)
	at.AddGrant(&auth.VideoGrant{
		RoomCreate: true,
	}).SetValidFor(2 * time.Minute)
	return at.ToJWT()
}

// GenerateRoomAdminToken creates a room-scoped administrative token for participant and track mutations.
// Unscoped calls fail closed to prevent unrestricted global room administration.
func (m *RoomManager) GenerateRoomAdminToken(roomCode string) (string, error) {
	if m.apiKey == "" || m.apiSecret == "" {
		return "", errors.New("livekit credentials not configured")
	}
	if roomCode == "" {
		return "", errors.New("security violation: room scope required for room admin token")
	}
	at := auth.NewAccessToken(m.apiKey, m.apiSecret)
	at.AddGrant(&auth.VideoGrant{
		Room:      roomCode,
		RoomAdmin: true,
	}).SetValidFor(2 * time.Minute)
	return at.ToJWT()
}

// GenerateAdminToken creates an administrative token.
// For backward compatibility, if roomCode is provided, a room-scoped admin token is returned.
// If roomCode is empty, an error is returned because unrestricted global admin tokens are prohibited.
func (m *RoomManager) GenerateAdminToken(roomCode string) (string, error) {
	return m.GenerateRoomAdminToken(roomCode)
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
		CanSubscribe:      true,
		CanPublish:        false,
		CanPublishData:    true,
		CanPublishSources: nil,
	})
}
