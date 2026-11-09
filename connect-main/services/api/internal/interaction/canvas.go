package interaction

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tathastu/connect/services/api/internal/ai"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/livecanvas"
	"github.com/tathastu/connect/services/api/internal/model"
)

// liveGenerateTimeout bounds one generation, so a slow provider cannot hold a request open.
const liveGenerateTimeout = 30 * time.Second

// LiveGenerator makes canvas content from a teacher's prompt. ai.Service implements it.
type LiveGenerator interface {
	GenerateLiveSlides(ctx context.Context, budgetKey, userKey, prompt, lectureContext string) (json.RawMessage, int, error)
	GenerateLiveSimulation(ctx context.Context, budgetKey, userKey, prompt, lectureContext string) (json.RawMessage, json.RawMessage, error)
}

// SetLiveGenerator enables AI generation on the live canvas. Without one, generation reports
// that AI is not configured and everything else still works.
func (h *Handler) SetLiveGenerator(g LiveGenerator) {
	h.generator = g
}

// CanvasState is what is on the live canvas, as every participant reads it.
type CanvasState struct {
	Kind       *string         `json:"kind"`
	Generation *string         `json:"generation"`
	Content    json.RawMessage `json:"content"`
	Slide      int             `json:"slide"`
	SlideCount int             `json:"slideCount"`
	SimMode    string          `json:"simMode"`
	SimParams  json.RawMessage `json:"simParams"`
	Presenter  *string         `json:"presenter"`
	Version    int64           `json:"version"`
	CanManage  bool            `json:"canManage"`
	MyAnswer   json.RawMessage `json:"myAnswer"`
}

// SimAnswer is one participant's submitted simulation settings.
type SimAnswer struct {
	Identity    string          `json:"identity"`
	DisplayName string          `json:"displayName"`
	Params      json.RawMessage `json:"params"`
	SubmittedAt time.Time       `json:"submittedAt"`
}

func sendCanvasError(w http.ResponseWriter, r *http.Request, err error, failure string) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "CN404":
			model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", pgErr.Message)
			return
		case "CN422":
			model.SendJSONError(w, r, http.StatusUnprocessableEntity, "INVALID_CANVAS", pgErr.Message)
			return
		}
	}
	sendDBError(w, r, err, failure)
}

func (h *Handler) readCanvas(ctx context.Context, tx pgx.Tx, roomID string) (*CanvasState, error) {
	state := &CanvasState{Slide: 1, SimMode: "presenter"}
	var content, params, mine []byte
	err := tx.QueryRow(ctx, `
		SELECT c.kind, c.generation::text, c.content, c.slide, c.slide_count, c.sim_mode, c.sim_params,
		       c.presenter_identity, c.version,
		       (SELECT s.params FROM live_sim_submissions s
		        WHERE s.room_id = c.room_id AND s.generation = c.generation AND s.identity = connect_auth.current_room_identity())
		FROM room_live_canvas c WHERE c.room_id = $1
	`, roomID).Scan(&state.Kind, &state.Generation, &content, &state.Slide, &state.SlideCount, &state.SimMode, &params, &state.Presenter, &state.Version, &mine)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	state.Content, state.SimParams, state.MyAnswer = content, params, mine
	if err := tx.QueryRow(ctx, `SELECT connect_auth.can_announce($1::UUID)`, roomID).Scan(&state.CanManage); err != nil {
		return nil, err
	}
	return state, nil
}

func (h *Handler) respondCanvas(w http.ResponseWriter, c *caller, status int) {
	var state *CanvasState
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		var err error
		state, err = h.readCanvas(c.r.Context(), tx, c.roomID)
		return err
	})
	if err != nil {
		sendCanvasError(w, c.r, err, "Could not load the live canvas.")
		return
	}
	model.SendJSON(w, status, state)
}

// GetCanvas handles GET /rooms/{code}/canvas.
func (h *Handler) GetCanvas(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	h.respondCanvas(w, c, http.StatusOK)
}

func decodeStrict(r *http.Request, into any) bool {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	return decoder.Decode(into) == nil
}

