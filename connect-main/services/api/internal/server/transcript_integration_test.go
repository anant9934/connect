package server_test

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/interaction"
	"github.com/tathastu/connect/services/api/internal/room"
)

// contextGenerator records the lecture context it receives.
type contextGenerator struct {
	fakeGenerator
	lastContext string
}

func (g *contextGenerator) GenerateLiveSlides(ctx context.Context, b, u, p, lectureContext string) (json.RawMessage, int, error) {
	g.lastContext = lectureContext
	content, n, err := g.fakeGenerator.GenerateLiveSlides(ctx, b, u, p, lectureContext)
	return content, n, err
}

// TestWorkflowDB_TranscriptAndRecordings adds captions as the host, uses them as slide context,
// saves a local recording's markers, and reads both back from meeting history.
func TestWorkflowDB_TranscriptAndRecordings(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	dsn := os.Getenv("TEST_CONNECT_APP_URL")
	if dsn == "" || os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("NOT VERIFIED: TEST_DATABASE_URL and TEST_CONNECT_APP_URL are required")
	}
	app, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Close)
	room.SetGuestTokenSecret([]byte("transcript-integration-secret-0123456"))
	t.Cleanup(room.ResetGuestTokenSecretForTest)
	gen := &contextGenerator{}
	api := apiClient{t: t, router: newRuntimeRouterWith(t, app, nil, func(h *interaction.Handler) { h.SetLiveGenerator(gen) })}
	_, hostToken := api.signup()
	_, memberToken := api.signup()
	_, strangerToken := api.signup()
	host, member, stranger := caller{token: hostToken}, caller{token: memberToken}, caller{token: strangerToken}
	res := api.want("create", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", host, map[string]any{})
	code, roomID := field(res, "room", "publicCode"), field(res, "room", "id")
	api.want("host joins", http.StatusOK, http.MethodPost, roomPath(code)+"/join", host, map[string]any{})
	api.want("member joins", http.StatusOK, http.MethodPost, roomPath(code)+"/join", member, map[string]any{})

	seg := func(id, text string) map[string]any {
		return map[string]any{"clientId": id, "spokenAt": time.Now().UTC().Format(time.RFC3339Nano), "text": text, "lang": "en-IN"}
	}
	post := func(name string, want int, who caller, segs ...map[string]any) {
		api.want(name, want, http.MethodPost, roomPath(code)+"/transcript", who, map[string]any{"segments": segs})
	}
	post("member cannot caption", http.StatusForbidden, member, seg("m1", "hello"))
	post("bad language", http.StatusBadRequest, host, map[string]any{"clientId": "x", "spokenAt": time.Now().UTC().Format(time.RFC3339), "text": "hi", "lang": "fr-FR"})
	post("host captions", http.StatusCreated, host, seg("s1", "Today we study binary search trees"), seg("s2", "Every left child is smaller"))
	post("retry is ignored", http.StatusCreated, host, seg("s1", "Today we study binary search trees"))
	if got := rowsOf(api.want("member reads live", http.StatusOK, http.MethodGet, roomPath(code)+"/transcript?sinceSeconds=600", member, nil), "segments"); len(got) != 2 {
		t.Fatalf("segments: %d", len(got))
	}
	api.want("stranger", http.StatusForbidden, http.MethodGet, roomPath(code)+"/transcript", stranger, nil)

	api.want("voice context", http.StatusCreated, http.MethodPost, roomPath(code)+"/canvas/generate", host, map[string]any{"kind": "slides", "prompt": "make slides", "useVoiceContext": true})
	if !strings.Contains(gen.lastContext, "Every left child is smaller") {
		t.Errorf("voice context missing: %q", gen.lastContext)
	}

	start := time.Now().Add(-2 * time.Minute).UTC()
	rec := map[string]any{"startedAt": start.Format(time.RFC3339), "endedAt": time.Now().UTC().Format(time.RFC3339), "fileName": "class.webm",
		"markers": []map[string]any{{"atMs": 1000, "kind": "slide", "label": "Slide 1"}, {"atMs": 5000, "kind": "transcript", "label": "Every left child is smaller"}, {"atMs": 99999999, "kind": "slide", "label": "dropped: past the end"}}}
	api.want("member cannot save recording", http.StatusForbidden, http.MethodPost, roomPath(code)+"/recordings", member, rec)
	saved := api.want("save recording", http.StatusCreated, http.MethodPost, roomPath(code)+"/recordings", host, rec)
	if saved["markers"] != 2.0 {
		t.Errorf("markers kept: %v", saved["markers"])
	}
	if got := rowsOf(api.want("member history recordings", http.StatusOK, http.MethodGet, "/api/v1/meetings/"+roomID+"/recordings", member, nil), "recordings"); len(got) != 1 {
		t.Errorf("recordings: %v", got)
	}
	if got := rowsOf(api.want("member history transcript", http.StatusOK, http.MethodGet, "/api/v1/meetings/"+roomID+"/transcript", member, nil), "segments"); len(got) != 2 {
		t.Errorf("history transcript: %d", len(got))
	}
	if got := rowsOf(api.want("stranger history", http.StatusOK, http.MethodGet, "/api/v1/meetings/"+roomID+"/transcript", stranger, nil), "segments"); len(got) != 0 {
		t.Errorf("stranger sees %d lines", len(got))
	}
}
