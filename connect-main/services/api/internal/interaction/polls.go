package interaction

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tathastu/connect/services/api/internal/audit"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/livekit"
	"github.com/tathastu/connect/services/api/internal/model"
)

const (
	minPollOptions = 2
	maxPollOptions = 10
	maxPollSeconds = 24 * 60 * 60
)

func (c *caller) canRun() bool { return c.role.IsHost || c.role.Role == livekit.RoleCoHost }

func sendPollError(w http.ResponseWriter, r *http.Request, err error, failure string) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "CN410":
			model.SendJSONError(w, r, http.StatusConflict, "POLL_CLOSED", "This question is closed.")
			return
		case "CN409":
			model.SendJSONError(w, r, http.StatusConflict, "ALREADY_ANSWERED", "You have already answered this question.")
			return
		case "CN422", "22P02":
			model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_CHOICES", "Those choices are not valid for this question.")
			return
		}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "This was not found.")
		return
	}
	sendDBError(w, r, err, failure)
}

type pollOptionInput struct {
	Label     string `json:"label"`
	IsCorrect bool   `json:"isCorrect"`
}

// CreatePoll handles POST /rooms/{code}/polls. Hosts and co-hosts only.
func (h *Handler) CreatePoll(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	if !c.canRun() {
		model.SendJSONError(w, c.r, http.StatusForbidden, "FORBIDDEN", "Only the host or a co-host can create questions.")
		return
	}
	var req struct {
		Kind            string            `json:"kind"`
		Question        string            `json:"question"`
		ChoiceMode      string            `json:"choiceMode"`
		Options         []pollOptionInput `json:"options"`
		Points          int               `json:"points"`
		DurationSeconds int               `json:"durationSeconds"`
		AllowChange     bool              `json:"allowChange"`
		LiveResults     *bool             `json:"liveResults"`
	}
	decoder := json.NewDecoder(c.r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Invalid request body.")
		return
	}
	if msg := validatePoll(req.Kind, req.Question, req.ChoiceMode, req.Options, req.Points, req.DurationSeconds); msg != "" {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_POLL", msg)
		return
	}
	liveResults := req.Kind != "quiz"
	if req.LiveResults != nil {
		liveResults = *req.LiveResults
	}
	var closesAt *time.Time
	if req.DurationSeconds > 0 {
		at := time.Now().Add(time.Duration(req.DurationSeconds) * time.Second)
		closesAt = &at
	}
	var id string
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		ctx := c.r.Context()
		if err := tx.QueryRow(ctx, `
			INSERT INTO polls (room_id, created_by, kind, question, choice_mode, points, allow_change, live_results, closes_at)
			VALUES ($1, connect_auth.current_room_identity(), $2, $3, $4, $5, $6, $7, $8) RETURNING id::text
		`, c.roomID, req.Kind, strings.TrimSpace(req.Question), req.ChoiceMode, req.Points, req.AllowChange, liveResults, closesAt).Scan(&id); err != nil {
			return err
		}
		for i, option := range req.Options {
			var optionID string
			if err := tx.QueryRow(ctx, `INSERT INTO poll_options (poll_id, position, label) VALUES ($1, $2, $3) RETURNING id::text`, id, i, strings.TrimSpace(option.Label)).Scan(&optionID); err != nil {
				return err
			}
			if req.Kind == "quiz" && option.IsCorrect {
				if _, err := tx.Exec(ctx, `INSERT INTO poll_answer_keys (poll_id, option_id) VALUES ($1, $2)`, id, optionID); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		sendPollError(w, c.r, err, "Could not create the question.")
		return
	}
	if h.audit != nil {
		h.audit.Record(c.r.Context(), audit.AuditParams{EventType: "room.poll_created", Severity: "INFO", ActorID: c.identity, RoomID: c.roomID, Metadata: map[string]any{"poll_id": id, "kind": req.Kind}})
	}
	model.SendJSON(w, http.StatusCreated, map[string]any{"id": id})
}

func validatePoll(kind, question, choiceMode string, options []pollOptionInput, points, duration int) string {
	if kind != "poll" && kind != "quiz" {
		return "A question is a poll or a quiz."
	}
	if text := strings.TrimSpace(question); text == "" || utf8.RuneCountInString(text) > 500 {
		return "A question must have 1 to 500 characters."
	}
	if choiceMode != "single" && choiceMode != "multiple" {
		return "Choose single or multiple answers."
	}
	if len(options) < minPollOptions || len(options) > maxPollOptions {
		return "A question needs 2 to 10 options."
	}
	correct := 0
	seen := map[string]bool{}
	for _, option := range options {
		label := strings.TrimSpace(option.Label)
		if label == "" || utf8.RuneCountInString(label) > 200 || seen[label] {
			return "Options must be different and have 1 to 200 characters."
		}
		seen[label] = true
		if option.IsCorrect {
			correct++
		}
	}
	if points < 0 || points > 1000 {
		return "Points must be between 0 and 1000."
	}
	if duration < 0 || duration > maxPollSeconds {
		return "The time limit must be at most 24 hours."
	}
	if kind == "quiz" {
		if correct == 0 {
			return "A quiz needs at least one correct option."
		}
		if choiceMode == "single" && correct != 1 {
			return "A single-answer quiz needs exactly one correct option."
		}
	}
	return ""
}

// ListPolls handles GET /rooms/{code}/polls. Keys and counts come only from poll_results,
// which applies the visibility rules; the caller's own answer and score come from RLS.
func (h *Handler) ListPolls(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var raw []byte
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		return tx.QueryRow(c.r.Context(), `
			SELECT COALESCE(json_agg(t ORDER BY t."createdAt" DESC), '[]'::json) FROM (
				SELECT p.id, p.kind, p.question, p.choice_mode AS "choiceMode", p.points, p.allow_change AS "allowChange",
				       p.closes_at AS "closesAt", p.created_at AS "createdAt",
				       (p.closed_at IS NOT NULL OR (p.closes_at IS NOT NULL AND clock_timestamp() >= p.closes_at)) AS closed,
				       (SELECT json_agg(json_build_object('id', o.id, 'label', o.label) ORDER BY o.position) FROM poll_options o WHERE o.poll_id = p.id) AS options,
				       (SELECT COALESCE(json_agg(json_build_object('optionId', pr.option_id, 'votes', pr.votes, 'isCorrect', pr.is_correct)), '[]'::json) FROM connect_auth.poll_results(p.id) pr) AS results,
				       (SELECT json_build_object('optionIds', r.option_ids, 'score', r.score) FROM poll_responses r WHERE r.poll_id = p.id AND r.identity = connect_auth.current_room_identity()) AS "myResponse",
				       (SELECT count(*) FROM poll_responses r WHERE r.poll_id = p.id) AS "visibleResponses"
				FROM polls p WHERE p.room_id = $1
			) t
		`, c.roomID).Scan(&raw)
	})
	if err != nil {
		sendPollError(w, c.r, err, "Could not load questions.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"polls": json.RawMessage(raw), "canManage": c.canRun()})
}

// RespondPoll handles POST /rooms/{code}/polls/{id}/respond.
func (h *Handler) RespondPoll(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var req struct {
		OptionIDs []string `json:"optionIds"`
	}
	if err := json.NewDecoder(c.r.Body).Decode(&req); err != nil || len(req.OptionIDs) == 0 || len(req.OptionIDs) > maxPollOptions {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_CHOICES", "Choose at least one option.")
		return
	}
	pollID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(pollID); err != nil {
		model.SendJSONError(w, c.r, http.StatusNotFound, "NOT_FOUND", "This was not found.")
		return
	}
	if !h.allow(w, c, "respond", 60, time.Minute) {
		return
	}
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		var inRoom bool
		if err := tx.QueryRow(c.r.Context(), `SELECT EXISTS (SELECT 1 FROM polls WHERE id = $1 AND room_id = $2)`, pollID, c.roomID).Scan(&inRoom); err != nil {
			return err
		}
		if !inRoom {
			return pgx.ErrNoRows
		}
		_, err := tx.Exec(c.r.Context(), `SELECT * FROM connect_auth.submit_poll_response($1::UUID, $2::UUID[])`, pollID, req.OptionIDs)
		return err
	})
	if err != nil {
		sendPollError(w, c.r, err, "Could not save your answer.")
		return
	}
	// A quiz score is not returned here: while it is open, that would reveal the answer.
	model.SendJSON(w, http.StatusOK, map[string]any{"saved": true})
}

