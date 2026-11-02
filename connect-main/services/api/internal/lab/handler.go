package lab

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/audit"
	"github.com/tathastu/connect/services/api/internal/database"
)

// Handler serves practical learning and programming lab endpoints.
type Handler struct {
	pool  *pgxpool.Pool
	audit *audit.Service
	repo  *Repository
}

// NewHandler constructs the lab handler.
func NewHandler(pool *pgxpool.Pool, auditService *audit.Service) *Handler {
	return &Handler{
		pool:  pool,
		audit: auditService,
		repo:  NewRepository(),
	}
}

// RegisterRoutes mounts the lab routes.
func (h *Handler) RegisterRoutes(r chi.Router) {
	r.Route("/organizations/{org}/lab", func(labRouter chi.Router) {
		labRouter.Get("/courses", h.listCourses)
		labRouter.Get("/courses/{slug}", h.getCourse)
		labRouter.Get("/courses/{slug}/modules", h.listModules)
		labRouter.Get("/exercises/{id}", h.getExercise)
		labRouter.Post("/exercises/{id}/submit", h.submitExercise)
		labRouter.Get("/assignments", h.listAssignments)
		labRouter.Post("/assignments", h.createAssignment)
		labRouter.Get("/assignments/{id}", h.getAssignment)
		labRouter.Post("/assignments/{id}/submit", h.submitAssignment)
		labRouter.Get("/assignments/{id}/submissions", h.listSubmissions)
		labRouter.Post("/submissions/{id}/grade", h.gradeSubmission)
		labRouter.Get("/progress", h.getProgress)
		labRouter.Get("/faculty/overview", h.getFacultyOverview)
	})
}

func (h *Handler) inOrg(r *http.Request, fn func(pgx.Tx, *database.AuthContext, uuid.UUID) error) error {
	orgStr := chi.URLParam(r, "org")
	orgID, err := uuid.Parse(orgStr)
	if err != nil {
		return errors.New("invalid organization id")
	}
	return database.WithAuthContext(r.Context(), h.pool, database.SessionTokenHash(r.Context()), &orgStr, func(tx pgx.Tx, authCtx *database.AuthContext) error {
		return fn(tx, authCtx, orgID)
	})
}

func (h *Handler) isFacultyOrAdmin(role *string, isSuper bool) bool {
	if isSuper {
		return true
	}
	if role == nil {
		return false
	}
	switch *role {
	case "institution_admin", "department_coordinator", "faculty":
		return true
	default:
		return false
	}
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func (h *Handler) listCourses(w http.ResponseWriter, r *http.Request) {
	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		courses, err := h.repo.ListLabCourses(r.Context(), tx, orgID)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, map[string]any{"courses": courses})
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func (h *Handler) getCourse(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		course, err := h.repo.GetLabCourseBySlug(r.Context(), tx, orgID, slug)
		if err != nil {
			return err
		}
		if course == nil {
			writeError(w, http.StatusNotFound, "course not found")
			return nil
		}
		modules, err := h.repo.ListLabModules(r.Context(), tx, orgID, course.ID)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"course":  course,
			"modules": modules,
		})
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func (h *Handler) listModules(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		course, err := h.repo.GetLabCourseBySlug(r.Context(), tx, orgID, slug)
		if err != nil {
			return err
		}
		if course == nil {
			writeError(w, http.StatusNotFound, "course not found")
			return nil
		}
		modules, err := h.repo.ListLabModules(r.Context(), tx, orgID, course.ID)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, map[string]any{"modules": modules})
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func (h *Handler) getExercise(w http.ResponseWriter, r *http.Request) {
	exID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid exercise id")
		return
	}
	err = h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		isStudent := !h.isFacultyOrAdmin(authCtx.Role, authCtx.IsSuperAdmin)
		ex, err := h.repo.GetLabExercise(r.Context(), tx, orgID, exID, isStudent)
		if err != nil {
			return err
		}
		if ex == nil {
			writeError(w, http.StatusNotFound, "exercise not found")
			return nil
		}
		writeJSON(w, http.StatusOK, map[string]any{"exercise": ex})
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func (h *Handler) listAssignments(w http.ResponseWriter, r *http.Request) {
	courseIDStr := r.URL.Query().Get("course_id")
	var courseID uuid.UUID
	var err error
	if courseIDStr != "" {
		courseID, err = uuid.Parse(courseIDStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid course_id")
			return
		}
	}
	err = h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		isStudent := !h.isFacultyOrAdmin(authCtx.Role, authCtx.IsSuperAdmin)
		assignments, err := h.repo.ListLabAssignments(r.Context(), tx, orgID, courseID, isStudent)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, map[string]any{"assignments": assignments})
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func (h *Handler) getAssignment(w http.ResponseWriter, r *http.Request) {
	assignID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid assignment id")
		return
	}
	err = h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		isStudent := !h.isFacultyOrAdmin(authCtx.Role, authCtx.IsSuperAdmin)
		var userUUID uuid.UUID
		if authCtx.UserID != "" {
			userUUID, _ = uuid.Parse(authCtx.UserID)
		}
		assignment, err := h.repo.GetLabAssignment(r.Context(), tx, orgID, assignID, isStudent, userUUID)
		if err != nil {
			return err
		}
		if assignment == nil {
			writeError(w, http.StatusNotFound, "assignment not found")
			return nil
		}
		writeJSON(w, http.StatusOK, map[string]any{"assignment": assignment})
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

