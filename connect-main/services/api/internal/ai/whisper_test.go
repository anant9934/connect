package ai

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTranscriber(t *testing.T) {
	var gotLang, gotModel, gotAuth string
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(4 << 20); err != nil {
			t.Fatal(err)
		}
		gotLang, gotModel, gotAuth = r.FormValue("language"), r.FormValue("model"), r.Header.Get("Authorization")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"text":"  aaj hum binary search padhenge  "}`))
	}))
	defer srv.Close()
	tr := NewTranscriberForTest(srv.URL, "gsk_test")
	text, err := tr.Transcribe(context.Background(), []byte("fake-audio"), "audio/webm;codecs=opus", "en-IN")
	if err != nil || text != "aaj hum binary search padhenge" {
		t.Fatalf("%q %v", text, err)
	}
	if gotLang != "" || gotModel != WhisperModel || gotAuth != "Bearer gsk_test" {
		t.Errorf("request: lang=%q model=%q auth=%q", gotLang, gotModel, gotAuth)
	}
	if _, err := tr.Transcribe(context.Background(), []byte("x"), "audio/webm", "hi-IN"); err != nil || gotLang != "hi" {
		t.Errorf("hindi: %q %v", gotLang, err)
	}
	status = http.StatusTooManyRequests
	if _, err := tr.Transcribe(context.Background(), []byte("x"), "audio/webm", "en-US"); !errors.Is(err, ErrProviderOverloaded) {
		t.Errorf("429: %v", err)
	}
	if _, err := tr.Transcribe(context.Background(), make([]byte, MaxWhisperAudioBytes+1), "audio/webm", "en-US"); !errors.Is(err, ErrPromptTooLarge) {
		t.Errorf("too large: %v", err)
	}
	var none *Transcriber
	if _, err := none.Transcribe(context.Background(), []byte("x"), "", ""); !errors.Is(err, ErrProviderNotConfigured) {
		t.Errorf("nil transcriber: %v", err)
	}
}