// ClosePoll handles POST /rooms/{code}/polls/{id}/close.
func (h *Handler) ClosePoll(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	if !c.canRun() {
		model.SendJSONError(w, c.r, http.StatusForbidden, "FORBIDDEN", "Only the host or a co-host can close questions.")
		return
	}
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(c.r.Context(), `UPDATE polls SET closed_at = COALESCE(closed_at, clock_timestamp()) WHERE id = $1 AND room_id = $2`, chi.URLParam(r, "id"), c.roomID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return nil
	})
	if err != nil {
		sendPollError(w, c.r, err, "Could not close the question.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"closed": true})
}

// PollScores handles GET /rooms/{code}/polls/{id}/scores for those running the room.
func (h *Handler) PollScores(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	if !c.canRun() {
		model.SendJSONError(w, c.r, http.StatusForbidden, "FORBIDDEN", "Only the host or a co-host can see scores.")
		return
	}
	var raw []byte
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		return tx.QueryRow(c.r.Context(), `
			SELECT COALESCE(json_agg(t ORDER BY t.score DESC NULLS LAST), '[]'::json) FROM (
				SELECT r.identity, r.score, r.submitted_at AS "submittedAt"
				FROM poll_responses r JOIN polls p ON p.id = r.poll_id
				WHERE r.poll_id = $1 AND p.room_id = $2
			) t
		`, chi.URLParam(r, "id"), c.roomID).Scan(&raw)
	})
	if err != nil {
		sendPollError(w, c.r, err, "Could not load scores.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"scores": json.RawMessage(raw)})
}

const doubtColumns = `id, asked_by AS "askedBy", asked_by_name AS "askedByName", question, status, assigned_to AS "assignedTo", answer, answered_by AS "answeredBy", created_at AS "createdAt", answered_at AS "answeredAt", resolved_at AS "resolvedAt"`

// ListDoubts handles GET /rooms/{code}/doubts, oldest open first.
func (h *Handler) ListDoubts(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var raw []byte
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		return tx.QueryRow(c.r.Context(), `
			SELECT COALESCE(json_agg(t), '[]'::json) FROM (
				SELECT `+doubtColumns+`,
				       (SELECT count(*) FROM doubt_votes v WHERE v.doubt_id = d.id)::int AS votes,
				       EXISTS (SELECT 1 FROM doubt_votes v WHERE v.doubt_id = d.id AND v.identity = connect_auth.current_room_identity()) AS "myVote"
				FROM meeting_doubts d WHERE room_id = $1
				-- Unresolved first, most upvoted first, then oldest first.
				ORDER BY (status = 'resolved'), votes DESC, created_at
			) t
		`, c.roomID).Scan(&raw)
	})
	if err != nil {
		sendPollError(w, c.r, err, "Could not load doubts.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"doubts": json.RawMessage(raw), "canManage": c.canRun()})
}

// AskDoubt handles POST /rooms/{code}/doubts.
func (h *Handler) AskDoubt(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var req struct {
		Question string `json:"question"`
	}
	if err := json.NewDecoder(c.r.Body).Decode(&req); err != nil {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Invalid request body.")
		return
	}
	question := strings.TrimSpace(req.Question)
	if question == "" || utf8.RuneCountInString(question) > 1000 {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_DOUBT", "A doubt must have 1 to 1000 characters.")
		return
	}
	if !h.allow(w, c, "doubt", 10, time.Minute) {
		return
	}
	var id string
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		var name string
		if err := tx.QueryRow(c.r.Context(), `
			SELECT display_name FROM room_participants
			WHERE room_id = $1 AND identity = connect_auth.current_room_identity() AND left_at IS NULL
			ORDER BY joined_at DESC LIMIT 1
		`, c.roomID).Scan(&name); err != nil {
			return err
		}
		return tx.QueryRow(c.r.Context(), `
			INSERT INTO meeting_doubts (room_id, asked_by, asked_by_name, question)
			VALUES ($1, connect_auth.current_room_identity(), $2, $3) RETURNING id::text
		`, c.roomID, name, question).Scan(&id)
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			model.SendJSONError(w, c.r, http.StatusForbidden, "JOIN_REQUIRED", "Join the meeting before asking.")
			return
		}
		sendPollError(w, c.r, err, "Could not save your doubt.")
		return
	}
	model.SendJSON(w, http.StatusCreated, map[string]any{"id": id})
}

