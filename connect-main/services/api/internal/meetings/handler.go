// Package meetings serves meeting history search and detail. What each person may see is decided
// by connect_auth.visible_meetings, not by anything in the request.
package meetings

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/model"
)

const (
	defaultPageSize = 20
	maxPageSize     = 100
	maxOffset       = 10000
	maxQueryLength  = 100
)

var (
	allowedStatuses = map[string]bool{"scheduled": true, "active": true, "ended": true, "cancelled": true, "created": true}
	allowedSorts    = map[string]bool{"newest": true, "oldest": true, "title": true}
)

// Handler serves the routes.
type Handler struct {
	pool *pgxpool.Pool
}

// NewHandler constructs the handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

// RegisterRoutes mounts the routes. The caller applies session authentication.
func (h *Handler) RegisterRoutes(r chi.Router) {
	r.Get("/meetings", h.search)
	r.Get("/meetings/{id}", h.detail)
}

// Item is one row of search results.
type Item struct {
	ID               string     `json:"id"`
	PublicCode       string     `json:"publicCode"`
	Title            *string    `json:"title"`
	Status           string     `json:"status"`
	MeetingAt        time.Time  `json:"meetingAt"`
	EndedAt          *time.Time `json:"endedAt"`
	HostName         string     `json:"hostName"`
	Access           string     `json:"access"`
	CourseTitle      *string    `json:"courseTitle"`
	OrganizationID   *string    `json:"organizationId"`
	OrganizationName *string    `json:"organizationName"`
	ParticipantCount *int64     `json:"participantCount"`
}

type searchParams struct {
	query                          *string
	statuses                       []string
	from, to                       *time.Time
	host, participant, course, org *string
	sort                           string
	limit, offset                  int
}

func optionalUUID(values map[string][]string, name string) (*string, string) {
	raw := strings.TrimSpace(first(values, name))
	if raw == "" {
		return nil, ""
	}
	if _, err := uuid.Parse(raw); err != nil {
		return nil, name + " must be a valid id."
	}
	return &raw, ""
}

func first(values map[string][]string, name string) string {
	if list := values[name]; len(list) > 0 {
		return list[0]
	}
	return ""
}

func optionalTime(values map[string][]string, name string) (*time.Time, string) {
	raw := strings.TrimSpace(first(values, name))
	if raw == "" {
		return nil, ""
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, name + " must be an RFC 3339 time with a zone."
	}
	return &parsed, ""
}

// parseSearch validates every input, returning a message for the first problem.
func parseSearch(values map[string][]string) (searchParams, string) {
	p := searchParams{sort: "newest", limit: defaultPageSize}
	if query := strings.TrimSpace(first(values, "q")); query != "" {
		if utf8.RuneCountInString(query) > maxQueryLength || !utf8.ValidString(query) || strings.ContainsRune(query, 0) {
			return p, "A search can have at most 100 characters."
		}
		p.query = &query
	}
	if raw := first(values, "status"); raw != "" {
		for _, status := range strings.Split(raw, ",") {
			status = strings.TrimSpace(status)
			if !allowedStatuses[status] {
				return p, "status is not recognized."
			}
			p.statuses = append(p.statuses, status)
		}
	}
	var msg string
	if p.from, msg = optionalTime(values, "from"); msg != "" {
		return p, msg
	}
	if p.to, msg = optionalTime(values, "to"); msg != "" {
		return p, msg
	}
	if p.from != nil && p.to != nil && !p.to.After(*p.from) {
		return p, "to must be after from."
	}
	if p.host, msg = optionalUUID(values, "host"); msg != "" {
		return p, msg
	}
	if p.participant, msg = optionalUUID(values, "participant"); msg != "" {
		return p, msg
	}
	if p.course, msg = optionalUUID(values, "course"); msg != "" {
		return p, msg
	}
	if p.org, msg = optionalUUID(values, "organization"); msg != "" {
		return p, msg
	}
	if raw := first(values, "sort"); raw != "" {
		if !allowedSorts[raw] {
			return p, "sort is not recognized."
		}
		p.sort = raw
	}
	if raw := first(values, "limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			return p, "limit must be a positive number."
		}
		p.limit = min(parsed, maxPageSize)
	}
	if raw := first(values, "offset"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 || parsed > maxOffset {
			return p, "offset must be between 0 and 10000."
		}
		p.offset = parsed
	}
	return p, ""
}

func (h *Handler) search(w http.ResponseWriter, r *http.Request) {
	params, msg := parseSearch(r.URL.Query())
	if msg != "" {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_SEARCH", msg)
		return
	}
	var items []Item
	var total int64
	err := database.WithAuthContext(r.Context(), h.pool, database.SessionTokenHash(r.Context()), nil, func(tx pgx.Tx, _ *database.AuthContext) error {
		var err error
		if items, total, err = runSearch(r.Context(), tx, params); err != nil {
			return err
		}
		// Rows carry the total, so a page past the end still has to learn it.
		if len(items) == 0 && params.offset > 0 {
			first := params
			first.limit, first.offset = 1, 0
			_, total, err = runSearch(r.Context(), tx, first)
		}
		return err
	})
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not search meetings.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"meetings": items, "total": total, "limit": params.limit, "offset": params.offset})
}

func runSearch(ctx context.Context, tx pgx.Tx, params searchParams) ([]Item, int64, error) {
	rows, err := tx.Query(ctx, `
		SELECT id::text, public_code, title, status, meeting_at, ended_at, host_name, access, course_title,
		       organization_id::text, organization_name, participant_count, total
		FROM connect_auth.search_meetings($1, $2::text[], $3, $4, $5::uuid, $6::uuid, $7::uuid, $8::uuid, $9, $10, $11)
	`, params.query, params.statuses, params.from, params.to, params.host, params.participant, params.course, params.org, params.sort, params.limit, params.offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := []Item{}
	var total int64
	for rows.Next() {
		var item Item
		if err := rows.Scan(&item.ID, &item.PublicCode, &item.Title, &item.Status, &item.MeetingAt, &item.EndedAt, &item.HostName, &item.Access,
			&item.CourseTitle, &item.OrganizationID, &item.OrganizationName, &item.ParticipantCount, &total); err != nil {
			return nil, 0, err
		}
		items = append(items, item)
	}
	return items, total, rows.Err()
}

// detail reports a meeting the caller may not see as not found, so ids cannot be probed.
func (h *Handler) detail(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := uuid.Parse(id); err != nil {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "This meeting is unavailable.")
		return
	}
	var raw, attendance []byte
	err := database.WithAuthContext(r.Context(), h.pool, database.SessionTokenHash(r.Context()), nil, func(tx pgx.Tx, _ *database.AuthContext) error {
		return tx.QueryRow(r.Context(), `SELECT connect_auth.meeting_detail($1::UUID), connect_auth.my_attendance_detail($1::UUID)`, id).Scan(&raw, &attendance)
	})
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load this meeting.")
		return
	}
	if raw == nil {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "This meeting is unavailable.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"meeting": json.RawMessage(raw), "attendance": json.RawMessage(attendance)})
}
