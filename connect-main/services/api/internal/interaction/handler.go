// Package interaction stores meeting chat, announcements, reactions and raised hands. The
// database is the source of truth; realtime channels only tell clients to fetch again.
package interaction

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/audit"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/livekit"
	"github.com/tathastu/connect/services/api/internal/model"
	"github.com/tathastu/connect/services/api/internal/ratelimit"
	"github.com/tathastu/connect/services/api/internal/room"
)

const (
	// MaxMessageLength matches the check constraint on meeting_messages.
	MaxMessageLength = 2000
	defaultPageSize  = 50
	maxPageSize      = 100
	// reactionWindow is how long a reaction stays on screen, and so in the live state.
	reactionWindow = 15 * time.Second
)

var (
	clientMessageIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	allowedReactions       = map[string]bool{"👍": true, "👏": true, "❤️": true, "😂": true, "😮": true, "🎉": true, "🤔": true, "👎": true}
)

// Handler serves the interaction routes.
type Handler struct {
	pool    *pgxpool.Pool
	rooms   *room.Service
	limiter ratelimit.Limiter
	audit   *audit.Service
}

// NewHandler constructs the handler.
func NewHandler(pool *pgxpool.Pool, rooms *room.Service, limiter ratelimit.Limiter, auditService *audit.Service) *Handler {
	return &Handler{pool: pool, rooms: rooms, limiter: limiter, audit: auditService}
}

// Message is a stored chat message or announcement.
type Message struct {
	ID              string    `json:"id"`
	Seq             int64     `json:"seq"`
	SenderIdentity  string    `json:"senderIdentity"`
	SenderName      string    `json:"senderName"`
	Kind            string    `json:"kind"`
	Body            string    `json:"body"`
	ClientMessageID string    `json:"clientMessageId"`
	CreatedAt       time.Time `json:"createdAt"`
}

type caller struct {
	identity   string
	role       *room.MyRole
	roomID     string
	roomStatus string
	r          *http.Request
}

// resolve returns the caller from their credentials only, with a verified place in the room.
func (h *Handler) resolve(w http.ResponseWriter, r *http.Request) (*caller, bool) {
	code := chi.URLParam(r, "code")
	identity, r := room.CallerIdentity(r, room.NormalizeCode(code))
	if identity == "" {
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Valid participant identity required.")
		return nil, false
	}
	role, err := h.rooms.GetMyRole(r.Context(), code, identity)
	if err != nil {
		if errors.Is(err, room.ErrRoomNotFound) {
			model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "This meeting is unavailable.")
			return nil, false
		}
		model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You are not a participant in this meeting.")
		return nil, false
	}
	rm, err := h.rooms.GetRoomForInteraction(r.Context(), code)
	if err != nil {
		model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "This meeting is unavailable.")
		return nil, false
	}
	return &caller{identity: identity, role: role, roomID: rm.ID, roomStatus: rm.Status, r: r}, true
}

func (h *Handler) allow(w http.ResponseWriter, c *caller, action string, limit int, window time.Duration) bool {
	if h.limiter == nil {
		return true
	}
	allowed, err := h.limiter.Allow(c.r.Context(), fmt.Sprintf("interaction:%s:%s:%s", action, c.roomID, c.identity), limit, window)
	if err != nil || !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(int(window.Seconds())))
		model.SendJSONError(w, c.r, http.StatusTooManyRequests, "TOO_MANY_REQUESTS", "You are doing that too often. Please slow down.")
		return false
	}
	return true
}

func sendDBError(w http.ResponseWriter, r *http.Request, err error, failure string) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "42501" {
		model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You do not have permission to do this.")
		return
	}
	model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", failure)
}

func scanMessages(rows pgx.Rows) ([]Message, error) {
	defer rows.Close()
	messages := []Message{}
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.Seq, &m.SenderIdentity, &m.SenderName, &m.Kind, &m.Body, &m.ClientMessageID, &m.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, m)
	}
	return messages, rows.Err()
}

