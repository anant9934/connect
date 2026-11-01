package audit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// EventType enumerates security audit event identifiers.
type EventType string

const (
	EventLoginSuccess     EventType = "auth.login_success"
	EventLoginFailure     EventType = "auth.login_failure"
	EventLogout           EventType = "auth.logout"
	EventSignupSuccess    EventType = "auth.signup_success"
	EventRoomCreated      EventType = "room.created"
	EventRoomJoined       EventType = "room.joined"
	EventRoomJoinDenied   EventType = "room.join_denied"
	EventRoomLocked       EventType = "room.locked"
	EventRoomUnlocked     EventType = "room.unlocked"
	EventRoomEnded        EventType = "room.ended"
	EventHostActionDenied EventType = "room.host_action_denied"
	EventTokenIssued      EventType = "room.token_issued"
)

// Service records security audit events safely to structured logs and database.
type Service struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
}

// NewService constructs the audit service.
func NewService(pool *pgxpool.Pool, logger *slog.Logger) *Service {
	return &Service{
		pool:   pool,
		logger: logger,
	}
}

// AuditParams holds safe non-sensitive attributes for auditing.
type AuditParams struct {
	EventType EventType
	Severity  string // INFO, WARN, CRITICAL
	ActorID   string // user UUID or guest UUID, empty if unauthenticated
	RoomID    string // internal room UUID, NEVER public invite codes
	ClientIP  string
	RequestID string
	Metadata  map[string]any
}

// Record logs the event in structured JSON logs and records to PostgreSQL if available.
func (s *Service) Record(ctx context.Context, params AuditParams) {
	if params.Severity == "" {
		params.Severity = "INFO"
	}

	ipHash := ""
	if params.ClientIP != "" {
		h := sha256.Sum256([]byte(params.ClientIP))
		ipHash = hex.EncodeToString(h[:8]) // 64-bit truncated hash for privacy
	}

	// Structured application logging (always works even if DB is unavailable)
	logAttrs := []any{
		slog.String("event_type", string(params.EventType)),
		slog.String("severity", params.Severity),
		slog.String("request_id", params.RequestID),
		slog.String("ip_hash", ipHash),
		slog.String("timestamp", time.Now().UTC().Format(time.RFC3339)),
	}
	if params.ActorID != "" {
		logAttrs = append(logAttrs, slog.String("actor_id", params.ActorID))
	}
	if params.RoomID != "" {
		logAttrs = append(logAttrs, slog.String("room_id", params.RoomID))
	}

	switch params.Severity {
	case "WARN":
		s.logger.Warn("security_audit_event", logAttrs...)
	case "CRITICAL":
		s.logger.Error("security_audit_event", logAttrs...)
	default:
		s.logger.Info("security_audit_event", logAttrs...)
	}

	// Persist to database asynchronously if pool is initialized
	if s.pool != nil {
		// #nosec G118 -- detached audit persistence must outlive client HTTP connection
		go func() {
			metadata := make(map[string]any, len(params.Metadata)+1)
			for k, v := range params.Metadata {
				metadata[k] = v
			}
			if params.RoomID != "" {
				metadata["room_id"] = params.RoomID
			}
			metaBytes, _ := json.Marshal(metadata)
			if metaBytes == nil {
				metaBytes = []byte("{}")
			}
			query := `
				INSERT INTO security_audit_events (event_type, severity, actor_id, ip_hash, metadata)
				VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), $5::jsonb)
			`
			insertCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
			defer cancel()
			if _, err := s.pool.Exec(insertCtx, query, string(params.EventType), params.Severity, params.ActorID, ipHash, string(metaBytes)); err != nil {
				s.logger.Error("security_audit_persist_failed", slog.String("event_type", string(params.EventType)), slog.String("error", err.Error()))
			}
		}()
	}
}

// ExtractIP pulls the remote IP address from the request.
func ExtractIP(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}
