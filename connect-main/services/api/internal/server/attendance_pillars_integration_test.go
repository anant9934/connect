package server_test

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestWorkflowDB_AttendancePillars reads the three pillars as the student, the host and a stranger.
func TestWorkflowDB_AttendancePillars(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
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
	api := apiClient{t: t, router: newRuntimeRouter(t, app, nil)}
	hostID, hostToken := api.signup()
	memberID, memberToken := api.signup()
	_, strangerToken := api.signup()
	host, member, stranger := caller{token: hostToken}, caller{token: memberToken}, caller{token: strangerToken}
	res := api.want("create", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", host, map[string]any{})
	code, roomID := field(res, "room", "publicCode"), field(res, "room", "id")
	api.want("host joins", http.StatusOK, http.MethodPost, roomPath(code)+"/join", host, map[string]any{})
	api.want("member joins", http.StatusOK, http.MethodPost, roomPath(code)+"/join", member, map[string]any{})
	base := "/api/v1/meetings/" + roomID + "/pillars"

	own := api.want("own pillars", http.StatusOK, http.MethodGet, base, member, nil)["pillars"].(map[string]any)
	if own["finalized"] != false || own["weights"] != nil {
		t.Errorf("a personal room has no finalised rule: %v", own)
	}
	duration := own["duration"].(map[string]any)
	if duration["joins"] != 1.0 || duration["reconnections"] != 0.0 {
		t.Errorf("duration: %v", duration)
	}
	for _, key := range []string{"engagement", "focus"} {
		if own[key] == nil {
			t.Errorf("missing %s", key)
		}
	}
	api.want("host sees the member", http.StatusOK, http.MethodGet, base+"?student="+memberID, host, nil)
	api.want("member cannot see the host", http.StatusForbidden, http.MethodGet, base+"?student="+hostID, member, nil)
	api.want("stranger cannot see the member", http.StatusForbidden, http.MethodGet, base+"?student="+memberID, stranger, nil)
	api.want("bad student id", http.StatusBadRequest, http.MethodGet, base+"?student=x", host, nil)
}
