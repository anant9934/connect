package p2p

import (
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	maxMessageSize = 64 * 1024 // 64 KB limit
	writeWait      = 5 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxRatePerSec  = 30
)

var (
	ErrRoomFull        = errors.New("p2p room has maximum 2 participants; use SFU")
	ErrPeerNotFound    = errors.New("target peer not found in this room")
	ErrInvalidMessage  = errors.New("invalid signaling message schema")
	ErrRateLimitExceed = errors.New("signaling message rate limit exceeded")
)

// Hub manages active WebRTC signaling rooms.
type Hub struct {
	mu     sync.RWMutex
	rooms  map[string]*RoomSession
	logger *slog.Logger
}

// NewHub constructs a new signaling Hub.
func NewHub(logger *slog.Logger) *Hub {
	return &Hub{
		rooms:  make(map[string]*RoomSession),
		logger: logger,
	}
}

// RoomSession manages up to 2 participants for direct 1:1 P2P WebRTC.
type RoomSession struct {
	RoomCode string
	mu       sync.Mutex
	peers    map[string]*Peer
	logger   *slog.Logger
}

// Peer represents an authenticated participant connected via WebSocket.
type Peer struct {
	Info     PeerInfo
	Conn     *websocket.Conn
	writeMu  sync.Mutex
	msgCount int
	window   time.Time
	closed   bool
}

