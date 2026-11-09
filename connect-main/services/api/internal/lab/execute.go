package lab

import (
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/runner"
)

// SetRunner enables server-side C++ and Java execution through an isolated runner service.
func (h *Handler) SetRunner(r runner.Runner) {
	h.runner = r
}

// serverRunLanguages are run by the runner service; the browser runs Python, SQL and the web languages.
var serverRunLanguages = map[string]bool{"cpp": true, "java": true}

// runLimiter allows each person a few runs a minute, so one tab cannot flood the runner.
type runLimiter struct {
	mu   sync.Mutex
	runs map[string][]time.Time
}

func (l *runLimiter) allow(key string, limit int, window time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.runs == nil {
		l.runs = map[string][]time.Time{}
	}
	cutoff := time.Now().Add(-window)
	recent := l.runs[key][:0]
	for _, t := range l.runs[key] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	if len(recent) >= limit {
		l.runs[key] = recent
		return false
	}
	l.runs[key] = append(recent, time.Now())
	return true
}

var runs runLimiter

func writeRunnerError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, runner.ErrNotConfigured):
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "RUNNER_NOT_CONFIGURED",
			"message": "C++ and Java run on a separate code runner, and none is set up for this server. Your code is saved; ask your administrator to configure one."})
	case errors.Is(err, runner.ErrUnsupportedLanguage):
		writeError(w, http.StatusBadRequest, "only C++ and Java run on the server; other languages run in your browser")
	case errors.Is(err, runner.ErrUnavailable):
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "RUNNER_UNAVAILABLE", "message": "The code runner did not respond. Try again in a moment."})
	default:
		writeError(w, http.StatusBadRequest, err.Error())
	}
}

// runCode handles POST /organizations/{org}/lab/run: compile and run C++ or Java with custom
// input. Membership is checked first; the program runs outside any database transaction.
func (h *Handler) runCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Language string `json:"language"`
		Source   string `json:"source_code"`
		Stdin    string `json:"stdin"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, runner.MaxSourceBytes+runner.MaxStdinBytes+(8<<10))
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !serverRunLanguages[req.Language] {
		writeRunnerError(w, runner.ErrUnsupportedLanguage)
		return
	}
	var userID string
	if err := h.inOrg(r, func(_ pgx.Tx, auth *database.AuthContext, _ uuid.UUID) error {
		userID = auth.UserID
		return nil
	}); err != nil {
		h.handleLabError(w, r, err)
		return
	}
	if h.runner == nil {
		writeRunnerError(w, runner.ErrNotConfigured)
		return
	}
	if !runs.allow("run:"+userID, 20, time.Minute) {
		writeError(w, http.StatusTooManyRequests, "too many runs; wait a minute")
		return
	}
	res, err := h.runner.Run(r.Context(), runner.Job{Language: req.Language, Source: req.Source, Stdin: req.Stdin})
	if err != nil {
		writeRunnerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": res, "runner": h.runner.Kind()})
}

// gradeOnServer runs every test case, hidden ones included, through the runner and returns the
// authoritative outputs for the evaluator. A compile error fails every case with its message.
func (h *Handler) gradeOnServer(r *http.Request, language, source string, cases []LabTestCase) (outputs, errs map[string]string, durations map[string]int, err error) {
	outputs, errs, durations = map[string]string{}, map[string]string{}, map[string]int{}
	for _, tc := range cases {
		id := tc.ID.String()
		res, runErr := h.runner.Run(r.Context(), runner.Job{Language: language, Source: source, Stdin: tc.Input, TimeLimitMS: tc.TimeLimitMS})
		if runErr != nil {
			return nil, nil, nil, runErr
		}
		durations[id] = res.TimeMS
		switch res.Status {
		case "ok":
			outputs[id] = res.Stdout
		case "compile_error":
			for _, other := range cases {
				errs[other.ID.String()] = "Compilation error: " + res.CompileOutput
			}
			return outputs, errs, durations, nil
		case "time_limit":
			errs[id] = "Time limit exceeded"
		default:
			msg := res.Stderr
			if msg == "" {
				msg = "Runtime error"
			}
			errs[id] = msg
		}
	}
	return outputs, errs, durations, nil
}

var errAssignmentGone = errors.New("assignment not found")

// submitAssignmentOnServer is submitAssignment for C++ and Java when a runner is configured: the
// server runs the tests itself, so the score is official instead of a self-check awaiting review.
// Reading the tests, running them and storing the result are separate steps, so no database
// connection is held while code runs.
func (h *Handler) submitAssignmentOnServer(w http.ResponseWriter, r *http.Request, assignID uuid.UUID, req submissionRequest) {
	var (
		cases      []LabTestCase
		assignment *LabAssignment
		isStudent  bool
	)
	err := h.inOrg(r, func(tx pgx.Tx, auth *database.AuthContext, orgID uuid.UUID) error {
		var err error
		if cases, err = h.repo.GetAllTestCasesForEvaluation(r.Context(), tx, orgID, &assignID, nil); err != nil {
			return err
		}
		assignment, err = h.repo.GetLabAssignment(r.Context(), tx, orgID, assignID, false, uuid.Nil)
		if err != nil || assignment == nil {
			return errAssignmentGone
		}
		isStudent = !h.isFacultyOrAdmin(auth.Role, auth.IsSuperAdmin)
		return nil
	})
	if errors.Is(err, errAssignmentGone) {
		writeError(w, http.StatusNotFound, "assignment not found")
		return
	}
	if err != nil {
		h.handleLabError(w, r, err)
		return
	}
	if isStudent && !assignment.DueAt.IsZero() && time.Now().After(assignment.DueAt) {
		writeError(w, http.StatusBadRequest, "assignment submission deadline has passed")
		return
	}
	if len(assignment.AllowedLanguages) > 0 {
		allowed := false
		for _, l := range assignment.AllowedLanguages {
			allowed = allowed || l == req.Language
		}
		if !allowed {
			writeError(w, http.StatusBadRequest, "language '"+req.Language+"' is not permitted for this assignment")
			return
		}
	}

	outputs, errs, durations, err := h.gradeOnServer(r, req.Language, req.SourceCode, cases)
	if err != nil {
		writeRunnerError(w, err)
		return
	}
	score, passed, total, status, results := EvaluateSubmissionAgainstTestCases(cases, outputs, errs, durations, assignment.MaxScore, isStudent)

	err = h.inOrg(r, func(tx pgx.Tx, auth *database.AuthContext, orgID uuid.UUID) error {
		studentID, err := uuid.Parse(auth.UserID)
		if err != nil {
			return errInvalidUserID
		}
		sub := &LabSubmission{
			ID: uuid.New(), OrganizationID: orgID, AssignmentID: &assignID, StudentUserID: studentID,
			Language: req.Language, SourceCode: req.SourceCode, Status: status, Score: score,
			PassedCount: passed, TotalCount: total, TestResults: results,
		}
		if err := h.repo.CreateSubmission(r.Context(), tx, sub); err != nil {
			return err
		}
		_ = h.repo.RecordStudentActivity(r.Context(), tx, orgID, assignment.LabCourseID, studentID, score, true, false)
		writeJSON(w, http.StatusOK, map[string]any{
			"submission": sub, "score": score, "status": status, "graded_on_server": true,
			"message": "Graded on the server against every test case, including hidden ones. Faculty can still review it.",
		})
		return nil
	})
	if err != nil {
		h.handleLabError(w, r, err)
	}
}

// routeExecution mounts the run endpoint; called from RegisterRoutes.
func (h *Handler) routeExecution(lab chi.Router) {
	lab.Post("/run", h.runCode)
}
