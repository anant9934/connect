package meetings

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/model"
)

type transcriptLine struct {
	SpeakerName string    `json:"speakerName"`
	SpokenAt    time.Time `json:"spokenAt"`
	Text        string    `json:"text"`
	Lang        string    `json:"lang"`
}

type recording struct {
	ID        string          `json:"id"`
	StartedAt time.Time       `json:"startedAt"`
	EndedAt   time.Time       `json:"endedAt"`
	FileName  string          `json:"fileName"`
	Markers   json.RawMessage `json:"markers"`
}

func (h *Handler) inMeeting(w http.ResponseWriter, r *http.Request, failure string, fn func(tx pgx.Tx, id string) error) bool {
	id := chi.URLParam(r, "id")
	if _, err := uuid.Parse(id); err != nil {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "This meeting is unavailable.")
		return false
	}
	err := database.WithAuthContext(r.Context(), h.pool, database.SessionTokenHash(r.Context()), nil, func(tx pgx.Tx, _ *database.AuthContext) error {
		return fn(tx, id)
	})
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", failure)
		return false
	}
	return true
}

// transcript handles GET /meetings/{id}/transcript. Row level security limits it to members.
func (h *Handler) transcript(w http.ResponseWriter, r *http.Request) {
	lines := []transcriptLine{}
	ok := h.inMeeting(w, r, "Could not load the transcript.", func(tx pgx.Tx, id string) error {
		rows, err := tx.Query(r.Context(), `
			SELECT speaker_name, spoken_at, body, lang FROM room_transcript_segments
			WHERE room_id = $1 ORDER BY spoken_at, seq LIMIT 5000`, id)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var l transcriptLine
			if err := rows.Scan(&l.SpeakerName, &l.SpokenAt, &l.Text, &l.Lang); err != nil {
				return err
			}
			lines = append(lines, l)
		}
		return rows.Err()
	})
	if ok {
		model.SendJSON(w, http.StatusOK, map[string]any{"segments": lines})
	}
}

// recordings handles GET /meetings/{id}/recordings: local recordings' times and markers.
func (h *Handler) recordings(w http.ResponseWriter, r *http.Request) {
	list := []recording{}
	ok := h.inMeeting(w, r, "Could not load the recordings.", func(tx pgx.Tx, id string) error {
		rows, err := tx.Query(r.Context(), `
			SELECT id::text, started_at, ended_at, file_name, markers FROM room_recordings
			WHERE room_id = $1 ORDER BY started_at DESC LIMIT 50`, id)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var rec recording
			var markers []byte
			if err := rows.Scan(&rec.ID, &rec.StartedAt, &rec.EndedAt, &rec.FileName, &markers); err != nil {
				return err
			}
			rec.Markers = markers
			list = append(list, rec)
		}
		return rows.Err()
	})
	if ok {
		model.SendJSON(w, http.StatusOK, map[string]any{"recordings": list})
	}
}

// pillars handles GET /meetings/{id}/pillars?student=&org=: one student's attendance as
// duration, engagement and focus. Without student it is the caller's own. Institution
// overseers pass org so their role there is checked; the database decides who may see whom.
func (h *Handler) pillars(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := uuid.Parse(id); err != nil {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "This meeting is unavailable.")
		return
	}
	student := r.URL.Query().Get("student")
	if student != "" {
		if _, err := uuid.Parse(student); err != nil {
			model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_QUERY", "Unknown student.")
			return
		}
	}
	var org *string
	if raw := r.URL.Query().Get("org"); raw != "" {
		if _, err := uuid.Parse(raw); err != nil {
			model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_QUERY", "Unknown organization.")
			return
		}
		org = &raw
	}
	var raw []byte
	err := database.WithAuthContext(r.Context(), h.pool, database.SessionTokenHash(r.Context()), org, func(tx pgx.Tx, auth *database.AuthContext) error {
		target := student
		if target == "" {
			target = auth.UserID
		}
		return tx.QueryRow(r.Context(), `SELECT connect_auth.attendance_pillars($1::UUID, $2::UUID)`, id, target).Scan(&raw)
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "42501" || errors.Is(err, database.ErrMembershipDenied) {
		model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You cannot see this attendance.")
		return
	}
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load the attendance.")
		return
	}
	if raw == nil {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "This meeting is unavailable.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"pillars": json.RawMessage(raw)})
}
