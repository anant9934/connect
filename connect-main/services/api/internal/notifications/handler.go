// Package notifications serves a person's own in-app notifications. The worker creates them.
package notifications

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/model"
)

const (
	defaultPageSize = 30
	maxPageSize     = 100
)

// Handler serves the notification routes. Row level security limits every query to the caller.
type Handler struct {
	pool *pgxpool.Pool
}

// NewHandler constructs the handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

// RegisterRoutes mounts the routes. The caller applies session authentication and CSRF.
func (h *Handler) RegisterRoutes(r chi.Router) {
	r.Get("/notifications", h.list)
	r.Post("/notifications/read-all", h.readAll)
	r.Post("/notifications/{id}/read", h.read)
}

func (h *Handler) inSession(r *http.Request, fn func(pgx.Tx) error) error {
	return database.WithAuthContext(r.Context(), h.pool, database.SessionTokenHash(r.Context()), nil, func(tx pgx.Tx, _ *database.AuthContext) error {
		return fn(tx)
	})
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	limit, before := defaultPageSize, int64(0)
	if value := r.URL.Query().Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed <= 0 {
			model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_PAGINATION", "limit must be a positive number.")
			return
		}
		limit = min(parsed, maxPageSize)
	}
	if value := r.URL.Query().Get("before"); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil || parsed <= 0 {
			model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_PAGINATION", "before must be a positive number.")
			return
		}
		before = parsed
	}
	unreadOnly := r.URL.Query().Get("unread") == "true"
	var raw []byte
	var unread int
	err := h.inSession(r, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(), `SELECT count(*) FROM notifications WHERE read_at IS NULL`).Scan(&unread); err != nil {
			return err
		}
		return tx.QueryRow(r.Context(), `
			SELECT COALESCE(json_agg(t), '[]'::json) FROM (
				SELECT id, seq, kind, title, body, link, created_at AS "createdAt", read_at AS "readAt"
				FROM notifications
				WHERE ($1::bigint = 0 OR seq < $1) AND (NOT $2 OR read_at IS NULL)
				ORDER BY seq DESC LIMIT $3
			) t
		`, before, unreadOnly, limit).Scan(&raw)
	})
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load notifications.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"notifications": json.RawMessage(raw), "unread": unread})
}

func (h *Handler) read(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := uuid.Parse(id); err != nil {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "This was not found.")
		return
	}
	var affected int64
	err := h.inSession(r, func(tx pgx.Tx) error {
		// Another person's notification is invisible here, so it reads as not found.
		var exists bool
		if err := tx.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM notifications WHERE id = $1)`, id).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return nil
		}
		affected = 1
		_, err := tx.Exec(r.Context(), `UPDATE notifications SET read_at = COALESCE(read_at, clock_timestamp()) WHERE id = $1`, id)
		return err
	})
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not update this notification.")
		return
	}
	if affected == 0 {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "This was not found.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) readAll(w http.ResponseWriter, r *http.Request) {
	err := h.inSession(r, func(tx pgx.Tx) error {
		_, err := tx.Exec(r.Context(), `UPDATE notifications SET read_at = clock_timestamp() WHERE read_at IS NULL`)
		return err
	})
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not update notifications.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"success": true})
}
