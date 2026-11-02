// Package avatars stores profile pictures. An upload is decoded and re-encoded, so what is served
// is always a plain JPEG of known size, with no metadata and nothing an attacker chose to embed.
package avatars

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png" // Registers PNG for image.Decode.
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/files"
	"github.com/tathastu/connect/services/api/internal/middleware"
	"github.com/tathastu/connect/services/api/internal/model"
)

const (
	// MaxUploadBytes is below the request limit, leaving room for the multipart wrapper.
	MaxUploadBytes  = 900 * 1024
	maxSourcePixels = 25_000_000
	avatarSize      = 256
	jpegQuality     = 85
	avatarIDPrefix  = "upload:"
)

// ErrInvalidImage reports an upload that is not a usable PNG or JPEG.
var ErrInvalidImage = errors.New("invalid image")

// Handler serves avatar upload, removal and download.
type Handler struct {
	authService *auth.Service
	storage     files.StorageProvider
}

// NewHandler constructs the handler.
func NewHandler(authService *auth.Service, storage files.StorageProvider) *Handler {
	return &Handler{authService: authService, storage: storage}
}

// Normalize checks the dimensions before decoding, so a small file cannot expand into a huge
// bitmap, then center-crops to a square and scales to the avatar size.
func Normalize(data []byte) ([]byte, error) {
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg") {
		return nil, ErrInvalidImage
	}
	if config.Width < 1 || config.Height < 1 || config.Width*config.Height > maxSourcePixels {
		return nil, ErrInvalidImage
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, ErrInvalidImage
	}
	bounds := source.Bounds()
	side := min(bounds.Dx(), bounds.Dy())
	left, top := bounds.Min.X+(bounds.Dx()-side)/2, bounds.Min.Y+(bounds.Dy()-side)/2
	scaled := image.NewRGBA(image.Rect(0, 0, avatarSize, avatarSize))
	for y := 0; y < avatarSize; y++ {
		for x := 0; x < avatarSize; x++ {
			r, g, b, a := source.At(left+x*side/avatarSize, top+y*side/avatarSize).RGBA()
			// JPEG has no transparency, so transparent areas become white.
			blend := func(v uint32) uint8 { return uint8((v + 0xffff - a) >> 8) }
			scaled.SetRGBA(x, y, color.RGBA{R: blend(r), G: blend(g), B: blend(b), A: 0xff})
		}
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, scaled, &jpeg.Options{Quality: jpegQuality}); err != nil {
		return nil, fmt.Errorf("failed to encode avatar: %w", err)
	}
	return out.Bytes(), nil
}

func storageKey(userID, avatarID string) string {
	return "avatars/" + userID + "/" + strings.TrimPrefix(avatarID, avatarIDPrefix) + ".jpg"
}

func (h *Handler) deleteStored(ctx context.Context, userID, avatarID string) {
	if strings.HasPrefix(avatarID, avatarIDPrefix) {
		// A leftover object is unreachable, because nothing links to it any more.
		_ = h.storage.Delete(ctx, storageKey(userID, avatarID))
	}
}

// Upload handles POST /users/me/avatar. The new picture is stored first, so a failure keeps the old one.
func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}
	file, _, err := r.FormFile("avatar")
	if err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_AVATAR", "Choose a PNG or JPEG image under 900 KB.")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, MaxUploadBytes+1))
	if err != nil || len(data) > MaxUploadBytes {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_AVATAR", "Choose a PNG or JPEG image under 900 KB.")
		return
	}
	normalized, err := Normalize(data)
	if err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_AVATAR", "Choose a PNG or JPEG image under 900 KB.")
		return
	}
	profile, err := h.authService.GetProfile(r.Context(), user.ID)
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not save your picture.")
		return
	}
	avatarID := avatarIDPrefix + uuid.NewString()
	if err := h.storage.Store(r.Context(), storageKey(user.ID, avatarID), normalized); err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not save your picture.")
		return
	}
	url := "/api/v1/users/" + user.ID + "/avatar?v=" + strings.TrimPrefix(avatarID, avatarIDPrefix)
	updated, err := h.authService.UpdateProfile(r.Context(), user.ID, profile.DisplayName, avatarID, url)
	if err != nil {
		h.deleteStored(r.Context(), user.ID, avatarID)
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not save your picture.")
		return
	}
	h.deleteStored(r.Context(), user.ID, profile.AvatarID)
	model.SendJSON(w, http.StatusOK, map[string]any{"profile": updated})
}

// Remove handles DELETE /users/me/avatar.
func (h *Handler) Remove(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
		return
	}
	profile, err := h.authService.GetProfile(r.Context(), user.ID)
	if err == nil {
		var updated *auth.UserDTO
		if updated, err = h.authService.UpdateProfile(r.Context(), user.ID, profile.DisplayName, "", ""); err == nil {
			h.deleteStored(r.Context(), user.ID, profile.AvatarID)
			model.SendJSON(w, http.StatusOK, map[string]any{"profile": updated})
			return
		}
	}
	model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not remove your picture.")
}

// Serve handles GET /users/{id}/avatar for signed-in callers. Any account can see a picture,
// as anyone sharing a meeting could, and an id has to be known to ask for one.
func (h *Handler) Serve(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := uuid.Parse(id); err != nil {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "No picture here.")
		return
	}
	profile, err := h.authService.GetProfile(r.Context(), id)
	if err != nil || !strings.HasPrefix(profile.AvatarID, avatarIDPrefix) {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "No picture here.")
		return
	}
	data, err := h.storage.Get(r.Context(), storageKey(id, profile.AvatarID))
	if err != nil {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "No picture here.")
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	// Pages on the same site show this image, and the API default would make browsers refuse it.
	w.Header().Set("Cross-Origin-Resource-Policy", "same-site")
	_, _ = w.Write(data)
}
