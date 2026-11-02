package server_test

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/room"
)

// TestWorkflowDB_PollsQuizzesDoubts runs live questions and the doubt queue as connect_app.
func TestWorkflowDB_PollsQuizzesDoubts(t *testing.T) {
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
	room.SetGuestTokenSecret([]byte("polls-integration-secret-0123456789012"))
	t.Cleanup(room.ResetGuestTokenSecretForTest)
	api := apiClient{t: t, router: newRuntimeRouter(t, app, nil)}

	_, hostToken := api.signup()
	coID, coToken := api.signup()
	memberID, memberToken := api.signup()
	_, strangerToken := api.signup()
	host, co, member, stranger := caller{token: hostToken}, caller{token: coToken}, caller{token: memberToken}, caller{token: strangerToken}
	res := api.want("create", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", host, map[string]any{})
	code := field(res, "room", "publicCode")
	base := roomPath(code)
	for _, who := range []caller{host, co, member} {
		api.want("join", http.StatusOK, http.MethodPost, base+"/join", who, map[string]any{})
	}
	api.want("co-host", http.StatusOK, http.MethodPost, base+"/participants/user:"+coID+"/cohost", host, nil)
	res = api.want("guest", http.StatusOK, http.MethodPost, base+"/join", caller{}, map[string]any{"displayName": "Guest Bo"})
	guest := caller{guest: res["guestToken"].(string)}

	findPoll := func(who caller, id string) map[string]any {
		t.Helper()
		for _, row := range rowsOf(api.want("list", http.StatusOK, http.MethodGet, base+"/polls", who, nil), "polls") {
			if row["id"] == id {
				return row
			}
		}
		t.Fatalf("poll %s not visible", id)
		return nil
	}
	optionIDs := func(poll map[string]any) []string {
		var ids []string
		for _, option := range poll["options"].([]any) {
			ids = append(ids, option.(map[string]any)["id"].(string))
		}
		return ids
	}
	options := func(labels ...string) []map[string]any {
		var out []map[string]any
		for _, label := range labels {
			out = append(out, map[string]any{"label": label})
		}
		return out
	}
	newPoll := func(body map[string]any) string {
		t.Helper()
		return api.want("create poll", http.StatusCreated, http.MethodPost, base+"/polls", host, body)["id"].(string)
	}
	respond := func(who caller, id string, want int, choices ...string) {
		t.Helper()
		api.want("respond", want, http.MethodPost, base+"/polls/"+id+"/respond", who, map[string]any{"optionIds": choices})
	}

	t.Run("creating is for hosts and co-hosts, with validation", func(t *testing.T) {
		good := map[string]any{"kind": "poll", "question": "Ready?", "choiceMode": "single", "options": options("Yes", "No")}
		api.want("member", http.StatusForbidden, http.MethodPost, base+"/polls", member, good)
		api.want("guest", http.StatusForbidden, http.MethodPost, base+"/polls", guest, good)
		api.want("stranger", http.StatusForbidden, http.MethodPost, base+"/polls", stranger, good)
		api.want("co-host", http.StatusCreated, http.MethodPost, base+"/polls", co, good)
		for name, body := range map[string]map[string]any{
			"one option":    {"kind": "poll", "question": "Q", "choiceMode": "single", "options": options("A")},
			"duplicate":     {"kind": "poll", "question": "Q", "choiceMode": "single", "options": options("A", "A")},
			"no question":   {"kind": "poll", "question": " ", "choiceMode": "single", "options": options("A", "B")},
			"bad mode":      {"kind": "poll", "question": "Q", "choiceMode": "many", "options": options("A", "B")},
			"quiz no key":   {"kind": "quiz", "question": "Q", "choiceMode": "single", "options": options("A", "B")},
			"two for one":   {"kind": "quiz", "question": "Q", "choiceMode": "single", "options": []map[string]any{{"label": "A", "isCorrect": true}, {"label": "B", "isCorrect": true}}},
			"long deadline": {"kind": "poll", "question": "Q", "choiceMode": "single", "options": options("A", "B"), "durationSeconds": 90000},
		} {
			api.want(name, http.StatusBadRequest, http.MethodPost, base+"/polls", host, body)
		}
	})

	t.Run("poll answers, retries, duplicates and live counts", func(t *testing.T) {
		id := newPoll(map[string]any{"kind": "poll", "question": "Pick", "choiceMode": "single", "options": options("A", "B", "C")})
		poll := findPoll(member, id)
		ids := optionIDs(poll)
		respond(member, id, http.StatusOK, ids[0])
		respond(member, id, http.StatusOK, ids[0])
		respond(member, id, http.StatusConflict, ids[1])
		respond(guest, id, http.StatusOK, ids[1])
		respond(co, id, http.StatusBadRequest, ids[0], ids[1])
		respond(co, id, http.StatusBadRequest, "00000000-0000-0000-0000-000000000000")
		respond(co, id, http.StatusBadRequest, "not-a-uuid")
		respond(stranger, id, http.StatusForbidden, ids[0])
		poll = findPoll(guest, id)
		votes := map[string]float64{}
		for _, row := range poll["results"].([]any) {
			item := row.(map[string]any)
			votes[item["optionId"].(string)] = item["votes"].(float64)
		}
		if votes[ids[0]] != 1 || votes[ids[1]] != 1 || votes[ids[2]] != 0 {
			t.Errorf("counts: %v", votes)
		}
		if mine := poll["myResponse"].(map[string]any); len(mine["optionIds"].([]any)) != 1 {
			t.Errorf("guest's answer did not survive a reload: %v", mine)
		}
	})

	t.Run("changing an answer follows the poll's rule", func(t *testing.T) {
		id := newPoll(map[string]any{"kind": "poll", "question": "Change", "choiceMode": "multiple", "allowChange": true, "options": options("A", "B")})
		ids := optionIDs(findPoll(member, id))
		respond(member, id, http.StatusOK, ids[0])
		respond(member, id, http.StatusOK, ids[0], ids[1])
		if mine := findPoll(member, id)["myResponse"].(map[string]any); len(mine["optionIds"].([]any)) != 2 {
			t.Errorf("answer not changed: %v", mine)
		}
	})

	t.Run("quiz keys stay hidden and the server scores", func(t *testing.T) {
		id := newPoll(map[string]any{"kind": "quiz", "question": "2+2", "choiceMode": "multiple", "points": 10,
			"options": []map[string]any{{"label": "4", "isCorrect": true}, {"label": "four", "isCorrect": true}, {"label": "5"}}})
		poll := findPoll(member, id)
		raw, _ := json.Marshal(poll)
		if results := poll["results"].([]any); len(results) != 0 {
			t.Errorf("quiz results visible while open: %s", raw)
		}
		ids := optionIDs(poll)
		var leaked int
		err := database.WithAuthContext(ctx, app, auth.HashSessionToken(memberToken), nil, func(tx pgx.Tx, _ *database.AuthContext) error {
			return tx.QueryRow(ctx, `SELECT count(*) FROM poll_answer_keys WHERE poll_id = $1`, id).Scan(&leaked)
		})
		if err != nil || leaked != 0 {
			t.Errorf("a participant read %d answer keys, err=%v", leaked, err)
		}
		res := api.want("respond", http.StatusOK, http.MethodPost, base+"/polls/"+id+"/respond", member, map[string]any{"optionIds": []string{ids[0], ids[2]}})
		if _, exposed := res["score"]; exposed {
			t.Errorf("the score was revealed while open: %v", res)
		}
		respond(guest, id, http.StatusOK, ids[0], ids[1])
		respond(co, id, http.StatusOK, ids[2])
		api.want("member scores", http.StatusForbidden, http.MethodGet, base+"/polls/"+id+"/scores", member, nil)
		api.want("member closes", http.StatusForbidden, http.MethodPost, base+"/polls/"+id+"/close", member, nil)
		api.want("host closes", http.StatusOK, http.MethodPost, base+"/polls/"+id+"/close", host, nil)
		respond(host, id, http.StatusConflict, ids[0])

		// 10 x max(0, right - wrong) / correct options: one right, one wrong is 0; both right is 10.
		scores := rowsOf(api.want("scores", http.StatusOK, http.MethodGet, base+"/polls/"+id+"/scores", host, nil), "scores")
		byIdentity := map[string]float64{}
		for _, row := range scores {
			byIdentity[row["identity"].(string)] = row["score"].(float64)
		}
		if byIdentity["user:"+memberID] != 0 || byIdentity["user:"+coID] != 0 {
			t.Errorf("scores: %v", byIdentity)
		}
		var top float64
		for _, v := range byIdentity {
			if v > top {
				top = v
			}
		}
		if top != 10 {
			t.Errorf("the correct answer should score 10: %v", byIdentity)
		}
		closed := findPoll(member, id)
		if closed["closed"] != true {
			t.Errorf("not closed: %v", closed)
		}
		correct := 0
		for _, row := range closed["results"].([]any) {
			if row.(map[string]any)["isCorrect"] == true {
				correct++
			}
		}
		if correct != 2 {
			t.Errorf("answers should be revealed after closing: %v", closed["results"])
		}
	})

	t.Run("a deadline is enforced by the server clock", func(t *testing.T) {
		id := newPoll(map[string]any{"kind": "poll", "question": "Fast", "choiceMode": "single", "durationSeconds": 60, "options": options("A", "B")})
		ids := optionIDs(findPoll(member, id))
		respond(member, id, http.StatusOK, ids[0])
		if _, err := admin.Exec(ctx, `UPDATE polls SET closes_at = clock_timestamp() - interval '1 second' WHERE id = $1`, id); err != nil {
			t.Fatal(err)
		}
		respond(guest, id, http.StatusConflict, ids[0])
		if findPoll(member, id)["closed"] != true {
			t.Error("a poll past its deadline should read as closed")
		}
	})

	t.Run("responses cannot be written directly", func(t *testing.T) {
		id := newPoll(map[string]any{"kind": "quiz", "question": "Direct", "choiceMode": "single", "points": 5,
			"options": []map[string]any{{"label": "Right", "isCorrect": true}, {"label": "Wrong"}}})
		err := database.WithAuthContext(ctx, app, auth.HashSessionToken(memberToken), nil, func(tx pgx.Tx, _ *database.AuthContext) error {
			_, err := tx.Exec(ctx, `INSERT INTO poll_responses (poll_id, identity, option_ids, score) VALUES ($1, connect_auth.current_room_identity(), '{}', 5)`, id)
			return err
		})
		if err == nil {
			t.Error("a participant wrote their own score")
		}
	})

	t.Run("concurrent answers count once each", func(t *testing.T) {
		id := newPoll(map[string]any{"kind": "poll", "question": "Race", "choiceMode": "single", "options": options("A", "B")})
		ids := optionIDs(findPoll(member, id))
		var wg sync.WaitGroup
		codes := make(chan int, 20)
		for i := range 20 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				got, _ := api.call(http.MethodPost, base+"/polls/"+id+"/respond", member, map[string]any{"optionIds": []string{ids[i%2]}})
				codes <- got
			}()
		}
		wg.Wait()
		close(codes)
		for got := range codes {
			if got != http.StatusOK && got != http.StatusConflict {
				t.Errorf("unexpected status %d", got)
			}
		}
		var rows int
		if err := admin.QueryRow(ctx, `SELECT count(*) FROM poll_responses WHERE poll_id = $1`, id).Scan(&rows); err != nil || rows != 1 {
			t.Errorf("expected one response, got %d, err=%v", rows, err)
		}
	})

	t.Run("doubt queue", func(t *testing.T) {
		res := api.want("ask", http.StatusCreated, http.MethodPost, base+"/doubts", guest, map[string]any{"question": "What is recursion?"})
		id := res["id"].(string)
		api.want("empty", http.StatusBadRequest, http.MethodPost, base+"/doubts", member, map[string]any{"question": "  "})
		api.want("stranger asks", http.StatusForbidden, http.MethodPost, base+"/doubts", stranger, map[string]any{"question": "Hi"})
		api.want("stranger reads", http.StatusForbidden, http.MethodGet, base+"/doubts", stranger, nil)
		api.want("member assigns", http.StatusForbidden, http.MethodPost, base+"/doubts/"+id+"/assign", member, map[string]any{"identity": "user:" + coID})
		api.want("host assigns", http.StatusOK, http.MethodPost, base+"/doubts/"+id+"/assign", host, map[string]any{"identity": "user:" + coID})
		api.want("member answers", http.StatusForbidden, http.MethodPost, base+"/doubts/"+id+"/answer", member, map[string]any{"answer": "No"})
		api.want("co-host answers", http.StatusOK, http.MethodPost, base+"/doubts/"+id+"/answer", co, map[string]any{"answer": "A function calling itself."})
		row := rowsOf(api.want("read", http.StatusOK, http.MethodGet, base+"/doubts", member, nil), "doubts")[0]
		if row["status"] != "answered" || row["askedByName"] != "Guest Bo" || row["answer"] != "A function calling itself." {
			t.Errorf("doubt: %v", row)
		}
		api.want("another participant cannot resolve", http.StatusNotFound, http.MethodPost, base+"/doubts/"+id+"/resolve", member, nil)
		api.want("asker resolves", http.StatusOK, http.MethodPost, base+"/doubts/"+id+"/resolve", guest, nil)
		api.want("already resolved", http.StatusNotFound, http.MethodPost, base+"/doubts/"+id+"/resolve", host, nil)

		// The asker's update policy cannot be used to answer their own doubt or change it.
		res = api.want("member asks", http.StatusCreated, http.MethodPost, base+"/doubts", member, map[string]any{"question": "Why?"})
		err := database.WithAuthContext(ctx, app, auth.HashSessionToken(memberToken), nil, func(tx pgx.Tx, _ *database.AuthContext) error {
			_, err := tx.Exec(ctx, `UPDATE meeting_doubts SET answer = 'self', status = 'answered' WHERE id = $1`, res["id"])
			return err
		})
		if err == nil {
			t.Error("an asker answered their own doubt directly")
		}
	})

	t.Run("polls from another room cannot be reached", func(t *testing.T) {
		id := newPoll(map[string]any{"kind": "poll", "question": "Other", "choiceMode": "single", "options": options("A", "B")})
		ids := optionIDs(findPoll(member, id))
		res := api.want("other room", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", stranger, map[string]any{})
		other := roomPath(field(res, "room", "publicCode"))
		api.want("join other", http.StatusOK, http.MethodPost, other+"/join", stranger, map[string]any{})
		api.want("answer through another room", http.StatusNotFound, http.MethodPost, other+"/polls/"+id+"/respond", stranger, map[string]any{"optionIds": ids[:1]})
		api.want("close through another room", http.StatusNotFound, http.MethodPost, other+"/polls/"+id+"/close", stranger, nil)
		if rows := rowsOf(api.want("list other", http.StatusOK, http.MethodGet, other+"/polls", stranger, nil), "polls"); len(rows) != 0 {
			t.Errorf("polls leaked between rooms: %v", rows)
		}
		var visible int
		if err := app.QueryRow(ctx, `SELECT count(*) FROM polls`).Scan(&visible); err != nil || visible != 0 {
			t.Errorf("no context sees %d polls, err=%v", visible, err)
		}
	})

}
