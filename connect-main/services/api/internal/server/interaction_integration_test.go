package server_test

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/interaction"
	"github.com/tathastu/connect/services/api/internal/livekit"
	appmw "github.com/tathastu/connect/services/api/internal/middleware"
	"github.com/tathastu/connect/services/api/internal/room"
)

// countingLimiter refuses after a fixed number of calls per key.
type countingLimiter struct {
	mu     sync.Mutex
	limit  int
	counts map[string]int
}

func (c *countingLimiter) Allow(_ context.Context, key string, _ int, _ time.Duration) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.counts[key]++
	return c.counts[key] <= c.limit, nil
}

// TestWorkflowDB_MeetingInteraction runs chat, announcements, reactions and hands as connect_app.
func TestWorkflowDB_MeetingInteraction(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	open := func(name string) *pgxpool.Pool {
		url := os.Getenv(name)
		if url == "" {
			t.Skipf("NOT VERIFIED: %s is required", name)
		}
		p, err := pgxpool.New(ctx, url)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(p.Close)
		return p
	}
	admin, app := open("TEST_DATABASE_URL"), open("TEST_CONNECT_APP_URL")
	room.SetGuestTokenSecret([]byte("interaction-integration-secret-0123456"))
	t.Cleanup(room.ResetGuestTokenSecretForTest)
	api := apiClient{t: t, router: newRuntimeRouter(t, app, nil)}

	hostID, hostToken := api.signup()
	coID, coToken := api.signup()
	memberID, memberToken := api.signup()
	_, strangerToken := api.signup()
	host, co, member, stranger := caller{token: hostToken}, caller{token: coToken}, caller{token: memberToken}, caller{token: strangerToken}

	res := api.want("create", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", host, map[string]any{})
	code := field(res, "room", "publicCode")
	res = api.want("create other", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", caller{token: strangerToken}, map[string]any{})
	otherCode := field(res, "room", "publicCode")
	base := roomPath(code)
	api.want("host joins", http.StatusOK, http.MethodPost, base+"/join", host, map[string]any{})
	api.want("co joins", http.StatusOK, http.MethodPost, base+"/join", co, map[string]any{})
	api.want("member joins", http.StatusOK, http.MethodPost, base+"/join", member, map[string]any{})
	api.want("make co-host", http.StatusOK, http.MethodPost, base+"/participants/user:"+coID+"/cohost", host, nil)
	res = api.want("guest joins", http.StatusOK, http.MethodPost, base+"/join", caller{}, map[string]any{"displayName": "Guest Ann"})
	guest := caller{guest: res["guestToken"].(string)}
	guestIdentity := field(res, "participant", "identity")

	msg := func(id, body string) map[string]any { return map[string]any{"clientMessageId": id, "body": body} }

	t.Run("sender comes from credentials, not the request", func(t *testing.T) {
		api.want("unknown field", http.StatusBadRequest, http.MethodPost, base+"/messages", member, map[string]any{"clientMessageId": "a1", "body": "hi", "senderIdentity": "user:" + hostID})
		res := api.want("member sends", http.StatusCreated, http.MethodPost, base+"/messages", member, msg("m1", "hello everyone"))
		sent, _ := res["message"].(map[string]any)
		if sent["senderIdentity"] != "user:"+memberID || sent["senderName"] != "Member" || sent["kind"] != "chat" {
			t.Errorf("unexpected message: %v", sent)
		}
		res = api.want("guest sends", http.StatusCreated, http.MethodPost, base+"/messages", guest, msg("g1", "hello from a guest"))
		sent, _ = res["message"].(map[string]any)
		if sent["senderIdentity"] != guestIdentity || sent["senderName"] != "Guest Ann" {
			t.Errorf("unexpected guest message: %v", sent)
		}
	})

	t.Run("the database rejects a forged sender without the service", func(t *testing.T) {
		err := database.WithAuthContext(ctx, app, auth.HashSessionToken(memberToken), nil, func(tx pgx.Tx, _ *database.AuthContext) error {
			var roomID string
			if err := admin.QueryRow(ctx, `SELECT id::text FROM rooms WHERE public_code = $1`, code).Scan(&roomID); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `INSERT INTO meeting_messages (room_id, sender_identity, sender_name, body, client_message_id) VALUES ($1, $2, 'Host', 'forged', 'f1')`, roomID, "user:"+hostID)
			return err
		})
		if err == nil {
			t.Error("a forged sender was stored")
		}
		if _, err := app.Exec(ctx, `UPDATE meeting_messages SET body = 'edited'`); err == nil {
			t.Error("the API role may edit messages")
		}
		if _, err := app.Exec(ctx, `DELETE FROM meeting_messages`); err == nil {
			t.Error("the API role may delete messages")
		}
	})

	t.Run("announcements are for hosts and co-hosts", func(t *testing.T) {
		announce := func(id string) map[string]any {
			return map[string]any{"clientMessageId": id, "body": "exam moved", "kind": "announcement"}
		}
		api.want("member", http.StatusForbidden, http.MethodPost, base+"/messages", member, announce("a2"))
		api.want("guest", http.StatusForbidden, http.MethodPost, base+"/messages", guest, announce("a3"))
		api.want("host", http.StatusCreated, http.MethodPost, base+"/messages", host, announce("a4"))
		api.want("co-host", http.StatusCreated, http.MethodPost, base+"/messages", co, announce("a5"))
		err := database.WithAuthContext(ctx, app, auth.HashSessionToken(memberToken), nil, func(tx pgx.Tx, _ *database.AuthContext) error {
			_, err := tx.Exec(ctx, `INSERT INTO meeting_messages (room_id, sender_identity, sender_name, kind, body, client_message_id)
				SELECT id, connect_auth.current_room_identity(), 'M', 'announcement', 'x', 'a6' FROM rooms WHERE public_code = $1`, code)
			return err
		})
		if err == nil {
			t.Error("the database accepted a participant's announcement")
		}
	})

	t.Run("malformed payloads", func(t *testing.T) {
		for name, body := range map[string]map[string]any{
			"empty":    msg("b1", "   "),
			"too long": msg("b2", strings.Repeat("x", interaction.MaxMessageLength+1)),
			"no id":    {"body": "hi"},
			"bad id":   msg("has spaces", "hi"),
			"bad kind": {"clientMessageId": "b3", "body": "hi", "kind": "system"},
		} {
			api.want(name, http.StatusBadRequest, http.MethodPost, base+"/messages", member, body)
		}
		api.want("bad reaction", http.StatusBadRequest, http.MethodPost, base+"/reactions", member, map[string]any{"emoji": "<script>"})
		api.want("bad hand", http.StatusBadRequest, http.MethodPost, base+"/hand", member, map[string]any{})
		api.want("bad page", http.StatusBadRequest, http.MethodGet, base+"/messages?after=-1", member, nil)
	})

	t.Run("a retry returns the original message", func(t *testing.T) {
		first := api.want("first", http.StatusCreated, http.MethodPost, base+"/messages", member, msg("retry1", "once only"))
		second := api.want("retry", http.StatusOK, http.MethodPost, base+"/messages", member, msg("retry1", "once only"))
		if first["message"].(map[string]any)["id"] != second["message"].(map[string]any)["id"] {
			t.Errorf("a retry created a new message: %v, %v", first, second)
		}
		// Another sender may use the same client id.
		api.want("other sender", http.StatusCreated, http.MethodPost, base+"/messages", co, msg("retry1", "mine"))
	})

	t.Run("isolation", func(t *testing.T) {
		api.want("stranger reads", http.StatusForbidden, http.MethodGet, base+"/messages", stranger, nil)
		api.want("stranger state", http.StatusForbidden, http.MethodGet, base+"/live-state", stranger, nil)
		api.want("stranger sends", http.StatusForbidden, http.MethodPost, base+"/messages", stranger, msg("s1", "hi"))
		api.want("stranger reacts", http.StatusForbidden, http.MethodPost, base+"/reactions", stranger, map[string]any{"emoji": "👍"})
		api.want("stranger hand", http.StatusForbidden, http.MethodPost, base+"/hand", stranger, map[string]any{"raised": true})
		api.want("anonymous", http.StatusUnauthorized, http.MethodGet, base+"/messages", caller{}, nil)
		api.want("guest in another room", http.StatusUnauthorized, http.MethodGet, roomPath(otherCode)+"/messages", guest, nil)
		if rows := rowsOf(api.want("other room is empty", http.StatusOK, http.MethodGet, roomPath(otherCode)+"/messages", stranger, nil), "messages"); len(rows) != 0 {
			t.Errorf("messages leaked between rooms: %v", rows)
		}
		var visible int
		if err := app.QueryRow(ctx, `SELECT count(*) FROM meeting_messages`).Scan(&visible); err != nil || visible != 0 {
			t.Errorf("no context sees %d messages, err=%v", visible, err)
		}
	})

	t.Run("pagination and ordering under concurrency", func(t *testing.T) {
		res := api.want("page room", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", member, map[string]any{})
		pageCode := field(res, "room", "publicCode")
		pageBase := roomPath(pageCode)
		api.want("join", http.StatusOK, http.MethodPost, pageBase+"/join", member, map[string]any{})
		var wg sync.WaitGroup
		for i := range 30 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				got, _ := api.call(http.MethodPost, pageBase+"/messages", member, msg(fmt.Sprintf("c%d", i), fmt.Sprintf("message %d", i)))
				if got != http.StatusCreated {
					t.Errorf("concurrent send %d: %d", i, got)
				}
			}()
		}
		wg.Wait()

		seen := map[string]bool{}
		last := float64(0)
		page := rowsOf(api.want("newest", http.StatusOK, http.MethodGet, pageBase+"/messages?limit=10", member, nil), "messages")
		if len(page) != 10 {
			t.Fatalf("expected 10, got %d", len(page))
		}
		oldest := page[0]["seq"].(float64)
		for page != nil {
			for _, row := range page {
				seen[row["id"].(string)] = true
				if s := row["seq"].(float64); s <= last && last != 0 {
					t.Errorf("page not ascending: %v after %v", s, last)
				} else {
					last = s
				}
			}
			last = 0
			next := rowsOf(api.want("older", http.StatusOK, http.MethodGet, fmt.Sprintf("%s/messages?limit=10&before=%.0f", pageBase, oldest), member, nil), "messages")
			if len(next) == 0 {
				break
			}
			oldest = next[0]["seq"].(float64)
			page = next
		}
		if len(seen) != 30 {
			t.Errorf("paging back found %d of 30 messages", len(seen))
		}
		after := rowsOf(api.want("after", http.StatusOK, http.MethodGet, fmt.Sprintf("%s/messages?after=%.0f", pageBase, oldest), member, nil), "messages")
		if len(after) != 29 {
			t.Errorf("expected 29 after the first, got %d", len(after))
		}
		if capped := rowsOf(api.want("limit is capped", http.StatusOK, http.MethodGet, pageBase+"/messages?limit=100000", member, nil), "messages"); len(capped) != 30 {
			t.Errorf("unexpected capped page: %d", len(capped))
		}
	})

	t.Run("hands and reactions survive a reload", func(t *testing.T) {
		api.want("raise", http.StatusOK, http.MethodPost, base+"/hand", member, map[string]any{"raised": true})
		api.want("raise twice", http.StatusOK, http.MethodPost, base+"/hand", member, map[string]any{"raised": true})
		api.want("guest raises", http.StatusOK, http.MethodPost, base+"/hand", guest, map[string]any{"raised": true})
		// Every emoji either client offers must be accepted.
		for _, emoji := range []string{"👍", "👏", "❤️", "🎉", "💡", "🔥"} {
			api.want("offered emoji "+emoji, http.StatusCreated, http.MethodPost, base+"/reactions", member, map[string]any{"emoji": emoji})
		}
		api.want("react", http.StatusCreated, http.MethodPost, base+"/reactions", guest, map[string]any{"emoji": "👏"})
		state := api.want("state", http.StatusOK, http.MethodGet, base+"/live-state", co, nil)
		hands, _ := state["raisedHands"].([]any)
		if len(hands) != 2 {
			t.Errorf("expected 2 hands, got %v", hands)
		}
		if list := rowsOf(state, "reactions"); len(list) != 7 || list[6]["identity"] != guestIdentity {
			t.Errorf("reactions: %v", list)
		}
		api.want("participant lowers another", http.StatusForbidden, http.MethodDelete, base+"/participants/user:"+memberID+"/hand", caller{token: strangerToken}, nil)
		api.want("co-host lowers", http.StatusOK, http.MethodDelete, base+"/participants/user:"+memberID+"/hand", co, nil)
		api.want("guest lowers own", http.StatusOK, http.MethodPost, base+"/hand", guest, map[string]any{"raised": false})
		state = api.want("state after", http.StatusOK, http.MethodGet, base+"/live-state", member, nil)
		if hands, _ := state["raisedHands"].([]any); len(hands) != 0 {
			t.Errorf("hands remain: %v", hands)
		}
		var history int
		if err := admin.QueryRow(ctx, `SELECT count(*) FROM meeting_hand_raises WHERE identity = $1`, "user:"+memberID).Scan(&history); err != nil || history != 1 {
			t.Errorf("hand history: %d, err=%v", history, err)
		}
	})

	t.Run("the host's message history outlives the meeting, and sending stops", func(t *testing.T) {
		before := rowsOf(api.want("before", http.StatusOK, http.MethodGet, base+"/messages", host, nil), "messages")
		api.want("end", http.StatusOK, http.MethodPost, base+"/end", host, nil)
		after := rowsOf(api.want("after", http.StatusOK, http.MethodGet, base+"/messages", host, nil), "messages")
		if len(after) != len(before) || len(after) == 0 {
			t.Errorf("history changed: %d then %d", len(before), len(after))
		}
		api.want("send after end", http.StatusConflict, http.MethodPost, base+"/messages", host, msg("e1", "too late"))
	})

	t.Run("rate limits", func(t *testing.T) {
		limiter := &countingLimiter{limit: 2, counts: map[string]int{}}
		authService := auth.NewService(auth.NewPgxRepository(app), nil, time.Hour, time.Hour)
		rooms := room.NewService(room.NewPgxRepository(app), room.NewPolicy(), nil, livekit.NewTokenService("test_key", "test_secret_that_is_long_enough_for_tests"), nil)
		handler := interaction.NewHandler(app, rooms, limiter, nil)
		r := chi.NewRouter()
		r.With(appmw.OptionalAuth(authService)).Post("/api/v1/rooms/{code}/messages", handler.PostMessage)
		limited := apiClient{t: t, router: r}

		res := api.want("rate room", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", member, map[string]any{})
		rateCode := field(res, "room", "publicCode")
		api.want("join", http.StatusOK, http.MethodPost, roomPath(rateCode)+"/join", member, map[string]any{})
		path := roomPath(rateCode) + "/messages"
		limited.want("first", http.StatusCreated, http.MethodPost, path, member, msg("r1", "a"))
		limited.want("second", http.StatusCreated, http.MethodPost, path, member, msg("r2", "b"))
		limited.want("third", http.StatusTooManyRequests, http.MethodPost, path, member, msg("r3", "c"))
	})
}
