package room

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/tathastu/connect/services/api/internal/middleware"
	"github.com/tathastu/connect/services/api/internal/model"
	"github.com/tathastu/connect/services/api/internal/ratelimit"
)

// Handlers handles HTTP endpoints for rooms, participants, and livekit media grants.
type Handlers struct {
	service         *Service
	limiter         ratelimit.Limiter
	publicAppOrigin string
	livekitURL      string
}

// NewHandlers constructs room handlers.
func NewHandlers(service *Service, limiter ratelimit.Limiter, publicAppOrigin, livekitURL string) *Handlers {
	return &Handlers{
		service:         service,
		limiter:         limiter,
		publicAppOrigin: strings.TrimRight(publicAppOrigin, "/"),
		livekitURL:      livekitURL,
	}
}

func (h *Handlers) isProduction() bool {
	return strings.HasPrefix(h.publicAppOrigin, "https://")
}

type CreateRoomRequest struct {
	MaxParticipants    int  `json:"maxParticipants,omitempty"`
	WaitingRoomEnabled bool `json:"waitingRoomEnabled,omitempty"`
}

type JoinRoomRequest struct {
	Identity    string `json:"identity,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
}

type LeaveRoomRequest struct {
	Identity string `json:"identity"`
}

type TokenRequest struct {
	GuestIdentity    string `json:"guestIdentity,omitempty"`
	GuestDisplayName string `json:"guestDisplayName,omitempty"`
	GuestToken       string `json:"guestToken,omitempty"`
}

type RoomDTO struct {
	ID                 string `json:"id"`
	PublicCode         string `json:"publicCode"`
	Status             string `json:"status"`
	IsLocked           bool   `json:"isLocked"`
	WaitingRoomEnabled bool   `json:"waitingRoomEnabled"`
	MaxParticipants    int    `json:"maxParticipants"`
	CreatedAt          string `json:"createdAt"`
}

type ParticipantDTO struct {
	Identity    string `json:"identity"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	IsGuest     bool   `json:"isGuest"`
	JoinedAt    string `json:"joinedAt"`
}

type AdmissionRequestDTO struct {
	ID          string `json:"id"`
	Identity    string `json:"identity"`
	DisplayName string `json:"displayName"`
	Status      string `json:"status"`
	RequestedAt string `json:"requestedAt"`
}

type AdmitRequestPayload struct {
	Identity    string `json:"identity,omitempty"`
	DisplayName string `json:"displayName"`
}

type AdmitDecisionPayload struct {
	RequestID string `json:"requestId"`
	Decision  string `json:"decision"`
}

type MuteParticipantPayload struct {
	TrackSid string `json:"trackSid,omitempty"`
}

func toRoomDTO(r *Room) RoomDTO {
	return RoomDTO{
		ID:                 r.ID,
		PublicCode:         r.PublicCode,
		Status:             r.Status,
		IsLocked:           r.IsLocked,
		WaitingRoomEnabled: r.WaitingRoomEnabled,
		MaxParticipants:    r.MaxParticipants,
		CreatedAt:          r.CreatedAt.Format(time.RFC3339),
	}
}

func toParticipantDTO(p *Participant) ParticipantDTO {
	return ParticipantDTO{
		Identity:    p.Identity,
		DisplayName: p.DisplayName,
		Role:        p.Role,
		IsGuest:     p.IsGuest,
		JoinedAt:    p.JoinedAt.Format(time.RFC3339),
	}
}

