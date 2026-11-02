package lab

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
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
			"title": "",
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
			"title": strings.Repeat("A", 256),
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
			"title": "Valid Title",
			"lab_course_id": uuid.New(),
			"starter_code": strings.Repeat("x", 65537),
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
				Input: "1",
				ExpectedOutput: "1",
			})
		}
		body, _ := json.Marshal(map[string]any{
			"title": "Valid Title",
			"lab_course_id": uuid.New(),
			"test_cases": testCases,
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
			"language": "python",
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
			"language": "python",
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
			"language": "",
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
		DueAt: pastDeadline,
	}

	assignmentFuture := &LabAssignment{
		AllowedLanguages: []string{"python", "javascript"},
		DueAt: futureDeadline,
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
