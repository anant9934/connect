package server_test

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/room"
)

// TestWorkflowDB_ClassroomBoards draws and presents through the API as connect_app, as each role.
func TestWorkflowDB_ClassroomBoards(t *testing.T) {
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
	room.SetGuestTokenSecret([]byte("classroom-board-integration-secret-0123"))
	t.Cleanup(room.ResetGuestTokenSecretForTest)
	api := apiClient{t: t, router: newRuntimeRouter(t, app, nil)}

	_, hostToken := api.signup()
	_, memberToken := api.signup()
	_, strangerToken := api.signup()
	host, member, stranger := caller{token: hostToken}, caller{token: memberToken}, caller{token: strangerToken}

	create := func(who caller) (id, code string) {
		t.Helper()
		res := api.want("create", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", who, map[string]any{})
		return field(res, "room", "id"), field(res, "room", "publicCode")
	}
	roomID, code := create(host)
	api.want("host joins", http.StatusOK, http.MethodPost, roomPath(code)+"/join", host, map[string]any{})
	api.want("member joins", http.StatusOK, http.MethodPost, roomPath(code)+"/join", member, map[string]any{})

	strokeNo := 0
	stroke := func(board string) map[string]any {
		strokeNo++
		return map[string]any{"clientStrokeId": fmt.Sprintf("s%d", strokeNo), "board": board, "color": "#112233", "width": 3, "points": [][]float64{{0.1, 0.1}, {0.9, 0.5}}}
	}
	post := func(name string, want int, who caller, body map[string]any) {
		t.Helper()
		api.want(name, want, http.MethodPost, roomPath(code)+"/board/strokes", who, body)
	}
	strokes := func(who caller, board string, after int) []map[string]any {
		t.Helper()
		path := fmt.Sprintf("%s/board?board=%s&afterSeq=%d", roomPath(code), board, after)
		return rowsOf(api.want("strokes", http.StatusOK, http.MethodGet, path, who, nil), "strokes")
	}
	state := func(who caller) map[string]any {
		t.Helper()
		return api.want("state", http.StatusOK, http.MethodGet, roomPath(code)+"/classroom", who, nil)
	}
	patch := func(name string, want int, who caller, body map[string]any) {
		t.Helper()
		api.want(name, want, http.MethodPatch, roomPath(code)+"/classroom", who, body)
	}

	t.Run("only those allowed may draw, and everyone in the room sees it", func(t *testing.T) {
		post("host draws", http.StatusCreated, host, stroke("whiteboard"))
		before := len(strokes(member, "whiteboard", 0))
		if before != 1 {
			t.Errorf("member sees %d strokes", before)
		}
		// RLS rejects the insert for a member while drawing is closed.
		post("member blocked", http.StatusForbidden, member, stroke("whiteboard"))
		if s := state(member); s["canDraw"] != false || s["canManage"] != false {
			t.Errorf("member state: %v", s)
		}
		patch("member cannot open drawing", http.StatusForbidden, member, map[string]any{"studentsCanDraw": true})
		patch("host opens drawing", http.StatusOK, host, map[string]any{"studentsCanDraw": true})
		if s := state(member); s["canDraw"] != true {
			t.Errorf("member state after opening: %v", s)
		}
		post("member draws", http.StatusCreated, member, stroke("whiteboard"))
		if got := len(strokes(host, "whiteboard", 0)); got != 2 {
			t.Errorf("host sees %d strokes", got)
		}
		api.want("stranger cannot read", http.StatusForbidden, http.MethodGet, roomPath(code)+"/board?board=whiteboard&afterSeq=0", stranger, nil)
		post("stranger cannot draw", http.StatusForbidden, stranger, stroke("whiteboard"))
		api.want("anonymous", http.StatusUnauthorized, http.MethodGet, roomPath(code)+"/classroom", caller{}, nil)
	})

	t.Run("a retry stores one stroke, and reading resumes after a sequence", func(t *testing.T) {
		body := stroke("whiteboard")
		post("first", http.StatusCreated, host, body)
		post("retry", http.StatusCreated, host, body)
		all := strokes(host, "whiteboard", 0)
		if len(all) != 3 {
			t.Fatalf("expected 3 strokes, got %d", len(all))
		}
		newest := int(all[len(all)-1]["seq"].(float64))
		if got := len(strokes(host, "whiteboard", newest-1)); got != 1 {
			t.Errorf("after: %d", got)
		}
		if got := len(strokes(host, "whiteboard", newest)); got != 0 {
			t.Errorf("after newest: %d", got)
		}
	})

	t.Run("invalid strokes are refused", func(t *testing.T) {
		for name, change := range map[string]map[string]any{
			"out of range":  {"points": [][]float64{{1.5, 0.1}}},
			"not a pair":    {"points": [][]float64{{0.1}}},
			"no points":     {"points": [][]float64{}},
			"color":         {"color": "red;drop"},
			"width":         {"width": 100},
			"tool":          {"tool": "laser"},
			"board":         {"board": "../other"},
			"client id":     {"clientStrokeId": "bad id!"},
			"unknown field": {"author": "user:someone"},
		} {
			body := stroke("whiteboard")
			for k, v := range change {
				body[k] = v
			}
			post(name, http.StatusBadRequest, host, body)
		}
		tooMany := make([][]float64, 2001)
		for i := range tooMany {
			tooMany[i] = []float64{0.5, 0.5}
		}
		body := stroke("whiteboard")
		body["points"] = tooMany
		post("too many points", http.StatusBadRequest, host, body)
		api.want("bad board read", http.StatusBadRequest, http.MethodGet, roomPath(code)+"/board?board=nope&afterSeq=0", host, nil)
	})

	t.Run("undo removes only your own, and clearing needs moderation", func(t *testing.T) {
		count := len(strokes(host, "whiteboard", 0))
		version := state(host)["version"].(float64)
		res := api.want("member undo", http.StatusOK, http.MethodPost, roomPath(code)+"/board/remove", member, map[string]any{"board": "whiteboard"})
		if res["removed"] != float64(1) {
			t.Errorf("undo: %v", res)
		}
		res = api.want("member undo again", http.StatusOK, http.MethodPost, roomPath(code)+"/board/remove", member, map[string]any{"board": "whiteboard"})
		if res["removed"] != float64(0) {
			t.Errorf("member removed someone else's stroke: %v", res)
		}
		if got := len(strokes(host, "whiteboard", 0)); got != count-1 {
			t.Errorf("after undo: %d of %d", got, count)
		}
		if state(host)["version"].(float64) <= version {
			t.Error("undo did not change the version, so others would keep showing it")
		}
		api.want("member cannot clear", http.StatusForbidden, http.MethodPost, roomPath(code)+"/board/remove", member, map[string]any{"board": "whiteboard", "all": true})
		api.want("host clears", http.StatusOK, http.MethodPost, roomPath(code)+"/board/remove", host, map[string]any{"board": "whiteboard", "all": true})
		if got := len(strokes(member, "whiteboard", 0)); got != 0 {
			t.Errorf("after clear: %d", got)
		}
	})

	t.Run("presentations belong to the room and the page is shared", func(t *testing.T) {
		otherRoomID, _ := create(stranger)
		addFile := func(room string) string {
			t.Helper()
			var id string
			err := admin.QueryRow(ctx, `
				INSERT INTO meeting_files (room_id, uploaded_by_identity, uploader_name, original_filename, sanitized_filename, content_type, size_bytes, storage_key, scan_status)
				VALUES ($1, 'user:x', 'X', 'deck.pdf', 'deck.pdf', 'application/pdf', 10, $2, 'available') RETURNING id::text`, room, uuid.NewString()).Scan(&id)
			if err != nil {
				t.Fatal(err)
			}
			return id
		}
		file, foreign := addFile(roomID), addFile(otherRoomID)
		image := addFile(roomID)
		quarantined := addFile(roomID)
		if _, err := admin.Exec(ctx, `UPDATE meeting_files SET content_type = 'image/png' WHERE id = $1`, image); err != nil {
			t.Fatal(err)
		}
		if _, err := admin.Exec(ctx, `UPDATE meeting_files SET scan_status = 'quarantined' WHERE id = $1`, quarantined); err != nil {
			t.Fatal(err)
		}
		patch("an image is not a presentation", http.StatusUnprocessableEntity, host, map[string]any{"fileId": image, "pages": 3})
		patch("a quarantined file", http.StatusNotFound, host, map[string]any{"fileId": quarantined, "pages": 3})

		patch("member cannot present", http.StatusForbidden, member, map[string]any{"fileId": file, "pages": 3})
		patch("a file from another room", http.StatusNotFound, host, map[string]any{"fileId": foreign, "pages": 3})
		patch("no page count", http.StatusUnprocessableEntity, host, map[string]any{"fileId": file})
		patch("zero pages", http.StatusUnprocessableEntity, host, map[string]any{"fileId": file, "pages": 0})
		patch("a page before presenting", http.StatusUnprocessableEntity, host, map[string]any{"page": 2})
		patch("bad file id", http.StatusBadRequest, host, map[string]any{"fileId": "../x", "pages": 3})
		patch("host presents", http.StatusOK, host, map[string]any{"fileId": file, "pages": 3})
		s := state(member)
		if s["fileId"] != file || s["page"] != float64(1) || s["pages"] != float64(3) || s["fileName"] != "deck.pdf" {
			t.Errorf("member state: %v", s)
		}
		patch("host turns the page", http.StatusOK, host, map[string]any{"page": 3})
		if s := state(member); s["page"] != float64(3) {
			t.Errorf("page: %v", s)
		}
		patch("member cannot turn it", http.StatusForbidden, member, map[string]any{"page": 1})
		patch("past the end", http.StatusUnprocessableEntity, host, map[string]any{"page": 4})
		patch("before the start", http.StatusUnprocessableEntity, host, map[string]any{"page": 0})
		if s := state(member); s["page"] != float64(3) {
			t.Errorf("a refused change moved the page: %v", s)
		}

		slide := "slide:" + file + ":3"
		post("annotate", http.StatusCreated, host, stroke(slide))
		if got := len(strokes(member, slide, 0)); got != 1 {
			t.Errorf("annotation: %d", got)
		}
		if got := len(strokes(member, "slide:"+file+":2", 0)); got != 0 {
			t.Errorf("annotation appeared on another page: %d", got)
		}

		patch("host stops", http.StatusOK, host, map[string]any{"stop": true})
		if s := state(member); s["fileId"] != nil || s["pages"] != float64(0) {
			t.Errorf("after stopping: %v", s)
		}
		// Who presented is written by the database from the caller, never from the request.
		patch("forged field", http.StatusBadRequest, host, map[string]any{"presenter": "user:someone"})
	})

	t.Run("guests can read and draw only under the same rule", func(t *testing.T) {
		res := api.want("guest joins", http.StatusOK, http.MethodPost, roomPath(code)+"/join", caller{}, map[string]any{"displayName": "Visitor"})
		guest := caller{guest: res["guestToken"].(string)}
		if s := state(guest); s["canManage"] != false {
			t.Errorf("guest state: %v", s)
		}
		patch("guest cannot manage", http.StatusForbidden, guest, map[string]any{"studentsCanDraw": false})
		post("guest may draw while open", http.StatusCreated, guest, stroke("whiteboard"))
		patch("host closes", http.StatusOK, host, map[string]any{"studentsCanDraw": false})
		post("guest blocked once closed", http.StatusForbidden, guest, stroke("whiteboard"))
	})
}