// GenerateCanvas handles POST /rooms/{code}/canvas/generate. Host or co-host only. The model
// is called outside any transaction, and the database checks permission again on publish.
func (h *Handler) GenerateCanvas(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var req struct {
		Kind    string `json:"kind"`
		Prompt  string `json:"prompt"`
		Context string `json:"context"`
	}
	if !decodeStrict(c.r, &req) || (req.Kind != "slides" && req.Kind != "simulation") {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Choose slides or a simulation and describe it.")
		return
	}
	if c.roomStatus != "active" {
		model.SendJSONError(w, c.r, http.StatusConflict, "MEETING_NOT_ACTIVE", "This meeting is not running.")
		return
	}
	var canManage bool
	var budgetKey string
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		return tx.QueryRow(c.r.Context(), `
			SELECT connect_auth.can_announce(r.id), COALESCE('org:' || r.organization_id::text, 'user:' || r.host_user_id::text, 'room:' || r.id::text)
			FROM rooms r WHERE r.id = $1
		`, c.roomID).Scan(&canManage, &budgetKey)
	})
	if err != nil {
		sendCanvasError(w, c.r, err, "Could not check your permissions.")
		return
	}
	if !canManage {
		model.SendJSONError(w, c.r, http.StatusForbidden, "FORBIDDEN", "Only the host or a co-host can generate for the class.")
		return
	}
	if h.generator == nil {
		ai.WriteError(w, c.r, ai.ErrProviderNotConfigured)
		return
	}
	if !h.allow(w, c, "canvas-generate", 10, time.Minute) {
		return
	}

	ctx, cancel := context.WithTimeout(c.r.Context(), liveGenerateTimeout)
	defer cancel()
	var content, params json.RawMessage
	var slideCount int
	if req.Kind == "slides" {
		content, slideCount, err = h.generator.GenerateLiveSlides(ctx, budgetKey, c.identity, req.Prompt, req.Context)
	} else {
		content, params, err = h.generator.GenerateLiveSimulation(ctx, budgetKey, c.identity, req.Prompt, req.Context)
	}
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			err = ai.ErrProviderTimeout
		}
		ai.WriteError(w, c.r, err)
		return
	}

	err = database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		_, err := tx.Exec(c.r.Context(), `SELECT connect_auth.live_canvas_publish($1::UUID, $2, $3::jsonb, $4, $5::jsonb)`,
			c.roomID, req.Kind, string(content), slideCount, nullableJSON(params))
		return err
	})
	if err != nil {
		sendCanvasError(w, c.r, err, "Could not show the result to the class.")
		return
	}
	h.respondCanvas(w, c, http.StatusCreated)
}

func nullableJSON(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	return string(raw)
}

// currentEngine returns the engine of the simulation on the canvas, or "" if there is none.
func currentEngine(ctx context.Context, tx pgx.Tx, roomID string) (string, error) {
	var engine *string
	err := tx.QueryRow(ctx, `SELECT content->>'engine' FROM room_live_canvas WHERE room_id = $1 AND kind = 'simulation'`, roomID).Scan(&engine)
	if errors.Is(err, pgx.ErrNoRows) || engine == nil {
		return "", nil
	}
	return *engine, err
}

var errNoSimulation = errors.New("no simulation on the canvas")

// UpdateCanvas handles PATCH /rooms/{code}/canvas: change slide, simulation mode or settings,
// or close the canvas. Host or co-host only; the database enforces it.
func (h *Handler) UpdateCanvas(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var req struct {
		Slide  *int           `json:"slide"`
		Mode   *string        `json:"mode"`
		Params map[string]any `json:"params"`
		Stop   bool           `json:"stop"`
	}
	if !decodeStrict(c.r, &req) || (req.Mode != nil && *req.Mode != "presenter" && *req.Mode != "sandbox") {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Invalid request body.")
		return
	}
	// Presenters save settings a few times a second while dragging; frames go over the data channel.
	if !h.allow(w, c, "canvas", 300, time.Minute) {
		return
	}
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		ctx := c.r.Context()
		var params any
		if req.Params != nil {
			engine, err := currentEngine(ctx, tx, c.roomID)
			if err != nil {
				return err
			}
			if engine == "" {
				return errNoSimulation
			}
			normalized, err := livecanvas.NormalizeParams(engine, req.Params)
			if err != nil {
				return err
			}
			encoded, err := json.Marshal(normalized)
			if err != nil {
				return err
			}
			params = string(encoded)
		}
		_, err := tx.Exec(ctx, `SELECT connect_auth.live_canvas_update($1::UUID, $2, $3, $4::jsonb, $5)`, c.roomID, req.Slide, req.Mode, params, req.Stop)
		return err
	})
	if errors.Is(err, errNoSimulation) || errors.Is(err, livecanvas.ErrUnknownEngine) {
		model.SendJSONError(w, c.r, http.StatusUnprocessableEntity, "INVALID_CANVAS", "Only a simulation has settings.")
		return
	}
	if err != nil {
		sendCanvasError(w, c.r, err, "Could not change the live canvas.")
		return
	}
	h.respondCanvas(w, c, http.StatusOK)
}

