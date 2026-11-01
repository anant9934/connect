package room

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/livekit"
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
	MaxParticipants    int        `json:"maxParticipants,omitempty"`
	WaitingRoomEnabled bool       `json:"waitingRoomEnabled,omitempty"`
	Passcode           string     `json:"passcode,omitempty"`
	Title              string     `json:"title,omitempty"`
	ScheduledStart     *time.Time `json:"scheduledStart,omitempty"`
	ScheduledEnd       *time.Time `json:"scheduledEnd,omitempty"`
	TimeZone           string     `json:"timeZone,omitempty"`
}

type JoinRoomRequest struct {
	Identity    string `json:"identity,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
	Passcode    string `json:"passcode,omitempty"`
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
	ID                     string          `json:"id"`
	PublicCode             string          `json:"publicCode"`
	Status                 string          `json:"status"`
	IsLocked               bool            `json:"isLocked"`
	WaitingRoomEnabled     bool            `json:"waitingRoomEnabled"`
	MaxParticipants        int             `json:"maxParticipants"`
	CreatedAt              string          `json:"createdAt"`
	Title                  string          `json:"title,omitempty"`
	ScheduledStart         string          `json:"scheduledStart,omitempty"`
	ScheduledEnd           string          `json:"scheduledEnd,omitempty"`
	TimeZone               string          `json:"timeZone,omitempty"`
	HasPasscode            bool            `json:"hasPasscode"`
	HostIdentity           string          `json:"hostIdentity"`
	ParticipantsCanPublish bool            `json:"participantsCanPublish"`
	CoHostPermissions      map[string]bool `json:"coHostPermissions,omitempty"`
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
	dto := RoomDTO{
		ID:                     r.ID,
		PublicCode:             r.PublicCode,
		Status:                 r.Status,
		IsLocked:               r.IsLocked,
		WaitingRoomEnabled:     r.WaitingRoomEnabled,
		MaxParticipants:        r.MaxParticipants,
		CreatedAt:              r.CreatedAt.Format(time.RFC3339),
		Title:                  r.Title,
		TimeZone:               r.TimeZone,
		HasPasscode:            r.PasscodeHash != "",
		HostIdentity:           "user:" + r.HostUserID,
		ParticipantsCanPublish: r.ParticipantsCanPublish,
		CoHostPermissions:      r.CoHostPermissions,
	}
	if r.ScheduledStart != nil {
		dto.ScheduledStart = r.ScheduledStart.UTC().Format(time.RFC3339)
	}
	if r.ScheduledEnd != nil {
		dto.ScheduledEnd = r.ScheduledEnd.UTC().Format(time.RFC3339)
	}
	return dto
}

// sendScheduleError reports a scheduling failure, returning false when err is unrecognized.
func sendScheduleError(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case errors.Is(err, ErrUnauthorizedRoomAction):
		model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "Only the host can change this meeting.")
	case errors.Is(err, ErrRoomNotFound):
		model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "This meeting is unavailable.")
	case errors.Is(err, ErrScheduleConflict):
		model.SendJSONError(w, r, http.StatusConflict, "SCHEDULE_CONFLICT", err.Error())
	case errors.Is(err, ErrInvalidSchedule):
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_SCHEDULE", err.Error())
	default:
		return false
	}
	return true
}

func sendRoleError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrUnauthorizedRoomAction):
		model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You do not have permission to do this.")
	case errors.Is(err, ErrRoomNotFound):
		model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "This meeting is unavailable.")
	case errors.Is(err, ErrParticipantNotFoundInRoom):
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "That person is not in this meeting.")
	case errors.Is(err, ErrIneligibleTarget):
		model.SendJSONError(w, r, http.StatusConflict, "INELIGIBLE_TARGET", "That person is not eligible for this role.")
	case errors.Is(err, ErrInvalidSchedule):
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_PERMISSIONS", err.Error())
	case errors.Is(err, ErrSFUSyncFailed):
		model.SendJSONError(w, r, http.StatusBadGateway, "SFU_SYNC_FAILED", "The media server could not apply this.")
	default:
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "This could not be completed.")
	}
}

// requireUser writes a 401 and returns nil when the request has no session.
func requireUser(w http.ResponseWriter, r *http.Request) *auth.User {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok || user == nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return nil
	}
	return user
}

func (h *Handlers) setCoHost(w http.ResponseWriter, r *http.Request, grant bool) {
	user := requireUser(w, r)
	if user == nil {
		return
	}
	if err := h.service.SetCoHost(r.Context(), chi.URLParam(r, "code"), user, chi.URLParam(r, "identity"), grant, extractIP(r), getRequestID(r)); err != nil {
		sendRoleError(w, r, err)
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"success": true})
}

// GrantCoHost handles POST /api/v1/rooms/{code}/participants/{identity}/cohost
func (h *Handlers) GrantCoHost(w http.ResponseWriter, r *http.Request) { h.setCoHost(w, r, true) }

// RevokeCoHost handles DELETE /api/v1/rooms/{code}/participants/{identity}/cohost
func (h *Handlers) RevokeCoHost(w http.ResponseWriter, r *http.Request) { h.setCoHost(w, r, false) }

// TransferHost handles POST /api/v1/rooms/{code}/participants/{identity}/transfer-host
func (h *Handlers) TransferHost(w http.ResponseWriter, r *http.Request) {
	user := requireUser(w, r)
	if user == nil {
		return
	}
	if err := h.service.TransferHost(r.Context(), chi.URLParam(r, "code"), user, chi.URLParam(r, "identity"), extractIP(r), getRequestID(r)); err != nil {
		sendRoleError(w, r, err)
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"success": true})
}

// UpdatePermissions handles PUT /api/v1/rooms/{code}/permissions
func (h *Handlers) UpdatePermissions(w http.ResponseWriter, r *http.Request) {
	user := requireUser(w, r)
	if user == nil {
		return
	}
	var perms RoomPermissions
	if err := json.NewDecoder(r.Body).Decode(&perms); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_PERMISSIONS", "Invalid request body.")
		return
	}
	if err := h.service.SetRoomPermissions(r.Context(), chi.URLParam(r, "code"), user, perms, extractIP(r), getRequestID(r)); err != nil {
		sendRoleError(w, r, err)
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"success": true})
}

// MuteAll handles POST /api/v1/rooms/{code}/mute-all
func (h *Handlers) MuteAll(w http.ResponseWriter, r *http.Request) {
	user := requireUser(w, r)
	if user == nil {
		return
	}
	if err := h.service.MuteAll(r.Context(), chi.URLParam(r, "code"), user, extractIP(r), getRequestID(r)); err != nil {
		sendRoleError(w, r, err)
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"success": true})
}

// Me handles GET /api/v1/rooms/{code}/me
func (h *Handlers) Me(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	identity, r := callerIdentity(r, NormalizeCode(code))
	if identity == "" {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Valid participant identity required.")
		return
	}
	role, err := h.service.GetMyRole(r.Context(), code, identity)
	if err != nil {
		sendRoleError(w, r, err)
		return
	}
	model.SendJSON(w, http.StatusOK, role)
}

// Upcoming handles GET /api/v1/rooms/upcoming
func (h *Handlers) Upcoming(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok || user == nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}
	rooms, err := h.service.GetUpcomingRooms(r.Context(), user, 50)
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to load upcoming meetings")
		return
	}
	list := make([]RoomDTO, 0, len(rooms))
	for _, rm := range rooms {
		list = append(list, toRoomDTO(rm))
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"rooms": list})
}

// Reschedule handles PATCH /api/v1/rooms/{code}
func (h *Handlers) Reschedule(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok || user == nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}
	var req CreateRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ScheduledStart == nil || req.ScheduledEnd == nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_SCHEDULE", "A title, start, end and time zone are required.")
		return
	}
	rm, err := h.service.RescheduleRoom(r.Context(), chi.URLParam(r, "code"), user, req.Title, *req.ScheduledStart, *req.ScheduledEnd, req.TimeZone, extractIP(r), getRequestID(r))
	if err != nil {
		if !sendScheduleError(w, r, err) {
			model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to change the meeting")
		}
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"room": toRoomDTO(rm)})
}

// Cancel handles POST /api/v1/rooms/{code}/cancel
func (h *Handlers) Cancel(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok || user == nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}
	if err := h.service.CancelRoom(r.Context(), chi.URLParam(r, "code"), user, extractIP(r), getRequestID(r)); err != nil {
		if !sendScheduleError(w, r, err) {
			model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to cancel the meeting")
		}
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"success": true, "status": "cancelled"})
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
		// A malformed schedule must not silently become an instant meeting.
		if err := decoder.Decode(&req); err != nil {
			model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_PAYLOAD", "Invalid request body.")
			return
		}
	}

	var createdRoom *Room
	var err error
	if req.ScheduledStart != nil || req.ScheduledEnd != nil {
		if req.ScheduledStart == nil || req.ScheduledEnd == nil {
			model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_SCHEDULE", "Both a start and an end are required.")
			return
		}
		createdRoom, err = h.service.ScheduleRoom(r.Context(), user, ScheduleParams{
			Title: req.Title, StartsAt: *req.ScheduledStart, EndsAt: *req.ScheduledEnd, TimeZone: req.TimeZone,
			Passcode: req.Passcode, WaitingRoomEnabled: req.WaitingRoomEnabled, MaxParticipants: req.MaxParticipants,
		}, clientIP, reqID)
	} else {
		createdRoom, err = h.service.CreateRoomWithPasscode(r.Context(), user, req.MaxParticipants, req.WaitingRoomEnabled, req.Passcode, clientIP, reqID)
	}
	if err != nil {
		if !sendScheduleError(w, r, err) {
			model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create room")
		}
		return
	}

	inviteURL := fmt.Sprintf("%s/room/%s", h.publicAppOrigin, createdRoom.PublicCode)

	model.SendJSON(w, http.StatusCreated, map[string]any{
		"room":      toRoomDTO(createdRoom),
		"inviteUrl": inviteURL,
	})
}

// verifiedGuestIdentity returns the identity proven by the caller's signed guest token.
// A bare identity in a body or query string proves nothing and is never used.
func verifiedGuestIdentity(r *http.Request, normCode string) string {
	token := strings.TrimSpace(r.Header.Get("X-Guest-Token"))
	if token == "" {
		if c, err := r.Cookie("tc_guest_" + normCode); err == nil {
			token = strings.TrimSpace(c.Value)
		}
	}
	if token == "" {
		return ""
	}
	identity, err := VerifyGuestToken(normCode, token)
	if err != nil {
		return ""
	}
	return identity
}

// callerIdentity resolves the caller from their session or signed guest token only, and
// records a guest on the returned request so database access runs in that guest's context.
func callerIdentity(r *http.Request, normCode string) (string, *http.Request) {
	if user, ok := middleware.UserFromContext(r.Context()); ok && user != nil {
		return "user:" + user.ID, r
	}
	identity := verifiedGuestIdentity(r, normCode)
	if identity == "" {
		return "", r
	}
	return identity, r.WithContext(database.WithGuestIdentity(r.Context(), identity))
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
		if errors.Is(err, ErrRoomCancelled) {
			model.SendJSONError(w, r, http.StatusGone, "ROOM_CANCELLED", "This meeting was cancelled.")
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

	// A guest keeps an identity only by proving it; any identity in the body is ignored.
	var guestIdentity string
	if user == nil {
		guestIdentity = verifiedGuestIdentity(r, NormalizeCode(code))
	}

	// Passcodes are short, so guessing is limited more tightly than joining.
	if h.limiter != nil && req.Passcode != "" {
		rateKey := fmt.Sprintf("room_passcode:%s:%s", clientIP, NormalizeCode(code))
		allowed, err := h.limiter.Allow(r.Context(), rateKey, 10, 10*time.Minute)
		if err != nil || !allowed {
			w.Header().Set("Retry-After", "600")
			model.SendJSONError(w, r, http.StatusTooManyRequests, "TOO_MANY_REQUESTS", "Too many passcode attempts. Please retry later.")
			return
		}
	}

	result, err := h.service.JoinRoomWithPasscode(r.Context(), code, user, guestIdentity, req.DisplayName, req.Passcode, clientIP, reqID)
	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorizedRoomAction):
			model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You are not permitted to join this meeting.")
		case errors.Is(err, ErrMeetingNotStarted):
			model.SendJSONError(w, r, http.StatusConflict, "MEETING_NOT_STARTED", "This meeting has not started yet.")
		case errors.Is(err, ErrRoomCancelled):
			model.SendJSONError(w, r, http.StatusGone, "ROOM_CANCELLED", "This meeting was cancelled.")
		case errors.Is(err, ErrPasscodeRequired):
			model.SendJSONError(w, r, http.StatusForbidden, "PASSCODE_REQUIRED", "This meeting requires a passcode.")
		case errors.Is(err, ErrInvalidPasscode):
			model.SendJSONError(w, r, http.StatusForbidden, "INVALID_PASSCODE", "The passcode is incorrect.")
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
	clientIP := extractIP(r)
	reqID := getRequestID(r)

	// The departing identity comes from the caller's credentials; the body cannot name someone else.
	identity, r := callerIdentity(r, NormalizeCode(code))
	ClearGuestCookie(w, code, h.isProduction())
	if identity != "" {
		_ = h.service.LeaveRoom(r.Context(), code, identity, clientIP, reqID)
	}

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
	identity, r := callerIdentity(r, NormalizeCode(code))
	if identity == "" {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Valid participant identity required.")
		return
	}
	participants, err := h.service.ListParticipantsFor(r.Context(), code, identity)
	if err != nil {
		if errors.Is(err, ErrUnauthorizedRoomAction) {
			model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You are not a participant in this meeting.")
			return
		}
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
		} else {
			model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Participant identity required for media token.")
			return
		}
	}

	ctx := r.Context()
	if user == nil {
		ctx = database.WithGuestIdentity(ctx, guestIdentity)
	}
	token, err := h.service.GenerateToken(ctx, code, user, guestIdentity, req.GuestDisplayName, clientIP, reqID)
	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorizedRoomAction):
			model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You are not permitted to join this meeting.")
		case errors.Is(err, ErrMeetingNotStarted):
			model.SendJSONError(w, r, http.StatusConflict, "MEETING_NOT_STARTED", "This meeting has not started yet.")
		case errors.Is(err, ErrRoomCancelled):
			model.SendJSONError(w, r, http.StatusGone, "ROOM_CANCELLED", "This meeting was cancelled.")
		case errors.Is(err, ErrPasscodeRequired):
			model.SendJSONError(w, r, http.StatusForbidden, "PASSCODE_REQUIRED", "This meeting requires a passcode.")
		case errors.Is(err, ErrInvalidPasscode):
			model.SendJSONError(w, r, http.StatusForbidden, "INVALID_PASSCODE", "The passcode is incorrect.")
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

	// Empty for a first-time guest, who then receives a new identity and its token.
	identity, _ := callerIdentity(r, NormalizeCode(code))

	req, err := h.service.RequestAdmission(r.Context(), code, identity, payload.DisplayName, clientIP, reqID)
	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorizedRoomAction):
			model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You are not permitted to join this meeting.")
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
	identity, _ := callerIdentity(r, NormalizeCode(code))
	if identity == "" {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Valid participant identity required.")
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

// PromoteSpeaker handles POST /api/v1/rooms/{code}/participants/{identity}/promote-speaker
func (h *Handlers) PromoteSpeaker(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	targetIdentity := chi.URLParam(r, "identity")
	user, ok := middleware.UserFromContext(r.Context())
	if !ok || user == nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}

	clientIP := extractIP(r)
	reqID := getRequestID(r)

	if err := h.service.PromoteSpeaker(r.Context(), code, user, targetIdentity, clientIP, reqID); err != nil {
		switch {
		case errors.Is(err, ErrUnauthorizedRoomAction):
			model.SendJSONError(w, r, http.StatusForbidden, "UNAUTHORIZED", "Only the host can promote participants to speaker")
		case errors.Is(err, ErrParticipantNotFoundInRoom):
			model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "Participant not found in active room")
		case errors.Is(err, ErrDatabaseRollbackFailed):
			model.SendJSONError(w, r, http.StatusBadGateway, "SFU_DESYNC_ERROR", "Critical media state divergence detected")
		case errors.Is(err, ErrSFUSyncFailed):
			model.SendJSONError(w, r, http.StatusBadGateway, "SFU_SYNC_FAILED", "Failed to synchronize permissions with media server")
		default:
			model.SendJSONError(w, r, http.StatusBadRequest, "PROMOTION_FAILED", err.Error())
		}
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"promoted": true,
		"role":     livekit.RoleSpeaker,
	})
}

// DemoteSpeaker handles POST /api/v1/rooms/{code}/participants/{identity}/demote-speaker
func (h *Handlers) DemoteSpeaker(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	targetIdentity := chi.URLParam(r, "identity")
	user, ok := middleware.UserFromContext(r.Context())
	if !ok || user == nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}

	clientIP := extractIP(r)
	reqID := getRequestID(r)

	if err := h.service.DemoteSpeaker(r.Context(), code, user, targetIdentity, clientIP, reqID); err != nil {
		switch {
		case errors.Is(err, ErrUnauthorizedRoomAction):
			model.SendJSONError(w, r, http.StatusForbidden, "UNAUTHORIZED", "Only the host can demote speakers")
		case errors.Is(err, ErrParticipantNotFoundInRoom):
			model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "Participant not found in active room")
		case errors.Is(err, ErrDatabaseRollbackFailed):
			model.SendJSONError(w, r, http.StatusBadGateway, "SFU_DESYNC_ERROR", "Critical media state divergence detected")
		case errors.Is(err, ErrSFUSyncFailed):
			model.SendJSONError(w, r, http.StatusBadGateway, "SFU_SYNC_FAILED", "Failed to synchronize permissions with media server")
		default:
			model.SendJSONError(w, r, http.StatusBadRequest, "DEMOTION_FAILED", err.Error())
		}
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{
		"demoted": true,
		"role":    livekit.RoleParticipant,
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
