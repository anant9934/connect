package server_test

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestWorkflowDB_DoubtVotesAndLeaderboard upvotes questions and ranks quiz points as connect_app.
func TestWorkflowDB_DoubtVotesAndLeaderboard(t *testing.T) {
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
	_, aToken := api.signup()
	_, bToken := api.signup()
	_, strangerToken := api.signup()
	host, a, b, stranger := caller{token: hostToken}, caller{token: aToken}, caller{token: bToken}, caller{token: strangerToken}
	code := field(api.want("create", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", host, map[string]any{}), "room", "publicCode")
	base := roomPath(code)
	for _, who := range []caller{host, a, b} {
		api.want("join", http.StatusOK, http.MethodPost, base+"/join", who, map[string]any{})
	}

	first := api.want("a asks", http.StatusCreated, http.MethodPost, base+"/doubts", a, map[string]any{"question": "Why is heapify O(n)?"})["id"].(string)
	second := api.want("b asks", http.StatusCreated, http.MethodPost, base+"/doubts", b, map[string]any{"question": "What is a min-heap?"})["id"].(string)
	vote := func(name string, want int, who caller, id string) map[string]any {
		return api.want(name, want, http.MethodPost, base+"/doubts/"+id+"/vote", who, nil)
	}
	vote("no self vote", http.StatusUnprocessableEntity, a, first)
	vote("stranger", http.StatusForbidden, stranger, second)
	if got := vote("a votes b's", http.StatusOK, a, second); got["voted"] != true || got["votes"] != 1.0 {
		t.Errorf("vote: %v", got)
	}
	vote("host votes b's", http.StatusOK, host, second)
	list := rowsOf(api.want("list", http.StatusOK, http.MethodGet, base+"/doubts", a, nil), "doubts")
	if list[0]["id"] != second || list[0]["votes"] != 2.0 || list[0]["myVote"] != true {
		t.Errorf("most voted first: %v", list)
	}
	if got := vote("a takes it back", http.StatusOK, a, second); got["voted"] != false || got["votes"] != 1.0 {
		t.Errorf("unvote: %v", got)
	}

	quiz := func(question string) string {
		return api.want("quiz", http.StatusCreated, http.MethodPost, base+"/polls", host, map[string]any{"kind": "quiz", "question": question, "choiceMode": "single", "points": 10,
			"options": []map[string]any{{"label": "Right", "isCorrect": true}, {"label": "Wrong"}}})["id"].(string)
	}
	options := func(id string) (right, wrong string) {
		for _, p := range rowsOf(api.want("polls", http.StatusOK, http.MethodGet, base+"/polls", host, nil), "polls") {
			if p["id"] == id {
				opts := p["options"].([]any)
				return opts[0].(map[string]any)["id"].(string), opts[1].(map[string]any)["id"].(string)
			}
		}
		t.Fatalf("quiz %s missing", id)
		return "", ""
	}
	q1 := quiz("Heap height?")
	r1, w1 := options(q1)
	api.want("a right", http.StatusOK, http.MethodPost, base+"/polls/"+q1+"/respond", a, map[string]any{"optionIds": []string{r1}})
	api.want("b wrong", http.StatusOK, http.MethodPost, base+"/polls/"+q1+"/respond", b, map[string]any{"optionIds": []string{w1}})
	board := rowsOf(api.want("leaderboard", http.StatusOK, http.MethodGet, base+"/leaderboard", b, nil), "leaderboard")
	if len(board) != 2 || board[0]["points"] != 10.0 || board[0]["rank"] != 1.0 || board[1]["isMe"] != true {
		t.Errorf("leaderboard: %v", board)
	}
	api.want("stranger leaderboard", http.StatusForbidden, http.MethodGet, base+"/leaderboard", stranger, nil)
}