// updateDoubt runs one change, reporting a missing doubt as not found.
func (h *Handler) updateDoubt(w http.ResponseWriter, c *caller, doubtID, query string, args ...any) bool {
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(c.r.Context(), query, append([]any{doubtID, c.roomID}, args...)...)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return nil
	})
	if err != nil {
		sendPollError(w, c.r, err, "Could not update this doubt.")
		return false
	}
	return true
}

// AssignDoubt handles POST /rooms/{code}/doubts/{id}/assign.
func (h *Handler) AssignDoubt(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	if !c.canRun() {
		model.SendJSONError(w, c.r, http.StatusForbidden, "FORBIDDEN", "Only the host or a co-host can assign doubts.")
		return
	}
	var req struct {
		Identity string `json:"identity"`
	}
	if err := json.NewDecoder(c.r.Body).Decode(&req); err != nil || req.Identity == "" {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Name who this is assigned to.")
		return
	}
	if h.updateDoubt(w, c, chi.URLParam(r, "id"), `UPDATE meeting_doubts SET assigned_to = $3, status = 'assigned' WHERE id = $1 AND room_id = $2 AND status IN ('open', 'assigned')`, req.Identity) {
		model.SendJSON(w, http.StatusOK, map[string]any{"status": "assigned"})
	}
}

