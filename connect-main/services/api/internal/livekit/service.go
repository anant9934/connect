package livekit

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/livekit/protocol/auth"
	proto "github.com/livekit/protocol/livekit"
)

// authTransport injects short-lived LiveKit administrative JWTs into Twirp HTTP requests.
type authTransport struct {
	base      http.RoundTripper
	apiKey    string
	apiSecret string
}

func (t *authTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	at := auth.NewAccessToken(t.apiKey, t.apiSecret)
	at.AddGrant(&auth.VideoGrant{
		RoomCreate: true,
		RoomAdmin:  true,
		RoomList:   true,
	}).SetValidFor(2 * time.Minute)

	token, err := at.ToJWT()
	if err != nil {
		return nil, fmt.Errorf("failed to generate administrative token for LiveKit API: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	return t.base.RoundTrip(req)
}

// RoomManager provides authoritative server-side room lifecycle controls against LiveKit SFU.
type RoomManager struct {
	client proto.RoomService
}

// NewRoomManager constructs a RoomManager instance targeting the configured LiveKit SFU.
func NewRoomManager(livekitURL, apiKey, apiSecret string) *RoomManager {
	if apiKey == "" || apiSecret == "" || livekitURL == "" {
		return &RoomManager{}
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
		client: proto.NewRoomServiceProtobufClient(httpURL, httpClient),
	}
}

// TerminateRoom instructs LiveKit SFU to immediately disconnect all participants and delete the room.
func (m *RoomManager) TerminateRoom(ctx context.Context, roomCode string) error {
	if m.client == nil {
		return nil // Non-blocking if credentials unconfigured in mock/offline test mode
	}

	_, err := m.client.DeleteRoom(ctx, &proto.DeleteRoomRequest{
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

	_, err := m.client.RemoveParticipant(ctx, &proto.RoomParticipantIdentity{
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

	_, err := m.client.MutePublishedTrack(ctx, &proto.MuteRoomTrackRequest{
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

	_, err := m.client.UpdateParticipant(ctx, &proto.UpdateParticipantRequest{
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
