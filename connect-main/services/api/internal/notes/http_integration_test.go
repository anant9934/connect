package notes_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/middleware"
	"github.com/tathastu/connect/services/api/internal/notes"
	"github.com/tathastu/connect/services/api/internal/room"
)

type notesEnv struct {
	t      *testing.T
	ctx    context.Context
	admin  *pgxpool.Pool
	app    *pgxpool.Pool
	router http.Handler
}

type tenantRoom struct {
	orgID, roomID, code, hostID, hostToken string
}

func envPool(t *testing.T, ctx context.Context, name string) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv(name)
	if url == "" {
		t.Skipf("NOT VERIFIED: %s is required", name)
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// addUser creates an active member of orgID with a live session and returns its raw token.
func (e *notesEnv) addUser(orgID, role string) (id, token string) {
	e.t.Helper()
	id = uuid.NewString()
	token = uuid.NewString()
	for _, s := range []struct {
		q    string
		args []any
	}{
		{`INSERT INTO users (id, email_normalized, display_name, password_hash) VALUES ($1, $2, 'Member', 'x')`, []any{id, id + "@example.test"}},
		{`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`, []any{orgID, id, role}},
		{`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, []any{id, auth.HashSessionToken(token)}},
	} {
		if _, err := e.admin.Exec(e.ctx, s.q, s.args...); err != nil {
			e.t.Fatal(err)
		}
	}
	return id, token
}

func (e *notesEnv) addTenantRoom() tenantRoom {
	e.t.Helper()
	suffix := uuid.NewString()[:8]
	var r tenantRoom
	r.code = "nt-" + suffix
	if err := e.admin.QueryRow(e.ctx, `INSERT INTO organizations (slug, name) VALUES ($1, 'Tenant') RETURNING id::text`, "notes-"+suffix).Scan(&r.orgID); err != nil {
		e.t.Fatal(err)
	}
	r.hostID, r.hostToken = e.addUser(r.orgID, "faculty")
	// Instant meetings are personal_commons rooms; each host belongs to a different organization.
	if err := e.admin.QueryRow(e.ctx, `INSERT INTO rooms (public_code, host_user_id, workspace_type) VALUES ($1, $2, 'personal_commons') RETURNING id::text`,
		r.code, r.hostID).Scan(&r.roomID); err != nil {
		e.t.Fatal(err)
	}
	return r
}

func (e *notesEnv) join(roomID, identity string, userID *string, isGuest bool) {
	e.t.Helper()
	if _, err := e.admin.Exec(e.ctx, `INSERT INTO room_participants (room_id, user_id, identity, display_name, is_guest) VALUES ($1, $2, $3, 'P', $4)`,
		roomID, userID, identity, isGuest); err != nil {
		e.t.Fatal(err)
	}
}

type creds struct {
	token, guest, claimed string
}

func (e *notesEnv) do(method, code string, c creds, body any) (int, notes.MeetingNote) {
	e.t.Helper()
	var payload bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&payload).Encode(body); err != nil {
			e.t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, "/api/v1/rooms/"+code+"/notes", &payload)
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	if c.guest != "" {
		req.Header.Set("X-Guest-Token", c.guest)
	}
	if c.claimed != "" {
		req.Header.Set("X-Participant-Identity", c.claimed)
	}
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	var res notes.NoteResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Note == nil {
		return rec.Code, notes.MeetingNote{}
	}
	return rec.Code, *res.Note
}

func expect(t *testing.T, name string, got, want int) {
	t.Helper()
	if got != want {
		t.Fatalf("%s: expected %d, got %d", name, want, got)
	}
}

func write(title, content string, rev int) notes.UpdateNoteRequest {
	return notes.UpdateNoteRequest{Title: title, Content: content, ExpectedRevision: rev}
}

// TestWorkflowDB_NotesHTTP drives the real routes and middleware against connect_app.
// Session validation uses the admin pool because the auth module is not yet converted.
func TestWorkflowDB_NotesHTTP(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	admin := envPool(t, ctx, "TEST_DATABASE_URL")
	app := envPool(t, ctx, "TEST_CONNECT_APP_URL")

	room.SetGuestTokenSecret([]byte("notes-integration-test-secret-0123456789"))
	t.Cleanup(room.ResetGuestTokenSecretForTest)

	authService := auth.NewService(auth.NewPgxRepository(admin), nil, time.Hour, time.Hour)
	handler := notes.NewHandler(notes.NewService(notes.NewPgxRepository(app), notes.NewPgxRoomValidator(app), nil))
	r := chi.NewRouter()
	r.With(middleware.OptionalAuth(authService)).Get("/api/v1/rooms/{code}/notes", handler.GetNotes)
	r.With(middleware.OptionalAuth(authService)).Put("/api/v1/rooms/{code}/notes", handler.UpdateNotes)

	e := &notesEnv{t: t, ctx: ctx, admin: admin, app: app, router: r}
	a := e.addTenantRoom()
	b := e.addTenantRoom()

	hostA := creds{token: a.hostToken}
	hostB := creds{token: b.hostToken}
	studentID, studentToken := e.addUser(a.orgID, "student")
	e.join(a.roomID, "user:"+studentID, &studentID, false)
	student := creds{token: studentToken}
	_, adminToken := e.addUser(a.orgID, "institution_admin")

	t.Run("host creates and participant collaborates", func(t *testing.T) {
		code, note := e.do(http.MethodPut, a.code, hostA, write("A", "secret-a", 1))
		expect(t, "host create", code, http.StatusOK)
		if note.Revision != 2 {
			t.Fatalf("unexpected revision %d", note.Revision)
		}
		code, note = e.do(http.MethodGet, a.code, student, nil)
		expect(t, "participant read", code, http.StatusOK)
		if note.Content != "secret-a" {
			t.Fatalf("participant read wrong content %q", note.Content)
		}
		code, note = e.do(http.MethodPut, a.code, student, write("A", "edited", 2))
		expect(t, "non-creator update", code, http.StatusOK)
		if note.Revision != 3 || note.UpdatedByIdentity != "user:"+studentID {
			t.Fatalf("unexpected note %+v", note)
		}
	})

	t.Run("stale revision conflicts", func(t *testing.T) {
		code, _ := e.do(http.MethodPut, a.code, student, write("A", "stale", 2))
		expect(t, "stale", code, http.StatusConflict)
	})

	t.Run("cross tenant read and update are denied", func(t *testing.T) {
		code, note := e.do(http.MethodGet, a.code, hostB, nil)
		expect(t, "read", code, http.StatusForbidden)
		if note.Content != "" {
			t.Fatal("content leaked across tenants")
		}
		code, _ = e.do(http.MethodPut, a.code, hostB, write("X", "overwrite", 3))
		expect(t, "update", code, http.StatusForbidden)
	})

	t.Run("organization admin outside the room is denied", func(t *testing.T) {
		code, _ := e.do(http.MethodGet, a.code, creds{token: adminToken}, nil)
		expect(t, "read", code, http.StatusForbidden)
	})

	t.Run("delete has no route", func(t *testing.T) {
		code, _ := e.do(http.MethodDelete, a.code, hostB, nil)
		expect(t, "delete", code, http.StatusMethodNotAllowed)
	})

	t.Run("rls alone blocks another tenant", func(t *testing.T) {
		err := database.WithAuthContext(ctx, app, auth.HashSessionToken(b.hostToken), nil, func(tx pgx.Tx, _ *database.AuthContext) error {
			var visible int
			if err := tx.QueryRow(ctx, `SELECT count(*) FROM meeting_notes WHERE room_id = $1`, a.roomID).Scan(&visible); err != nil {
				return err
			}
			if visible != 0 {
				t.Errorf("other tenant sees %d notes", visible)
			}
			for _, q := range []string{
				`UPDATE meeting_notes SET content = 'x' WHERE room_id = $1`,
				`DELETE FROM meeting_notes WHERE room_id = $1`,
			} {
				tag, err := tx.Exec(ctx, q, a.roomID)
				if err != nil {
					return err
				}
				if tag.RowsAffected() != 0 {
					t.Errorf("%s changed %d rows", q, tag.RowsAffected())
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	})

	t.Run("missing context sees nothing", func(t *testing.T) {
		var visible int
		if err := app.QueryRow(ctx, `SELECT count(*) FROM meeting_notes WHERE room_id = $1`, a.roomID).Scan(&visible); err != nil {
			t.Fatal(err)
		}
		if visible != 0 {
			t.Fatalf("no context, yet %d notes visible", visible)
		}
	})

	t.Run("invalid membership is refused", func(t *testing.T) {
		err := database.WithAuthContext(ctx, app, auth.HashSessionToken(b.hostToken), &a.orgID, func(pgx.Tx, *database.AuthContext) error { return nil })
		if err == nil {
			t.Fatal("foreign organization accepted")
		}
	})

	t.Run("unauthenticated and forged callers are rejected", func(t *testing.T) {
		code, _ := e.do(http.MethodGet, a.code, creds{}, nil)
		expect(t, "no credentials", code, http.StatusUnauthorized)
		code, _ = e.do(http.MethodGet, a.code, creds{token: "not-a-session"}, nil)
		expect(t, "bad session", code, http.StatusUnauthorized)
		code, _ = e.do(http.MethodGet, a.code, creds{token: b.hostToken, claimed: "user:" + a.hostID}, nil)
		expect(t, "forged identity", code, http.StatusUnauthorized)
	})

	t.Run("revoked session is rejected", func(t *testing.T) {
		id, token := e.addUser(a.orgID, "student")
		e.join(a.roomID, "user:"+id, &id, false)
		if _, err := admin.Exec(ctx, `UPDATE sessions SET revoked_at = now() WHERE user_id = $1`, id); err != nil {
			t.Fatal(err)
		}
		code, _ := e.do(http.MethodGet, a.code, creds{token: token}, nil)
		expect(t, "revoked", code, http.StatusUnauthorized)
	})

	t.Run("left and removed participants are denied", func(t *testing.T) {
		leftID, leftToken := e.addUser(a.orgID, "student")
		e.join(a.roomID, "user:"+leftID, &leftID, false)
		removedID, removedToken := e.addUser(a.orgID, "student")
		e.join(a.roomID, "user:"+removedID, &removedID, false)
		if _, err := admin.Exec(ctx, `UPDATE room_participants SET left_at = now() WHERE identity = $1`, "user:"+leftID); err != nil {
			t.Fatal(err)
		}
		if _, err := admin.Exec(ctx, `UPDATE room_participants SET is_removed = true WHERE identity = $1`, "user:"+removedID); err != nil {
			t.Fatal(err)
		}
		code, _ := e.do(http.MethodGet, a.code, creds{token: leftToken}, nil)
		expect(t, "left", code, http.StatusForbidden)
		code, _ = e.do(http.MethodPut, a.code, creds{token: removedToken}, write("X", "x", 3))
		expect(t, "removed", code, http.StatusForbidden)
	})

	t.Run("guests", func(t *testing.T) {
		identity := "guest:" + uuid.NewString()
		e.join(a.roomID, identity, nil, true)
		guestToken, err := room.GenerateGuestToken(room.NormalizeCode(a.code), identity, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		guest := creds{guest: guestToken}
		code, note := e.do(http.MethodGet, a.code, guest, nil)
		expect(t, "guest read", code, http.StatusOK)
		code, updated := e.do(http.MethodPut, a.code, guest, write("A", "from guest", note.Revision))
		expect(t, "guest write", code, http.StatusOK)
		if updated.Revision != note.Revision+1 {
			t.Fatalf("unexpected revision %d", updated.Revision)
		}
		code, _ = e.do(http.MethodPut, a.code, guest, write("A", "stale", note.Revision))
		expect(t, "guest stale", code, http.StatusConflict)

		code, _ = e.do(http.MethodGet, b.code, guest, nil)
		expect(t, "token for another room", code, http.StatusUnauthorized)

		other := "guest:" + uuid.NewString()
		otherToken, err := room.GenerateGuestToken(room.NormalizeCode(a.code), other, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		code, _ = e.do(http.MethodGet, a.code, creds{guest: otherToken}, nil)
		expect(t, "valid token, never joined", code, http.StatusForbidden)

		for _, q := range []string{
			`SELECT count(*) FROM connect_auth.guest_read_note($1, $2)`,
		} {
			var n int
			if err := app.QueryRow(ctx, q, a.roomID, "user:"+a.hostID).Scan(&n); err == nil {
				t.Fatal("guest function accepted a user identity")
			}
		}
	})

	t.Run("concurrent tenants do not leak through the pool", func(t *testing.T) {
		code, _ := e.do(http.MethodPut, b.code, hostB, write("B", "secret-b", 1))
		expect(t, "seed tenant b", code, http.StatusOK)
		var wg sync.WaitGroup
		errs := make(chan string, 40)
		for i := range 40 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				c, roomCode, foreign := hostA, a.code, "secret-b"
				if i%2 == 1 {
					c, roomCode, foreign = hostB, b.code, "from guest"
				}
				code, note := e.do(http.MethodGet, roomCode, c, nil)
				if code != http.StatusOK || note.Content == foreign {
					errs <- fmt.Sprintf("request %d: code %d content %q", i, code, note.Content)
				}
			}()
		}
		wg.Wait()
		close(errs)
		for msg := range errs {
			t.Error(msg)
		}
	})
}
