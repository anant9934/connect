package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/model"
)

// maxMeetingTranscriptChars keeps one summary request inside the prompt size limit.
const maxMeetingTranscriptChars = 60000

var (
	errMeetingNotInOrg   = errors.New("this meeting does not belong to this institution")
	errNoMeetingMaterial = errors.New("this meeting has no transcript or questions to summarise")
)

// offsetLabel is MM:SS (or H:MM:SS) of at after base, or "" when at is before base.
func offsetLabel(at, base time.Time) string {
	d := at.Sub(base)
	if d < 0 {
		return ""
	}
	total := int(d.Seconds())
	h, m, s := total/3600, (total%3600)/60, total%60
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%02d:%02d", m, s)
}

type meetingLine struct {
	Speaker  string
	SpokenAt time.Time
	Text     string
}

type meetingDoubt struct {
	Question string
	Answer   *string
	Status   string
}

// buildMeetingTranscript writes the transcript with [MM:SS] times measured from the recording
// (or, without one, from the first line), then the Q&A list, within the size limit.
func buildMeetingTranscript(lines []meetingLine, doubts []meetingDoubt, recordingStart *time.Time) string {
	var b strings.Builder
	var base time.Time
	if recordingStart != nil {
		base = *recordingStart
	} else if len(lines) > 0 {
		base = lines[0].SpokenAt
	}
	for _, l := range lines {
		if label := offsetLabel(l.SpokenAt, base); label != "" {
			fmt.Fprintf(&b, "[%s] %s: %s\n", label, l.Speaker, l.Text)
		} else {
			fmt.Fprintf(&b, "%s: %s\n", l.Speaker, l.Text)
		}
		if b.Len() > maxMeetingTranscriptChars {
			break
		}
	}
	if len(doubts) > 0 {
		b.WriteString("\nQuestions from the class Q&A list:\n")
		for _, d := range doubts {
			answer := "(no answer recorded)"
			if d.Answer != nil && strings.TrimSpace(*d.Answer) != "" {
				answer = "Answer: " + strings.TrimSpace(*d.Answer)
			}
			fmt.Fprintf(&b, "- Q (%s): %s %s\n", d.Status, d.Question, answer)
		}
	}
	text := b.String()
	if len(text) > maxMeetingTranscriptChars {
		text = text[:maxMeetingTranscriptChars]
	}
	return strings.ToValidUTF8(text, "")
}