// EditCanvasSlide handles PUT /rooms/{code}/canvas/slides/{index}: the teacher's edit to one slide.
func (h *Handler) EditCanvasSlide(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	index, err := strconv.Atoi(chi.URLParam(r, "index"))
	var req struct {
		Slide livecanvas.Slide `json:"slide"`
	}
	if err != nil || index < 0 || index >= livecanvas.MaxSlides || !decodeStrict(c.r, &req) {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Invalid request body.")
		return
	}
	slide, usable := livecanvas.CleanSlide(req.Slide)
	if !usable {
		model.SendJSONError(w, c.r, http.StatusUnprocessableEntity, "INVALID_CANVAS", "A slide needs a title and some content.")
		return
	}
	if !h.allow(w, c, "canvas", 300, time.Minute) {
		return
	}
	encoded, err := json.Marshal(slide)
	if err != nil {
		model.SendJSONError(w, c.r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not save the slide.")
		return
	}
	err = database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		_, err := tx.Exec(c.r.Context(), `SELECT connect_auth.live_canvas_edit_slide($1::UUID, $2, $3::jsonb)`, c.roomID, index, string(encoded))
		return err
	})
	if err != nil {
		sendCanvasError(w, c.r, err, "Could not save the slide.")
		return
	}
	h.respondCanvas(w, c, http.StatusOK)
}

// SubmitSimulation handles POST /rooms/{code}/canvas/submit: a participant sends their settings
// back while the host has opened sandbox mode.
func (h *Handler) SubmitSimulation(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var req struct {
		Params map[string]any `json:"params"`
	}
	if !decodeStrict(c.r, &req) || req.Params == nil {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Invalid request body.")
		return
	}
	if !h.allow(w, c, "canvas-submit", 30, time.Minute) {
		return
	}
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		ctx := c.r.Context()
		engine, err := currentEngine(ctx, tx, c.roomID)
		if err != nil {
			return err
		}
		if engine == "" {
			return errNoSimulation
		}
		normalized, err := livecanvas.NormalizeParams(engine, req.Params)
		if err != nil {
			return err
		}
		encoded, err := json.Marshal(normalized)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `SELECT connect_auth.live_sim_submit($1::UUID, $2::jsonb)`, c.roomID, string(encoded))
		return err
	})
	if errors.Is(err, errNoSimulation) || errors.Is(err, livecanvas.ErrUnknownEngine) {
		model.SendJSONError(w, c.r, http.StatusUnprocessableEntity, "INVALID_CANVAS", "There is no simulation to answer.")
		return
	}
	if err != nil {
		sendCanvasError(w, c.r, err, "Could not send your answer.")
		return
	}
	h.respondCanvas(w, c, http.StatusOK)
}

// ListSimulationAnswers handles GET /rooms/{code}/canvas/submissions. Moderators see every
// answer to the current simulation; a participant sees only their own (row level security).
func (h *Handler) ListSimulationAnswers(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	answers := []SimAnswer{}
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		rows, err := tx.Query(c.r.Context(), `
			SELECT s.identity, s.display_name, s.params, s.submitted_at
			FROM live_sim_submissions s
			JOIN room_live_canvas c ON c.room_id = s.room_id AND c.generation = s.generation
			WHERE s.room_id = $1
			ORDER BY s.submitted_at
			LIMIT 500
		`, c.roomID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a SimAnswer
			var params []byte
			if err := rows.Scan(&a.Identity, &a.DisplayName, &params, &a.SubmittedAt); err != nil {
				return err
			}
			a.Params = params
			answers = append(answers, a)
		}
		return rows.Err()
	})
	if err != nil {
		sendCanvasError(w, c.r, err, "Could not load the answers.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"answers": answers})
}