const messageColumns = `id::text, seq, sender_identity, sender_name, kind, body, client_message_id, created_at`

func parseInt64(value string) (int64, bool) {
	if value == "" {
		return 0, true
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	return parsed, err == nil && parsed >= 0
}

// ListMessages handles GET /rooms/{code}/messages. With before it pages back through history,
// newest page first in time; with after it returns what followed. Either way, ascending by seq.
func (h *Handler) ListMessages(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	query := c.r.URL.Query()
	after, okAfter := parseInt64(query.Get("after"))
	before, okBefore := parseInt64(query.Get("before"))
	limit, okLimit := parseInt64(query.Get("limit"))
	if !okAfter || !okBefore || !okLimit {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAGINATION", "after, before and limit must be non-negative numbers.")
		return
	}
	if limit == 0 {
		limit = defaultPageSize
	}
	if limit > maxPageSize {
		limit = maxPageSize
	}
	var messages []Message
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		var rows pgx.Rows
		var err error
		switch {
		case before > 0:
			rows, err = tx.Query(c.r.Context(), `SELECT `+messageColumns+` FROM (
				SELECT * FROM meeting_messages WHERE room_id = $1 AND seq < $2 ORDER BY seq DESC LIMIT $3
			) page ORDER BY seq`, c.roomID, before, limit)
		case after > 0:
			rows, err = tx.Query(c.r.Context(), `SELECT `+messageColumns+` FROM meeting_messages WHERE room_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`, c.roomID, after, limit)
		default:
			rows, err = tx.Query(c.r.Context(), `SELECT `+messageColumns+` FROM (
				SELECT * FROM meeting_messages WHERE room_id = $1 ORDER BY seq DESC LIMIT $2
			) page ORDER BY seq`, c.roomID, limit)
		}
		if err != nil {
			return err
		}
		messages, err = scanMessages(rows)
		return err
	})
	if err != nil {
		sendDBError(w, c.r, err, "Could not load messages.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"messages": messages})
}

// PostMessage handles POST /rooms/{code}/messages. Retrying with the same clientMessageId returns
// the original message, so a client that lost the response cannot send it twice.
func (h *Handler) PostMessage(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var req struct {
		ClientMessageID string `json:"clientMessageId"`
		Body            string `json:"body"`
		Kind            string `json:"kind"`
	}
	decoder := json.NewDecoder(c.r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Invalid request body.")
		return
	}
	if !clientMessageIDPattern.MatchString(req.ClientMessageID) {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_MESSAGE_ID", "A valid clientMessageId is required.")
		return
	}
	body := strings.TrimSpace(req.Body)
	if body == "" || utf8.RuneCountInString(body) > MaxMessageLength || !utf8.ValidString(body) || strings.ContainsRune(body, 0) {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_MESSAGE", fmt.Sprintf("A message must have 1 to %d characters.", MaxMessageLength))
		return
	}
	if req.Kind == "" {
		req.Kind = "chat"
	}
	if req.Kind != "chat" && req.Kind != "announcement" {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_KIND", "A message is a chat or an announcement.")
		return
	}
	if req.Kind == "announcement" && !c.role.IsHost && c.role.Role != livekit.RoleCoHost {
		model.SendJSONError(w, c.r, http.StatusForbidden, "FORBIDDEN", "Only the host or a co-host can post announcements.")
		return
	}
	if !h.allow(w, c, "message", 20, 10*time.Second) {
		return
	}

	var message Message
	created := false
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		ctx := c.r.Context()
		if c.roomStatus != "active" {
			return errRoomClosed
		}
		var senderName string
		if err := tx.QueryRow(ctx, `
			SELECT display_name FROM room_participants
			WHERE room_id = $1 AND identity = connect_auth.current_room_identity() AND left_at IS NULL
			ORDER BY joined_at DESC LIMIT 1
		`, c.roomID).Scan(&senderName); err != nil {
			return err
		}
		// Sequence numbers are taken under this lock, so a reader who has seen seq N can never
		// later miss a lower one that committed after it.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, c.roomID); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			INSERT INTO meeting_messages (room_id, sender_identity, sender_name, kind, body, client_message_id)
			VALUES ($1, connect_auth.current_room_identity(), $2, $3, $4, $5)
			ON CONFLICT (room_id, sender_identity, client_message_id) DO NOTHING
			RETURNING `+messageColumns, c.roomID, senderName, req.Kind, body, req.ClientMessageID)
		if err != nil {
			return err
		}
		inserted, err := scanMessages(rows)
		if err != nil {
			return err
		}
		if len(inserted) == 1 {
			message, created = inserted[0], true
			return nil
		}
		rows, err = tx.Query(ctx, `SELECT `+messageColumns+` FROM meeting_messages WHERE room_id = $1 AND sender_identity = connect_auth.current_room_identity() AND client_message_id = $2`, c.roomID, req.ClientMessageID)
		if err != nil {
			return err
		}
		existing, err := scanMessages(rows)
		if err != nil {
			return err
		}
		if len(existing) != 1 {
			return pgx.ErrNoRows
		}
		message = existing[0]
		return nil
	})
	if err != nil {
		switch {
		case errors.Is(err, errRoomClosed):
			model.SendJSONError(w, c.r, http.StatusConflict, "MEETING_NOT_ACTIVE", "This meeting is not running.")
		case errors.Is(err, pgx.ErrNoRows):
			model.SendJSONError(w, c.r, http.StatusForbidden, "JOIN_REQUIRED", "Join the meeting before sending messages.")
		default:
			sendDBError(w, c.r, err, "Could not send the message.")
		}
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
		if h.audit != nil && message.Kind == "announcement" {
			h.audit.Record(c.r.Context(), audit.AuditParams{EventType: "room.announcement_posted", Severity: "INFO", ActorID: c.identity, RoomID: c.roomID})
		}
	}
	model.SendJSON(w, status, map[string]any{"message": message})
}

var errRoomClosed = errors.New("meeting is not active")

// PostReaction handles POST /rooms/{code}/reactions.
func (h *Handler) PostReaction(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var req struct {
		Emoji string `json:"emoji"`
	}
	if err := json.NewDecoder(c.r.Body).Decode(&req); err != nil || !allowedReactions[req.Emoji] {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_REACTION", "That reaction is not available.")
		return
	}
	if !h.allow(w, c, "reaction", 30, time.Minute) {
		return
	}
	var id string
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		return tx.QueryRow(c.r.Context(), `INSERT INTO meeting_reactions (room_id, identity, emoji) VALUES ($1, connect_auth.current_room_identity(), $2) RETURNING id::text`, c.roomID, req.Emoji).Scan(&id)
	})
	if err != nil {
		sendDBError(w, c.r, err, "Could not send the reaction.")
		return
	}
	model.SendJSON(w, http.StatusCreated, map[string]any{"id": id})
}

// SetHand handles POST /rooms/{code}/hand. Repeating a state changes nothing.
func (h *Handler) SetHand(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var req struct {
		Raised *bool `json:"raised"`
	}
	if err := json.NewDecoder(c.r.Body).Decode(&req); err != nil || req.Raised == nil {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "raised must be true or false.")
		return
	}
	if !h.allow(w, c, "hand", 20, time.Minute) {
		return
	}
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		ctx := c.r.Context()
		var err error
		if *req.Raised {
			_, err = tx.Exec(ctx, `
				INSERT INTO meeting_hand_raises (room_id, identity) VALUES ($1, connect_auth.current_room_identity())
				ON CONFLICT (room_id, identity) WHERE lowered_at IS NULL DO NOTHING
			`, c.roomID)
		} else {
			_, err = tx.Exec(ctx, `
				UPDATE meeting_hand_raises SET lowered_at = clock_timestamp(), lowered_by = connect_auth.current_room_identity()
				WHERE room_id = $1 AND identity = connect_auth.current_room_identity() AND lowered_at IS NULL
			`, c.roomID)
		}
		return err
	})
	if err != nil {
		sendDBError(w, c.r, err, "Could not change your hand.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"raised": *req.Raised})
}

// LowerHand handles DELETE /rooms/{code}/participants/{identity}/hand for moderators.
func (h *Handler) LowerHand(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	if !c.role.Permissions[room.PermMute] {
		model.SendJSONError(w, c.r, http.StatusForbidden, "FORBIDDEN", "You do not have permission to lower hands.")
		return
	}
	target := room.IdentityParam(r)
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		_, err := tx.Exec(c.r.Context(), `
			UPDATE meeting_hand_raises SET lowered_at = clock_timestamp(), lowered_by = connect_auth.current_room_identity()
			WHERE room_id = $1 AND identity = $2 AND lowered_at IS NULL
		`, c.roomID, target)
		return err
	})
	if err != nil {
		sendDBError(w, c.r, err, "Could not lower that hand.")
		return
	}
	if h.audit != nil {
		h.audit.Record(c.r.Context(), audit.AuditParams{EventType: "room.hand_lowered", Severity: "INFO", ActorID: c.identity, RoomID: c.roomID, Metadata: map[string]any{"target": target}})
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"success": true})
}

// Reaction is one shown reaction.
type Reaction struct {
	ID        string    `json:"id"`
	Identity  string    `json:"identity"`
	Emoji     string    `json:"emoji"`
	CreatedAt time.Time `json:"createdAt"`
}

// LiveState handles GET /rooms/{code}/live-state?afterSeq=. Clients poll it, and on a data channel
// hint, so a reconnect or missed hint costs only a short delay.
func (h *Handler) LiveState(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	after, valid := parseInt64(c.r.URL.Query().Get("afterSeq"))
	if !valid {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAGINATION", "afterSeq must be a non-negative number.")
		return
	}
	messages := []Message{}
	hands := []string{}
	reactions := []Reaction{}
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		ctx := c.r.Context()
		var rows pgx.Rows
		var err error
		if after > 0 {
			rows, err = tx.Query(ctx, `SELECT `+messageColumns+` FROM meeting_messages WHERE room_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`, c.roomID, after, maxPageSize)
		} else {
			rows, err = tx.Query(ctx, `SELECT `+messageColumns+` FROM (SELECT * FROM meeting_messages WHERE room_id = $1 ORDER BY seq DESC LIMIT $2) page ORDER BY seq`, c.roomID, defaultPageSize)
		}
		if err != nil {
			return err
		}
		if messages, err = scanMessages(rows); err != nil {
			return err
		}
		rows, err = tx.Query(ctx, `SELECT identity FROM meeting_hand_raises WHERE room_id = $1 AND lowered_at IS NULL ORDER BY raised_at`, c.roomID)
		if err != nil {
			return err
		}
		if hands, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return err
		}
		rows, err = tx.Query(ctx, `SELECT id::text, identity, emoji, created_at FROM meeting_reactions WHERE room_id = $1 AND created_at > $2 ORDER BY created_at`, c.roomID, time.Now().Add(-reactionWindow))
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item Reaction
			if err := rows.Scan(&item.ID, &item.Identity, &item.Emoji, &item.CreatedAt); err != nil {
				return err
			}
			reactions = append(reactions, item)
		}
		return rows.Err()
	})
	if err != nil {
		sendDBError(w, c.r, err, "Could not load the meeting state.")
		return
	}
	if hands == nil {
		hands = []string{}
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"messages": messages, "raisedHands": hands, "reactions": reactions, "role": c.role})
}
