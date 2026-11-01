package attendance

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	lkauth "github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	"github.com/livekit/protocol/webhook"
	"github.com/tathastu/connect/services/api/internal/model"
)

// ErrUnknownRoom means the event refers to a room this service does not track.
var ErrUnknownRoom = errors.New("unknown room")

// SessionEvent is a signature-verified LiveKit event reduced to what attendance needs.
type SessionEvent struct {
	EventID        string
	EventType      string
	RoomName       string
	ParticipantSID string
	Identity       string
	JoinedAt       time.Time
	OccurredAt     time.Time
}

// SessionStore persists webhook events idempotently.
type SessionStore interface {
	Apply(ctx context.Context, ev SessionEvent) error
}

// WebhookHandler ingests signed LiveKit webhooks. Authentication is the signature,
// so the route carries neither session auth nor CSRF protection.
type WebhookHandler struct {
	keys   lkauth.KeyProvider
	store  SessionStore
	logger *slog.Logger
}

// NewWebhookHandler builds the handler using the LiveKit API credentials.
func NewWebhookHandler(apiKey, apiSecret string, store SessionStore, logger *slog.Logger) *WebhookHandler {
	return &WebhookHandler{keys: lkauth.NewSimpleKeyProvider(apiKey, apiSecret), store: store, logger: logger}
}

func (h *WebhookHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	event, err := webhook.ReceiveWebhookEvent(r, h.keys)
	if err != nil {
		h.logger.Warn("livekit_webhook_rejected", slog.String("error", err.Error()))
		model.SendJSONError(w, r, http.StatusUnauthorized, "INVALID_WEBHOOK_SIGNATURE", "Webhook could not be verified")
		return
	}

	ev, relevant := toSessionEvent(event)
	if !relevant {
		w.WriteHeader(http.StatusOK)
		return
	}

	if err := h.store.Apply(r.Context(), ev); err != nil {
		if errors.Is(err, ErrUnknownRoom) {
			// The event is authentic but untracked; redelivery cannot change that.
			h.logger.Warn("livekit_webhook_unknown_room", slog.String("room", ev.RoomName), slog.String("event", ev.EventType))
			w.WriteHeader(http.StatusOK)
			return
		}
		h.logger.Error("livekit_webhook_store_failed", slog.String("event", ev.EventType), slog.String("error", err.Error()))
		model.SendJSONError(w, r, http.StatusInternalServerError, "WEBHOOK_PROCESSING_FAILED", "Webhook could not be processed")
		return
	}
	w.WriteHeader(http.StatusOK)
}

func toSessionEvent(event *livekit.WebhookEvent) (SessionEvent, bool) {
	ev := SessionEvent{
		EventID:    event.GetId(),
		EventType:  event.GetEvent(),
		RoomName:   event.GetRoom().GetName(),
		OccurredAt: time.Unix(event.GetCreatedAt(), 0).UTC(),
	}
	if ev.EventID == "" || ev.RoomName == "" {
		return ev, false
	}

	switch ev.EventType {
	case webhook.EventParticipantJoined, webhook.EventParticipantLeft:
		p := event.GetParticipant()
		if p.GetSid() == "" || p.GetIdentity() == "" {
			return ev, false
		}
		ev.ParticipantSID = p.GetSid()
		ev.Identity = p.GetIdentity()
		ev.JoinedAt = time.Unix(p.GetJoinedAt(), 0).UTC()
		if p.GetJoinedAt() == 0 {
			ev.JoinedAt = ev.OccurredAt
		}
		return ev, true
	case webhook.EventRoomFinished:
		return ev, true
	}
	return ev, false
}

// hostSuccessionGraceSeconds gives a departed host time to reconnect before a co-host takes over.
const hostSuccessionGraceSeconds = 60

// PgxSessionStore implements SessionStore on PostgreSQL.
type PgxSessionStore struct {
	pool *pgxpool.Pool
}

// NewPgxSessionStore creates the PostgreSQL session store.
func NewPgxSessionStore(pool *pgxpool.Pool) *PgxSessionStore {
	return &PgxSessionStore{pool: pool}
}

// Apply records the ledger entry and session change in one transaction, so a redelivery
// after a failure reprocesses cleanly and a redelivery after success is a no-op.
func (s *PgxSessionStore) Apply(ctx context.Context, ev SessionEvent) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var roomID *string
	err = tx.QueryRow(ctx, `SELECT connect_auth.webhook_room_id($1)::text`, ev.RoomName).Scan(&roomID)
	if err == nil && roomID == nil {
		err = pgx.ErrNoRows
	}
	if errors.Is(err, pgx.ErrNoRows) {
		// Keep a durable trace of authentic events for rooms we do not track.
		if _, err := tx.Exec(ctx, `
			INSERT INTO livekit_webhook_events (event_id, event_type, room_name, outcome)
			VALUES ($1, $2, $3, 'unknown_room')
			ON CONFLICT (event_id) DO NOTHING
		`, ev.EventID, ev.EventType, ev.RoomName); err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		return ErrUnknownRoom
	}
	if err != nil {
		return err
	}

	tag, err := tx.Exec(ctx, `
		INSERT INTO livekit_webhook_events (event_id, event_type, room_name)
		VALUES ($1, $2, $3)
		ON CONFLICT (event_id) DO NOTHING
	`, ev.EventID, ev.EventType, ev.RoomName)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return nil
	}

	switch ev.EventType {
	case webhook.EventParticipantJoined:
		_, err = tx.Exec(ctx, `
			INSERT INTO participant_media_sessions (room_id, participant_sid, identity, user_id, joined_at)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (room_id, participant_sid) DO NOTHING
		`, *roomID, ev.ParticipantSID, ev.Identity, userIDFromIdentity(ev.Identity), ev.JoinedAt)
	case webhook.EventParticipantLeft:
		// Upsert because deliveries may arrive out of order or the join may have been lost.
		_, err = tx.Exec(ctx, `
			INSERT INTO participant_media_sessions (room_id, participant_sid, identity, user_id, joined_at, left_at)
			VALUES ($1, $2, $3, $4, $5::timestamptz, GREATEST($5::timestamptz, $6::timestamptz))
			ON CONFLICT (room_id, participant_sid) DO UPDATE
			SET left_at = GREATEST(participant_media_sessions.joined_at, EXCLUDED.left_at)
		`, *roomID, ev.ParticipantSID, ev.Identity, userIDFromIdentity(ev.Identity), ev.JoinedAt, ev.OccurredAt)
		if err == nil {
			// A crashed client never calls /leave, so this is how a vanished host is noticed.
			_, err = tx.Exec(ctx, `SELECT connect_auth.enqueue_host_succession($1::UUID, $2, $3)`, *roomID, ev.Identity, hostSuccessionGraceSeconds)
		}
	case webhook.EventRoomFinished:
		_, err = tx.Exec(ctx, `
			UPDATE participant_media_sessions
			SET left_at = GREATEST(joined_at, $2::timestamptz)
			WHERE room_id = $1 AND left_at IS NULL
		`, *roomID, ev.OccurredAt)
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// userIDFromIdentity extracts the user id from the server-minted identity; guests have none.
func userIDFromIdentity(identity string) *string {
	if id, ok := strings.CutPrefix(identity, "user:"); ok && id != "" {
		return &id
	}
	return nil
}
