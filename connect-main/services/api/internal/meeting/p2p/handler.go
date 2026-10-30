package p2p

import (
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/config"
	"github.com/tathastu/connect/services/api/internal/middleware"
	"github.com/tathastu/connect/services/api/internal/model"
	"github.com/tathastu/connect/services/api/internal/room"
)

// Handler handles HTTP and WebSocket endpoints for WebRTC P2P signaling.
type Handler struct {
	cfg         *config.Config
	logger      *slog.Logger
	hub         *Hub
	roomService *room.Service
	authService *auth.Service
	upgrader    websocket.Upgrader
}

// NewHandler constructs a secure P2P Handler.
func NewHandler(
	cfg *config.Config,
	logger *slog.Logger,
	hub *Hub,
	roomService *room.Service,
	authService *auth.Service,
) *Handler {
	allowedOriginMap := make(map[string]bool)
	for _, o := range cfg.CORSAllowedOrigins {
		allowedOriginMap[strings.ToLower(strings.TrimSpace(o))] = true
	}
	if cfg.PublicAppOrigin != "" {
		allowedOriginMap[strings.ToLower(strings.TrimSpace(cfg.PublicAppOrigin))] = true
	}

	upgrader := websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				// Non-browser or direct clients without origin allowed in dev only
				return cfg.AppEnv == config.EnvDevelopment
			}
			u, err := url.Parse(origin)
			if err != nil {
				return false
			}
			originNorm := strings.ToLower(u.Scheme + "://" + u.Host)
			if allowedOriginMap[originNorm] {
				return true
			}
			// In development, allow localhost/127.0.0.1
			if cfg.AppEnv == config.EnvDevelopment {
				if strings.Contains(originNorm, "localhost") || strings.Contains(originNorm, "127.0.0.1") {
					return true
				}
			}
			return false
		},
	}

	return &Handler{
		cfg:         cfg,
		logger:      logger,
		hub:         hub,
		roomService: roomService,
		authService: authService,
		upgrader:    upgrader,
	}
}

// GetConfig returns ICE configuration and P2P eligibility for a participant.
// GET /api/v1/rooms/{code}/p2p/config
func (h *Handler) GetConfig(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	normCode := room.NormalizeCode(code)
	if normCode == "" {
		model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "Meeting not found")
		return
	}

	rm, err := h.roomService.GetRoom(r.Context(), normCode)
	if err != nil || rm == nil {
		model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "Meeting not found")
		return
	}

	if rm.Status == "ended" {
		model.SendJSONError(w, r, http.StatusGone, "ROOM_ENDED", "Meeting has ended")
		return
	}

	role := ""
	if peerInfo, err := h.authenticateRequest(r, normCode); err == nil {
		role = peerInfo.Role
	}

	iceServers := make([]ICEServer, 0, len(h.cfg.ICEServers))
	for _, s := range h.cfg.ICEServers {
		trimmed := strings.TrimSpace(s)
		if trimmed != "" {
			iceServers = append(iceServers, ICEServer{
				URLs: []string{trimmed},
			})
		}
	}
	if len(iceServers) == 0 {
		iceServers = append(iceServers, ICEServer{
			URLs: []string{"stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"},
		})
	}

	// 1:1 eligibility: Hybrid enabled and room active
	eligible := h.cfg.HybridMediaEnabled || h.cfg.P2PPilotEnabled || h.cfg.P2PDirectMediaEnabled

	resp := ConfigDTO{
		P2PEligible:   eligible,
		HybridEnabled: h.cfg.HybridMediaEnabled || h.cfg.P2PPilotEnabled,
		Role:          role,
		IceServers:    iceServers,
	}

	model.SendJSON(w, http.StatusOK, resp)
}

