package server_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/room"
)

// TestWorkflowDB_MeetingHistorySearch searches real rows as connect_app, for each kind of person.
func TestWorkflowDB_MeetingHistorySearch(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
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
	room.SetGuestTokenSecret([]byte("history-integration-secret-01234567890"))
	t.Cleanup(room.ResetGuestTokenSecretForTest)
	api := apiClient{t: t, router: newRuntimeRouter(t, app, nil)}

	tag := "h" + strings.ReplaceAll(uuid.NewString()[:8], "-", "")
	hostID, hostToken := api.signup()
	memberID, memberToken := api.signup()
	_, strangerToken := api.signup()
	host, member, stranger := caller{token: hostToken}, caller{token: memberToken}, caller{token: strangerToken}

	schedule := func(who caller, title string, at time.Time) (id, code string) {
		t.Helper()
		res := api.want("schedule "+title, http.StatusCreated, http.MethodPost, "/api/v1/rooms/", who, map[string]any{
			"title": title, "timeZone": "Asia/Kolkata", "scheduledStart": at.Format(time.RFC3339), "scheduledEnd": at.Add(time.Hour).Format(time.RFC3339),
		})
		return field(res, "room", "id"), field(res, "room", "publicCode")
	}
	search := func(who caller, params url.Values) (rows []map[string]any, total float64) {
		t.Helper()
		res := api.want("search "+params.Encode(), http.StatusOK, http.MethodGet, "/api/v1/meetings?"+params.Encode(), who, nil)
		total, _ = res["total"].(float64)
		return rowsOf(res, "meetings"), total
	}
	titles := func(rows []map[string]any) string {
		var out []string
		for _, row := range rows {
			out = append(out, fmt.Sprint(row["title"]))
		}
		return strings.Join(out, ",")
	}
	q := func(pairs ...string) url.Values {
		v := url.Values{}
		for i := 0; i < len(pairs); i += 2 {
			v.Set(pairs[i], pairs[i+1])
		}
		return v
	}

	base := time.Now().Add(240 * time.Hour).UTC().Truncate(time.Second)
	alphaID, alphaCode := schedule(host, tag+" Alpha Algebra", base)
	_, betaCode := schedule(host, tag+" Beta 100% Biology", base.Add(3*time.Hour))
	schedule(host, tag+" Gamma_Geometry", base.Add(6*time.Hour))
	otherID, otherCode := schedule(stranger, tag+" Stranger Secret", base)

	// The member attends Beta, which moves it to active, while Alpha stays scheduled.
	api.want("start beta", http.StatusOK, http.MethodPost, roomPath(betaCode)+"/join", host, map[string]any{})
	api.want("member joins beta", http.StatusOK, http.MethodPost, roomPath(betaCode)+"/join", member, map[string]any{})

	t.Run("only meetings this person may see", func(t *testing.T) {
		rows, total := search(host, q("q", tag))
		if total != 3 || strings.Contains(titles(rows), "Stranger") {
			t.Errorf("host sees %v of %v", titles(rows), total)
		}
		rows, _ = search(member, q("q", tag))
		if len(rows) != 1 || !strings.Contains(titles(rows), "Beta") {
			t.Errorf("member sees %v", titles(rows))
		}
		if rows, _ := search(stranger, q("q", tag)); len(rows) != 1 || !strings.Contains(titles(rows), "Stranger") {
			t.Errorf("stranger sees %v", titles(rows))
		}
		// An unlocked personal room is readable under RLS by any user, so search must not rely on that.
		if rows, _ := search(member, q("q", otherCode)); len(rows) != 0 {
			t.Errorf("a code alone revealed another person's meeting: %v", rows)
		}
		api.want("anonymous", http.StatusUnauthorized, http.MethodGet, "/api/v1/meetings", caller{}, nil)
		api.want("detail of another's", http.StatusNotFound, http.MethodGet, "/api/v1/meetings/"+otherID, host, nil)
		api.want("detail bad id", http.StatusNotFound, http.MethodGet, "/api/v1/meetings/nope", host, nil)
	})

	t.Run("title and code", func(t *testing.T) {
		if rows, _ := search(host, q("q", tag+" alpha")); len(rows) != 1 || rows[0]["id"] != alphaID {
			t.Errorf("case-insensitive title: %v", titles(rows))
		}
		for _, form := range []string{alphaCode, strings.ToLower(alphaCode), strings.ReplaceAll(alphaCode, "-", ""), alphaCode[:6]} {
			rows, _ := search(host, q("q", form))
			found := false
			for _, row := range rows {
				found = found || row["id"] == alphaID
			}
			if !found {
				t.Errorf("code form %q did not find it: %v", form, titles(rows))
			}
		}
		// Wildcards are literal.
		if rows, _ := search(host, q("q", tag+" Beta 100%")); len(rows) != 1 {
			t.Errorf("percent: %v", titles(rows))
		}
		if rows, _ := search(host, q("q", tag+" Beta 100%x")); len(rows) != 0 {
			t.Errorf("percent treated as wildcard: %v", titles(rows))
		}
		if rows, _ := search(host, q("q", "Gamma_G")); len(rows) != 1 {
			t.Errorf("underscore: %v", titles(rows))
		}
		if rows, _ := search(host, q("q", "Gamma%G")); len(rows) != 0 {
			t.Errorf("percent matched across words: %v", titles(rows))
		}
		if rows, _ := search(host, q("q", "' OR 1=1 --")); len(rows) != 0 {
			t.Errorf("injection text matched: %v", titles(rows))
		}
	})

	t.Run("date boundaries, in any zone", func(t *testing.T) {
		ist := time.FixedZone("IST", 5*3600+1800)
		from := base.In(ist).Format(time.RFC3339)
		rows, _ := search(host, q("q", tag, "from", from, "to", base.Add(time.Second).In(ist).Format(time.RFC3339)))
		if len(rows) != 1 || rows[0]["id"] != alphaID {
			t.Errorf("from is inclusive: %v", titles(rows))
		}
		if rows, _ := search(host, q("q", tag, "from", base.Add(-time.Hour).Format(time.RFC3339), "to", base.Format(time.RFC3339))); len(rows) != 0 {
			t.Errorf("to is exclusive: %v", titles(rows))
		}
		if rows, _ := search(host, q("q", tag, "from", base.Add(time.Second).Format(time.RFC3339))); strings.Contains(titles(rows), "Alpha") {
			t.Errorf("before from: %v", titles(rows))
		}
	})

	t.Run("filters together, sorting and pages", func(t *testing.T) {
		rows, _ := search(host, q("q", tag, "status", "scheduled", "host", hostID, "from", base.Add(-time.Hour).Format(time.RFC3339), "to", base.Add(time.Hour).Format(time.RFC3339)))
		if len(rows) != 1 || rows[0]["id"] != alphaID {
			t.Errorf("combined: %v", titles(rows))
		}
		if rows, _ := search(host, q("q", tag, "status", "active,scheduled")); len(rows) != 3 {
			t.Errorf("several statuses: %v", titles(rows))
		}
		if rows, _ := search(host, q("q", tag, "status", "ended")); len(rows) != 0 {
			t.Errorf("ended: %v", titles(rows))
		}
		rows, _ = search(host, q("q", tag, "participant", memberID))
		if len(rows) != 1 || !strings.Contains(titles(rows), "Beta") {
			t.Errorf("participant filter for the host: %v", titles(rows))
		}
		// A non-host cannot learn who else attended by filtering on them.
		if rows, _ := search(member, q("q", tag, "participant", hostID)); len(rows) != 0 {
			t.Errorf("participant filter leaked attendance: %v", titles(rows))
		}

		order := func(sort string) string {
			rows, _ := search(host, q("q", tag, "sort", sort))
			return titles(rows)
		}
		if got := order("oldest"); !strings.HasPrefix(got, tag+" Alpha") {
			t.Errorf("oldest: %s", got)
		}
		if got := order("newest"); !strings.HasPrefix(got, tag+" Gamma") {
			t.Errorf("newest: %s", got)
		}
		if got := order("title"); !strings.HasPrefix(got, tag+" Alpha") || !strings.Contains(got, "Beta") {
			t.Errorf("title: %s", got)
		}
		seen := map[any]bool{}
		for offset := 0; offset < 3; offset++ {
			page, total := search(host, q("q", tag, "limit", "1", "offset", fmt.Sprint(offset), "sort", "oldest"))
			if len(page) != 1 || total != 3 {
				t.Fatalf("page %d: %v of %v", offset, titles(page), total)
			}
			seen[page[0]["id"]] = true
		}
		if len(seen) != 3 {
			t.Errorf("pages repeated rows: %v", seen)
		}
		if page, total := search(host, q("q", tag, "offset", "50")); len(page) != 0 || total != 3 {
			t.Errorf("past the end: %v of %v", titles(page), total)
		}
	})

	t.Run("malformed input", func(t *testing.T) {
		for _, bad := range []url.Values{
			q("q", strings.Repeat("x", 101)), q("from", "yesterday"), q("to", "2026-01-01"), q("status", "gone"), q("sort", "random"),
			q("limit", "0"), q("limit", "x"), q("offset", "-1"), q("offset", "99999"), q("host", "me"), q("course", "1"),
			q("from", "2026-02-01T00:00:00Z", "to", "2026-01-01T00:00:00Z"),
		} {
			api.want("bad "+bad.Encode(), http.StatusBadRequest, http.MethodGet, "/api/v1/meetings?"+bad.Encode(), host, nil)
		}
		res := api.want("capped", http.StatusOK, http.MethodGet, "/api/v1/meetings?limit=100000", host, nil)
		if res["limit"] != float64(100) {
			t.Errorf("limit not capped: %v", res["limit"])
		}
		if rows, _ := search(stranger, q("q", "no such meeting anywhere")); len(rows) != 0 {
			t.Errorf("empty result: %v", rows)
		}
	})

	t.Run("detail shows attendees only to those who run the meeting", func(t *testing.T) {
		rows, _ := search(host, q("q", tag+" Beta"))
		id := rows[0]["id"].(string)
		if rows[0]["participantCount"] != float64(2) {
			t.Errorf("host count: %v", rows[0])
		}
		memberRows, _ := search(member, q("q", tag+" Beta"))
		if memberRows[0]["participantCount"] != nil {
			t.Errorf("a participant saw the attendee count: %v", memberRows[0])
		}
		people := func(who caller) []map[string]any {
			res := api.want("detail", http.StatusOK, http.MethodGet, "/api/v1/meetings/"+id, who, nil)
			meeting, _ := res["meeting"].(map[string]any)
			return rowsOf(meeting, "participants")
		}
		if list := people(host); len(list) != 2 {
			t.Errorf("host sees %d people", len(list))
		}
		if list := people(member); len(list) != 1 || list[0]["isYou"] != true {
			t.Errorf("member sees %v", list)
		}
		for _, row := range people(host) {
			if _, leaked := row["identity"]; leaked {
				t.Errorf("identity exposed: %v", row)
			}
		}
	})

	t.Run("student, faculty and administrator in an institution", func(t *testing.T) {
		var orgA, orgB string
		for _, dest := range []*string{&orgA, &orgB} {
			if err := admin.QueryRow(ctx, `INSERT INTO organizations (slug, name) VALUES ($1, 'Tenant') RETURNING id::text`, "hist-"+uuid.NewString()[:8]).Scan(dest); err != nil {
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
		_, orgAdmin := member(orgA, "institution_admin")
		facultyID, faculty := member(orgA, "faculty")
		studentID, student := member(orgA, "student")
		_, otherStudent := member(orgA, "student")
		_, otherAdmin := member(orgB, "institution_admin")

		base2 := "/api/v1/organizations/" + orgA
		dept := field(api.want("dept", http.StatusCreated, http.MethodPost, base2+"/departments", orgAdmin, map[string]any{"code": "H", "name": "H"}), "department", "id")
		course := field(api.want("course", http.StatusCreated, http.MethodPost, base2+"/courses", orgAdmin, map[string]any{"departmentId": dept, "code": "H1", "title": "History Course"}), "course", "id")
		batch := field(api.want("batch", http.StatusCreated, http.MethodPost, base2+"/batches", orgAdmin, map[string]any{"courseId": course, "name": "A", "academicTerm": "T", "startDate": "2020-01-01", "endDate": "2035-01-01"}), "batch", "id")
		allocation := field(api.want("allocation", http.StatusCreated, http.MethodPost, base2+"/allocations", orgAdmin, map[string]any{"courseId": course, "facultyUserId": facultyID}), "allocation", "id")
		api.want("enroll", http.StatusCreated, http.MethodPost, base2+"/enrollments", orgAdmin, map[string]any{"batchId": batch, "studentUserId": studentID})
		at := time.Now().Add(500 * time.Hour).UTC().Truncate(time.Second)
		api.want("class", http.StatusCreated, http.MethodPost, base2+"/sessions", faculty, map[string]any{
			"courseId": course, "batchId": batch, "facultyAllocationId": allocation, "title": tag + " Class", "timeZone": "UTC",
			"start": at.Format(time.RFC3339), "end": at.Add(time.Hour).Format(time.RFC3339),
		})
		find := q("q", tag+" Class")
		for name, who := range map[string]caller{"admin": orgAdmin, "faculty": faculty, "student": student} {
			rows, _ := search(who, find)
			if len(rows) != 1 || rows[0]["courseTitle"] != "History Course" {
				t.Errorf("%s: %v", name, rows)
			}
		}
		for name, who := range map[string]caller{"unenrolled student": otherStudent, "other tenant's admin": otherAdmin} {
			if rows, _ := search(who, find); len(rows) != 0 {
				t.Errorf("%s saw the class: %v", name, rows)
			}
		}
		if rows, _ := search(orgAdmin, q("q", tag+" Class", "course", course, "organization", orgA)); len(rows) != 1 {
			t.Errorf("course and organization filters: %v", rows)
		}
		if rows, _ := search(otherAdmin, q("organization", orgA)); len(rows) != 0 {
			t.Errorf("naming another organization revealed it: %v", rows)
		}
	})

	t.Run("calendar export follows the same visibility", func(t *testing.T) {
		get := func(who caller, path string) (int, string, string) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			req.Header.Set("Authorization", "Bearer "+who.token)
			rec := httptest.NewRecorder()
			api.router.ServeHTTP(rec, req)
			return rec.Code, rec.Header().Get("Content-Type"), rec.Body.String()
		}
		code, kind, body := get(host, "/api/v1/meetings/"+alphaID+"/calendar.ics")
		if code != http.StatusOK || !strings.HasPrefix(kind, "text/calendar") || !strings.Contains(strings.ReplaceAll(body, "\r\n ", ""), "SUMMARY:"+tag+" Alpha Algebra") {
			t.Errorf("host export: %d %s %s", code, kind, body)
		}
		if !strings.Contains(body, "DTSTART:"+base.Format("20060102T150405Z")) {
			t.Errorf("start: %s", body)
		}
		for _, who := range []caller{member, stranger} {
			if code, _, _ := get(who, "/api/v1/meetings/"+alphaID+"/calendar.ics"); code != http.StatusNotFound {
				t.Errorf("someone else exported it: %d", code)
			}
		}
		if code, _, _ := get(caller{}, "/api/v1/meetings/calendar.ics"); code != http.StatusUnauthorized {
			t.Errorf("anonymous: %d", code)
		}
		_, _, all := get(host, "/api/v1/meetings/calendar.ics")
		if !strings.Contains(all, alphaID+"@connect") || strings.Contains(all, otherID+"@connect") {
			t.Errorf("feed: %s", all)
		}
		// A cancelled meeting stays in the feed, so calendars can remove it.
		_, gammaCode := schedule(host, tag+" Doomed", base.Add(9*time.Hour))
		api.want("cancel", http.StatusOK, http.MethodPost, roomPath(gammaCode)+"/cancel", host, nil)
		_, _, all = get(host, "/api/v1/meetings/calendar.ics")
		if !strings.Contains(all, "STATUS:CANCELLED") {
			t.Errorf("cancelled meeting missing: %s", all)
		}
		// Keeps the search count below unaffected.
		if _, err := admin.Exec(ctx, `DELETE FROM rooms WHERE public_code = $1`, gammaCode); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("search stays fast with many meetings", func(t *testing.T) {
		seedHost, _ := api.signup()
		_, err := admin.Exec(ctx, `
			INSERT INTO rooms (public_code, host_user_id, workspace_type, status, title, created_at)
			SELECT 'SEED' || substr(md5(g::text || $2), 1, 12), $1::uuid, 'personal_commons', 'ended', 'Seed ' || g, now() - (g || ' minutes')::interval
			FROM generate_series(1, 20000) g
		`, seedHost, tag)
		if err != nil {
			t.Fatal(err)
		}
		loaded, loadedToken := api.signup()
		_, err = admin.Exec(ctx, `
			INSERT INTO rooms (public_code, host_user_id, workspace_type, status, title, created_at)
			SELECT 'LOAD' || substr(md5(g::text || $2), 1, 12), $1::uuid, 'personal_commons', 'ended', 'Load ' || g, now() - (g || ' minutes')::interval
			FROM generate_series(1, 500) g
		`, loaded, tag)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := admin.Exec(ctx, `ANALYZE rooms`); err != nil {
			t.Fatal(err)
		}
		who := caller{token: loadedToken}
		var worst time.Duration
		for _, params := range []url.Values{q(), q("q", "Load 49"), q("sort", "title", "offset", "400"), q("status", "ended", "limit", "100")} {
			started := time.Now()
			search(who, params)
			if took := time.Since(started); took > worst {
				worst = took
			}
		}
		t.Logf("slowest search with 500 of 20000+ visible: %v", worst)
		if worst > time.Second {
			t.Errorf("search took %v", worst)
		}
		if _, total := search(who, q()); total != 500 {
			t.Errorf("total: %v", total)
		}
	})
}