// Create handles POST /api/v1/rooms
func (h *Handlers) Create(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok || user == nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required to create a room")
		return
	}

	clientIP := extractIP(r)
	reqID := getRequestID(r)

	// Rate limit room creation per authenticated user (max 10 rooms per minute)
	if h.limiter != nil {
		rateKey := fmt.Sprintf("create_room:%s", user.ID)
		allowed, err := h.limiter.Allow(r.Context(), rateKey, 10, time.Minute)
		if err != nil || !allowed {
			w.Header().Set("Retry-After", "60")
			model.SendJSONError(w, r, http.StatusTooManyRequests, "TOO_MANY_REQUESTS", "Room creation rate limit reached")
			return
		}
	}

	var req CreateRoomRequest
	if r.ContentLength > 0 {
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		_ = decoder.Decode(&req)
	}

	createdRoom, err := h.service.CreateRoomWithOptions(r.Context(), user, req.MaxParticipants, req.WaitingRoomEnabled, clientIP, reqID)
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create room")
		return
	}

	inviteURL := fmt.Sprintf("%s/room/%s", h.publicAppOrigin, createdRoom.PublicCode)

	model.SendJSON(w, http.StatusCreated, map[string]any{
		"room":      toRoomDTO(createdRoom),
		"inviteUrl": inviteURL,
	})
}

// Get handles GET /api/v1/rooms/{code}
func (h *Handlers) Get(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	if !IsValidCodeFormat(code) {
		model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "This meeting is unavailable.")
		return
	}

	clientIP := extractIP(r)
	// Rate limit room lookup by IP + room code (mitigate code enumeration)
	if h.limiter != nil {
		rateKey := fmt.Sprintf("room_lookup:%s:%s", clientIP, NormalizeCode(code))
		allowed, err := h.limiter.Allow(r.Context(), rateKey, 30, time.Minute)
		if err != nil || !allowed {
			w.Header().Set("Retry-After", "60")
			model.SendJSONError(w, r, http.StatusTooManyRequests, "TOO_MANY_REQUESTS", "Too many requests. Please slow down.")
			return
		}
	}

	rm, err := h.service.GetRoom(r.Context(), code)
	if err != nil {
		if errors.Is(err, ErrRoomEnded) {
			model.SendJSONError(w, r, http.StatusGone, "ROOM_ENDED", "This meeting has ended.")
			return
		}
		model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "This meeting is unavailable.")
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"room": toRoomDTO(rm),
	})
}

// Join handles POST /api/v1/rooms/{code}/join
func (h *Handlers) Join(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	if !IsValidCodeFormat(code) {
		model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "This meeting is unavailable.")
		return
	}

	clientIP := extractIP(r)
	reqID := getRequestID(r)

	// Rate limit join attempts by IP + room code
	if h.limiter != nil {
		rateKey := fmt.Sprintf("room_join:%s:%s", clientIP, NormalizeCode(code))
		allowed, err := h.limiter.Allow(r.Context(), rateKey, 15, time.Minute)
		if err != nil || !allowed {
			w.Header().Set("Retry-After", "60")
			model.SendJSONError(w, r, http.StatusTooManyRequests, "TOO_MANY_REQUESTS", "Too many join attempts. Please retry later.")
			return
		}
	}

	user, _ := middleware.UserFromContext(r.Context())

	var req JoinRoomRequest
	if r.ContentLength > 0 {
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		_ = decoder.Decode(&req)
	}

	result, err := h.service.JoinRoomWithIdentity(r.Context(), code, user, req.Identity, req.DisplayName, clientIP, reqID)
	if err != nil {
		switch {
		case errors.Is(err, ErrRoomNotFound):
			model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "This meeting is unavailable.")
		case errors.Is(err, ErrRoomEnded):
			model.SendJSONError(w, r, http.StatusGone, "ROOM_ENDED", "This meeting has ended.")
		case errors.Is(err, ErrRoomLocked):
			model.SendJSONError(w, r, http.StatusForbidden, "ROOM_LOCKED", "This meeting is locked by the host.")
		case errors.Is(err, ErrRoomFull):
			model.SendJSONError(w, r, http.StatusConflict, "ROOM_FULL", "This meeting is currently at maximum capacity.")
		case errors.Is(err, ErrParticipantRemoved):
			model.SendJSONError(w, r, http.StatusForbidden, "PARTICIPANT_REMOVED", "You have been removed from this meeting by the host.")
		case errors.Is(err, ErrAdmissionPending):
			model.SendJSONError(w, r, http.StatusForbidden, "ADMISSION_PENDING", "Waiting for host approval to enter the meeting.")
		case errors.Is(err, ErrAdmissionRequired):
			model.SendJSONError(w, r, http.StatusForbidden, "ADMISSION_REQUIRED", "Admission request required to enter this meeting.")
		case errors.Is(err, ErrAdmissionDenied):
			model.SendJSONError(w, r, http.StatusForbidden, "ADMISSION_DENIED", "The host declined your request to join.")
		case errors.Is(err, ErrInvalidDisplayName):
			model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_DISPLAY_NAME", err.Error())
		default:
			model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to join meeting room")
		}
		return
	}

	respData := map[string]any{
		"room":        toRoomDTO(result.Room),
		"participant": toParticipantDTO(result.Participant),
		"isHost":      result.IsHost,
	}
	if result.GuestToken != "" {
		SetGuestCookie(w, code, result.GuestToken, h.isProduction(), 12*time.Hour)
		respData["guestToken"] = result.GuestToken
	}

	model.SendJSON(w, http.StatusOK, respData)
}