// AnswerDoubt handles POST /rooms/{code}/doubts/{id}/answer.
func (h *Handler) AnswerDoubt(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	if !c.canRun() {
		model.SendJSONError(w, c.r, http.StatusForbidden, "FORBIDDEN", "Only the host or a co-host can answer doubts.")
		return
	}
	var req struct {
		Answer string `json:"answer"`
	}
	if err := json.NewDecoder(c.r.Body).Decode(&req); err != nil {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Invalid request body.")
		return
	}
	answer := strings.TrimSpace(req.Answer)
	if answer == "" || utf8.RuneCountInString(answer) > 4000 {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_ANSWER", "An answer must have 1 to 4000 characters.")
		return
	}
	if h.updateDoubt(w, c, chi.URLParam(r, "id"), `
		UPDATE meeting_doubts SET answer = $3, answered_by = connect_auth.current_room_identity(), answered_at = clock_timestamp(), status = 'answered'
		WHERE id = $1 AND room_id = $2 AND status <> 'resolved'
	`, answer) {
		model.SendJSON(w, http.StatusOK, map[string]any{"status": "answered"})
	}
}

// ResolveDoubt handles POST /rooms/{code}/doubts/{id}/resolve, for moderators or the asker.
func (h *Handler) ResolveDoubt(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	if h.updateDoubt(w, c, chi.URLParam(r, "id"), `UPDATE meeting_doubts SET status = 'resolved', resolved_at = clock_timestamp() WHERE id = $1 AND room_id = $2 AND status <> 'resolved'`) {
		model.SendJSON(w, http.StatusOK, map[string]any{"status": "resolved"})
	}
}

// VoteDoubt handles POST /rooms/{code}/doubts/{id}/vote: adds or removes the caller's upvote.
func (h *Handler) VoteDoubt(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !uuidPattern.MatchString(id) {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Unknown question.")
		return
	}
	if !h.allow(w, c, "doubt-vote", 60, time.Minute) {
		return
	}
	var voted bool
	var votes int
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		return tx.QueryRow(c.r.Context(), `SELECT voted, votes FROM connect_auth.toggle_doubt_vote($1::UUID)`, id).Scan(&voted, &votes)
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "CN422" {
		model.SendJSONError(w, c.r, http.StatusUnprocessableEntity, "CANNOT_VOTE", pgErr.Message)
		return
	}
	if err != nil {
		sendPollError(w, c.r, err, "Could not record the vote.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"voted": voted, "votes": votes})
}

// LeaderboardRow is one place on the quiz leaderboard.
type LeaderboardRow struct {
	Rank        int     `json:"rank"`
	DisplayName string  `json:"displayName"`
	Points      float64 `json:"points"`
	Answered    int     `json:"answered"`
	IsMe        bool    `json:"isMe"`
}

// Leaderboard handles GET /rooms/{code}/leaderboard: top five by quiz points, and the caller.
func (h *Handler) Leaderboard(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	rows := []LeaderboardRow{}
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		res, err := tx.Query(c.r.Context(), `SELECT rank, display_name, points::float8, answered, is_me FROM connect_auth.quiz_leaderboard($1::UUID)`, c.roomID)
		if err != nil {
			return err
		}
		defer res.Close()
		for res.Next() {
			var row LeaderboardRow
			if err := res.Scan(&row.Rank, &row.DisplayName, &row.Points, &row.Answered, &row.IsMe); err != nil {
				return err
			}
			rows = append(rows, row)
		}
		return res.Err()
	})
	if err != nil {
		sendPollError(w, c.r, err, "Could not load the leaderboard.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"leaderboard": rows})
}