// ServeWS upgrades the HTTP request to WebSocket and runs the signaling loop.
// GET /api/v1/rooms/{code}/p2p/ws
func (h *Handler) ServeWS(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	normCode := room.NormalizeCode(code)
	if normCode == "" {
		http.Error(w, "invalid room code", http.StatusBadRequest)
		return
	}

	// 1. Authenticate peer identity securely
	peerInfo, err := h.authenticateRequest(r, normCode)
	if err != nil {
		h.logger.Warn("p2p ws rejected: authentication failure", "room", normCode, "err", err)
		http.Error(w, "unauthorized: "+err.Error(), http.StatusUnauthorized)
		return
	}

	// 2. Validate room status
	rm, err := h.roomService.GetRoom(r.Context(), normCode)
	if err != nil || rm == nil {
		http.Error(w, "meeting not found", http.StatusNotFound)
		return
	}
	if rm.Status == "ended" {
		http.Error(w, "meeting has ended", http.StatusGone)
		return
	}
	if rm.IsLocked && !peerInfo.IsHost {
		http.Error(w, "meeting is locked", http.StatusForbidden)
		return
	}

	// 3. Upgrade to WebSocket (Origin validation enforced in constructor CheckOrigin)
	conn, err := h.upgrader.Upgrade(w, r, nil) // nosemgrep: go.gorilla.security.audit.websocket-missing-origin-check.websocket-missing-origin-check
	if err != nil {
		h.logger.Warn("p2p ws upgrade failed", "room", normCode, "err", err)
		return
	}

	// 4. Register peer with signaling hub (enforcing 2-peer cap)
	peer, err := h.hub.Register(normCode, peerInfo, conn)
	if err != nil {
		h.logger.Warn("p2p registration failed", "room", normCode, "err", err)
		_ = conn.WriteJSON(SignalingMessage{
			Type:      MsgTypeFallbackSFU,
			Reason:    err.Error(),
			Timestamp: time.Now().UnixMilli(),
		})
		_ = conn.Close()
		return
	}

	defer func() {
		h.hub.Unregister(normCode, peer.Info.Identity)
	}()

	// 5. Send initial role and ready state to the connected peer
	_ = peer.SendMessage(SignalingMessage{
		Type:        MsgTypeRole,
		Role:        peer.Info.Role,
		RecipientID: peer.Info.Identity,
		Timestamp:   time.Now().UnixMilli(),
	})

	// Broadcast peer_joined to the other peer if present
	_ = h.hub.RouteMessage(normCode, peer, SignalingMessage{
		Type:      MsgTypePeerJoined,
		SenderID:  peer.Info.Identity,
		Timestamp: time.Now().UnixMilli(),
	})

	// Configure WebSocket connection timeouts
	conn.SetReadLimit(maxMessageSize)
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	// Start ping keepalive ticker
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	go func() {
		for range ticker.C {
			peer.writeMu.Lock()
			if peer.closed {
				peer.writeMu.Unlock()
				return
			}
			_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				peer.writeMu.Unlock()
				return
			}
			peer.writeMu.Unlock()
		}
	}()

	// Read message loop
	for {
		var msg SignalingMessage
		err := conn.ReadJSON(&msg)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure, websocket.CloseNormalClosure) {
				h.logger.Warn("p2p ws read error", "room", normCode, "err", err)
			}
			break
		}

		// Handle keepalive pings
		if msg.Type == MsgTypePing {
			_ = peer.SendMessage(SignalingMessage{
				Type:      MsgTypePong,
				Timestamp: time.Now().UnixMilli(),
			})
			continue
		}

		// Route valid signaling message to authorized peer
		if err := h.hub.RouteMessage(normCode, peer, msg); err != nil {
			if errors.Is(err, ErrRateLimitExceed) {
				_ = peer.SendMessage(SignalingMessage{
					Type:      MsgTypeError,
					Reason:    "RATE_LIMIT_EXCEEDED",
					Timestamp: time.Now().UnixMilli(),
				})
			} else {
				h.logger.Warn("p2p route message error", "room", normCode, "err", err)
			}
		}
	}
}

// authenticateRequest extracts and verifies identity from session cookie or guest token.
func (h *Handler) authenticateRequest(r *http.Request, normCode string) (PeerInfo, error) {
	// 1. Check logged-in user session
	user, ok := middleware.UserFromContext(r.Context())
	if !ok || user == nil {
		if token := auth.ExtractSessionToken(r); token != "" && h.authService != nil {
			u, _, err := h.authService.ValidateSession(r.Context(), token)
			if err == nil && u != nil {
				user = u
			}
		}
	}

	if user != nil {
		// User is authenticated; check if host of the room
		isHost := false
		if rm, err := h.roomService.GetRoom(r.Context(), normCode); err == nil && rm != nil {
			if rm.HostUserID == user.ID {
				isHost = true
			}
		}
		return PeerInfo{
			Identity:    "user:" + user.ID,
			DisplayName: user.DisplayName,
			IsHost:      isHost,
			JoinedAt:    time.Now(),
		}, nil
	}

	// 2. Check room-scoped guest token
	guestToken := strings.TrimSpace(r.Header.Get("X-Guest-Token"))
	if guestToken == "" {
		if c, err := r.Cookie("tc_guest_" + normCode); err == nil && c.Value != "" {
			guestToken = strings.TrimSpace(c.Value)
		}
	}
	if guestToken == "" {
		guestToken = strings.TrimSpace(r.URL.Query().Get("guest_token"))
	}

	if guestToken != "" {
		verifiedIdent, err := room.VerifyGuestToken(normCode, guestToken)
		if err != nil {
			return PeerInfo{}, errors.New("invalid or expired guest credential")
		}

		displayName := strings.TrimSpace(r.URL.Query().Get("display_name"))
		if displayName == "" {
			if participants, err := h.roomService.GetParticipants(r.Context(), normCode); err == nil {
				for _, p := range participants {
					if p.Identity == verifiedIdent && p.DisplayName != "" {
						displayName = p.DisplayName
						break
					}
				}
			}
		}
		if displayName == "" {
			displayName = "Guest"
		}

		return PeerInfo{
			Identity:    verifiedIdent,
			DisplayName: displayName,
			IsHost:      false,
			JoinedAt:    time.Now(),
		}, nil
	}

	return PeerInfo{}, errors.New("authentication required for p2p signaling")
}