// Leave handles POST /api/v1/rooms/{code}/leave
func (h *Handlers) Leave(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	ClearGuestCookie(w, code, h.isProduction())
	clientIP := extractIP(r)
	reqID := getRequestID(r)

	var req LeaveRoomRequest
	if r.ContentLength > 0 {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	user, _ := middleware.UserFromContext(r.Context())
	identity := req.Identity
	if user != nil && identity == "" {
		identity = "user:" + user.ID
	}

	_ = h.service.LeaveRoom(r.Context(), code, identity, clientIP, reqID)

	model.SendJSON(w, http.StatusOK, map[string]any{
		"success": true,
	})
}

// Lock handles POST /api/v1/rooms/{code}/lock
func (h *Handlers) Lock(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	user, ok := middleware.UserFromContext(r.Context())
	if !ok || user == nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}

	clientIP := extractIP(r)
	reqID := getRequestID(r)

	if err := h.service.LockRoom(r.Context(), code, user, clientIP, reqID); err != nil {
		if errors.Is(err, ErrUnauthorizedRoomAction) {
			model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "Only the host can lock the meeting.")
			return
		}
		model.SendJSONError(w, r, http.StatusBadRequest, "ROOM_ERROR", err.Error())
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"success":  true,
		"isLocked": true,
	})
}

// Unlock handles POST /api/v1/rooms/{code}/unlock
func (h *Handlers) Unlock(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	user, ok := middleware.UserFromContext(r.Context())
	if !ok || user == nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}

	clientIP := extractIP(r)
	reqID := getRequestID(r)

	if err := h.service.UnlockRoom(r.Context(), code, user, clientIP, reqID); err != nil {
		if errors.Is(err, ErrUnauthorizedRoomAction) {
			model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "Only the host can unlock the meeting.")
			return
		}
		model.SendJSONError(w, r, http.StatusBadRequest, "ROOM_ERROR", err.Error())
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"success":  true,
		"isLocked": false,
	})
}

// End handles POST /api/v1/rooms/{code}/end
func (h *Handlers) End(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	user, ok := middleware.UserFromContext(r.Context())
	if !ok || user == nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}

	clientIP := extractIP(r)
	reqID := getRequestID(r)

	if err := h.service.EndRoom(r.Context(), code, user, clientIP, reqID); err != nil {
		if errors.Is(err, ErrUnauthorizedRoomAction) {
			model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "Only the meeting host can end the meeting for everyone.")
			return
		}
		model.SendJSONError(w, r, http.StatusBadRequest, "ROOM_ERROR", err.Error())
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"status":  "ended",
	})
}

