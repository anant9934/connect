package institution

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/model"
)

const (
	auditDefaultPage = 50
	auditMaxPage     = 200
	auditMaxOffset   = 100000
)

// overview reports the state of the organization. The database limits it to its overseers.
func (h *Handler) overview(w http.ResponseWriter, r *http.Request) {
	var raw []byte
	err := h.inOrg(r, func(tx pgx.Tx, _ *database.AuthContext) error {
		return tx.QueryRow(r.Context(), `SELECT connect_auth.org_overview($1::UUID)`, chi.URLParam(r, "org")).Scan(&raw)
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"overview": json.RawMessage(raw)})
}

// AuditEvent is one entry of an organization's audit log.
type AuditEvent struct {
	ID         string    `json:"id"`
	EventType  string    `json:"eventType"`
	Severity   string    `json:"severity"`
	ActorName  *string   `json:"actorName"`
	TargetName *string   `json:"targetName"`
	Target     *string   `json:"target"`
	CreatedAt  time.Time `json:"createdAt"`
}

func auditTime(r *http.Request, name string) (*time.Time, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, invalid(name + " must be an RFC 3339 time with a zone.")
	}
	return &parsed, nil
}

func (h *Handler) auditLog(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	from, err := auditTime(r, "from")
	if err != nil {
		sendError(w, r, err)
		return
	}
	to, err := auditTime(r, "to")
	if err != nil {
		sendError(w, r, err)
		return
	}
	limit, offset := auditDefaultPage, 0
	if raw := values.Get("limit"); raw != "" {
		parsed, convErr := strconv.Atoi(raw)
		if convErr != nil || parsed < 1 {
			sendError(w, r, invalid("limit must be a positive number."))
			return
		}
		limit = min(parsed, auditMaxPage)
	}
	if raw := values.Get("offset"); raw != "" {
		parsed, convErr := strconv.Atoi(raw)
		if convErr != nil || parsed < 0 || parsed > auditMaxOffset {
			sendError(w, r, invalid("offset is out of range."))
			return
		}
		offset = parsed
	}
	var event *string
	if raw := strings.TrimSpace(values.Get("event")); raw != "" {
		if len(raw) > 64 {
			sendError(w, r, invalid("event is not recognized."))
			return
		}
		event = &raw
	}

	events := []AuditEvent{}
	var total int64
	err = h.inOrg(r, func(tx pgx.Tx, _ *database.AuthContext) error {
		rows, err := tx.Query(r.Context(), `
			SELECT id::text, event_type, severity, actor_name, target_name, target, created_at, total
			FROM connect_auth.org_audit_events($1::UUID, $2, $3, $4, $5, $6)
		`, chi.URLParam(r, "org"), event, from, to, limit, offset)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var e AuditEvent
			if err := rows.Scan(&e.ID, &e.EventType, &e.Severity, &e.ActorName, &e.TargetName, &e.Target, &e.CreatedAt, &total); err != nil {
				return err
			}
			events = append(events, e)
		}
		return rows.Err()
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"events": events, "total": total, "limit": limit, "offset": offset})
}