type createAssignmentRequest struct {
	LabCourseID      uuid.UUID     `json:"lab_course_id"`
	Title            string        `json:"title"`
	Description      string        `json:"description"`
	AllowedLanguages []string      `json:"allowed_languages"`
	StarterCode      string        `json:"starter_code"`
	DueAt            time.Time     `json:"due_at"`
	MaxScore         int           `json:"max_score"`
	Status           string        `json:"status"`
	TestCases        []LabTestCase `json:"test_cases"`
}

func (h *Handler) createAssignment(w http.ResponseWriter, r *http.Request) {
	var req createAssignmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Title == "" || req.LabCourseID == uuid.Nil {
		writeError(w, http.StatusBadRequest, "title and lab_course_id are required")
		return
	}
	if req.MaxScore <= 0 {
		req.MaxScore = 100
	}
	if req.Status == "" {
		req.Status = "published"
	}

	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		if !h.isFacultyOrAdmin(authCtx.Role, authCtx.IsSuperAdmin) {
			writeError(w, http.StatusForbidden, "only faculty or administrators may create assignments")
			return nil
		}
		authorID, err := uuid.Parse(authCtx.UserID)
		if err != nil {
			return errors.New("invalid user id in session")
		}

		assignment := &LabAssignment{
			ID:               uuid.New(),
			OrganizationID:   orgID,
			LabCourseID:      req.LabCourseID,
			CreatedByUserID:  authorID,
			Title:            req.Title,
			Description:      req.Description,
			AllowedLanguages: req.AllowedLanguages,
			StarterCode:      json.RawMessage(fmt.Sprintf(`{"code": %q}`, req.StarterCode)),
			DueAt:            req.DueAt,
			MaxScore:         req.MaxScore,
			Status:           req.Status,
		}
		if assignment.DueAt.IsZero() {
			assignment.DueAt = time.Now().Add(14 * 24 * time.Hour)
		}

		if err := h.repo.CreateLabAssignment(r.Context(), tx, assignment, req.TestCases); err != nil {
			return err
		}
		writeJSON(w, http.StatusCreated, map[string]any{"assignment": assignment})
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

type submissionRequest struct {
	Language        string            `json:"language"`
	SourceCode      string            `json:"source_code"`
	Outputs         map[string]string `json:"outputs"`   // test_case_id -> stdout
	Errors          map[string]string `json:"errors"`    // test_case_id -> stderr
	Durations       map[string]int    `json:"durations"` // test_case_id -> duration_ms
	ExecutionTimeMS int               `json:"execution_duration_ms"`
	Stdout          string            `json:"stdout"`
	Stderr          string            `json:"stderr"`
}

func (h *Handler) submitAssignment(w http.ResponseWriter, r *http.Request) {
	assignID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid assignment id")
		return
	}
	var req submissionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	err = h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		studentID, err := uuid.Parse(authCtx.UserID)
		if err != nil {
			return errors.New("invalid user id")
		}

		// Retrieve all test cases for assignment (including hidden test cases)
		testCases, err := h.repo.GetAllTestCasesForEvaluation(r.Context(), tx, orgID, &assignID, nil)
		if err != nil {
			return err
		}

		// Get assignment to verify max score and course id
		assignment, err := h.repo.GetLabAssignment(r.Context(), tx, orgID, assignID, false, uuid.Nil)
		if err != nil || assignment == nil {
			writeError(w, http.StatusNotFound, "assignment not found")
			return nil
		}

		// Evaluate test cases safely
		isStudent := !h.isFacultyOrAdmin(authCtx.Role, authCtx.IsSuperAdmin)
		score, passedCount, totalCount, status, results := EvaluateSubmissionAgainstTestCases(
			testCases, req.Outputs, req.Errors, req.Durations, assignment.MaxScore, isStudent,
		)

		sub := &LabSubmission{
			ID:                  uuid.New(),
			OrganizationID:      orgID,
			AssignmentID:        &assignID,
			StudentUserID:       studentID,
			Language:            req.Language,
			SourceCode:          req.SourceCode,
			Status:              status,
			Score:               score,
			PassedCount:         passedCount,
			TotalCount:          totalCount,
			ExecutionDurationMS: req.ExecutionTimeMS,
			Stdout:              req.Stdout,
			Stderr:              req.Stderr,
			TestResults:         results,
		}

		if err := h.repo.CreateSubmission(r.Context(), tx, sub); err != nil {
			return err
		}

		// Record student progress
		_ = h.repo.RecordStudentActivity(r.Context(), tx, orgID, assignment.LabCourseID, studentID, score, true, false)

		writeJSON(w, http.StatusOK, map[string]any{
			"submission": sub,
			"score":      score,
			"status":     status,
		})
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func (h *Handler) submitExercise(w http.ResponseWriter, r *http.Request) {
	exID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid exercise id")
		return
	}
	var req submissionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	err = h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		studentID, err := uuid.Parse(authCtx.UserID)
		if err != nil {
			return errors.New("invalid user id")
		}

		testCases, err := h.repo.GetAllTestCasesForEvaluation(r.Context(), tx, orgID, nil, &exID)
		if err != nil {
			return err
		}

		exercise, err := h.repo.GetLabExercise(r.Context(), tx, orgID, exID, false)
		if err != nil || exercise == nil {
			writeError(w, http.StatusNotFound, "exercise not found")
			return nil
		}

		isStudent := !h.isFacultyOrAdmin(authCtx.Role, authCtx.IsSuperAdmin)
		score, passedCount, totalCount, status, results := EvaluateSubmissionAgainstTestCases(
			testCases, req.Outputs, req.Errors, req.Durations, exercise.Points, isStudent,
		)

		sub := &LabSubmission{
			ID:                  uuid.New(),
			OrganizationID:      orgID,
			ExerciseID:          &exID,
			StudentUserID:       studentID,
			Language:            req.Language,
			SourceCode:          req.SourceCode,
			Status:              status,
			Score:               score,
			PassedCount:         passedCount,
			TotalCount:          totalCount,
			ExecutionDurationMS: req.ExecutionTimeMS,
			Stdout:              req.Stdout,
			Stderr:              req.Stderr,
			TestResults:         results,
		}

		if err := h.repo.CreateSubmission(r.Context(), tx, sub); err != nil {
			return err
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"submission": sub,
			"score":      score,
			"status":     status,
		})
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func (h *Handler) listSubmissions(w http.ResponseWriter, r *http.Request) {
	assignID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid assignment id")
		return
	}
	err = h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		isFaculty := h.isFacultyOrAdmin(authCtx.Role, authCtx.IsSuperAdmin)
		var studentID *uuid.UUID
		if !isFaculty {
			// Student can only see their own submissions
			uid, _ := uuid.Parse(authCtx.UserID)
			studentID = &uid
		}
		subs, err := h.repo.ListSubmissions(r.Context(), tx, orgID, &assignID, studentID)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, map[string]any{"submissions": subs})
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

