package livekit

import (
	"errors"
	"fmt"
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

// GrantParams specifies attributes for token signing.
type GrantParams struct {
	RoomCode    string
	Identity    string // 'user:<uuid>' or 'guest:<uuid>'
	DisplayName string
	IsHost      bool
	ValidFor    time.Duration
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

	at := auth.NewAccessToken(s.apiKey, s.apiSecret)

	grant := &auth.VideoGrant{
		RoomJoin:       true,
		Room:           params.RoomCode,
		CanPublish:     ptr(true),
		CanSubscribe:   ptr(true),
		CanPublishData: ptr(true),
		RoomCreate:     params.IsHost,
		RoomAdmin:      false, // High-privilege moderation remains on Go API
		RoomRecord:     false, // Recording explicitly deferred in Phase 2
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
