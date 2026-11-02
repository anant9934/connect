package interaction

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/model"
	"github.com/tathastu/connect/services/api/internal/room"
)

const (
	maxBreakouts        = 20
	maxBreakoutNameRune = 60
)

func sendBreakoutError(w http.ResponseWriter, r *http.Request, err error, failure string) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "CN409" {
		model.SendJSONError(w, r, http.StatusConflict, "ALREADY_OPEN", pgErr.Message)
		return
	}
	sendBoardError(w, r, err, failure)
}

// GetBreakouts handles GET /rooms/{code}/breakouts.
func (h *Handler) GetBreakouts(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var raw []byte
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		return tx.QueryRow(c.r.Context(), `SELECT connect_auth.breakout_state($1::UUID)`, c.roomID).Scan(&raw)
	})
	if err != nil {
		sendBreakoutError(w, c.r, err, "Could not load breakout rooms.")
		return
	}
	model.SendJSON(w, http.StatusOK, json.RawMessage(raw))
}

// OpenBreakouts handles POST /rooms/{code}/breakouts.
func (h *Handler) OpenBreakouts(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var req struct {
		Names []string `json:"names"`
	}
	decoder := json.NewDecoder(c.r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil || len(req.Names) < 1 || len(req.Names) > maxBreakouts {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_BREAKOUTS", "Choose 1 to 20 breakout rooms.")
		return
	}
	seen := map[string]bool{}
	codes := make([]string, len(req.Names))
	for i, name := range req.Names {
		name = strings.TrimSpace(name)
		if name == "" || utf8.RuneCountInString(name) > maxBreakoutNameRune || seen[strings.ToLower(name)] {
			model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_BREAKOUTS", "Each breakout room needs its own name of up to 60 characters.")
			return
		}
		seen[strings.ToLower(name)] = true
		req.Names[i] = name
		code, err := room.GeneratePublicCode()
		if err != nil {
			model.SendJSONError(w, c.r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not open breakout rooms.")
			return
		}
		codes[i] = room.NormalizeCode(code)
	}
	if !h.allow(w, c, "breakout", 30, time.Minute) {
		return
	}
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		_, err := tx.Exec(c.r.Context(), `SELECT connect_auth.breakout_open($1::UUID, $2::text[], $3::text[])`, c.roomID, req.Names, codes)
		return err
	})
	if err != nil {
		sendBreakoutError(w, c.r, err, "Could not open breakout rooms.")
		return
	}
	model.SendJSON(w, http.StatusCreated, map[string]any{"success": true})
}

// AssignBreakout handles POST /rooms/{code}/breakouts/assign. A null room returns the person to the main meeting.
func (h *Handler) AssignBreakout(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var req struct {
		Identity string  `json:"identity"`
		RoomID   *string `json:"roomId"`
	}
	decoder := json.NewDecoder(c.r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil || req.Identity == "" || len(req.Identity) > 128 || (req.RoomID != nil && !uuidPattern.MatchString(*req.RoomID)) {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Invalid request body.")
		return
	}
	if !h.allow(w, c, "breakout-assign", 300, time.Minute) {
		return
	}
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		_, err := tx.Exec(c.r.Context(), `SELECT connect_auth.breakout_assign($1::UUID, $2, $3::UUID)`, c.roomID, req.Identity, req.RoomID)
		return err
	})
	if err != nil {
		sendBreakoutError(w, c.r, err, "Could not assign this person.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"success": true})
}

// CloseBreakouts handles POST /rooms/{code}/breakouts/close. Everyone returns to the main meeting.
func (h *Handler) CloseBreakouts(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	if !h.allow(w, c, "breakout", 30, time.Minute) {
		return
	}
	var codes []string
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		rows, err := tx.Query(c.r.Context(), `SELECT public_code FROM connect_auth.breakout_close($1::UUID)`, c.roomID)
		if err != nil {
			return err
		}
		codes, err = pgx.CollectRows(rows, pgx.RowTo[string])
		return err
	})
	if err != nil {
		sendBreakoutError(w, c.r, err, "Could not close breakout rooms.")
		return
	}
	h.rooms.TerminateLiveRooms(c.r.Context(), codes)
	model.SendJSON(w, http.StatusOK, map[string]any{"closed": len(codes)})
}
