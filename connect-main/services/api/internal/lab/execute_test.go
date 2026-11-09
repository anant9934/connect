package lab

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/runner"
)

// scriptedRunner answers by stdin: "tle" times out, "crash" fails, anything else echoes doubled.
type scriptedRunner struct {
	compileError bool
	jobs         []runner.Job
}

func (s *scriptedRunner) Kind() string { return "test" }

func (s *scriptedRunner) Run(_ context.Context, job runner.Job) (*runner.Result, error) {
	s.jobs = append(s.jobs, job)
	switch {
	case s.compileError:
		return &runner.Result{Status: "compile_error", CompileOutput: "main.cpp:3: expected ';'"}, nil
	case job.Stdin == "tle":
		return &runner.Result{Status: "time_limit", TimeMS: job.TimeLimitMS}, nil
	case job.Stdin == "crash":
		return &runner.Result{Status: "runtime_error", Stderr: "Segmentation fault"}, nil
	}
	return &runner.Result{Status: "ok", Stdout: job.Stdin + job.Stdin + "\n", TimeMS: 3}, nil
}

func TestGradeOnServer(t *testing.T) {
	cases := []LabTestCase{
		{ID: uuid.New(), Input: "ab", ExpectedOutput: "abab", Weight: 2, TimeLimitMS: 1000},
		{ID: uuid.New(), Input: "tle", ExpectedOutput: "x", Weight: 1, IsHidden: true, TimeLimitMS: 500},
		{ID: uuid.New(), Input: "crash", ExpectedOutput: "x", Weight: 1, TimeLimitMS: 1000},
	}
	fake := &scriptedRunner{}
	h := &Handler{runner: fake}
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	outputs, errs, durations, err := h.gradeOnServer(req, "cpp", "int main(){}", cases)
	if err != nil {
		t.Fatal(err)
	}
	if fake.jobs[1].TimeLimitMS != 500 {
		t.Errorf("per-case time limit not passed: %d", fake.jobs[1].TimeLimitMS)
	}
	score, passed, total, _, _ := EvaluateSubmissionAgainstTestCases(cases, outputs, errs, durations, 100, true)
	if passed != 1 || total != 3 || score != 50 {
		t.Errorf("score %d passed %d/%d", score, passed, total)
	}
	if errs[cases[1].ID.String()] != "Time limit exceeded" || !strings.Contains(errs[cases[2].ID.String()], "Segmentation") {
		t.Errorf("errors: %v", errs)
	}

	compile := &scriptedRunner{compileError: true}
	h.runner = compile
	_, errs, _, _ = h.gradeOnServer(req, "cpp", "int main(", cases)
	if len(compile.jobs) != 1 || len(errs) != 3 || !strings.HasPrefix(errs[cases[2].ID.String()], "Compilation error") {
		t.Errorf("a compile error should fail every case after one run: jobs %d errs %v", len(compile.jobs), errs)
	}
}

func TestRunCode(t *testing.T) {
	role := "student"
	member := func(ctx context.Context, pool *pgxpool.Pool, tokenHash string, orgID *string, fn func(pgx.Tx, *database.AuthContext) error) error {
		return fn(nil, &database.AuthContext{UserID: uuid.NewString(), Role: &role})
	}
	call := func(h *Handler, body string) *httptest.ResponseRecorder {
		router := chi.NewRouter()
		router.Post("/organizations/{org}/lab/run", h.runCode)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/organizations/"+uuid.NewString()+"/lab/run", strings.NewReader(body)))
		return rec
	}
	h := &Handler{withAuthCtxFn: member}
	if rec := call(h, `{"language":"cpp","source_code":"int main(){}"}`); rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "RUNNER_NOT_CONFIGURED") {
		t.Errorf("no runner: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, `{"language":"python","source_code":"print(1)"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("python on server: %d", rec.Code)
	}
	h.runner = &scriptedRunner{}
	rec := call(h, `{"language":"java","source_code":"class Main{}","stdin":"hi"}`)
	var body struct {
		Result runner.Result `json:"result"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if rec.Code != http.StatusOK || body.Result.Stdout != "hihi\n" {
		t.Errorf("run: %d %s", rec.Code, rec.Body)
	}
}

func TestRunLimiter(t *testing.T) {
	var l runLimiter
	for i := 0; i < 3; i++ {
		if !l.allow("u", 3, 60e9) {
			t.Fatalf("run %d refused", i)
		}
	}
	if l.allow("u", 3, 60e9) {
		t.Error("fourth run in the window allowed")
	}
	if !l.allow("v", 3, 60e9) {
		t.Error("another person was limited")
	}
}
