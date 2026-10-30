package livekit

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/livekit/protocol/auth"
)

var (
	ErrMissingCredentials = errors.New("livekit api key or secret not configured")
)

// TokenService creates short-lived, cryptographically signed LiveKit WebRTC access grants.
type TokenService struct {
	apiKey    string
	apiSecret string
}

// NewTokenService constructs a LiveKit token generator.
func NewTokenService(apiKey, apiSecret string) *TokenService {
	return &TokenService{
		apiKey:    apiKey,
		apiSecret: apiSecret,
	}
}

// Track source constants corresponding to LiveKit's canonical track source identifiers
const (
	TrackSourceCamera           = "camera"
	TrackSourceMicrophone       = "microphone"
	TrackSourceScreenShare      = "screen_share"
	TrackSourceScreenShareAudio = "screen_share_audio"
)

// Role constants defining least-privilege permission tiers
const (
	RoleHost        = "host"
	RoleCoHost      = "co-host"
	RoleSpeaker     = "speaker"
	RoleParticipant = "participant"
)

// GrantParams specifies attributes for token signing.
type GrantParams struct {
	RoomCode          string
	Identity          string // 'user:<uuid>' or 'guest:<uuid>'
	DisplayName       string
	Role              string // RoleHost, RoleCoHost, RoleSpeaker, RoleParticipant
	IsHost            bool   // Deprecated / legacy alias for RoleHost
	CanPublish        *bool  // Explicit override if provided
	CanPublishSources []string
	ValidFor          time.Duration
}

// GenerateToken generates a short-lived (5-10min) LiveKit access token with least-privilege grants.
func (s *TokenService) GenerateToken(params GrantParams) (string, error) {
	if s.apiKey == "" || s.apiSecret == "" {
		return "", ErrMissingCredentials
	}

	validFor := params.ValidFor
	if validFor <= 0 {
		validFor = 10 * time.Minute
	}

	var canPublish bool
	var sources []string
	canPublishData := true
	canSubscribe := true

	effectiveRole := strings.ToLower(strings.TrimSpace(params.Role))
	if effectiveRole == "" && params.IsHost {
		effectiveRole = RoleHost
	} else if effectiveRole == "" {
		effectiveRole = RoleParticipant
	}

	switch effectiveRole {
	case RoleHost, RoleCoHost:
		canPublish = true
		sources = []string{TrackSourceCamera, TrackSourceMicrophone, TrackSourceScreenShare, TrackSourceScreenShareAudio}
	case RoleSpeaker:
		canPublish = true
		// Promoted student speakers can publish camera and microphone, but screen sharing requires co-host or explicit grant
		sources = []string{TrackSourceCamera, TrackSourceMicrophone}
	default:
		// Regular participants/students and guests have no publishing rights by default
		canPublish = false
		sources = nil
	}

	if params.CanPublish != nil {
		canPublish = *params.CanPublish
	}
	if params.CanPublishSources != nil {
		sources = params.CanPublishSources
	}

	at := auth.NewAccessToken(s.apiKey, s.apiSecret)

	grant := &auth.VideoGrant{
		RoomJoin:          true,
		Room:              params.RoomCode,
		CanPublish:        ptr(canPublish),
		CanSubscribe:      ptr(canSubscribe),
		CanPublishData:    ptr(canPublishData),
		CanPublishSources: sources,
		RoomCreate:        params.IsHost || effectiveRole == RoleHost,
		RoomAdmin:         false, // High-privilege moderation remains on Go API
		RoomRecord:        false, // Recording explicitly deferred in Phase 2
	}

	at.AddGrant(grant).
		SetIdentity(params.Identity).
		SetName(params.DisplayName).
		SetValidFor(validFor)

	token, err := at.ToJWT()
	if err != nil {
		return "", fmt.Errorf("failed to sign livekit access grant: %w", err)
	}

	return token, nil
}

func ptr[T any](v T) *T {
	return &v
}
