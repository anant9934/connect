package files

import (
	"errors"
	"fmt"
	"io"
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
	r.Post("/api/v1/rooms/{code}/files/upload", h.UploadFile)
	r.Get("/api/v1/rooms/{code}/files", h.ListFiles)
	r.Get("/api/v1/rooms/{code}/files/{id}/download", h.DownloadFile)
	r.Delete("/api/v1/rooms/{code}/files/{id}", h.DeleteFile)
}

// UploadFile handles POST /api/v1/rooms/{code}/files/upload
func (h *Handler) UploadFile(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	identity, err := extractCallerIdentity(r, code)
	if err != nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Valid participant identity required to upload files.")
		return
	}

	// Limit request body to prevent unbounded memory consumption
	r.Body = http.MaxBytesReader(w, r.Body, MaxFileSizeBytes+1024*1024)

	// #nosec G120 - body stream bounded by http.MaxBytesReader and memory bounded to 10MB
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_UPLOAD", "Upload exceeds maximum allowed size (25 MB) or malformed multipart data.")
		return
	}
	defer r.MultipartForm.RemoveAll() // Clean temporary disk buffers

	file, header, err := r.FormFile("file")
	if err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "FILE_REQUIRED", "No file found under 'file' form field.")
		return
	}
	defer file.Close()

	if header.Size > MaxFileSizeBytes {
		model.SendJSONError(w, r, http.StatusBadRequest, "FILE_TOO_LARGE", "File size exceeds 25 MB limit.")
		return
	}

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "READ_ERROR", "Failed to read uploaded file.")
		return
	}

	uploadedFile, err := h.service.UploadFile(r.Context(), code, identity, header.Filename, fileBytes)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidFileType):
			model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_FILE_TYPE", "File type not supported or content signature mismatch. Allowed: PDF, PPTX, PNG, JPEG, WebP, TXT.")
		case errors.Is(err, ErrFileTooLarge):
			model.SendJSONError(w, r, http.StatusBadRequest, "FILE_TOO_LARGE", "File exceeds 25 MB limit.")
		case errors.Is(err, ErrInvalidFilename):
			model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_FILENAME", "Invalid or unsafe filename.")
		case errors.Is(err, ErrFileRejected):
			model.SendJSONError(w, r, http.StatusUnprocessableEntity, "FILE_REJECTED", "File was rejected during security inspection.")
		case errors.Is(err, ErrRoomCapacityExceeded):
			model.SendJSONError(w, r, http.StatusConflict, "ROOM_FULL", "Meeting file limit reached (100 files max).")
		case errors.Is(err, ErrUnauthorized):
			model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You are not authorized to upload files in this meeting.")
		default:
			model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to process file.")
		}
		return
	}

	model.SendJSON(w, http.StatusCreated, FileUploadResponse{File: uploadedFile})
}

// ListFiles handles GET /api/v1/rooms/{code}/files
func (h *Handler) ListFiles(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	identity, err := extractCallerIdentity(r, code)
	if err != nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Valid participant identity required to view files.")
		return
	}

	fileList, err := h.service.ListFiles(r.Context(), code, identity)
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You are not authorized to view files in this meeting.")
			return
		}
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve meeting files.")
		return
	}

	if fileList == nil {
		fileList = []*MeetingFile{}
	}

	model.SendJSON(w, http.StatusOK, FileListResponse{Files: fileList})
}

// DownloadFile handles GET /api/v1/rooms/{code}/files/{id}/download
func (h *Handler) DownloadFile(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	fileID := chi.URLParam(r, "id")
	identity, err := extractCallerIdentity(r, code)
	if err != nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Valid participant identity required to download files.")
		return
	}

	file, data, err := h.service.DownloadFile(r.Context(), code, fileID, identity)
	if err != nil {
		switch {
		case errors.Is(err, ErrFileNotFound):
			model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "File not found.")
		case errors.Is(err, ErrFileQuarantined):
			model.SendJSONError(w, r, http.StatusLocked, "FILE_QUARANTINED", "File is in quarantine undergoing verification.")
		case errors.Is(err, ErrFileRejected):
			model.SendJSONError(w, r, http.StatusForbidden, "FILE_REJECTED", "File was rejected during security inspection.")
		case errors.Is(err, ErrUnauthorized):
			model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You are not authorized to download this file.")
		default:
			model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to download file.")
		}
		return
	}

	// Security response headers for file download
	w.Header().Set("Content-Type", file.MimeType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", file.SanitizedFilename))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-cache, no-store, must-revalidate")
	w.WriteHeader(http.StatusOK)
	// nosemgrep: go.lang.security.audit.xss.no-direct-write-to-responsewriter.no-direct-write-to-responsewriter
	_, _ = w.Write(data)
}

// DeleteFile handles DELETE /api/v1/rooms/{code}/files/{id}
func (h *Handler) DeleteFile(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	fileID := chi.URLParam(r, "id")
	identity, err := extractCallerIdentity(r, code)
	if err != nil {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Valid participant identity required to delete files.")
		return
	}

	if err := h.service.DeleteFile(r.Context(), code, fileID, identity); err != nil {
		switch {
		case errors.Is(err, ErrFileNotFound):
			model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "File not found.")
		case errors.Is(err, ErrUnauthorized):
			model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You are not authorized to delete this file.")
		default:
			model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to delete file.")
		}
		return
	}

	model.SendJSON(w, http.StatusOK, map[string]any{"success": true})
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
		guestToken = strings.TrimSpace(r.URL.Query().Get("token"))
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
