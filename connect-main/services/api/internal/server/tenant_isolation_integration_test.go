package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/audit"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/config"
	"github.com/tathastu/connect/services/api/internal/files"
	"github.com/tathastu/connect/services/api/internal/handlers"
	"github.com/tathastu/connect/services/api/internal/livekit"
	"github.com/tathastu/connect/services/api/internal/meeting/p2p"
	"github.com/tathastu/connect/services/api/internal/notes"
	"github.com/tathastu/connect/services/api/internal/ratelimit"
	"github.com/tathastu/connect/services/api/internal/room"
	"github.com/tathastu/connect/services/api/internal/server"
)

// allowAll keeps rate limits out of this test; they have their own coverage.
type allowAll struct{}

func (allowAll) Allow(context.Context, string, int, time.Duration) (bool, error) { return true, nil }

type apiClient struct {
	t      *testing.T
	router http.Handler
}

type caller struct {
	token, guest string
}

func (c apiClient) call(method, path string, who caller, body any) (int, map[string]any) {
	c.t.Helper()
	var payload io.Reader = http.NoBody
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			c.t.Fatal(err)
		}
		payload = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:3000")
	if who.token != "" {
		req.Header.Set("Authorization", "Bearer "+who.token)
	}
	if who.guest != "" {
		req.Header.Set("X-Guest-Token", who.guest)
	}
	rec := httptest.NewRecorder()
	c.router.ServeHTTP(rec, req)
	var decoded map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &decoded)
	return rec.Code, decoded
}

func (c apiClient) want(name string, want int, method, path string, who caller, body any) map[string]any {
	c.t.Helper()
	got, decoded := c.call(method, path, who, body)
	if got != want {
		c.t.Errorf("%s: expected %d, got %d: %v", name, want, got, decoded)
	}
	return decoded
}

// signup creates an account through the real route, as connect_app, and returns its token.
func (c apiClient) signup() (id, token string) {
	c.t.Helper()
	email := uuid.NewString() + "@example.test"
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/signup", strings.NewReader(fmt.Sprintf(
		`{"email":%q,"password":"correct-horse-battery-9","displayName":"Member"}`, email)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:3000")
	rec := httptest.NewRecorder()
	c.router.ServeHTTP(rec, req)
	if rec.Code >= 300 {
		c.t.Fatalf("signup: %d %s", rec.Code, rec.Body.String())
	}
	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == auth.CookieDev || cookie.Name == auth.CookieProduction {
			token = cookie.Value
		}
	}
	var res struct {
		User struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if token == "" || res.User.ID == "" {
		c.t.Fatalf("signup returned no session: %s", rec.Body.String())
	}
	return res.User.ID, token
}

