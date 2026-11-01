package attendance

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	lkauth "github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	"github.com/livekit/protocol/webhook"
	"google.golang.org/protobuf/encoding/protojson"
)

const (
	testAPIKey    = "test_key"
	testAPISecret = "test_secret_that_is_long_enough_for_signing"
)

type fakeStore struct {
	events []SessionEvent
	err    error
}

func (f *fakeStore) Apply(_ context.Context, ev SessionEvent) error {
	f.events = append(f.events, ev)
	return f.err
}

func signedRequest(t *testing.T, event *livekit.WebhookEvent, secret string) *http.Request {
	t.Helper()
	body, err := protojson.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(body)
	token, err := lkauth.NewAccessToken(testAPIKey, secret).
		SetValidFor(time.Minute).
		SetSha256(base64.StdEncoding.EncodeToString(sum[:])).
		ToJWT()
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/livekit/webhook", strings.NewReader(string(body)))
	req.Header.Set("Authorization", token)
	req.Header.Set("Content-Type", "application/webhook+json")
	return req
}

func serve(store SessionStore, req *http.Request) int {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	rec := httptest.NewRecorder()
	NewWebhookHandler(testAPIKey, testAPISecret, store, logger).ServeHTTP(rec, req)
	return rec.Code
}

func leftEvent() *livekit.WebhookEvent {
	return &livekit.WebhookEvent{
		Id:        "EV_1",
		Event:     webhook.EventParticipantLeft,
		CreatedAt: 1_800_000_100,
		Room:      &livekit.Room{Name: "abc-defg-hij"},
		Participant: &livekit.ParticipantInfo{
			Sid:      "PA_1",
			Identity: "user:11111111-1111-1111-1111-111111111111",
			JoinedAt: 1_800_000_000,
		},
	}
}

func TestWebhook_AppliesVerifiedParticipantEvent(t *testing.T) {
	store := &fakeStore{}
	if code := serve(store, signedRequest(t, leftEvent(), testAPISecret)); code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
	if len(store.events) != 1 {
		t.Fatalf("expected one event, got %d", len(store.events))
	}
	ev := store.events[0]
	if ev.ParticipantSID != "PA_1" || ev.RoomName != "abc-defg-hij" || ev.JoinedAt.Unix() != 1_800_000_000 || ev.OccurredAt.Unix() != 1_800_000_100 {
		t.Fatalf("unexpected event: %+v", ev)
	}
}

func TestWebhook_RejectsForgedSignature(t *testing.T) {
	store := &fakeStore{}
	code := serve(store, signedRequest(t, leftEvent(), "attacker_secret_that_is_long_enough_for_signing"))
	if code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", code)
	}
	if len(store.events) != 0 {
		t.Fatal("forged event reached the store")
	}
}

func TestWebhook_RejectsTamperedBody(t *testing.T) {
	store := &fakeStore{}
	req := signedRequest(t, leftEvent(), testAPISecret)
	req.Body = io.NopCloser(strings.NewReader(`{"id":"EV_1","event":"participant_left"}`))
	if code := serve(store, req); code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", code)
	}
	if len(store.events) != 0 {
		t.Fatal("tampered event reached the store")
	}
}

func TestWebhook_IgnoresIrrelevantEvents(t *testing.T) {
	store := &fakeStore{}
	event := &livekit.WebhookEvent{Id: "EV_2", Event: webhook.EventTrackPublished, Room: &livekit.Room{Name: "abc"}}
	if code := serve(store, signedRequest(t, event, testAPISecret)); code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
	if len(store.events) != 0 {
		t.Fatal("irrelevant event reached the store")
	}
}

func TestWebhook_StoreFailureRequestsRedelivery(t *testing.T) {
	store := &fakeStore{err: errors.New("database unavailable")}
	if code := serve(store, signedRequest(t, leftEvent(), testAPISecret)); code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", code)
	}
}

func TestWebhook_UnknownRoomIsAcknowledged(t *testing.T) {
	store := &fakeStore{err: ErrUnknownRoom}
	if code := serve(store, signedRequest(t, leftEvent(), testAPISecret)); code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
}

func TestUserIDFromIdentity(t *testing.T) {
	if id := userIDFromIdentity("user:abc"); id == nil || *id != "abc" {
		t.Fatalf("unexpected id: %v", id)
	}
	if id := userIDFromIdentity("guest:abc"); id != nil {
		t.Fatalf("guest must have no user id, got %v", *id)
	}
}
