package meetings

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/model"
)

// SavedDeck is a deck saved from the live canvas.
type SavedDeck struct {
	ID         string          `json:"id"`
	Title      string          `json:"title"`
	SlideCount int             `json:"slideCount"`
	CreatedAt  time.Time       `json:"createdAt"`
	Content    json.RawMessage `json:"content,omitempty"`
}

// listDecks handles GET /meetings/{id}/decks. Row level security limits it to the meeting's members.
func (h *Handler) listDecks(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := uuid.Parse(id); err != nil {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "This meeting is unavailable.")
		return
	}
	decks := []SavedDeck{}
	err := database.WithAuthContext(r.Context(), h.pool, database.SessionTokenHash(r.Context()), nil, func(tx pgx.Tx, _ *database.AuthContext) error {
		rows, err := tx.Query(r.Context(), `
			SELECT id::text, title, slide_count, created_at FROM room_saved_decks
			WHERE room_id = $1 ORDER BY created_at DESC LIMIT 50`, id)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var d SavedDeck
			if err := rows.Scan(&d.ID, &d.Title, &d.SlideCount, &d.CreatedAt); err != nil {
				return err
			}
			decks = append(decks, d)
		}
		return rows.Err()
	})
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load the saved decks.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"decks": decks})
}

// getDeck handles GET /meetings/{id}/decks/{deck}.
func (h *Handler) getDeck(w http.ResponseWriter, r *http.Request) {
	id, deckID := chi.URLParam(r, "id"), chi.URLParam(r, "deck")
	if _, err := uuid.Parse(id); err != nil {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "This deck is unavailable.")
		return
	}
	if _, err := uuid.Parse(deckID); err != nil {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "This deck is unavailable.")
		return
	}
	var d SavedDeck
	var content []byte
	err := database.WithAuthContext(r.Context(), h.pool, database.SessionTokenHash(r.Context()), nil, func(tx pgx.Tx, _ *database.AuthContext) error {
		return tx.QueryRow(r.Context(), `
			SELECT id::text, title, slide_count, created_at, content FROM room_saved_decks
			WHERE id = $1 AND room_id = $2`, deckID, id).Scan(&d.ID, &d.Title, &d.SlideCount, &d.CreatedAt, &content)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "This deck is unavailable.")
		return
	}
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load the deck.")
		return
	}
	d.Content = content
	model.SendJSON(w, http.StatusOK, map[string]any{"deck": d})
}