type gradeRequest struct {
	Score    int    `json:"score"`
	Feedback string `json:"feedback"`
}

func (h *Handler) gradeSubmission(w http.ResponseWriter, r *http.Request) {
	subID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid submission id")
		return
	}
	var req gradeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	err = h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		if !h.isFacultyOrAdmin(authCtx.Role, authCtx.IsSuperAdmin) {
			writeError(w, http.StatusForbidden, "only faculty or administrators may grade submissions")
			return nil
		}
		graderID, err := uuid.Parse(authCtx.UserID)
		if err != nil {
			return errors.New("invalid user id")
		}
		if err := h.repo.UpdateSubmissionGrade(r.Context(), tx, orgID, subID, graderID, req.Score, req.Feedback); err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": true})
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func (h *Handler) getProgress(w http.ResponseWriter, r *http.Request) {
	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		studentID, err := uuid.Parse(authCtx.UserID)
		if err != nil {
			return errors.New("invalid user id")
		}
		progress, err := h.repo.GetStudentProgress(r.Context(), tx, orgID, studentID)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, map[string]any{"progress": progress})
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func (h *Handler) getFacultyOverview(w http.ResponseWriter, r *http.Request) {
	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		if !h.isFacultyOrAdmin(authCtx.Role, authCtx.IsSuperAdmin) {
			writeError(w, http.StatusForbidden, "only faculty or administrators may access overview")
			return nil
		}
		fo, err := h.repo.GetFacultyOverview(r.Context(), tx, orgID)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, map[string]any{"overview": fo})
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}
