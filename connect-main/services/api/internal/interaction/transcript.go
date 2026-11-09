package interaction

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/tathastu/connect/services/api/internal/ai"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/model"
)

const (
	maxSegmentsPerPost   = 20
	maxSegmentChars      = 1000
	voiceContextWindow   = 3 * time.Minute
	maxVoiceContextChars = 4000
	maxRecordingMarkers  = 1000
)

var transcriptLangs = map[string]bool{"en-IN": true, "hi-IN": true, "en-US": true}

// Segment is one finished line of the live transcript.
type Segment struct {
	Seq         int64     `json:"seq"`
	Speaker     string    `json:"speaker"`
	SpeakerName string    `json:"speakerName"`
	SpokenAt    time.Time `json:"spokenAt"`
	Text        string    `json:"text"`
	Lang        string    `json:"lang"`
	Source      string    `json:"source"`
}

// NewSegment is a segment as the host's browser sends it.
type NewSegment struct {
	ClientID string    `json:"clientId"`
	SpokenAt time.Time `json:"spokenAt"`
	Text     string    `json:"text"`
	Lang     string    `json:"lang"`
}

func cleanSegmentText(s string) string {
	s = strings.Join(strings.Fields(strings.ToValidUTF8(s, "")), " ")
	if utf8.RuneCountInString(s) > maxSegmentChars {
		s = string([]rune(s)[:maxSegmentChars])
	}
	return s
}

func (h *Handler) addSegments(ctx context.Context, tx pgx.Tx, roomID, source string, segments []NewSegment) error {
	for _, seg := range segments {
		if _, err := tx.Exec(ctx, `SELECT connect_auth.transcript_add($1::UUID, $2, $3, $4, $5, $6)`,
			roomID, seg.ClientID, seg.SpokenAt, seg.Text, seg.Lang, source); err != nil {
			return err
		}
	}
	return nil
}

// PostTranscript handles POST /rooms/{code}/transcript: finished segments from the host's
// browser speech recognition. Host or co-host only; retries with the same client id are ignored.
func (h *Handler) PostTranscript(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var req struct {
		Segments []NewSegment `json:"segments"`
	}
	c.r.Body = http.MaxBytesReader(w, c.r.Body, 64<<10)
	if !decodeStrict(c.r, &req) || len(req.Segments) == 0 || len(req.Segments) > maxSegmentsPerPost {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Send 1 to 20 transcript segments.")
		return
	}
	for i := range req.Segments {
		s := &req.Segments[i]
		s.Text = cleanSegmentText(s.Text)
		if !clientMessageIDPattern.MatchString(s.ClientID) || !transcriptLangs[s.Lang] || s.Text == "" {
			model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_SEGMENT", "A transcript segment is not valid.")
			return
		}
	}
	if c.roomStatus != "active" {
		model.SendJSONError(w, c.r, http.StatusConflict, "MEETING_NOT_ACTIVE", "This meeting is not running.")
		return
	}
	if !h.allow(w, c, "transcript", 120, time.Minute) {
		return
	}
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		return h.addSegments(c.r.Context(), tx, c.roomID, "browser", req.Segments)
	})
	if err != nil {
		sendCanvasError(w, c.r, err, "Could not save the transcript.")
		return
	}
	model.SendJSON(w, http.StatusCreated, map[string]any{"saved": len(req.Segments)})
}

func readSegments(ctx context.Context, tx pgx.Tx, roomID string, since *time.Time, limit int) ([]Segment, error) {
	rows, err := tx.Query(ctx, `
		SELECT seq, speaker_identity, speaker_name, spoken_at, body, lang, source
		FROM room_transcript_segments
		WHERE room_id = $1 AND ($2::timestamptz IS NULL OR spoken_at >= $2)
		ORDER BY spoken_at, seq LIMIT $3`, roomID, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Segment{}
	for rows.Next() {
		var s Segment
		if err := rows.Scan(&s.Seq, &s.Speaker, &s.SpeakerName, &s.SpokenAt, &s.Text, &s.Lang, &s.Source); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ListTranscript handles GET /rooms/{code}/transcript?sinceSeconds=N.
func (h *Handler) ListTranscript(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var since *time.Time
	if raw := c.r.URL.Query().Get("sinceSeconds"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 8*3600 {
			model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_QUERY", "sinceSeconds must be 1 to 28800.")
			return
		}
		t := time.Now().Add(-time.Duration(n) * time.Second)
		since = &t
	}
	var segments []Segment
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		var err error
		segments, err = readSegments(c.r.Context(), tx, c.roomID, since, 2000)
		return err
	})
	if err != nil {
		sendCanvasError(w, c.r, err, "Could not load the transcript.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"segments": segments})
}

// recentVoiceContext returns the last few minutes of transcript as plain text, for live slides.
func (h *Handler) recentVoiceContext(ctx context.Context, roomID string) (string, error) {
	var segments []Segment
	since := time.Now().Add(-voiceContextWindow)
	err := database.InCallerContext(ctx, h.pool, roomID, func(tx pgx.Tx) error {
		var err error
		segments, err = readSegments(ctx, tx, roomID, &since, 400)
		return err
	})
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for _, s := range segments {
		b.WriteString(s.Text)
		b.WriteString("\n")
	}
	text := b.String()
	if runes := []rune(text); len(runes) > maxVoiceContextChars {
		text = string(runes[len(runes)-maxVoiceContextChars:]) // keep the most recent words
	}
	return strings.TrimSpace(text), nil
}

// Marker is a point in a local recording: a slide change, a transcript line or a note.
type Marker struct {
	AtMs  int64  `json:"atMs"`
	Kind  string `json:"kind"`
	Label string `json:"label"`
}

// SaveRecording handles POST /rooms/{code}/recordings: metadata for a recording made in the
// host's browser. The video file stays with the host; only times and markers are stored.
func (h *Handler) SaveRecording(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	var req struct {
		StartedAt time.Time `json:"startedAt"`
		EndedAt   time.Time `json:"endedAt"`
		FileName  string    `json:"fileName"`
		Markers   []Marker  `json:"markers"`
	}
	c.r.Body = http.MaxBytesReader(w, c.r.Body, 512<<10)
	if !decodeStrict(c.r, &req) || !req.EndedAt.After(req.StartedAt) || req.EndedAt.Sub(req.StartedAt) > 8*time.Hour || len(req.Markers) > maxRecordingMarkers {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Invalid recording.")
		return
	}
	req.FileName = strings.TrimSpace(req.FileName)
	if req.FileName == "" || utf8.RuneCountInString(req.FileName) > 200 {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "A file name of up to 200 characters is required.")
		return
	}
	duration := req.EndedAt.Sub(req.StartedAt).Milliseconds()
	markers := make([]Marker, 0, len(req.Markers))
	for _, m := range req.Markers {
		if (m.Kind != "slide" && m.Kind != "transcript" && m.Kind != "note") || m.AtMs < 0 || m.AtMs > duration {
			continue
		}
		label := cleanSegmentText(m.Label)
		if utf8.RuneCountInString(label) > 300 {
			label = string([]rune(label)[:300])
		}
		if label != "" {
			markers = append(markers, Marker{m.AtMs, m.Kind, label})
		}
	}
	if !h.allow(w, c, "recording", 20, time.Minute) {
		return
	}
	encoded, _ := json.Marshal(markers)
	var id string
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		return tx.QueryRow(c.r.Context(), `SELECT connect_auth.recording_save($1::UUID, $2, $3, $4, $5::jsonb)::text`,
			c.roomID, req.StartedAt, req.EndedAt, req.FileName, string(encoded)).Scan(&id)
	})
	if err != nil {
		sendCanvasError(w, c.r, err, "Could not save the recording.")
		return
	}
	model.SendJSON(w, http.StatusCreated, map[string]any{"id": id, "markers": len(markers)})
}

