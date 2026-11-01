package attendance

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	lkauth "github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	"github.com/livekit/protocol/webhook"
	"github.com/tathastu/connect/services/api/internal/middleware"
)

func signRaw(t *testing.T, body []byte, secret string) string {
	t.Helper()
	sum := sha256.Sum256(body)
	token, err := lkauth.NewAccessToken(testAPIKey, secret).
		SetValidFor(time.Minute).
		SetSha256(base64.StdEncoding.EncodeToString(sum[:])).
		ToJWT()
	if err != nil {
		t.Fatal(err)
	}
	return token
}

// TestWorkflowDB_WebhookHTTPBoundary sends raw requests through the router and body limit
// to the real store running as connect_app, and asserts what reached the database.
func TestWorkflowDB_WebhookHTTPBoundary(t *testing.T) {
	adminURL, appURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_CONNECT_APP_URL")
	if adminURL == "" || appURL == "" {
		t.Skip("NOT VERIFIED: TEST_DATABASE_URL and TEST_CONNECT_APP_URL are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, adminURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	app, err := pgxpool.New(ctx, appURL)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()

	userID, code := uuid.NewString(), "hook-"+uuid.NewString()[:8]
	if _, err := admin.Exec(ctx, `INSERT INTO users (id, email_normalized, display_name, password_hash) VALUES ($1, $2, 'Hook', 'x')`, userID, code+"@example.test"); err != nil {
		t.Fatal(err)
	}
	var roomID string
	if err := admin.QueryRow(ctx, `INSERT INTO rooms (public_code, host_user_id, workspace_type) VALUES ($1, $2, 'personal_workspace') RETURNING id::text`, code, userID).Scan(&roomID); err != nil {
		t.Fatal(err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	r := chi.NewRouter()
	r.Use(middleware.BodySizeLimit(1 << 20))
	r.Use(middleware.RequireJSONContentType)
	r.Method(http.MethodPost, "/api/v1/livekit/webhook", NewWebhookHandler(testAPIKey, testAPISecret, NewPgxSessionStore(app), logger))

	post := func(body []byte, authorization string) int {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/livekit/webhook", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/webhook+json")
		if authorization != "" {
			req.Header.Set("Authorization", authorization)
		}
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec.Code
	}
	stored := func() (ledger, sessions int) {
		t.Helper()
		if err := admin.QueryRow(ctx, `SELECT count(*) FROM livekit_webhook_events WHERE room_name = $1`, code).Scan(&ledger); err != nil {
			t.Fatal(err)
		}
		if err := admin.QueryRow(ctx, `SELECT count(*) FROM participant_media_sessions WHERE room_id = $1`, roomID).Scan(&sessions); err != nil {
			t.Fatal(err)
		}
		return ledger, sessions
	}

	event := &livekit.WebhookEvent{
		Id: "EV_" + uuid.NewString(), Event: webhook.EventParticipantJoined, CreatedAt: 1_800_000_000,
		Room:        &livekit.Room{Name: code},
		Participant: &livekit.ParticipantInfo{Sid: "PA_" + code, Identity: "user:" + userID, JoinedAt: 1_800_000_000},
	}
	valid := signedRequest(t, event, testAPISecret)
	body, err := io.ReadAll(valid.Body)
	if err != nil {
		t.Fatal(err)
	}
	token := valid.Header.Get("Authorization")

	rejected := []struct {
		name          string
		body          []byte
		authorization string
		want          int
	}{
		{"missing signature", body, "", http.StatusUnauthorized},
		{"garbage signature", body, "not-a-jwt", http.StatusUnauthorized},
		{"wrong secret", body, signRaw(t, body, "attacker_secret_that_is_long_enough_for_signing"), http.StatusUnauthorized},
		{"tampered body", append([]byte(" "), body...), token, http.StatusUnauthorized},
		{"signed but malformed", []byte(`{not json`), signRaw(t, []byte(`{not json`), testAPISecret), http.StatusUnauthorized},
	}
	for _, c := range rejected {
		if got := post(c.body, c.authorization); got != c.want {
			t.Errorf("%s: expected %d, got %d", c.name, c.want, got)
		}
		if ledger, sessions := stored(); ledger != 0 || sessions != 0 {
			t.Fatalf("%s reached the database: ledger=%d sessions=%d", c.name, ledger, sessions)
		}
	}

	if got := post(body, token); got != http.StatusOK {
		t.Fatalf("valid event: got %d", got)
	}
	if ledger, sessions := stored(); ledger != 1 || sessions != 1 {
		t.Fatalf("valid event stored ledger=%d sessions=%d", ledger, sessions)
	}

	// A replay carries a valid signature, so it is acknowledged but changes nothing.
	if _, err := admin.Exec(ctx, `UPDATE participant_media_sessions SET identity = 'sentinel' WHERE room_id = $1`, roomID); err != nil {
		t.Fatal(err)
	}
	if got := post(body, token); got != http.StatusOK {
		t.Fatalf("replay: got %d", got)
	}
	var identity string
	if err := admin.QueryRow(ctx, `SELECT identity FROM participant_media_sessions WHERE room_id = $1`, roomID).Scan(&identity); err != nil {
		t.Fatal(err)
	}
	if ledger, sessions := stored(); ledger != 1 || sessions != 1 || identity != "sentinel" {
		t.Fatalf("replay changed state: ledger=%d sessions=%d identity=%s", ledger, sessions, identity)
	}
}