// summariseMeeting handles POST /organizations/{org}/ai/summaries/from-meeting: reads a class
// meeting's saved transcript and Q&A on the server and summarises it as faculty-only notes
// with MM:SS times. Reading, calling the model and saving are separate steps, so no database
// connection is held during the model call.
func (h *Handler) summariseMeeting(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RoomID     string `json:"roomId"`
		CourseCode string `json:"courseCode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Malformed JSON request body")
		return
	}
	roomID, err := uuid.Parse(req.RoomID)
	if err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "MISSING_FIELD", "roomId is required")
		return
	}

	var (
		lines     []meetingLine
		doubts    []meetingDoubt
		recStart  *time.Time
		sessionID *uuid.UUID
		title     string
		userID    string
		orgID     uuid.UUID
	)
	err = h.inOrg(r, func(tx pgx.Tx, auth *database.AuthContext, org uuid.UUID) error {
		if !h.isFacultyOrAdmin(auth) {
			return errUnauthorized
		}
		userID, orgID = auth.UserID, org
		var roomOrg *uuid.UUID
		if err := tx.QueryRow(r.Context(), `SELECT organization_id, class_session_id, COALESCE(title, public_code) FROM rooms WHERE id = $1`, roomID).Scan(&roomOrg, &sessionID, &title); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return errMeetingNotInOrg
			}
			return err
		}
		if roomOrg == nil || *roomOrg != org {
			return errMeetingNotInOrg
		}
		rows, err := tx.Query(r.Context(), `SELECT speaker_name, spoken_at, body FROM room_transcript_segments WHERE room_id = $1 ORDER BY spoken_at, seq LIMIT 5000`, roomID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var l meetingLine
			if err := rows.Scan(&l.Speaker, &l.SpokenAt, &l.Text); err != nil {
				rows.Close()
				return err
			}
			lines = append(lines, l)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		drows, err := tx.Query(r.Context(), `SELECT question, answer, status FROM meeting_doubts WHERE room_id = $1 ORDER BY created_at LIMIT 200`, roomID)
		if err != nil {
			return err
		}
		for drows.Next() {
			var d meetingDoubt
			if err := drows.Scan(&d.Question, &d.Answer, &d.Status); err != nil {
				drows.Close()
				return err
			}
			doubts = append(doubts, d)
		}
		drows.Close()
		if err := drows.Err(); err != nil {
			return err
		}
		err = tx.QueryRow(r.Context(), `SELECT started_at FROM room_recordings WHERE room_id = $1 ORDER BY started_at LIMIT 1`, roomID).Scan(&recStart)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	})
	if errors.Is(err, errMeetingNotInOrg) {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", errMeetingNotInOrg.Error())
		return
	}
	if err != nil {
		h.handleError(w, r, err)
		return
	}
	if len(lines) == 0 && len(doubts) == 0 {
		model.SendJSONError(w, r, http.StatusUnprocessableEntity, "NO_TRANSCRIPT", errNoMeetingMaterial.Error()+". Turn on captions during class.")
		return
	}

	courseCode := strings.TrimSpace(req.CourseCode)
	if courseCode == "" {
		courseCode = title
	}
	full := buildMeetingTranscript(lines, doubts, recStart)
	var (
		summary *LectureSummary
		usage   *Usage
	)
	if len(full) > chunkThresholdChars && len(lines) > 0 {
		// Long class: summarise ten-minute windows, then merge. Times stay measured from the
		// recording (or the first line), so they still link to the right moment.
		base := lines[0].SpokenAt
		if recStart != nil {
			base = *recStart
		}
		var texts []string
		for _, chunk := range chunkLines(lines) {
			texts = append(texts, buildMeetingTranscript(chunk, nil, &base))
		}
		summary, usage, err = h.service.SummarizeLongLecture(r.Context(), orgID.String(), userID, courseCode, texts, buildMeetingTranscript(nil, doubts, nil))
	} else {
		summary, usage, err = h.service.SummarizeLecture(r.Context(), orgID.String(), userID, courseCode, full)
	}
	if err != nil {
		h.handleError(w, r, err)
		return
	}
	summary.Source = &SummarySource{RoomID: roomID.String(), RecordingStartedAt: recStart}
	content, err := json.Marshal(summary)
	if err != nil {
		h.handleError(w, r, err)
		return
	}

	err = h.inOrg(r, func(tx pgx.Tx, auth *database.AuthContext, org uuid.UUID) error {
		userUUID, err := uuid.Parse(auth.UserID)
		if err != nil {
			return errUnauthenticated
		}
		artifact := &Artifact{
			ID: uuid.New(), OrganizationID: org, SessionID: sessionID, CreatorUserID: userUUID,
			ArtifactType: "lecture_summary", Title: summary.Title, Content: content, Visibility: "faculty_only",
		}
		if err := h.repo.CreateArtifact(r.Context(), tx, artifact); err != nil {
			return err
		}
		if err := h.recordUsage(r.Context(), tx, org, userUUID, nil, nil, sessionID, "lecture_summary", usage); err != nil {
			return err
		}
		model.SendJSON(w, http.StatusOK, map[string]any{"artifact": artifact, "summary": summary, "usage": usage})
		return nil
	})
	if err != nil {
		h.handleError(w, r, err)
	}
}

// updateArtifact handles PUT /organizations/{org}/ai/artifacts/{id}: faculty edit generated notes,
// quizzes or flashcards before publishing. The content is validated like model output, and an
// edit to published material takes it back to review.
func (h *Handler) updateArtifact(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_ID", "Invalid artifact UUID")
		return
	}
	var req struct {
		Title   string          `json:"title"`
		Content json.RawMessage `json:"content"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 512<<10)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Content) == 0 {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "title and content are required")
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" || len([]rune(title)) > 200 {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "A title of 1 to 200 characters is required.")
		return
	}
	err = h.inOrg(r, func(tx pgx.Tx, auth *database.AuthContext, org uuid.UUID) error {
		if !h.isFacultyOrAdmin(auth) {
			return errUnauthorized
		}
		existing, err := h.repo.GetArtifact(r.Context(), tx, org, id)
		if err != nil {
			return err
		}
		clean, err := h.validateEdited(existing, req.Content)
		if err != nil {
			return err
		}
		tag, err := tx.Exec(r.Context(), `
			UPDATE ai_artifacts SET title = $1, content = $2::jsonb, human_reviewed = false,
			       visibility = CASE WHEN visibility = 'published' THEN 'faculty_only' ELSE visibility END,
			       updated_at = clock_timestamp()
			WHERE organization_id = $3 AND id = $4`, title, string(clean), org, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrArtifactNotFound
		}
		model.SendJSON(w, http.StatusOK, map[string]any{"status": "updated", "artifactId": id})
		return nil
	})
	if err != nil {
		h.handleError(w, r, err)
	}
}

// validateEdited checks edited content against its artifact type. A summary keeps its source.
func (h *Handler) validateEdited(existing *Artifact, content json.RawMessage) ([]byte, error) {
	v := NewValidator()
	switch existing.ArtifactType {
	case "lecture_summary":
		s, err := v.ValidateLectureSummary(string(content))
		if err != nil {
			return nil, err
		}
		var old LectureSummary
		if json.Unmarshal(existing.Content, &old) == nil {
			s.Source = old.Source
		}
		return json.Marshal(s)
	case "practice_quiz":
		q, err := v.ValidatePracticeQuiz(string(content))
		if err != nil {
			return nil, err
		}
		return json.Marshal(q)
	case "flashcard_deck":
		f, err := v.ValidateFlashcards(string(content))
		if err != nil {
			return nil, err
		}
		return json.Marshal(f)
	}
	return nil, ErrInvalidStructuredOutput
}
