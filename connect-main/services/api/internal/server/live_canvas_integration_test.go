package server_test

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/interaction"
	"github.com/tathastu/connect/services/api/internal/room"
)

// fakeGenerator stands in for the AI service so the test needs no provider.
type fakeGenerator struct{ calls int }

func (f *fakeGenerator) GenerateLiveSlides(context.Context, string, string, string, string) (json.RawMessage, int, error) {
	f.calls++
	return json.RawMessage(`{"title":"Stacks","slides":[{"layout":"title","title":"Stacks"},{"layout":"bullets","title":"Push","bullets":["add on top"]},{"layout":"bullets","title":"Pop","bullets":["remove from top"]}]}`), 3, nil
}

func (f *fakeGenerator) GenerateLiveSimulation(context.Context, string, string, string, string) (json.RawMessage, json.RawMessage, error) {
	f.calls++
	return json.RawMessage(`{"engine":"projectile","title":"Throw","explanation":"","observe":[]}`),
		json.RawMessage(`{"angle":45,"speed":20,"gravity":9.8,"height":0,"_run":0}`), nil
}

// TestWorkflowDB_LiveCanvas generates, moves and answers on the live canvas as connect_app.
func TestWorkflowDB_LiveCanvas(t *testing.T) {
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
	_, app := open("TEST_DATABASE_URL"), open("TEST_CONNECT_APP_URL")
	room.SetGuestTokenSecret([]byte("live-canvas-integration-secret-012345"))
	t.Cleanup(room.ResetGuestTokenSecretForTest)
	gen := &fakeGenerator{}
	api := apiClient{t: t, router: newRuntimeRouterWith(t, app, nil, func(h *interaction.Handler) { h.SetLiveGenerator(gen) })}

	_, hostToken := api.signup()
	_, memberToken := api.signup()
	_, strangerToken := api.signup()
	host, member, stranger := caller{token: hostToken}, caller{token: memberToken}, caller{token: strangerToken}

	res := api.want("create", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", host, map[string]any{})
	code := field(res, "room", "publicCode")
	api.want("host joins", http.StatusOK, http.MethodPost, roomPath(code)+"/join", host, map[string]any{})
	api.want("member joins", http.StatusOK, http.MethodPost, roomPath(code)+"/join", member, map[string]any{})
	path := roomPath(code) + "/canvas"

	t.Run("empty canvas", func(t *testing.T) {
		s := api.want("empty", http.StatusOK, http.MethodGet, path, member, nil)
		if s["kind"] != nil || s["canManage"] != false {
			t.Errorf("state: %v", s)
		}
		api.want("stranger", http.StatusForbidden, http.MethodGet, path, stranger, nil)
		api.want("anonymous", http.StatusUnauthorized, http.MethodGet, path, caller{}, nil)
	})

	t.Run("only moderators generate, and the model is not called for others", func(t *testing.T) {
		api.want("member refused", http.StatusForbidden, http.MethodPost, path+"/generate", member, map[string]any{"kind": "slides", "prompt": "stacks"})
		if gen.calls != 0 {
			t.Fatalf("generator called %d times for a member", gen.calls)
		}
		api.want("bad kind", http.StatusBadRequest, http.MethodPost, path+"/generate", host, map[string]any{"kind": "html", "prompt": "x"})
		s := api.want("host generates", http.StatusCreated, http.MethodPost, path+"/generate", host, map[string]any{"kind": "slides", "prompt": "stacks"})
		if s["kind"] != "slides" || s["slideCount"] != 3.0 || s["slide"] != 1.0 {
			t.Errorf("state: %v", s)
		}
		if seen := api.want("member reads", http.StatusOK, http.MethodGet, path, member, nil); seen["kind"] != "slides" {
			t.Errorf("member state: %v", seen)
		}
	})

	t.Run("slides move and edit; members cannot", func(t *testing.T) {
		api.want("member move", http.StatusForbidden, http.MethodPatch, path, member, map[string]any{"slide": 2})
		api.want("out of range", http.StatusUnprocessableEntity, http.MethodPatch, path, host, map[string]any{"slide": 9})
		if s := api.want("move", http.StatusOK, http.MethodPatch, path, host, map[string]any{"slide": 3}); s["slide"] != 3.0 {
			t.Errorf("slide: %v", s["slide"])
		}
		edit := map[string]any{"slide": map[string]any{"layout": "bullets", "title": "Pop, edited", "bullets": []string{"LIFO"}}}
		api.want("member edit", http.StatusForbidden, http.MethodPut, path+"/slides/2", member, edit)
		s := api.want("edit", http.StatusOK, http.MethodPut, path+"/slides/2", host, edit)
		var deck struct {
			Slides []struct{ Title string } `json:"slides"`
		}
		raw, _ := json.Marshal(s["content"])
		if err := json.Unmarshal(raw, &deck); err != nil || deck.Slides[2].Title != "Pop, edited" {
			t.Errorf("edited deck: %s", raw)
		}
		api.want("missing slide", http.StatusUnprocessableEntity, http.MethodPut, path+"/slides/7", host, edit)
		api.want("settings on slides", http.StatusUnprocessableEntity, http.MethodPatch, path, host, map[string]any{"params": map[string]any{"angle": 30}})
	})

	t.Run("sandbox answers only while open, clamped, private to the student", func(t *testing.T) {
		api.want("simulation", http.StatusCreated, http.MethodPost, path+"/generate", host, map[string]any{"kind": "simulation", "prompt": "throw"})
		answer := map[string]any{"params": map[string]any{"angle": 500, "speed": 10}}
		api.want("closed for answers", http.StatusUnprocessableEntity, http.MethodPost, path+"/submit", member, answer)
		api.want("member opens sandbox", http.StatusForbidden, http.MethodPatch, path, member, map[string]any{"mode": "sandbox"})
		api.want("open sandbox", http.StatusOK, http.MethodPatch, path, host, map[string]any{"mode": "sandbox", "params": map[string]any{"angle": 60}})
		s := api.want("answer", http.StatusOK, http.MethodPost, path+"/submit", member, answer)
		mine, _ := s["myAnswer"].(map[string]any)
		if mine == nil || mine["angle"] != 85.0 {
			t.Errorf("answer not clamped: %v", s["myAnswer"])
		}
		if all := rowsOf(api.want("host list", http.StatusOK, http.MethodGet, path+"/submissions", host, nil), "answers"); len(all) != 1 {
			t.Errorf("host sees %d answers", len(all))
		}
		api.want("host answers too", http.StatusOK, http.MethodPost, path+"/submit", host, answer)
		if own := rowsOf(api.want("member list", http.StatusOK, http.MethodGet, path+"/submissions", member, nil), "answers"); len(own) != 1 || own[0]["identity"] == nil {
			t.Errorf("member should see only their own answer: %v", own)
		}
		api.want("new simulation", http.StatusCreated, http.MethodPost, path+"/generate", host, map[string]any{"kind": "simulation", "prompt": "again"})
		if all := rowsOf(api.want("after regenerate", http.StatusOK, http.MethodGet, path+"/submissions", host, nil), "answers"); len(all) != 0 {
			t.Errorf("old answers still listed: %d", len(all))
		}
	})

	t.Run("closing clears the canvas", func(t *testing.T) {
		api.want("member stop", http.StatusForbidden, http.MethodPatch, path, member, map[string]any{"stop": true})
		if s := api.want("stop", http.StatusOK, http.MethodPatch, path, host, map[string]any{"stop": true}); s["kind"] != nil {
			t.Errorf("after stop: %v", s)
		}
	})
}
