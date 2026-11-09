package interaction

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/model"
)

const (
	maxStrokePoints = 2000
	maxBoardStrokes = 5000
)

var (
	boardPattern = regexp.MustCompile(`^(whiteboard|slide:[0-9a-f-]{36}:[0-9]{1,4})$`)
	colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	uuidPattern  = regexp.MustCompile(`^[0-9a-fA-F-]{36}$`)
)

// ClassroomState is the shared whiteboard and presentation state of a room.
type ClassroomState struct {
	StudentsCanDraw bool    `json:"studentsCanDraw"`
	CanDraw         bool    `json:"canDraw"`
	CanManage       bool    `json:"canManage"`
	FileID          *string `json:"fileId"`
	FileName        *string `json:"fileName"`
	FileType        *string `json:"fileType"`
	Page            int     `json:"page"`
	Pages           int     `json:"pages"`
	Presenter       *string `json:"presenter"`
	Version         int64   `json:"version"`
}

// Stroke is one drawn line.
type Stroke struct {
	ID             string          `json:"id"`
	Seq            int64           `json:"seq"`
	AuthorIdentity string          `json:"authorIdentity"`
	Tool           string          `json:"tool"`
	Color          string          `json:"color"`
	Width          int             `json:"width"`
	Points         json.RawMessage `json:"points"`
	Body           *string         `json:"body,omitempty"`
}

// boardTools maps each tool to how many points it stores: 0 means any number (free drawing).
var boardTools = map[string]int{"pen": 0, "highlighter": 0, "rect": 2, "circle": 2, "arrow": 2, "text": 1, "note": 1, "math": 1}

const maxBoardBody = 500

// validBody allows printable text and line breaks, 1 to maxBoardBody characters.
func validBody(body string) bool {
	if strings.TrimSpace(body) == "" || utf8.RuneCountInString(body) > maxBoardBody || !utf8.ValidString(body) {
		return false
	}
	for _, r := range body {
		if r < 0x20 && r != '\n' {
			return false
		}
	}
	return true
}

func sendBoardError(w http.ResponseWriter, r *http.Request, err error, failure string) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "CN404":
			model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", pgErr.Message)
			return
		case "CN422":
			model.SendJSONError(w, r, http.StatusUnprocessableEntity, "INVALID_PRESENTATION", pgErr.Message)
			return
		}
	}
	sendDBError(w, r, err, failure)
}

// GetClassroom handles GET /rooms/{code}/classroom.
func (h *Handler) GetClassroom(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var state ClassroomState
	state.Page = 1
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		ctx := c.r.Context()
		err := tx.QueryRow(ctx, `
			SELECT s.students_can_draw, s.presentation_file_id::text, f.original_filename, f.content_type,
			       s.presentation_page, s.presentation_pages, s.presenter_identity, s.version
			FROM room_classroom_state s
			LEFT JOIN meeting_files f ON f.id = s.presentation_file_id
			WHERE s.room_id = $1
		`, c.roomID).Scan(&state.StudentsCanDraw, &state.FileID, &state.FileName, &state.FileType, &state.Page, &state.Pages, &state.Presenter, &state.Version)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		return tx.QueryRow(ctx, `SELECT connect_auth.can_draw($1::UUID), connect_auth.can_announce($1::UUID)`, c.roomID).Scan(&state.CanDraw, &state.CanManage)
	})
	if err != nil {
		sendBoardError(w, c.r, err, "Could not load the classroom.")
		return
	}
	model.SendJSON(w, http.StatusOK, state)
}