// SpeechTranscriber turns an audio chunk into text. *ai.Transcriber implements it.
type SpeechTranscriber interface {
	Transcribe(ctx context.Context, audio []byte, contentType, lang string) (string, error)
}

// SetTranscriber enables the Whisper fallback for browsers without speech recognition.
func (h *Handler) SetTranscriber(t SpeechTranscriber) {
	h.transcriber = t
}

// whisperDailyLimit keeps the shared free Groq quota from running out in one day.
const whisperDailyLimit = 1500

// PostTranscriptAudio handles POST /rooms/{code}/transcript/audio: a few seconds of the host's
// speech, transcribed by the free Whisper fallback and stored as a segment. Permission is
// checked before the provider is called, so nobody else can spend the shared quota.
func (h *Handler) PostTranscriptAudio(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	c.r.Body = http.MaxBytesReader(w, c.r.Body, ai.MaxWhisperAudioBytes+(64<<10))
	if err := c.r.ParseMultipartForm(ai.MaxWhisperAudioBytes); err != nil {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Send up to 2 MB of audio.")
		return
	}
	lang, clientID := c.r.FormValue("lang"), c.r.FormValue("clientId")
	spokenAt, err := time.Parse(time.RFC3339Nano, c.r.FormValue("spokenAt"))
	if err != nil {
		spokenAt = time.Now()
	}
	file, header, err := c.r.FormFile("audio")
	if err != nil || !transcriptLangs[lang] || !clientMessageIDPattern.MatchString(clientID) {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Audio, a language and a client id are required.")
		return
	}
	defer file.Close()
	audio, err := io.ReadAll(io.LimitReader(file, ai.MaxWhisperAudioBytes+1))
	if err != nil || len(audio) == 0 || len(audio) > ai.MaxWhisperAudioBytes {
		model.SendJSONError(w, c.r, http.StatusBadRequest, "INVALID_PAYLOAD", "Send up to 2 MB of audio.")
		return
	}
	var canManage bool
	err = database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		return tx.QueryRow(c.r.Context(), `SELECT connect_auth.can_announce($1::UUID)`, c.roomID).Scan(&canManage)
	})
	if err != nil || !canManage {
		model.SendJSONError(w, c.r, http.StatusForbidden, "FORBIDDEN", "Only the host or a co-host can add to the transcript.")
		return
	}
	if h.transcriber == nil {
		ai.WriteError(w, c.r, ai.ErrProviderNotConfigured)
		return
	}
	if !h.allow(w, c, "whisper", 30, time.Minute) {
		return
	}
	if h.limiter != nil {
		if allowed, err := h.limiter.Allow(c.r.Context(), "interaction:whisper:day", whisperDailyLimit, 24*time.Hour); err != nil || !allowed {
			ai.WriteError(w, c.r, ai.ErrProviderQuotaExhausted)
			return
		}
	}
	text, err := h.transcriber.Transcribe(c.r.Context(), audio, header.Header.Get("Content-Type"), lang)
	if err != nil {
		ai.WriteError(w, c.r, err)
		return
	}
	text = cleanSegmentText(text)
	if text == "" {
		model.SendJSON(w, http.StatusOK, map[string]any{"text": ""})
		return
	}
	err = database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		return h.addSegments(c.r.Context(), tx, c.roomID, "whisper", []NewSegment{{ClientID: clientID, SpokenAt: spokenAt, Text: text, Lang: lang}})
	})
	if err != nil {
		sendCanvasError(w, c.r, err, "Could not save the transcript.")
		return
	}
	model.SendJSON(w, http.StatusCreated, map[string]any{"text": text})
}
