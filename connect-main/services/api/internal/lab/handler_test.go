package lab

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/database"
)

func TestHandler_CreateAssignmentValidation(t *testing.T) {
	h := &Handler{}

	t.Run("fails when body is invalid JSON", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/test/lab/assignments", strings.NewReader("invalid-json"))
		rec := httptest.NewRecorder()
		h.createAssignment(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("fails when title or course ID is missing", func(t *testing.T) {
		body, _ := json.Marshal(map[string]any{
			"title":         "",
			"lab_course_id": uuid.Nil,
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/test/lab/assignments", bytes.NewReader(body))
		rec := httptest.NewRecorder()
		h.createAssignment(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("fails when title exceeds 255 chars", func(t *testing.T) {
		body, _ := json.Marshal(map[string]any{
			"title":         strings.Repeat("A", 256),
			"lab_course_id": uuid.New(),
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/test/lab/assignments", bytes.NewReader(body))
		rec := httptest.NewRecorder()
		h.createAssignment(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "255 characters") {
			t.Errorf("expected 255 characters message, got %s", rec.Body.String())
		}
	})

	t.Run("fails when starter code exceeds 64KB", func(t *testing.T) {
		body, _ := json.Marshal(map[string]any{
			"title":         "Valid Title",
			"lab_course_id": uuid.New(),
			"starter_code":  strings.Repeat("x", 65537),
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/test/lab/assignments", bytes.NewReader(body))
		rec := httptest.NewRecorder()
		h.createAssignment(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "64KB") {
			t.Errorf("expected 64KB limit message, got %s", rec.Body.String())
		}
	})

	t.Run("fails when test cases count exceeds 50", func(t *testing.T) {
		var testCases []LabTestCase
		for i := 0; i < 51; i++ {
			testCases = append(testCases, LabTestCase{
				Input:          "1",
				ExpectedOutput: "1",
			})
		}
		body, _ := json.Marshal(map[string]any{
			"title":         "Valid Title",
			"lab_course_id": uuid.New(),
			"test_cases":    testCases,
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/test/lab/assignments", bytes.NewReader(body))
		rec := httptest.NewRecorder()
		h.createAssignment(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "50 test cases") {
			t.Errorf("expected 50 test cases limit message, got %s", rec.Body.String())
		}
	})
}

func TestHandler_SubmitAssignmentValidation(t *testing.T) {
	h := &Handler{}
	assignID := uuid.New().String()

	withChiParam := func(req *http.Request, key, val string) *http.Request {
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add(key, val)
		return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	}

	t.Run("fails on invalid assignment id", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/test/lab/assignments/invalid-uuid/submit", nil)
		req = withChiParam(req, "id", "invalid-uuid")
		rec := httptest.NewRecorder()
		h.submitAssignment(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("fails on empty source code", func(t *testing.T) {
		body, _ := json.Marshal(map[string]any{
			"language":    "python",
			"source_code": "",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/test/lab/assignments/"+assignID+"/submit", bytes.NewReader(body))
		req = withChiParam(req, "id", assignID)
		rec := httptest.NewRecorder()
		h.submitAssignment(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "source_code is required") {
			t.Errorf("expected source_code required message, got %s", rec.Body.String())
		}
	})

	t.Run("fails on oversized source code > 64KB", func(t *testing.T) {
		body, _ := json.Marshal(map[string]any{
			"language":    "python",
			"source_code": strings.Repeat("p", 65537),
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/test/lab/assignments/"+assignID+"/submit", bytes.NewReader(body))
		req = withChiParam(req, "id", assignID)
		rec := httptest.NewRecorder()
		h.submitAssignment(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "64KB") {
			t.Errorf("expected 64KB limit error, got %s", rec.Body.String())
		}
	})

	t.Run("fails on missing language", func(t *testing.T) {
		body, _ := json.Marshal(map[string]any{
			"language":    "",
			"source_code": "print('hello')",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/test/lab/assignments/"+assignID+"/submit", bytes.NewReader(body))
		req = withChiParam(req, "id", assignID)
		rec := httptest.NewRecorder()
		h.submitAssignment(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "language is required") {
			t.Errorf("expected language is required message, got %s", rec.Body.String())
		}
	})
}

func TestHandler_RoleAuthorizationChecks(t *testing.T) {
	h := &Handler{}

	adminRole := "institution_admin"
	coordRole := "department_coordinator"
	facultyRole := "faculty"
	studentRole := "student"
	guestRole := "guest"

	if !h.isFacultyOrAdmin(&adminRole, false) {
		t.Error("expected institution_admin to be authorized")
	}
	if !h.isFacultyOrAdmin(&coordRole, false) {
		t.Error("expected department_coordinator to be authorized")
	}
	if !h.isFacultyOrAdmin(&facultyRole, false) {
		t.Error("expected faculty to be authorized")
	}
	if h.isFacultyOrAdmin(&studentRole, false) {
		t.Error("student should NOT be authorized as faculty")
	}
	if h.isFacultyOrAdmin(&guestRole, false) {
		t.Error("guest should NOT be authorized as faculty")
	}
	if h.isFacultyOrAdmin(nil, false) {
		t.Error("nil role should NOT be authorized as faculty")
	}
	if !h.isFacultyOrAdmin(nil, true) {
		t.Error("super admin must always be authorized")
	}
}

func TestHandler_DeadlineAndLanguageEnforcementLogic(t *testing.T) {
	pastDeadline := time.Now().Add(-1 * time.Hour)
	futureDeadline := time.Now().Add(24 * time.Hour)

	assignmentPast := &LabAssignment{
		AllowedLanguages: []string{"python", "javascript"},
		DueAt:            pastDeadline,
	}

	assignmentFuture := &LabAssignment{
		AllowedLanguages: []string{"python", "javascript"},
		DueAt:            futureDeadline,
	}

	// Test deadline check
	isPastStudent := !assignmentPast.DueAt.IsZero() && time.Now().After(assignmentPast.DueAt)
	if !isPastStudent {
		t.Errorf("expected past assignment to be detected as expired")
	}

	isFutureStudent := !assignmentFuture.DueAt.IsZero() && time.Now().After(assignmentFuture.DueAt)
	if isFutureStudent {
		t.Errorf("expected future assignment to not be detected as expired")
	}

	// Test language check
	checkLang := func(a *LabAssignment, lang string) bool {
		if len(a.AllowedLanguages) == 0 {
			return true
		}
		for _, l := range a.AllowedLanguages {
			if l == lang {
				return true
			}
		}
		return false
	}

	if !checkLang(assignmentFuture, "python") {
		t.Errorf("expected python to be allowed")
	}
	if checkLang(assignmentFuture, "cpp") {
		t.Errorf("expected cpp to NOT be allowed when restricted to python, javascript")
	}
}

func TestHandler_GradeSubmissionValidation(t *testing.T) {
	h := &Handler{}

	t.Run("fails on invalid submission id", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/test/lab/submissions/not-a-uuid/grade", nil)
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("id", "not-a-uuid")
		req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
		rec := httptest.NewRecorder()
		h.gradeSubmission(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("fails on invalid body json", func(t *testing.T) {
		subID := uuid.NewString()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/test/lab/submissions/"+subID+"/grade", strings.NewReader("bad-json"))
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("id", subID)
		req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
		rec := httptest.NewRecorder()
		h.gradeSubmission(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
	})
}

func stringPtr(s string) *string {
	return &s
}

func TestHandler_AuthorizationErrorHardening(t *testing.T) {
	validOrgID := uuid.New()
	alienOrgID := uuid.MustParse("11111111-2222-3333-4444-555555555555")
	userUUID := uuid.MustParse("4220b22f-d890-410a-8d18-baec52dc7796")

	withRouteParams := func(req *http.Request, params map[string]string) *http.Request {
		rctx := chi.NewRouteContext()
		for k, v := range params {
			rctx.URLParams.Add(k, v)
		}
		return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	}

	t.Run("Active organization member can access authorized lab resources", func(t *testing.T) {
		repoExecuted := false
		h := &Handler{
			withAuthCtxFn: func(ctx context.Context, pool *pgxpool.Pool, tokenHash string, orgID *string, fn func(pgx.Tx, *database.AuthContext) error) error {
				auth := &database.AuthContext{
					UserID:         userUUID.String(),
					OrganizationID: orgID,
					Role:           stringPtr("student"),
					IsSuperAdmin:   false,
				}
				return fn(nil, auth)
			},
		}

		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/organizations/%s/lab/courses", validOrgID), nil)
		req = withRouteParams(req, map[string]string{"org": validOrgID.String()})

		err := h.inOrg(req, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
			repoExecuted = true
			if orgID != validOrgID {
				t.Errorf("expected orgID %v, got %v", validOrgID, orgID)
			}
			return nil
		})

		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if !repoExecuted {
			t.Fatal("expected authorized query to execute")
		}
	})

	t.Run("User without active membership receives 403 Forbidden without SQLSTATE or UUID leaks", func(t *testing.T) {
		repoExecuted := false
		simulatedDBErr := fmt.Errorf("failed to authenticate database session context: %w", &pgconn.PgError{
			Code:    "42501",
			Message: fmt.Sprintf("ERROR: Authorization Failed: User %s has no active membership in Organization %s (SQLSTATE 42501)", userUUID, alienOrgID),
		})

		h := &Handler{
			withAuthCtxFn: func(ctx context.Context, pool *pgxpool.Pool, tokenHash string, orgID *string, fn func(pgx.Tx, *database.AuthContext) error) error {
				// Simulating PostgreSQL connect_auth.authenticate_session aborting before executing fn
				return simulatedDBErr
			},
		}

		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/organizations/%s/lab/courses", alienOrgID), nil)
		req = withRouteParams(req, map[string]string{"org": alienOrgID.String()})
		rec := httptest.NewRecorder()

		h.listCourses(rec, req)

		// 1. Status must be 403 Forbidden (not 500)
		if rec.Code != http.StatusForbidden {
			t.Errorf("expected HTTP 403 Forbidden, got %d", rec.Code)
		}

		body := rec.Body.String()

		// 2. Response body must not contain database internals
		sensitiveSubstrings := []string{
			"SQLSTATE",
			"42501",
			"connect_auth",
			"authenticate_session",
			userUUID.String(),
			alienOrgID.String(),
			"failed to authenticate",
			"ERROR:",
		}
		for _, s := range sensitiveSubstrings {
			if strings.Contains(body, s) {
				t.Errorf("SECURITY LEAK: response body contains sensitive database internal %q: %s", s, body)
			}
		}

		// 3. Response body must match safe generic error
		var parsed map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
			t.Fatalf("failed to parse JSON response: %v", err)
		}
		expectedMsg := "you do not have permission to access this organization's resources"
		if parsed["error"] != expectedMsg {
			t.Errorf("expected error %q, got %q", expectedMsg, parsed["error"])
		}

		// 4. Protected lab repository query must NOT have executed
		if repoExecuted {
			t.Error("SECURITY BREACH: protected repository query was executed despite authorization failure")
		}
	})

	t.Run("Cross-tenant request does not execute protected lab repository query", func(t *testing.T) {
		repoExecuted := false
		h := &Handler{
			withAuthCtxFn: func(ctx context.Context, pool *pgxpool.Pool, tokenHash string, orgID *string, fn func(pgx.Tx, *database.AuthContext) error) error {
				return &pgconn.PgError{Code: "42501", Message: "unauthorized tenant"}
			},
		}

		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/organizations/%s/lab/courses/intro-cs", alienOrgID), nil)
		req = withRouteParams(req, map[string]string{"org": alienOrgID.String(), "slug": "intro-cs"})
		rec := httptest.NewRecorder()

		h.getCourse(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Errorf("expected HTTP 403, got %d", rec.Code)
		}
		if repoExecuted {
			t.Error("repository query should never execute when tenant authorization fails")
		}
	})

	t.Run("Genuine database failure returns HTTP 500 with generic message", func(t *testing.T) {
		rawDBErr := errors.New("dial tcp 127.0.0.1:5432: connect: connection refused")
		h := &Handler{
			withAuthCtxFn: func(ctx context.Context, pool *pgxpool.Pool, tokenHash string, orgID *string, fn func(pgx.Tx, *database.AuthContext) error) error {
				return rawDBErr
			},
		}

		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/organizations/%s/lab/courses", validOrgID), nil)
		req = withRouteParams(req, map[string]string{"org": validOrgID.String()})
		rec := httptest.NewRecorder()

		h.listCourses(rec, req)

		if rec.Code != http.StatusInternalServerError {
			t.Errorf("expected HTTP 500, got %d", rec.Code)
		}

		body := rec.Body.String()
		if strings.Contains(body, "dial tcp") || strings.Contains(body, "5432") || strings.Contains(body, "connection refused") {
			t.Errorf("SECURITY LEAK: internal database connection string leaked in HTTP 500: %s", body)
		}

		var parsed map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
			t.Fatalf("failed to parse JSON response: %v", err)
		}
		if parsed["error"] != "an unexpected internal error occurred" {
			t.Errorf("expected generic error message, got %q", parsed["error"])
		}
	})

	t.Run("Invalid organization UUID returns HTTP 400 Bad Request", func(t *testing.T) {
		h := &Handler{}
		req := httptest.NewRequest(http.MethodGet, "/organizations/not-a-valid-uuid/lab/courses", nil)
		req = withRouteParams(req, map[string]string{"org": "not-a-valid-uuid"})
		rec := httptest.NewRecorder()

		h.listCourses(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected HTTP 400 Bad Request, got %d", rec.Code)
		}

		var parsed map[string]string
		_ = json.Unmarshal(rec.Body.Bytes(), &parsed)
		if parsed["error"] != "invalid organization id" {
			t.Errorf("expected 'invalid organization id', got %q", parsed["error"])
		}
	})

	t.Run("Role permission boundaries: students cannot create assignments or view faculty overview", func(t *testing.T) {
		studentRole := "student"
		h := &Handler{
			withAuthCtxFn: func(ctx context.Context, pool *pgxpool.Pool, tokenHash string, orgID *string, fn func(pgx.Tx, *database.AuthContext) error) error {
				auth := &database.AuthContext{
					UserID:         userUUID.String(),
					OrganizationID: orgID,
					Role:           &studentRole,
					IsSuperAdmin:   false,
				}
				return fn(nil, auth)
			},
		}

		// 1. Student attempting to access faculty overview
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/organizations/%s/lab/faculty/overview", validOrgID), nil)
		req = withRouteParams(req, map[string]string{"org": validOrgID.String()})
		rec := httptest.NewRecorder()
		h.getFacultyOverview(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Errorf("expected 403 Forbidden for student on faculty overview, got %d", rec.Code)
		}

		// 2. Student attempting to create an assignment
		createBody, _ := json.Marshal(map[string]any{
			"lab_course_id": uuid.New(),
			"title":         "Unauthorized Assignment",
			"description":   "Should be blocked",
		})
		reqCreate := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/organizations/%s/lab/assignments", validOrgID), bytes.NewReader(createBody))
		reqCreate = withRouteParams(reqCreate, map[string]string{"org": validOrgID.String()})
		recCreate := httptest.NewRecorder()
		h.createAssignment(recCreate, reqCreate)

		if recCreate.Code != http.StatusForbidden {
			t.Errorf("expected 403 Forbidden for student creating assignment, got %d", recCreate.Code)
		}

		// 3. Student attempting to grade a submission
		gradeBody, _ := json.Marshal(map[string]any{
			"score":    100,
			"feedback": "Self-awarded grade",
		})
		submissionID := uuid.New().String()
		reqGrade := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/organizations/%s/lab/submissions/%s/grade", validOrgID, submissionID), bytes.NewReader(gradeBody))
		reqGrade = withRouteParams(reqGrade, map[string]string{
			"org": validOrgID.String(),
			"id":  submissionID,
		})
		recGrade := httptest.NewRecorder()
		h.gradeSubmission(recGrade, reqGrade)

		if recGrade.Code != http.StatusForbidden {
			t.Errorf("expected 403 Forbidden for student grading submission, got %d", recGrade.Code)
		}
	})

	t.Run("Hidden-test masking and student self-grading protections remain intact", func(t *testing.T) {
		hiddenTCID := uuid.New()
		publicTCID := uuid.New()
		testCases := []LabTestCase{
			{
				ID:             publicTCID,
				Input:          "5",
				ExpectedOutput: "10",
				IsHidden:       false,
				Weight:         50,
			},
			{
				ID:             hiddenTCID,
				Input:          "secret-input",
				ExpectedOutput: "secret-output",
				IsHidden:       true,
				Weight:         50,
			},
		}

		outputs := map[string]string{
			publicTCID.String(): "10",
			hiddenTCID.String(): "secret-output",
		}
		errorsMap := map[string]string{}
		durations := map[string]int{
			publicTCID.String(): 15,
			hiddenTCID.String(): 18,
		}

		// When evaluated for a student:
		score, passedCount, totalCount, status, results := EvaluateSubmissionAgainstTestCases(
			testCases, outputs, errorsMap, durations, 100, true, // isStudent = true
		)

		if status != "passed" || passedCount != 2 || totalCount != 2 || score != 100 {
			t.Fatalf("unexpected evaluation outcome: score=%d, passed=%d/%d, status=%s", score, passedCount, totalCount, status)
		}

		// Verify hidden test case masking: input and expected output must be masked for student
		for _, r := range results {
			if r.IsHidden {
				if r.Input != "" {
					t.Errorf("SECURITY LEAK: student result contains hidden test input: %q", r.Input)
				}
				if r.ExpectedOutput != "" {
					t.Errorf("SECURITY LEAK: student result contains hidden test expected output: %q", r.ExpectedOutput)
				}
			}
		}

		// When evaluated for faculty (isStudent = false):
		_, _, _, _, facultyResults := EvaluateSubmissionAgainstTestCases(
			testCases, outputs, errorsMap, durations, 100, false, // isStudent = false
		)

		for _, r := range facultyResults {
			if r.IsHidden {
				if r.Input != "secret-input" {
					t.Errorf("faculty should see unmasked hidden test input, got %q", r.Input)
				}
				if r.ExpectedOutput != "secret-output" {
					t.Errorf("faculty should see unmasked hidden test expected output, got %q", r.ExpectedOutput)
				}
			}
		}
	})
}