// Participants handles GET /api/v1/rooms/{code}/participants
func (h *Handlers) Participants(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	participants, err := h.service.GetParticipants(r.Context(), code)
	if err != nil {
		model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "This meeting is unavailable.")
		return
	}

	list := make([]ParticipantDTO, 0, len(participants))
	for _, p := range participants {
		list = append(list, toParticipantDTO(p))
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"participants": list,
	})
}

// Token handles POST /api/v1/rooms/{code}/token
func (h *Handlers) Token(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	normCode := NormalizeCode(code)
	clientIP := extractIP(r)
	reqID := getRequestID(r)

	user, _ := middleware.UserFromContext(r.Context())

	var req TokenRequest
	if r.ContentLength > 0 {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	guestIdentity := strings.TrimSpace(req.GuestIdentity)
	if user == nil {
		// Unauthenticated guest must provide a verified room-scoped guest credential
		guestToken := strings.TrimSpace(req.GuestToken)
		if guestToken == "" {
			guestToken = strings.TrimSpace(r.Header.Get("X-Guest-Token"))
		}
		if guestToken == "" {
			if c, err := r.Cookie("tc_guest_" + normCode); err == nil && c.Value != "" {
				guestToken = strings.TrimSpace(c.Value)
			}
		}
		if guestToken == "" && strings.HasPrefix(guestIdentity, "gst.") {
			guestToken = guestIdentity
		}

		if guestToken != "" {
			verifiedIdent, err := VerifyGuestToken(normCode, guestToken)
			if err != nil {
				model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Invalid or expired guest credential.")
				return
			}
			if guestIdentity != "" && guestIdentity != verifiedIdent && !strings.HasPrefix(guestIdentity, "gst.") {
				model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Participant identity does not match verified credential.")
				return
			}
			guestIdentity = verifiedIdent
		} else if guestIdentity != "" {
			// A raw guest:<uuid> header/body without token is rejected unless admitted in waiting room
			rm, err := h.service.GetRoom(r.Context(), normCode)
			if err != nil || rm == nil {
				model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "This meeting is unavailable.")
				return
			}
			if rm.WaitingRoomEnabled {
				admitReq, err := h.service.GetAdmissionStatus(r.Context(), normCode, guestIdentity)
				if err != nil || admitReq == nil || admitReq.Status != "admitted" {
					model.SendJSONError(w, r, http.StatusForbidden, "ADMISSION_REQUIRED", "Verified guest credential required.")
					return
				}
				newToken, err := GenerateGuestToken(normCode, guestIdentity, 12*time.Hour)
				if err == nil {
					SetGuestCookie(w, normCode, newToken, h.isProduction(), 12*time.Hour)
				}
			} else {
				model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Valid room-scoped guest credential required.")
				return
			}
		} else {
			model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Participant identity required for media token.")
			return
		}
	}

	token, err := h.service.GenerateToken(r.Context(), code, user, guestIdentity, req.GuestDisplayName, clientIP, reqID)
	if err != nil {
		switch {
		case errors.Is(err, ErrRoomNotFound):
			model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "This meeting is unavailable.")
		case errors.Is(err, ErrRoomEnded):
			model.SendJSONError(w, r, http.StatusGone, "ROOM_ENDED", "This meeting has ended.")
		case errors.Is(err, ErrParticipantRemoved):
			model.SendJSONError(w, r, http.StatusForbidden, "PARTICIPANT_REMOVED", "You have been removed from this meeting by the host.")
		case errors.Is(err, ErrAdmissionPending):
			model.SendJSONError(w, r, http.StatusForbidden, "ADMISSION_PENDING", "Waiting for host approval to enter the meeting.")
		case errors.Is(err, ErrAdmissionRequired):
			model.SendJSONError(w, r, http.StatusForbidden, "ADMISSION_REQUIRED", "Admission request required to enter this meeting.")
		case errors.Is(err, ErrAdmissionDenied):
			model.SendJSONError(w, r, http.StatusForbidden, "ADMISSION_DENIED", "The host declined your request to join.")
		case errors.Is(err, ErrParticipantRequired) || errors.Is(err, ErrUnauthorizedRoomAction):
			model.SendJSONError(w, r, http.StatusForbidden, "UNAUTHORIZED", "Participant identity required for media token")
		default:
			model.SendJSONError(w, r, http.StatusInternalServerError, "TOKEN_ERROR", "Failed to issue room connection token")
		}
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"token":      token,
		"livekitUrl": h.livekitURL,
	})
}