// UpdateClassroom handles PATCH /rooms/{code}/classroom. The database checks the caller may do it.
func (h *Handler) UpdateClassroom(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var req struct {
		StudentsCanDraw *bool   `json:"studentsCanDraw"`
		FileID          *string `json:"fileId"`
		Pages           *int    `json:"pages"`
		Page            *int    `json:"page"`
		Stop            bool    `json:"stop"`
	}
	decoder := json.NewDecoder(c.r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil || (req.FileID != nil && !uuidPattern.MatchString(*req.FileID)) {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Invalid request body.")
		return
	}
	if !h.allow(w, c, "classroom", 120, time.Minute) {
		return
	}
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		_, err := tx.Exec(c.r.Context(), `SELECT connect_auth.classroom_update($1::UUID, $2, $3::UUID, $4, $5, $6)`,
			c.roomID, req.StudentsCanDraw, req.FileID, req.Pages, req.Page, req.Stop)
		return err
	})
	if err != nil {
		sendBoardError(w, c.r, err, "Could not update the classroom.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"success": true})
}

// ListStrokes handles GET /rooms/{code}/board?board=&afterSeq=.
func (h *Handler) ListStrokes(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	query := c.r.URL.Query()
	board := query.Get("board")
	after, valid := parseInt64(query.Get("afterSeq"))
	if !boardPattern.MatchString(board) || !valid {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_BOARD", "A valid board is required.")
		return
	}
	strokes := []Stroke{}
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		rows, err := tx.Query(c.r.Context(), `
			SELECT id::text, seq, author_identity, tool, color, width, points, body
			FROM board_strokes
			WHERE room_id = $1 AND board = $2 AND seq > $3 AND deleted_at IS NULL
			ORDER BY seq LIMIT $4
		`, c.roomID, board, after, maxBoardStrokes)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var s Stroke
			var points []byte
			if err := rows.Scan(&s.ID, &s.Seq, &s.AuthorIdentity, &s.Tool, &s.Color, &s.Width, &points, &s.Body); err != nil {
				return err
			}
			s.Points = points
			strokes = append(strokes, s)
		}
		return rows.Err()
	})
	if err != nil {
		sendBoardError(w, c.r, err, "Could not load the board.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"strokes": strokes})
}

// The whiteboard pans and zooms over an area larger than its first view; slide annotations
// stay on their page, the 0-1 square.
const (
	whiteboardMin = -4.0
	whiteboardMax = 5.0
)

// pointBounds returns the coordinate range allowed on a board.
func pointBounds(board string) (float64, float64) {
	if board == "whiteboard" {
		return whiteboardMin, whiteboardMax
	}
	return 0, 1
}

// validPoints requires 1 to maxStrokePoints pairs, each within the 0-1 square.
func validPoints(points [][]float64) bool {
	return validPointsIn(points, 0, 1)
}

// validPointsIn requires 1 to maxStrokePoints pairs, each within [lo, hi].
func validPointsIn(points [][]float64, lo, hi float64) bool {
	if len(points) == 0 || len(points) > maxStrokePoints {
		return false
	}
	for _, p := range points {
		if len(p) != 2 || math.IsNaN(p[0]) || math.IsNaN(p[1]) || p[0] < lo || p[0] > hi || p[1] < lo || p[1] > hi {
			return false
		}
	}
	return true
}

// PostStroke handles POST /rooms/{code}/board/strokes. A retry with the same client id changes nothing.
func (h *Handler) PostStroke(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var req struct {
		ClientStrokeID string      `json:"clientStrokeId"`
		Board          string      `json:"board"`
		Tool           string      `json:"tool"`
		Color          string      `json:"color"`
		Width          int         `json:"width"`
		Points         [][]float64 `json:"points"`
		Body           string      `json:"body"`
	}
	c.r.Body = http.MaxBytesReader(w, c.r.Body, 256<<10)
	decoder := json.NewDecoder(c.r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Invalid request body.")
		return
	}
	if req.Tool == "" {
		req.Tool = "pen"
	}
	pointCount, knownTool := boardTools[req.Tool]
	needsBody := req.Tool == "text" || req.Tool == "note" || req.Tool == "math"
	lo, hi := pointBounds(req.Board)
	if !clientMessageIDPattern.MatchString(req.ClientStrokeID) || !boardPattern.MatchString(req.Board) || !colorPattern.MatchString(req.Color) ||
		!knownTool || req.Width < 1 || req.Width > 40 || !validPointsIn(req.Points, lo, hi) ||
		(pointCount > 0 && len(req.Points) != pointCount) || needsBody != (req.Body != "") || (needsBody && !validBody(req.Body)) {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_STROKE", "This stroke is not valid.")
		return
	}
	if !h.allow(w, c, "stroke", 300, time.Minute) {
		return
	}
	points, err := json.Marshal(req.Points)
	if err != nil {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_STROKE", "This stroke is not valid.")
		return
	}
	var seq int64
	err = database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		ctx := c.r.Context()
		err := tx.QueryRow(ctx, `
			INSERT INTO board_strokes (room_id, board, author_identity, tool, color, width, points, client_stroke_id, body)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, ''))
			ON CONFLICT (room_id, author_identity, client_stroke_id) DO NOTHING
			RETURNING seq
		`, c.roomID, req.Board, c.identity, req.Tool, req.Color, req.Width, points, req.ClientStrokeID, req.Body).Scan(&seq)
		if errors.Is(err, pgx.ErrNoRows) {
			return tx.QueryRow(ctx, `SELECT seq FROM board_strokes WHERE room_id = $1 AND author_identity = $2 AND client_stroke_id = $3`,
				c.roomID, c.identity, req.ClientStrokeID).Scan(&seq)
		}
		return err
	})
	if err != nil {
		sendBoardError(w, c.r, err, "Could not save the stroke.")
		return
	}
	model.SendJSON(w, http.StatusCreated, map[string]any{"seq": seq})
}

// RemoveStrokes handles POST /rooms/{code}/board/remove: undo the caller's last stroke, or clear all.
func (h *Handler) RemoveStrokes(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var req struct {
		Board string `json:"board"`
		All   bool   `json:"all"`
	}
	if err := json.NewDecoder(c.r.Body).Decode(&req); err != nil || !boardPattern.MatchString(req.Board) {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_BOARD", "A valid board is required.")
		return
	}
	if !h.allow(w, c, "board-remove", 60, time.Minute) {
		return
	}
	var removed int
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		return tx.QueryRow(c.r.Context(), `SELECT connect_auth.board_remove($1::UUID, $2, $3)`, c.roomID, req.Board, req.All).Scan(&removed)
	})
	if err != nil {
		sendBoardError(w, c.r, err, "Could not change the board.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"removed": removed})
}

// MoveStroke handles POST /rooms/{code}/board/move: drag a note or text box to a new place.
func (h *Handler) MoveStroke(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var req struct {
		ID     string      `json:"id"`
		Points [][]float64 `json:"points"`
	}
	decoder := json.NewDecoder(c.r.Body)
	decoder.DisallowUnknownFields()
	// The database knows the item's board; the widest (whiteboard) range is checked here.
	if err := decoder.Decode(&req); err != nil || !uuidPattern.MatchString(req.ID) || len(req.Points) != 1 || !validPointsIn(req.Points, whiteboardMin, whiteboardMax) {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Invalid request body.")
		return
	}
	if !h.allow(w, c, "board-move", 120, time.Minute) {
		return
	}
	points, _ := json.Marshal(req.Points)
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		_, err := tx.Exec(c.r.Context(), `SELECT connect_auth.board_move($1::UUID, $2::UUID, $3::jsonb)`, c.roomID, req.ID, string(points))
		return err
	})
	if err != nil {
		sendBoardError(w, c.r, err, "Could not move that.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"success": true})
}
