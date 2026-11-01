package files_test

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/files"
	"github.com/tathastu/connect/services/api/internal/middleware"
	"github.com/tathastu/connect/services/api/internal/notes"
	"github.com/tathastu/connect/services/api/internal/room"
)

type cleanScanner struct{}

func (cleanScanner) Scan(context.Context, *files.MeetingFile, []byte) (files.ScanStatus, string, error) {
	return files.ScanStatusAvailable, "clean", nil
}

type fileRoom struct {
	id, code, hostToken string
}

// TestWorkflowDB_FilesHTTP drives the real routes against connect_app. Session validation
// uses the admin pool because the auth module is not yet converted.
func TestWorkflowDB_FilesHTTP(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	pool := func(name string) *pgxpool.Pool {
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
	admin, app := pool("TEST_DATABASE_URL"), pool("TEST_CONNECT_APP_URL")

	room.SetGuestTokenSecret([]byte("files-integration-test-secret-0123456789"))
	t.Cleanup(room.ResetGuestTokenSecretForTest)

	authService := auth.NewService(auth.NewPgxRepository(admin), nil, time.Hour, time.Hour)
	svc := files.NewService(files.NewPgxRepository(app), files.NewMemoryStorageProvider(), cleanScanner{}, notes.NewPgxRoomValidator(app), nil)
	h := files.NewHandler(svc)
	r := chi.NewRouter()
	r.Group(func(g chi.Router) {
		g.Use(middleware.OptionalAuth(authService))
		h.RegisterRoutes(g)
	})

	addUser := func() (string, string) {
		t.Helper()
		id, token := uuid.NewString(), uuid.NewString()
		if _, err := admin.Exec(ctx, `INSERT INTO users (id, email_normalized, display_name, password_hash) VALUES ($1, $2, 'U', 'x')`, id, id+"@example.test"); err != nil {
			t.Fatal(err)
		}
		if _, err := admin.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, id, auth.HashSessionToken(token)); err != nil {
			t.Fatal(err)
		}
		return id, token
	}
	addRoom := func() fileRoom {
		t.Helper()
		hostID, token := addUser()
		code, err := room.GeneratePublicCode()
		if err != nil {
			t.Fatal(err)
		}
		f := fileRoom{code: code, hostToken: token}
		if err := admin.QueryRow(ctx, `INSERT INTO rooms (public_code, host_user_id, workspace_type) VALUES ($1, $2, 'personal_commons') RETURNING id::text`, code, hostID).Scan(&f.id); err != nil {
			t.Fatal(err)
		}
		return f
	}
	joinUser := func(f fileRoom) string {
		t.Helper()
		id, token := addUser()
		if _, err := admin.Exec(ctx, `INSERT INTO room_participants (room_id, user_id, identity, display_name) VALUES ($1, $2, $3, 'P')`, f.id, id, "user:"+id); err != nil {
			t.Fatal(err)
		}
		return token
	}
	joinGuest := func(f fileRoom) string {
		t.Helper()
		identity := "guest:" + uuid.NewString()
		if _, err := admin.Exec(ctx, `INSERT INTO room_participants (room_id, identity, display_name, is_guest) VALUES ($1, $2, 'G', true)`, f.id, identity); err != nil {
			t.Fatal(err)
		}
		token, err := room.GenerateGuestToken(f.code, identity, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		return token
	}

	send := func(req *http.Request, token, guest string) *httptest.ResponseRecorder {
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if guest != "" {
			req.Header.Set("X-Guest-Token", guest)
		}
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec
	}
	upload := func(code, token, guest string) (int, string) {
		t.Helper()
		var body bytes.Buffer
		w := multipart.NewWriter(&body)
		part, err := w.CreateFormFile("file", "notes.txt")
		if err != nil {
			t.Fatal(err)
		}
		_, _ = part.Write([]byte("private tenant content"))
		_ = w.Close()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/rooms/"+code+"/files/upload", &body)
		req.Header.Set("Content-Type", w.FormDataContentType())
		rec := send(req, token, guest)
		var res files.FileUploadResponse
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if res.File == nil {
			return rec.Code, ""
		}
		return rec.Code, res.File.ID
	}
	call := func(method, path, token, guest string) *httptest.ResponseRecorder {
		return send(httptest.NewRequest(method, path, nil), token, guest)
	}
	expect := func(name string, got, want int) {
		t.Helper()
		if got != want {
			t.Errorf("%s: expected %d, got %d", name, want, got)
		}
	}

	a, b := addRoom(), addRoom()
	base := "/api/v1/rooms/" + a.code + "/files"
	member := joinUser(a)
	otherMember := joinUser(a)
	guest := joinGuest(a)

	code, hostFile := upload(a.code, a.hostToken, "")
	if code >= 300 || hostFile == "" {
		t.Fatalf("host upload: %d", code)
	}
	code, memberFile := upload(a.code, member, "")
	if code >= 300 || memberFile == "" {
		t.Fatalf("member upload: %d", code)
	}
	code, guestFile := upload(a.code, "", guest)
	if code >= 300 || guestFile == "" {
		t.Fatalf("guest upload: %d", code)
	}

	t.Run("participants read", func(t *testing.T) {
		rec := call(http.MethodGet, base, otherMember, "")
		expect("list", rec.Code, http.StatusOK)
		var res files.FileListResponse
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if len(res.Files) != 3 {
			t.Errorf("expected 3 files, got %d", len(res.Files))
		}
		expect("member download", call(http.MethodGet, base+"/"+hostFile+"/download", otherMember, "").Code, http.StatusOK)
		expect("guest list", call(http.MethodGet, base, "", guest).Code, http.StatusOK)
		expect("guest download", call(http.MethodGet, base+"/"+hostFile+"/download", "", guest).Code, http.StatusOK)
	})

	t.Run("other tenant is denied", func(t *testing.T) {
		expect("list", call(http.MethodGet, base, b.hostToken, "").Code, http.StatusForbidden)
		expect("download", call(http.MethodGet, base+"/"+hostFile+"/download", b.hostToken, "").Code, http.StatusForbidden)
		expect("delete", call(http.MethodDelete, base+"/"+hostFile, b.hostToken, "").Code, http.StatusForbidden)
		code, _ := upload(a.code, b.hostToken, "")
		expect("upload", code, http.StatusForbidden)
		// A file id from room A requested through the caller's own room B.
		rec := call(http.MethodGet, "/api/v1/rooms/"+b.code+"/files/"+hostFile+"/download", b.hostToken, "")
		expect("id through own room", rec.Code, http.StatusNotFound)
	})

	t.Run("unauthenticated is rejected", func(t *testing.T) {
		expect("no credentials", call(http.MethodGet, base, "", "").Code, http.StatusUnauthorized)
		expect("guest token for another room", call(http.MethodGet, "/api/v1/rooms/"+b.code+"/files", "", guest).Code, http.StatusUnauthorized)
	})

	t.Run("delete follows host and uploader rules", func(t *testing.T) {
		expect("non-uploader", call(http.MethodDelete, base+"/"+memberFile, otherMember, "").Code, http.StatusForbidden)
		expect("guest on another's file", call(http.MethodDelete, base+"/"+hostFile, "", guest).Code, http.StatusForbidden)
		if got := call(http.MethodDelete, base+"/"+memberFile, a.hostToken, "").Code; got >= 300 {
			t.Errorf("host delete: %d", got)
		}
		if got := call(http.MethodDelete, base+"/"+guestFile, "", guest).Code; got >= 300 {
			t.Errorf("guest own delete: %d", got)
		}
		var jobs int
		if err := admin.QueryRow(ctx, `SELECT count(*) FROM background_jobs WHERE idempotency_key LIKE $1`, "file-purge-"+memberFile+"%").Scan(&jobs); err != nil || jobs != 1 {
			t.Errorf("purge jobs=%d err=%v", jobs, err)
		}
	})

	t.Run("database enforces without the service", func(t *testing.T) {
		var visible int
		if err := app.QueryRow(ctx, `SELECT count(*) FROM meeting_files WHERE room_id = $1`, a.id).Scan(&visible); err != nil || visible != 0 {
			t.Errorf("no context: visible=%d err=%v", visible, err)
		}

		err := database.WithAuthContext(ctx, app, auth.HashSessionToken(b.hostToken), nil, func(tx pgx.Tx, _ *database.AuthContext) error {
			if err := tx.QueryRow(ctx, `SELECT count(*) FROM meeting_files WHERE room_id = $1`, a.id).Scan(&visible); err != nil {
				return err
			}
			if visible != 0 {
				t.Errorf("other tenant sees %d files", visible)
			}
			tag, err := tx.Exec(ctx, `UPDATE meeting_files SET scan_status = 'deleted' WHERE room_id = $1`, a.id)
			if err != nil {
				return err
			}
			if tag.RowsAffected() != 0 {
				t.Errorf("other tenant updated %d files", tag.RowsAffected())
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}

		// A guest context from room B cannot reach room A.
		bGuest := "guest:" + uuid.NewString()
		if _, err := admin.Exec(ctx, `INSERT INTO room_participants (room_id, identity, display_name, is_guest) VALUES ($1, $2, 'G', true)`, b.id, bGuest); err != nil {
			t.Fatal(err)
		}
		err = database.WithRoomGuestContext(ctx, app, b.id, bGuest, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, `SELECT count(*) FROM meeting_files WHERE room_id = $1`, a.id).Scan(&visible)
		})
		if err != nil || visible != 0 {
			t.Errorf("guest of another room: visible=%d err=%v", visible, err)
		}

		// A user identity and a stranger are refused the guest context.
		noop := func(pgx.Tx) error { return nil }
		if err := database.WithRoomGuestContext(ctx, app, a.id, "user:"+uuid.NewString(), noop); err == nil {
			t.Error("guest context accepted a user identity")
		}
		if err := database.WithRoomGuestContext(ctx, app, a.id, "guest:"+uuid.NewString(), noop); err == nil {
			t.Error("guest context accepted a non-participant")
		}

		// Settings written directly, without the signature function, grant nothing.
		tx, err := app.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `SELECT set_config('app._guest_room', $1, true), set_config('app._guest_identity', 'guest:x', true),
			set_config('app._guest_nonce', 'n', true), set_config('app._guest_xid', pg_current_xact_id()::text, true),
			set_config('app._guest_exp', '9999999999', true), set_config('app._guest_sig', 'forged', true)`, a.id); err != nil {
			t.Fatal(err)
		}
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM meeting_files WHERE room_id = $1`, a.id).Scan(&visible); err != nil || visible != 0 {
			t.Errorf("forged guest context: visible=%d err=%v", visible, err)
		}
	})
}