// RequestAdmission handles POST /api/v1/rooms/{code}/admission/request
func (h *Handlers) RequestAdmission(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	clientIP := extractIP(r)
	reqID := getRequestID(r)

	var payload AdmitRequestPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "MALFORMED_JSON", "Invalid request body")
		return
	}

	req, err := h.service.RequestAdmission(r.Context(), code, payload.Identity, payload.DisplayName, clientIP, reqID)
	if err != nil {
		switch {
		case errors.Is(err, ErrRoomNotFound):
			model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "This meeting is unavailable.")
		case errors.Is(err, ErrRoomEnded):
			model.SendJSONError(w, r, http.StatusGone, "ROOM_ENDED", "This meeting has ended.")
		case errors.Is(err, ErrRoomLocked):
			model.SendJSONError(w, r, http.StatusForbidden, "ROOM_LOCKED", "This meeting is locked by the host.")
		case errors.Is(err, ErrParticipantRemoved):
			model.SendJSONError(w, r, http.StatusForbidden, "PARTICIPANT_REMOVED", "You have been removed from this meeting by the host.")
		case errors.Is(err, ErrInvalidDisplayName):
			model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_DISPLAY_NAME", err.Error())
		default:
			model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to submit admission request")
		}
		return
	}

	if req.GuestToken != "" {
		SetGuestCookie(w, code, req.GuestToken, h.isProduction(), 12*time.Hour)
	}

	model.SendJSON(w, http.StatusCreated, map[string]any{
		"request": AdmissionRequestDTO{
			ID:          req.ID,
			Identity:    req.Identity,
			DisplayName: req.DisplayName,
			Status:      req.Status,
			RequestedAt: req.RequestedAt.Format(time.RFC3339),
		},
	})
}

// GetAdmissionStatus handles GET /api/v1/rooms/{code}/admission/status?identity={identity}
func (h *Handlers) GetAdmissionStatus(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	identity := r.URL.Query().Get("identity")
	if identity == "" {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_IDENTITY", "Identity query parameter required")
		return
	}

	req, err := h.service.GetAdmissionStatus(r.Context(), code, identity)
	if err != nil {
		if errors.Is(err, ErrAdmissionRequestNotFound) {
			model.SendJSONError(w, r, http.StatusNotFound, "REQUEST_NOT_FOUND", "No admission request found")
			return
		}
		if errors.Is(err, ErrRoomEnded) {
			model.SendJSONError(w, r, http.StatusGone, "ROOM_ENDED", "This meeting has ended.")
			return
		}
		model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "This meeting is unavailable.")
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"request": AdmissionRequestDTO{
			ID:          req.ID,
			Identity:    req.Identity,
			DisplayName: req.DisplayName,
			Status:      req.Status,
			RequestedAt: req.RequestedAt.Format(time.RFC3339),
		},
	})
}

// GetPendingAdmissions handles GET /api/v1/rooms/{code}/admission/pending
func (h *Handlers) GetPendingAdmissions(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	user, ok := middleware.UserFromContext(r.Context())
	if !ok || user == nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}

	requests, err := h.service.GetPendingAdmissions(r.Context(), code, user)
	if err != nil {
		if errors.Is(err, ErrUnauthorizedRoomAction) {
			model.SendJSONError(w, r, http.StatusForbidden, "UNAUTHORIZED", "Only the host can review admission requests")
			return
		}
		model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "This meeting is unavailable.")
		return
	}

	dtos := make([]AdmissionRequestDTO, 0, len(requests))
	for _, req := range requests {
		dtos = append(dtos, AdmissionRequestDTO{
			ID:          req.ID,
			Identity:    req.Identity,
			DisplayName: req.DisplayName,
			Status:      req.Status,
			RequestedAt: req.RequestedAt.Format(time.RFC3339),
		})
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"requests": dtos,
	})
}

