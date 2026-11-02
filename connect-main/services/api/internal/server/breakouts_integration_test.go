package server_test

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/room"
)

// TestWorkflowDB_BreakoutRooms runs group discussion through the API as connect_app.
func TestWorkflowDB_BreakoutRooms(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	open := func(name string) *pgxpool.Pool {
		dsn := os.Getenv(name)
		if dsn == "" {
			t.Skipf("NOT VERIFIED: %s is required", name)
		}
		p, err := pgxpool.New(ctx, dsn)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(p.Close)
		return p
	}
	admin, app := open("TEST_DATABASE_URL"), open("TEST_CONNECT_APP_URL")
	room.SetGuestTokenSecret([]byte("breakout-integration-secret-0123456789"))
	t.Cleanup(room.ResetGuestTokenSecretForTest)
	api := apiClient{t: t, router: newRuntimeRouter(t, app, nil)}

	hostID, hostToken := api.signup()
	aliceID, aliceToken := api.signup()
	bobID, bobToken := api.signup()
	_, outsiderToken := api.signup()
	host, alice, bob, outsider := caller{token: hostToken}, caller{token: aliceToken}, caller{token: bobToken}, caller{token: outsiderToken}

	created := api.want("create", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", host, map[string]any{})
	mainID, code := field(created, "room", "id"), field(created, "room", "publicCode")
	path := roomPath(code)
	api.want("host joins", http.StatusOK, http.MethodPost, path+"/join", host, map[string]any{})
	api.want("alice joins", http.StatusOK, http.MethodPost, path+"/join", alice, map[string]any{})
	api.want("bob joins", http.StatusOK, http.MethodPost, path+"/join", bob, map[string]any{})
	guestRes := api.want("guest joins", http.StatusOK, http.MethodPost, path+"/join", caller{}, map[string]any{"displayName": "Visitor"})
	guest := caller{guest: guestRes["guestToken"].(string)}
	guestIdentity := field(guestRes, "participant", "identity")

	state := func(who caller) map[string]any {
		t.Helper()
		return api.want("state", http.StatusOK, http.MethodGet, path+"/breakouts", who, nil)
	}
	assign := func(name string, want int, who caller, identity string, roomID any) {
		t.Helper()
		api.want(name, want, http.MethodPost, path+"/breakouts/assign", who, map[string]any{"identity": identity, "roomId": roomID})
	}

	t.Run("only moderators open groups", func(t *testing.T) {
		names := map[string]any{"names": []string{"Group 1", "Group 2"}}
		api.want("member", http.StatusForbidden, http.MethodPost, path+"/breakouts", alice, names)
		api.want("guest", http.StatusForbidden, http.MethodPost, path+"/breakouts", guest, names)
		api.want("outsider", http.StatusForbidden, http.MethodPost, path+"/breakouts", outsider, names)
		api.want("anonymous", http.StatusUnauthorized, http.MethodPost, path+"/breakouts", caller{}, names)
		for _, bad := range []map[string]any{{"names": []string{}}, {"names": []string{"Same", "same"}}, {"names": []string{" "}}, {"other": 1}} {
			api.want("bad", http.StatusBadRequest, http.MethodPost, path+"/breakouts", host, bad)
		}
		api.want("host", http.StatusCreated, http.MethodPost, path+"/breakouts", host, names)
		api.want("twice", http.StatusConflict, http.MethodPost, path+"/breakouts", host, names)
	})

	s := state(host)
	rooms := rowsOf(s, "rooms")
	if len(rooms) != 2 {
		t.Fatalf("rooms: %v", s)
	}
	group1, group2 := rooms[0]["id"].(string), rooms[1]["id"].(string)
	code1, code2 := rooms[0]["code"].(string), rooms[1]["code"].(string)

	t.Run("assignment decides who may enter", func(t *testing.T) {
		if m := state(alice); len(rowsOf(m, "rooms")) != 0 || len(rowsOf(m, "people")) != 0 || m["myRoom"] != nil {
			t.Errorf("a participant sees too much: %v", m)
		}
		assign("member cannot assign", http.StatusForbidden, alice, "user:"+bobID, group1)
		api.want("not assigned yet", http.StatusForbidden, http.MethodPost, roomPath(code1)+"/join", alice, map[string]any{})

		assign("alice to 1", http.StatusOK, host, "user:"+aliceID, group1)
		assign("bob to 2", http.StatusOK, host, "user:"+bobID, group2)
		assign("a guest", http.StatusUnprocessableEntity, host, guestIdentity, group1)
		assign("not in the meeting", http.StatusNotFound, host, "user:00000000-0000-4000-8000-000000000000", group1)
		assign("another meeting's room", http.StatusNotFound, host, "user:"+aliceID, mainID)

		if m := state(alice); m["myRoom"] == nil || m["myRoom"].(map[string]any)["code"] != code1 {
			t.Errorf("alice's room: %v", m)
		}
		api.want("alice enters hers", http.StatusOK, http.MethodPost, roomPath(code1)+"/join", alice, map[string]any{})
		api.want("alice cannot enter bob's", http.StatusForbidden, http.MethodPost, roomPath(code2)+"/join", alice, map[string]any{})
		api.want("outsider cannot", http.StatusForbidden, http.MethodPost, roomPath(code1)+"/join", outsider, map[string]any{})
		api.want("a guest with the code cannot", http.StatusForbidden, http.MethodPost, roomPath(code1)+"/join", caller{}, map[string]any{"displayName": "Visitor"})
		api.want("host visits", http.StatusOK, http.MethodPost, roomPath(code1)+"/join", host, map[string]any{})
	})

	t.Run("a group's discussion stays in the group", func(t *testing.T) {
		api.want("message", http.StatusCreated, http.MethodPost, roomPath(code1)+"/messages", alice, map[string]any{"clientMessageId": "g1", "body": "group talk"})
		if rows := rowsOf(api.want("host reads", http.StatusOK, http.MethodGet, roomPath(code1)+"/messages", host, nil), "messages"); len(rows) != 1 {
			t.Errorf("group messages: %v", rows)
		}
		if rows := rowsOf(api.want("main meeting", http.StatusOK, http.MethodGet, path+"/messages", bob, nil), "messages"); len(rows) != 0 {
			t.Errorf("leaked into the main meeting: %v", rows)
		}
		api.want("bob cannot read", http.StatusForbidden, http.MethodGet, roomPath(code1)+"/messages", bob, nil)
		// From inside, the way back is known; nothing about the other group is.
		inside := api.want("inside", http.StatusOK, http.MethodGet, roomPath(code1)+"/breakouts", alice, nil)
		if inside["isBreakout"] != true || inside["mainCode"] != code || len(rowsOf(inside, "rooms")) != 0 {
			t.Errorf("inside: %v", inside)
		}
		api.want("no nesting", http.StatusUnprocessableEntity, http.MethodPost, roomPath(code1)+"/breakouts", host, map[string]any{"names": []string{"Deep"}})
	})

	t.Run("reassigning moves a person, and history lists only the main meeting", func(t *testing.T) {
		assign("bob to 1", http.StatusOK, host, "user:"+bobID, group1)
		api.want("bob enters 1", http.StatusOK, http.MethodPost, roomPath(code1)+"/join", bob, map[string]any{})
		assign("bob back", http.StatusOK, host, "user:"+bobID, nil)
		if m := state(bob); m["myRoom"] != nil {
			t.Errorf("bob still assigned: %v", m)
		}
		rows := rowsOf(api.want("history", http.StatusOK, http.MethodGet, "/api/v1/meetings?q="+url.QueryEscape(code1), alice, nil), "meetings")
		if len(rows) != 0 {
			t.Errorf("a breakout was listed: %v", rows)
		}
		if rows := rowsOf(api.want("history", http.StatusOK, http.MethodGet, "/api/v1/meetings?q="+url.QueryEscape(code), alice, nil), "meetings"); len(rows) != 1 {
			t.Errorf("main meeting missing: %v", rows)
		}
	})

	t.Run("closing returns everyone", func(t *testing.T) {
		api.want("member cannot close", http.StatusForbidden, http.MethodPost, path+"/breakouts/close", alice, map[string]any{})
		res := api.want("host closes", http.StatusOK, http.MethodPost, path+"/breakouts/close", host, map[string]any{})
		if res["closed"] != float64(2) {
			t.Errorf("closed: %v", res)
		}
		if m := state(alice); m["myRoom"] != nil {
			t.Errorf("after closing: %v", m)
		}
		var open int
		if err := admin.QueryRow(ctx, `SELECT count(*) FROM room_participants rp JOIN rooms r ON r.id = rp.room_id WHERE r.parent_room_id = $1 AND rp.left_at IS NULL`, mainID).Scan(&open); err != nil {
			t.Fatal(err)
		}
		if open != 0 {
			t.Errorf("%d people still in closed groups", open)
		}
		if got := state(host); len(rowsOf(got, "rooms")) != 0 {
			t.Errorf("rooms after closing: %v", got)
		}
		api.want("reopen", http.StatusCreated, http.MethodPost, path+"/breakouts", host, map[string]any{"names": []string{"Round 2"}})
	})

	t.Run("ending the meeting ends its groups", func(t *testing.T) {
		api.want("end", http.StatusOK, http.MethodPost, path+"/end", host, nil)
		var open int
		if err := admin.QueryRow(ctx, `SELECT count(*) FROM rooms WHERE parent_room_id = $1 AND status = 'active'`, mainID).Scan(&open); err != nil {
			t.Fatal(err)
		}
		if open != 0 {
			t.Errorf("%d groups still open", open)
		}
	})
	_ = hostID
}