func newRuntimeRouter(t *testing.T, app *pgxpool.Pool) http.Handler {
	t.Helper()
	cfg := &config.Config{
		AppEnv:             config.EnvDevelopment,
		Port:               8080,
		CORSAllowedOrigins: []string{"http://localhost:3000"},
		TathastuIssuer:     "https://auth.aitathastu.internal",
		TathastuAudience:   "tathastu-connect-service",
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	var limiter ratelimit.Limiter = allowAll{}
	auditService := audit.NewService(app, logger)
	authService := auth.NewService(auth.NewPgxRepository(app), auditService, time.Hour, time.Hour)
	roomService := room.NewService(room.NewPgxRepository(app), room.NewPolicy(), auditService, livekit.NewTokenService("test_key", "test_secret_that_is_long_enough_for_tests"), nil)
	validator := notes.NewPgxRoomValidator(app)
	return server.BuildRouter(cfg, logger, limiter,
		handlers.NewHealthHandler(&mockPinger{}, &mockPinger{}, logger),
		handlers.NewSystemHandler("test"), handlers.NewAssertionHandler(cfg),
		auth.NewHandlers(authService, limiter, false),
		room.NewHandlers(roomService, nil, "http://localhost:3000", "http://localhost:7880"),
		notes.NewHandler(notes.NewService(notes.NewPgxRepository(app), validator, auditService)),
		files.NewHandler(files.NewService(files.NewPgxRepository(app), files.NewMemoryStorageProvider(), files.NewHeuristicScanner(), validator, auditService)),
		authService, p2p.NewHandler(cfg, logger, p2p.NewHub(logger), roomService, authService), nil)
}

// TestWorkflowDB_APITenantIsolation runs the full router with every module on connect_app,
// so nothing here depends on an owner connection except fixture setup and assertions.
func TestWorkflowDB_APITenantIsolation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
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

	room.SetGuestTokenSecret([]byte("isolation-integration-test-secret-012345"))
	t.Cleanup(room.ResetGuestTokenSecretForTest)

	api := apiClient{t: t, router: newRuntimeRouter(t, app)}
	roomPath := func(code string) string { return "/api/v1/rooms/" + code }

	createRoom := func(token string, waiting bool) string {
		t.Helper()
		res := api.want("create room", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", caller{token: token},
			map[string]any{"maxParticipants": 10, "waitingRoomEnabled": waiting})
		rm, _ := res["room"].(map[string]any)
		code, _ := rm["publicCode"].(string)
		if code == "" {
			t.Fatalf("no room code in %v", res)
		}
		return code
	}

	t.Run("account lifecycle runs under the restricted role", func(t *testing.T) {
		id, token := api.signup()
		api.want("session", http.StatusOK, http.MethodGet, "/api/v1/users/me/profile", caller{token: token}, nil)
		api.want("profile update", http.StatusOK, http.MethodPatch, "/api/v1/users/me/profile", caller{token: token},
			map[string]any{"displayName": "Renamed"})
		var name string
		if err := admin.QueryRow(ctx, `SELECT display_name FROM users WHERE id = $1`, id).Scan(&name); err != nil || name != "Renamed" {
			t.Errorf("profile not saved: %q err=%v", name, err)
		}
		api.want("logout", http.StatusOK, http.MethodPost, "/api/v1/auth/logout", caller{token: token}, nil)
		api.want("revoked session", http.StatusUnauthorized, http.MethodGet, "/api/v1/users/me/profile", caller{token: token}, nil)
	})

	t.Run("runtime role cannot list accounts or read audit", func(t *testing.T) {
		api.signup()
		for _, q := range []string{`SELECT count(*) FROM users`, `SELECT count(*) FROM sessions`, `SELECT count(*) FROM security_audit_events`} {
			var n int
			if err := app.QueryRow(ctx, q).Scan(&n); err != nil {
				t.Errorf("%s: %v", q, err)
			} else if n != 0 {
				t.Errorf("%s returned %d rows with no context", q, n)
			}
		}
		if _, err := app.Exec(ctx, `DELETE FROM security_audit_events`); err == nil {
			t.Error("runtime role may delete audit events")
		}
	})

	t.Run("room flow and cross tenant denial", func(t *testing.T) {
		hostA, tokenA := api.signup()
		_, tokenB := api.signup()
		_, memberToken := api.signup()
		code := createRoom(tokenA, false)
		host, member, stranger := caller{token: tokenA}, caller{token: memberToken}, caller{token: tokenB}

		api.want("host history", http.StatusOK, http.MethodGet, "/api/v1/rooms/history", host, nil)
		api.want("member join", http.StatusOK, http.MethodPost, roomPath(code)+"/join", member, map[string]any{})
		res := api.want("host participants", http.StatusOK, http.MethodGet, roomPath(code)+"/participants", host, nil)
		if list, _ := res["participants"].([]any); len(list) != 2 {
			t.Errorf("expected 2 participants, got %v", res)
		}
		api.want("anonymous participants", http.StatusUnauthorized, http.MethodGet, roomPath(code)+"/participants", caller{}, nil)
		api.want("stranger participants", http.StatusForbidden, http.MethodGet, roomPath(code)+"/participants", stranger, nil)
		api.want("stranger lock", http.StatusForbidden, http.MethodPost, roomPath(code)+"/lock", stranger, nil)
		api.want("stranger end", http.StatusForbidden, http.MethodPost, roomPath(code)+"/end", stranger, nil)
		api.want("member lock", http.StatusForbidden, http.MethodPost, roomPath(code)+"/lock", member, nil)

		// Leave names only the caller, whatever the body claims.
		api.want("stranger leave naming host", http.StatusOK, http.MethodPost, roomPath(code)+"/leave", stranger, map[string]any{"identity": "user:" + hostA})
		api.want("anonymous leave naming host", http.StatusOK, http.MethodPost, roomPath(code)+"/leave", caller{}, map[string]any{"identity": "user:" + hostA})
		var active int
		if err := admin.QueryRow(ctx, `SELECT count(*) FROM room_participants rp JOIN rooms r ON r.id = rp.room_id WHERE r.public_code = $1 AND rp.identity = $2 AND rp.left_at IS NULL`, code, "user:"+hostA).Scan(&active); err != nil || active != 1 {
			t.Errorf("forged leave removed the host: active=%d err=%v", active, err)
		}

		api.want("host lock", http.StatusOK, http.MethodPost, roomPath(code)+"/lock", host, nil)
		api.want("locked join", http.StatusForbidden, http.MethodPost, roomPath(code)+"/join", stranger, map[string]any{})
		api.want("host unlock", http.StatusOK, http.MethodPost, roomPath(code)+"/unlock", host, nil)

		// A joined guest proves identity by token; a stolen bare identity gets nothing.
		res = api.want("guest join", http.StatusOK, http.MethodPost, roomPath(code)+"/join", caller{}, map[string]any{"displayName": "Guest One"})
		guestToken, _ := res["guestToken"].(string)
		participant, _ := res["participant"].(map[string]any)
		guestIdentity, _ := participant["identity"].(string)
		if guestToken == "" || guestIdentity == "" {
			t.Fatalf("guest join returned %v", res)
		}
		api.want("guest participants", http.StatusOK, http.MethodGet, roomPath(code)+"/participants", caller{guest: guestToken}, nil)
		res = api.want("identity theft", http.StatusOK, http.MethodPost, roomPath(code)+"/join", caller{}, map[string]any{"displayName": "Thief", "identity": guestIdentity})
		stolen, _ := res["participant"].(map[string]any)
		if stolen["identity"] == guestIdentity {
			t.Error("join issued a token for an identity the caller did not prove")
		}
		api.want("raw identity token", http.StatusUnauthorized, http.MethodPost, roomPath(code)+"/token", caller{}, map[string]any{"guestIdentity": guestIdentity, "guestDisplayName": "Thief"})
		api.want("guest token", http.StatusOK, http.MethodPost, roomPath(code)+"/token", caller{guest: guestToken}, map[string]any{"guestDisplayName": "Guest One"})

		// Removal is enforced at the database as well as the service.
		api.want("host removes guest", http.StatusOK, http.MethodPost, roomPath(code)+"/participants/"+guestIdentity+"/remove", host, nil)
		api.want("removed guest", http.StatusForbidden, http.MethodGet, roomPath(code)+"/participants", caller{guest: guestToken}, nil)

		api.want("host ends", http.StatusOK, http.MethodPost, roomPath(code)+"/end", host, nil)
		var jobs int
		if err := admin.QueryRow(ctx, `SELECT count(*) FROM background_jobs WHERE idempotency_key LIKE 'attendance-reconcile-%' AND payload->'data'->>'roomId' = (SELECT id::text FROM rooms WHERE public_code = $1)`, code).Scan(&jobs); err != nil || jobs != 1 {
			t.Errorf("end room enqueued %d reconcile jobs, err=%v", jobs, err)
		}
		api.want("join ended", http.StatusGone, http.MethodPost, roomPath(code)+"/join", stranger, map[string]any{})
	})

	t.Run("waiting room gates media and data", func(t *testing.T) {
		_, hostToken := api.signup()
		_, userToken := api.signup()
		code := createRoom(hostToken, true)
		host, user := caller{token: hostToken}, caller{token: userToken}

		res := api.want("guest join", http.StatusOK, http.MethodPost, roomPath(code)+"/join", caller{}, map[string]any{"displayName": "Waiting"})
		guestToken, _ := res["guestToken"].(string)
		guest := caller{guest: guestToken}

		api.want("token before request", http.StatusForbidden, http.MethodPost, roomPath(code)+"/token", guest, map[string]any{"guestDisplayName": "Waiting"})
		api.want("notes before admission", http.StatusForbidden, http.MethodGet, roomPath(code)+"/notes", guest, nil)
		api.want("participants before admission", http.StatusForbidden, http.MethodGet, roomPath(code)+"/participants", guest, nil)
		api.want("guest requests", http.StatusCreated, http.MethodPost, roomPath(code)+"/admission/request", guest, map[string]any{"displayName": "Waiting"})
		api.want("user requests", http.StatusCreated, http.MethodPost, roomPath(code)+"/admission/request", user, map[string]any{"displayName": "User"})
		api.want("status needs identity", http.StatusUnauthorized, http.MethodGet, roomPath(code)+"/admission/status", caller{}, nil)
		api.want("stranger cannot list", http.StatusForbidden, http.MethodGet, roomPath(code)+"/admission/pending", user, nil)

		res = api.want("host lists", http.StatusOK, http.MethodGet, roomPath(code)+"/admission/pending", host, nil)
		pending, _ := res["requests"].([]any)
		if len(pending) != 2 {
			t.Fatalf("expected 2 pending, got %v", res)
		}
		for _, item := range pending {
			row, _ := item.(map[string]any)
			api.want("stranger cannot decide", http.StatusForbidden, http.MethodPost, roomPath(code)+"/admission/decision", user, map[string]any{"requestId": row["id"], "decision": "admitted"})
			api.want("host admits", http.StatusOK, http.MethodPost, roomPath(code)+"/admission/decision", host, map[string]any{"requestId": row["id"], "decision": "admitted"})
		}
		api.want("status after", http.StatusOK, http.MethodGet, roomPath(code)+"/admission/status", guest, nil)
		api.want("notes after admission", http.StatusOK, http.MethodGet, roomPath(code)+"/notes", guest, nil)
		api.want("token after admission", http.StatusOK, http.MethodPost, roomPath(code)+"/token", guest, map[string]any{"guestDisplayName": "Waiting"})
		api.want("user token after admission", http.StatusOK, http.MethodPost, roomPath(code)+"/token", user, nil)
	})

	t.Run("scheduled meeting and passcode", func(t *testing.T) {
		_, hostToken := api.signup()
		_, userToken := api.signup()
		host, user := caller{token: hostToken}, caller{token: userToken}
		start := time.Now().Add(48 * time.Hour).UTC().Truncate(time.Second)
		body := func(from time.Time) map[string]any {
			return map[string]any{
				"title": "Algebra", "timeZone": "Asia/Kolkata", "passcode": "open-sesame",
				"scheduledStart": from.Format(time.RFC3339), "scheduledEnd": from.Add(time.Hour).Format(time.RFC3339),
			}
		}
		res := api.want("schedule", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", host, body(start))
		rm, _ := res["room"].(map[string]any)
		code, _ := rm["publicCode"].(string)
		if rm["status"] != "scheduled" || rm["hasPasscode"] != true || rm["passcodeHash"] != nil {
			t.Errorf("unexpected scheduled room: %v", rm)
		}

		api.want("overlap conflicts", http.StatusConflict, http.MethodPost, "/api/v1/rooms/", host, body(start.Add(30*time.Minute)))
		bad := body(start.Add(100 * time.Hour))
		bad["timeZone"] = "Mars/Olympus"
		api.want("bad time zone", http.StatusBadRequest, http.MethodPost, "/api/v1/rooms/", host, bad)
		past := body(time.Now().Add(-time.Hour))
		api.want("start in the past", http.StatusBadRequest, http.MethodPost, "/api/v1/rooms/", host, past)

		res = api.want("upcoming", http.StatusOK, http.MethodGet, "/api/v1/rooms/upcoming", host, nil)
		if list, _ := res["rooms"].([]any); len(list) != 1 {
			t.Errorf("host upcoming: %v", res)
		}
		res = api.want("other user upcoming", http.StatusOK, http.MethodGet, "/api/v1/rooms/upcoming", user, nil)
		if list, _ := res["rooms"].([]any); len(list) != 0 {
			t.Errorf("another user's meetings leaked: %v", res)
		}

		api.want("join before start", http.StatusConflict, http.MethodPost, roomPath(code)+"/join", user, map[string]any{"passcode": "open-sesame"})
		api.want("token before start", http.StatusConflict, http.MethodPost, roomPath(code)+"/token", user, nil)
		api.want("stranger reschedule", http.StatusForbidden, http.MethodPatch, roomPath(code), user, body(start.Add(5*time.Hour)))
		api.want("stranger cancel", http.StatusForbidden, http.MethodPost, roomPath(code)+"/cancel", user, nil)
		res = api.want("host reschedule", http.StatusOK, http.MethodPatch, roomPath(code), host, body(start.Add(5*time.Hour)))
		moved, _ := res["room"].(map[string]any)
		if moved["scheduledStart"] != start.Add(5*time.Hour).Format(time.RFC3339) {
			t.Errorf("reschedule not saved: %v", moved)
		}

		res = api.want("host starts by joining", http.StatusOK, http.MethodPost, roomPath(code)+"/join", host, map[string]any{})
		started, _ := res["room"].(map[string]any)
		if started["status"] != "active" {
			t.Errorf("host join did not start the meeting: %v", started)
		}
		api.want("cancel after start", http.StatusBadRequest, http.MethodPost, roomPath(code)+"/cancel", host, nil)

		api.want("no passcode", http.StatusForbidden, http.MethodPost, roomPath(code)+"/join", user, map[string]any{})
		api.want("wrong passcode", http.StatusForbidden, http.MethodPost, roomPath(code)+"/join", user, map[string]any{"passcode": "wrong-code"})
		api.want("guest wrong passcode", http.StatusForbidden, http.MethodPost, roomPath(code)+"/join", caller{}, map[string]any{"displayName": "Guest", "passcode": "wrong-code"})
		api.want("token skipping join", http.StatusForbidden, http.MethodPost, roomPath(code)+"/token", user, nil)
		api.want("right passcode", http.StatusOK, http.MethodPost, roomPath(code)+"/join", user, map[string]any{"passcode": "open-sesame"})
		api.want("token after join", http.StatusOK, http.MethodPost, roomPath(code)+"/token", user, nil)
		res = api.want("guest right passcode", http.StatusOK, http.MethodPost, roomPath(code)+"/join", caller{}, map[string]any{"displayName": "Guest", "passcode": "open-sesame"})
		guestToken, _ := res["guestToken"].(string)
		api.want("guest token after join", http.StatusOK, http.MethodPost, roomPath(code)+"/token", caller{guest: guestToken}, map[string]any{"guestDisplayName": "Guest"})

		res = api.want("second meeting", http.StatusCreated, http.MethodPost, "/api/v1/rooms/", host, body(start.Add(10*time.Hour)))
		second, _ := res["room"].(map[string]any)
		secondCode, _ := second["publicCode"].(string)
		api.want("host cancels", http.StatusOK, http.MethodPost, roomPath(secondCode)+"/cancel", host, nil)
		api.want("join cancelled", http.StatusGone, http.MethodPost, roomPath(secondCode)+"/join", user, map[string]any{})
		api.want("lookup cancelled", http.StatusGone, http.MethodGet, roomPath(secondCode), user, nil)
	})

	t.Run("institutional room is limited to its organization", func(t *testing.T) {
		suffix := uuid.NewString()[:8]
		var orgA, orgB string
		for _, dest := range []*string{&orgA, &orgB} {
			if err := admin.QueryRow(ctx, `INSERT INTO organizations (slug, name) VALUES ($1, 'Tenant') RETURNING id::text`, "iso-"+uuid.NewString()[:8]).Scan(dest); err != nil {
				t.Fatal(err)
			}
		}
		member := func(org, role string) (string, caller) {
			t.Helper()
			id, token := api.signup()
			if _, err := admin.Exec(ctx, `INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`, org, id, role); err != nil {
				t.Fatal(err)
			}
			return id, caller{token: token}
		}
		facultyID, faculty := member(orgA, "faculty")
		studentID, student := member(orgA, "student")
		_, otherOrg := member(orgB, "institution_admin")
		_, unaffiliatedToken := api.signup()
		unaffiliated := caller{token: unaffiliatedToken}

		code, err := room.GeneratePublicCode()
		if err != nil {
			t.Fatal(err)
		}
		var roomID string
		if err := admin.QueryRow(ctx, `INSERT INTO rooms (public_code, host_user_id, organization_id, workspace_type) VALUES ($1, $2, $3, 'institutional') RETURNING id::text`, code, facultyID, orgA).Scan(&roomID); err != nil {
			t.Fatalf("institutional room %s: %v", suffix, err)
		}

		api.want("student joins", http.StatusOK, http.MethodPost, roomPath(code)+"/join", student, map[string]any{})
		api.want("student token", http.StatusOK, http.MethodPost, roomPath(code)+"/token", student, nil)
		api.want("student notes", http.StatusOK, http.MethodPut, roomPath(code)+"/notes", student, map[string]any{"title": "T", "content": "tenant-a", "expectedRevision": 1})
		api.want("faculty reads", http.StatusOK, http.MethodGet, roomPath(code)+"/notes", faculty, nil)

		for name, who := range map[string]caller{"other organization admin": otherOrg, "unaffiliated user": unaffiliated} {
			api.want(name+" join", http.StatusForbidden, http.MethodPost, roomPath(code)+"/join", who, map[string]any{})
			api.want(name+" token", http.StatusForbidden, http.MethodPost, roomPath(code)+"/token", who, nil)
			api.want(name+" notes", http.StatusForbidden, http.MethodGet, roomPath(code)+"/notes", who, nil)
			api.want(name+" files", http.StatusForbidden, http.MethodGet, roomPath(code)+"/files", who, nil)
			api.want(name+" participants", http.StatusForbidden, http.MethodGet, roomPath(code)+"/participants", who, nil)
			api.want(name+" end", http.StatusForbidden, http.MethodPost, roomPath(code)+"/end", who, nil)
		}
		api.want("guest join refused", http.StatusForbidden, http.MethodPost, roomPath(code)+"/join", caller{}, map[string]any{"displayName": "Guest"})

		// Losing membership ends access even for someone already in the room.
		if _, err := admin.Exec(ctx, `UPDATE organization_memberships SET status = 'suspended' WHERE organization_id = $1 AND user_id = $2`, orgA, studentID); err != nil {
			t.Fatal(err)
		}
		api.want("suspended student notes", http.StatusForbidden, http.MethodGet, roomPath(code)+"/notes", student, nil)
		api.want("suspended student token", http.StatusForbidden, http.MethodPost, roomPath(code)+"/token", student, nil)
	})
}

// TestWorkflowDB_EveryTableHasRLS fails when a table is added without row level security.
func TestWorkflowDB_EveryTableHasRLS(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("NOT VERIFIED: TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	// Holds migration names only, with nothing tenant or user related.
	exempt := map[string]bool{"schema_metadata": true}
	rows, err := pool.Query(ctx, `
		SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
		  AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		if !exempt[name] {
			t.Errorf("table %s lacks enabled and forced row level security", name)
		}
	}
}