// DecideAdmission handles POST /api/v1/rooms/{code}/admission/decision
func (h *Handlers) DecideAdmission(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	user, ok := middleware.UserFromContext(r.Context())
	if !ok || user == nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}

	clientIP := extractIP(r)
	reqID := getRequestID(r)

	var payload AdmitDecisionPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "MALFORMED_JSON", "Invalid request body")
		return
	}

	if err := h.service.DecideAdmission(r.Context(), code, user, payload.RequestID, payload.Decision, clientIP, reqID); err != nil {
		switch {
		case errors.Is(err, ErrUnauthorizedRoomAction):
			model.SendJSONError(w, r, http.StatusForbidden, "UNAUTHORIZED", "Only the host can decide admission")
		case errors.Is(err, ErrAdmissionAlreadyDecided):
			model.SendJSONError(w, r, http.StatusConflict, "ALREADY_DECIDED", "This request has already been processed")
		default:
			model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to record admission decision")
		}
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"status": payload.Decision,
	})
}

// RemoveParticipant handles POST /api/v1/rooms/{code}/participants/{identity}/remove
func (h *Handlers) RemoveParticipant(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	targetIdentity := chi.URLParam(r, "identity")
	user, ok := middleware.UserFromContext(r.Context())
	if !ok || user == nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}

	clientIP := extractIP(r)
	reqID := getRequestID(r)

	if err := h.service.RemoveParticipant(r.Context(), code, user, targetIdentity, clientIP, reqID); err != nil {
		switch {
		case errors.Is(err, ErrUnauthorizedRoomAction):
			model.SendJSONError(w, r, http.StatusForbidden, "UNAUTHORIZED", "Only the host can remove participants")
		default:
			model.SendJSONError(w, r, http.StatusBadRequest, "REMOVE_FAILED", err.Error())
		}
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"removed": true,
	})
}

// MuteParticipant handles POST /api/v1/rooms/{code}/participants/{identity}/mute
func (h *Handlers) MuteParticipant(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	targetIdentity := chi.URLParam(r, "identity")
	user, ok := middleware.UserFromContext(r.Context())
	if !ok || user == nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}

	clientIP := extractIP(r)
	reqID := getRequestID(r)

	var payload MuteParticipantPayload
	if r.ContentLength > 0 {
		_ = json.NewDecoder(r.Body).Decode(&payload)
	}

	if err := h.service.MuteParticipant(r.Context(), code, user, targetIdentity, payload.TrackSid, clientIP, reqID); err != nil {
		if errors.Is(err, ErrUnauthorizedRoomAction) {
			model.SendJSONError(w, r, http.StatusForbidden, "UNAUTHORIZED", "Only the host can mute participants")
			return
		}
		model.SendJSONError(w, r, http.StatusBadRequest, "MUTE_FAILED", err.Error())
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"muted": true,
	})
}

// History handles GET /api/v1/rooms/history
func (h *Handlers) History(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok || user == nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required to view meeting history")
		return
	}

	items, total, err := h.service.GetMeetingHistory(r.Context(), user, 20, 0)
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve meeting history")
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"history": items,
		"total":   total,
	})
}

func extractIP(r *http.Request) string {
	remote := r.RemoteAddr
	if idx := strings.LastIndex(remote, ":"); idx != -1 {
		return remote[:idx]
	}
	return remote
}

func getRequestID(r *http.Request) string {
	if reqID := r.Header.Get("X-Request-ID"); reqID != "" {
		return reqID
	}
	return "req_unknown"
}
