package notes

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/tathastu/connect/services/api/internal/middleware"
	"github.com/tathastu/connect/services/api/internal/model"
	"github.com/tathastu/connect/services/api/internal/room"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) RegisterRoutes(r chi.Router) {
	r.Get("/api/v1/rooms/{code}/notes", h.GetNotes)
	r.Put("/api/v1/rooms/{code}/notes", h.UpdateNotes)
}

// GetNotes handles GET /api/v1/rooms/{code}/notes
func (h *Handler) GetNotes(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	identity, err := extractCallerIdentity(r, code)
	if err != nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Valid participant identity required to view notes.")
		return
	}

	note, err := h.service.GetNote(r.Context(), code, identity)
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You are not authorized to view notes in this meeting.")
			return
		}
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve notes.")
		return
	}

	model.SendJSON(w, http.StatusOK, NoteResponse{Note: note})
}

// UpdateNotes handles PUT /api/v1/rooms/{code}/notes
func (h *Handler) UpdateNotes(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	identity, err := extractCallerIdentity(r, code)
	if err != nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Valid participant identity required to edit notes.")
		return
	}

	var req UpdateNoteRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_PAYLOAD", "Invalid request body.")
		return
	}

	note, err := h.service.UpdateNote(r.Context(), code, identity, req.Title, req.Content, req.ExpectedRevision)
	if err != nil {
		switch {
		case errors.Is(err, ErrRevisionConflict):
			model.SendJSONError(w, r, http.StatusConflict, "REVISION_CONFLICT", "Someone else updated these notes. Please merge changes and try again.")
		case errors.Is(err, ErrContentTooLarge):
			model.SendJSONError(w, r, http.StatusBadRequest, "PAYLOAD_TOO_LARGE", "Note content exceeds maximum permitted size (50 KB).")
		case errors.Is(err, ErrInvalidTitle):
			model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_TITLE", "Note title exceeds maximum permitted length.")
		case errors.Is(err, ErrUnauthorized):
			model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You are not authorized to edit notes in this meeting.")
		default:
			model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to save notes.")
		}
		return
	}

	model.SendJSON(w, http.StatusOK, NoteResponse{Note: note})
}

func extractCallerIdentity(r *http.Request, roomCode string) (string, error) {
	user, ok := middleware.UserFromContext(r.Context())
	if ok && user != nil {
		claimedHeader := strings.TrimSpace(r.Header.Get("X-Participant-Identity"))
		if claimedHeader != "" && claimedHeader != "user:"+user.ID {
			return "", ErrUnauthorized
		}
		return "user:" + user.ID, nil
	}

	// Unauthenticated callers MUST provide verified, room-scoped guest credentials
	normCode := room.NormalizeCode(roomCode)
	guestToken := strings.TrimSpace(r.Header.Get("X-Guest-Token"))
	if guestToken == "" {
		if c, err := r.Cookie("tc_guest_" + normCode); err == nil && c.Value != "" {
			guestToken = strings.TrimSpace(c.Value)
		}
	}
	if guestToken == "" {
		guestToken = strings.TrimSpace(r.URL.Query().Get("guest_token"))
	}
	if guestToken == "" {
		guestToken = strings.TrimSpace(r.URL.Query().Get("guestToken"))
	}
	if guestToken == "" {
		claimedHdr := strings.TrimSpace(r.Header.Get("X-Participant-Identity"))
		if strings.HasPrefix(claimedHdr, "gst.") {
			guestToken = claimedHdr
		}
	}

	if guestToken == "" {
		return "", ErrUnauthorized
	}

	verifiedIdentity, err := room.VerifyGuestToken(normCode, guestToken)
	if err != nil {
		return "", ErrUnauthorized
	}

	claimedIdentity := strings.TrimSpace(r.Header.Get("X-Participant-Identity"))
	if claimedIdentity == "" {
		claimedIdentity = strings.TrimSpace(r.URL.Query().Get("identity"))
	}
	if claimedIdentity != "" && claimedIdentity != verifiedIdentity && !strings.HasPrefix(claimedIdentity, "gst.") {
		return "", ErrUnauthorized
	}

	return verifiedIdentity, nil
}
