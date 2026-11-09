package server_test

import (
	"context"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestWorkflowDB_MeetingNumber creates a room as connect_app and finds it by its number.
func TestWorkflowDB_MeetingNumber(t *testing.T) {
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
	_, hostToken := api.signup()
	res := api.want("create", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", caller{token: hostToken}, map[string]any{})
	code, number := field(res, "room", "publicCode"), field(res, "room", "meetingNumber")
	if len(strings.ReplaceAll(number, " ", "")) != 11 {
		t.Fatalf("meeting number %q", number)
	}
	got := api.want("resolve", http.StatusOK, http.MethodGet, "/api/v1/rooms/by-number/"+strings.ReplaceAll(number, " ", ""), caller{}, nil)
	if got["publicCode"] != code {
		t.Errorf("resolved %v, want %s", got["publicCode"], code)
	}
	detail := api.want("detail", http.StatusOK, http.MethodGet, roomPath(code), caller{}, nil)
	if field(detail, "room", "meetingNumber") != number {
		t.Errorf("detail number %v", detail["room"])
	}
	api.want("unknown", http.StatusNotFound, http.MethodGet, "/api/v1/rooms/by-number/10000000000", caller{}, nil)
}