// Register adds a verified participant to the room session.
// Enforces strict 1:1 eligibility (maximum 2 participants).
func (h *Hub) Register(roomCode string, info PeerInfo, conn *websocket.Conn) (*Peer, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, exists := h.rooms[roomCode]
	if !exists {
		room = &RoomSession{
			RoomCode: roomCode,
			peers:    make(map[string]*Peer),
			logger:   h.logger,
		}
		h.rooms[roomCode] = room
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	// If already 2 distinct peers and current peer is not reconnecting, reject
	if len(room.peers) >= 2 {
		if _, ok := room.peers[info.Identity]; !ok {
			return nil, ErrRoomFull
		}
	}

	// Determine polite/impolite role deterministically:
	// If first peer: host is "impolite", guest is "impolite" if first.
	// When second peer connects: one must be polite, one impolite.
	// Rule: Host is always "impolite" (master). If both guests or both same,
	// lexicographical comparison of Identity decides: smaller ID is "impolite", larger ID is "polite".
	newPeer := &Peer{
		Info:   info,
		Conn:   conn,
		window: time.Now(),
	}

	// Close old connection if peer reconnected with same identity
	if existing, ok := room.peers[info.Identity]; ok {
		existing.Close()
	}

	room.peers[info.Identity] = newPeer

	// Recompute roles for all peers in the room
	peersList := make([]*Peer, 0, len(room.peers))
	for _, p := range room.peers {
		peersList = append(peersList, p)
	}

	if len(peersList) == 1 {
		peersList[0].Info.Role = "impolite"
		_ = peersList[0].SendMessage(SignalingMessage{
			Type:      MsgTypeRole,
			Role:      peersList[0].Info.Role,
			Timestamp: time.Now().UnixMilli(),
		})
	} else if len(peersList) == 2 {
		p1 := peersList[0]
		p2 := peersList[1]
		if p1.Info.IsHost && !p2.Info.IsHost {
			p1.Info.Role = "impolite"
			p2.Info.Role = "polite"
		} else if !p1.Info.IsHost && p2.Info.IsHost {
			p1.Info.Role = "polite"
			p2.Info.Role = "impolite"
		} else {
			// Deterministic fallback by identity
			if p1.Info.Identity < p2.Info.Identity {
				p1.Info.Role = "impolite"
				p2.Info.Role = "polite"
			} else {
				p1.Info.Role = "polite"
				p2.Info.Role = "impolite"
			}
		}

		// Notify both peers of their definitive roles
		_ = p1.SendMessage(SignalingMessage{
			Type:      MsgTypeRole,
			Role:      p1.Info.Role,
			Timestamp: time.Now().UnixMilli(),
		})
		_ = p2.SendMessage(SignalingMessage{
			Type:      MsgTypeRole,
			Role:      p2.Info.Role,
			Timestamp: time.Now().UnixMilli(),
		})

		// Notify each peer that the other peer is present
		_ = p1.SendMessage(SignalingMessage{
			Type:        MsgTypePeerJoined,
			SenderID:    p2.Info.Identity,
			RecipientID: p1.Info.Identity,
			DisplayName: p2.Info.DisplayName,
			Timestamp:   time.Now().UnixMilli(),
		})
		_ = p2.SendMessage(SignalingMessage{
			Type:        MsgTypePeerJoined,
			SenderID:    p1.Info.Identity,
			RecipientID: p2.Info.Identity,
			DisplayName: p1.Info.DisplayName,
			Timestamp:   time.Now().UnixMilli(),
		})
	}

	h.logger.Info("p2p peer registered",
		"room", roomCode,
		"identity", info.Identity,
		"role", newPeer.Info.Role,
		"peerCount", len(room.peers),
	)

	return newPeer, nil
}

// Unregister removes a peer from the room and notifies the remaining peer.
func (h *Hub) Unregister(roomCode string, identity string) {
	h.mu.Lock()
	room, exists := h.rooms[roomCode]
	h.mu.Unlock()

	if !exists {
		return
	}

	room.mu.Lock()
	peer, ok := room.peers[identity]
	if ok {
		delete(room.peers, identity)
		peer.Close()
	}
	remainingCount := len(room.peers)

	// Notify remaining peer
	var remainingPeer *Peer
	for _, p := range room.peers {
		remainingPeer = p
		break
	}
	room.mu.Unlock()

	if remainingPeer != nil {
		_ = remainingPeer.SendMessage(SignalingMessage{
			Type:        MsgTypePeerLeft,
			SenderID:    identity,
			RecipientID: remainingPeer.Info.Identity,
			Timestamp:   time.Now().UnixMilli(),
		})
	}

	if remainingCount == 0 {
		h.mu.Lock()
		delete(h.rooms, roomCode)
		h.mu.Unlock()
	}

	h.logger.Info("p2p peer unregistered",
		"room", roomCode,
		"identity", identity,
		"remaining", remainingCount,
	)
}

// RouteMessage routes a validated signaling message to the other peer in the 1:1 room.
func (h *Hub) RouteMessage(roomCode string, sender *Peer, msg SignalingMessage) error {
	h.mu.RLock()
	room, exists := h.rooms[roomCode]
	h.mu.RUnlock()

	if !exists {
		return errors.New("room does not exist")
	}

	// Validate rate limit for sender
	if !sender.allowMessage() {
		return ErrRateLimitExceed
	}

	// Validate message schema
	if err := validateMessage(&msg); err != nil {
		return err
	}

	// Set sender ID securely (never trust client-supplied senderId)
	msg.SenderID = sender.Info.Identity
	msg.Timestamp = time.Now().UnixMilli()

	room.mu.Lock()
	var targetPeer *Peer
	for id, p := range room.peers {
		if id != sender.Info.Identity {
			targetPeer = p
			break
		}
	}
	room.mu.Unlock()

	if targetPeer == nil {
		// Peer not connected yet; nothing to route to yet
		return nil
	}

	msg.RecipientID = targetPeer.Info.Identity
	return targetPeer.SendMessage(msg)
}

// SendMessage writes a JSON signaling message with write timeout and lock safety.
func (p *Peer) SendMessage(msg SignalingMessage) error {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()

	if p.closed {
		return errors.New("peer connection closed")
	}

	_ = p.Conn.SetWriteDeadline(time.Now().Add(writeWait))
	return p.Conn.WriteJSON(msg)
}

// Close gracefully closes the peer connection.
func (p *Peer) Close() {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	if !p.closed {
		p.closed = true
		_ = p.Conn.Close()
	}
}

func (p *Peer) allowMessage() bool {
	now := time.Now()
	if now.Sub(p.window) > time.Second {
		p.window = now
		p.msgCount = 1
		return true
	}
	p.msgCount++
	return p.msgCount <= maxRatePerSec
}

func validateMessage(msg *SignalingMessage) error {
	switch msg.Type {
	case MsgTypeOffer, MsgTypeAnswer:
		if msg.SDP == "" {
			return errors.New("sdp cannot be empty")
		}
		// Basic sanity check: standard SDP starts with "v=0"
		if !strings.HasPrefix(strings.TrimSpace(msg.SDP), "v=0") {
			return errors.New("invalid SDP format")
		}
		// Max SDP length sanity check (prevent memory bomb)
		if len(msg.SDP) > 32*1024 {
			return errors.New("sdp exceeds maximum allowed length")
		}
	case MsgTypeCandidate:
		if msg.Candidate == nil || len(*msg.Candidate) == 0 {
			return errors.New("candidate payload required")
		}
		if len(*msg.Candidate) > 4096 {
			return errors.New("candidate payload exceeds maximum allowed length")
		}
	case MsgTypeReady, MsgTypeRenegotiate, MsgTypePing, MsgTypePong:
		// Valid simple signals
	default:
		return fmt.Errorf("unknown message type: %s", msg.Type)
	}
	return nil
}
