package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
)

// WhisperModel is Groq's free-tier speech model.
const WhisperModel = "whisper-large-v3-turbo"

// MaxWhisperAudioBytes bounds one uploaded chunk of speech.
const MaxWhisperAudioBytes = 2 << 20

// Transcriber turns short audio chunks into text with Groq's Whisper. It is the fallback for
// browsers without built-in speech recognition.
type Transcriber struct {
	pool    *KeyPool
	client  *http.Client
	baseURL string
}

// NewGroqTranscriber returns nil when no Groq key is configured.
func NewGroqTranscriber(keys *KeyPoolManager) *Transcriber {
	pool := keys.GetKeyPool("groq")
	if pool == nil || pool.Size() == 0 {
		return nil
	}
	return &Transcriber{pool: pool, client: &http.Client{Timeout: 30 * time.Second}, baseURL: "https://api.groq.com/openai/v1"}
}

// NewTranscriberForTest points a transcriber at a test server.
func NewTranscriberForTest(baseURL string, keys ...string) *Transcriber {
	return &Transcriber{pool: NewKeyPool("groq", keys), client: &http.Client{Timeout: 5 * time.Second}, baseURL: baseURL}
}

// whisperLanguage maps a caption language to Whisper's. Indian English is left to detection,
// so Hinglish lectures that switch between English and Hindi are not forced into one.
func whisperLanguage(lang string) string {
	switch lang {
	case "hi-IN":
		return "hi"
	case "en-US":
		return "en"
	default:
		return ""
	}
}

// Transcribe sends one audio chunk and returns its text.
func (t *Transcriber) Transcribe(ctx context.Context, audio []byte, contentType, lang string) (string, error) {
	if t == nil {
		return "", ErrProviderNotConfigured
	}
	if len(audio) == 0 || len(audio) > MaxWhisperAudioBytes {
		return "", ErrPromptTooLarge
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	_ = form.WriteField("model", WhisperModel)
	_ = form.WriteField("response_format", "json")
	_ = form.WriteField("temperature", "0")
	if l := whisperLanguage(lang); l != "" {
		_ = form.WriteField("language", l)
	}
	ext := "webm"
	if strings.Contains(contentType, "ogg") {
		ext = "ogg"
	} else if strings.Contains(contentType, "mp4") || strings.Contains(contentType, "m4a") {
		ext = "m4a"
	} else if strings.Contains(contentType, "wav") {
		ext = "wav"
	}
	part, err := form.CreateFormFile("file", "chunk."+ext)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(audio); err != nil {
		return "", err
	}
	if err := form.Close(); err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.baseURL+"/audio/transcriptions", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+t.pool.NextKey())
	res, err := t.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return "", ErrProviderTimeout
		}
		return "", fmt.Errorf("%w: whisper request failed", ErrProviderUnavailable)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	switch {
	case res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden:
		return "", ErrUnauthorizedProvider
	case res.StatusCode == http.StatusTooManyRequests:
		return "", ErrProviderOverloaded
	case res.StatusCode == http.StatusRequestEntityTooLarge:
		return "", ErrPromptTooLarge
	case res.StatusCode >= 300:
		return "", fmt.Errorf("%w: whisper status %d", ErrProviderUnavailable, res.StatusCode)
	}
	var out struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("%w: whisper response", ErrInvalidStructuredOutput)
	}
	return strings.TrimSpace(out.Text), nil
}
