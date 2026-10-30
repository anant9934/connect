package p2p

import (
	"encoding/json"
	"time"
)

// MessageType defines the category of WebRTC signaling messages.
type MessageType string

const (
	MsgTypeReady       MessageType = "ready"
	MsgTypeOffer       MessageType = "offer"
	MsgTypeAnswer      MessageType = "answer"
	MsgTypeCandidate   MessageType = "candidate"
	MsgTypeRenegotiate MessageType = "renegotiate"
	MsgTypePeerJoined  MessageType = "peer_joined"
	MsgTypePeerLeft    MessageType = "peer_left"
	MsgTypeRole        MessageType = "role"
	MsgTypeFallbackSFU MessageType = "fallback_to_sfu"
	MsgTypeError       MessageType = "error"
	MsgTypePing        MessageType = "ping"
	MsgTypePong        MessageType = "pong"
)

// SignalingMessage defines the wire format for WebRTC signaling.
type SignalingMessage struct {
	Type        MessageType      `json:"type"`
	SenderID    string           `json:"senderId,omitempty"`
	RecipientID string           `json:"recipientId,omitempty"`
	DisplayName string           `json:"displayName,omitempty"`
	SDP         string           `json:"sdp,omitempty"`
	Candidate   *json.RawMessage `json:"candidate,omitempty"`
	Role        string           `json:"role,omitempty"` // "polite" or "impolite"
	Reason      string           `json:"reason,omitempty"`
	Timestamp   int64            `json:"timestamp,omitempty"`
}

// PeerInfo holds authenticated participant metadata within a signaling session.
type PeerInfo struct {
	Identity    string
	DisplayName string
	IsHost      bool
	JoinedAt    time.Time
	Role        string // "polite" or "impolite"
}

// ConfigDTO provides the WebRTC configuration (STUN/TURN) to authenticated clients.
type ConfigDTO struct {
	P2PEligible   bool        `json:"p2pEligible"`
	HybridEnabled bool        `json:"hybridEnabled"`
	Role          string      `json:"role,omitempty"`
	IceServers    []ICEServer `json:"iceServers"`
}

// ICEServer defines a STUN/TURN server entry.
type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}
