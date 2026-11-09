package lab

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/audit"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/runner"
)

var (
	errInvalidOrgID    = errors.New("invalid organization id")
	errInvalidUserID   = errors.New("invalid user id in session")
	errUnauthenticated = errors.New("authentication required")
)

type withAuthContextFunc func(ctx context.Context, pool *pgxpool.Pool, tokenHash string, orgID *string, fn func(pgx.Tx, *database.AuthContext) error) error

// Handler serves practical learning and programming lab endpoints.
type Handler struct {
	pool          *pgxpool.Pool
	audit         *audit.Service
	repo          *Repository
	withAuthCtxFn withAuthContextFunc
	// runner executes C++ and Java in an isolated service; nil when none is configured.
	runner runner.Runner
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
		h.routeExecution(labRouter)
	})
}

func (h *Handler) inOrg(r *http.Request, fn func(pgx.Tx, *database.AuthContext, uuid.UUID) error) error {
	orgStr := chi.URLParam(r, "org")
	orgID, err := uuid.Parse(orgStr)
	if err != nil {
		return errInvalidOrgID
	}
	withAuth := database.WithAuthContext
	if h.withAuthCtxFn != nil {
		withAuth = h.withAuthCtxFn
	}
	return withAuth(r.Context(), h.pool, database.SessionTokenHash(r.Context()), &orgStr, func(tx pgx.Tx, authCtx *database.AuthContext) error {
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

// ErrDomainValidation is a typed sentinel for client-actionable domain rule violations.
var ErrDomainValidation = errors.New("domain validation failed")

// isTenantMembershipDenial returns true only if the 42501 error explicitly matches
// the documented contract of connect_auth.authenticate_session for tenant membership denial:
// "Authorization Failed: User <uuid> has no active membership in Organization <uuid>"
func isTenantMembershipDenial(pgErr *pgconn.PgError) bool {
	msg := strings.TrimSpace(pgErr.Message)
	msg = strings.TrimPrefix(msg, "ERROR:")
	msg = strings.TrimSpace(msg)
	return strings.HasPrefix(msg, "Authorization Failed:") ||
		strings.Contains(msg, "has no active membership in Organization") ||
		strings.EqualFold(msg, "unauthorized tenant")
}

// isRowSecurityViolation reports a write refused by a row level security WITH CHECK policy,
// for example faculty writing to a course they do not manage. This is a normal authorization
// outcome, unlike a missing GRANT ("permission denied for table"), which stays a 500.
func isRowSecurityViolation(pgErr *pgconn.PgError) bool {
	return strings.HasPrefix(strings.TrimSpace(pgErr.Message), "new row violates row-level security policy")
}

// isRecognizedDomainValidationError checks whether a generic P0001 exception represents
// a known, documented business validation failure from academic/tenancy triggers.
func isRecognizedDomainValidationError(pgErr *pgconn.PgError) bool {
	msg := strings.TrimSpace(pgErr.Message)
	return strings.HasPrefix(msg, "Foreign Key Violation:") ||
		strings.HasPrefix(msg, "Integrity Error:") ||
		strings.HasPrefix(msg, "Temporal Eligibility Error:")
}

// handleLabError translates database and internal errors into safe, client-facing HTTP responses.
// - database.ErrMembershipDenied or SQLSTATE 42501 with "Authorization Failed:" -> HTTP 403 Forbidden.
// - Unexpected/ambiguous SQLSTATE 42501 (database system privilege errors) -> HTTP 500 Internal Server Error (fail-safe).
// - database.ErrNoSessionToken / database.ErrSessionInvalid / SQLSTATE 28000 -> HTTP 401 Unauthorized.
// - SQLSTATE 23505 unique violation -> HTTP 409 Conflict.
// - SQLSTATE 23503, 23514 foreign key/check constraint violation -> HTTP 400 Bad Request.
// - SQLSTATE 22P02 invalid input syntax (e.g. malformed UUID) -> HTTP 400 Bad Request.
// - SQLSTATE P0001 recognized academic domain validation triggers / ErrDomainValidation -> HTTP 400 Bad Request.
// - SQLSTATE P0001 unknown/unrecognized triggers -> HTTP 500 Internal Server Error (fail-safe).
// - SQLSTATE CN404 custom not found -> HTTP 404 Not Found.
// - SQLSTATE CN409 custom conflict -> HTTP 409 Conflict.
// - SQLSTATE CN410 custom gone -> HTTP 410 Gone.
// - SQLSTATE CN422 custom unprocessable -> HTTP 422 Unprocessable Entity.
// - errInvalidOrgID -> HTTP 400 Bad Request.
// - pgx.ErrNoRows -> HTTP 404 Not Found.
// - Genuine internal failures -> HTTP 500 without leaking raw SQL, SQLSTATE, or internal UUIDs.
func (h *Handler) handleLabError(w http.ResponseWriter, r *http.Request, err error) {
	if err == nil {
		return
	}

	// 1. Validation: Malformed route parameter
	if errors.Is(err, errInvalidOrgID) {
		writeError(w, http.StatusBadRequest, "invalid organization id")
		return
	}

	// 2. Authentication failure: Missing, invalid, expired, or revoked session credentials
	if errors.Is(err, errUnauthenticated) ||
		errors.Is(err, errInvalidUserID) ||
		errors.Is(err, database.ErrNoSessionToken) ||
		errors.Is(err, database.ErrSessionInvalid) {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	// 3. Organization authorization denial: Verified user lacks active tenant membership (typed sentinel)
	if errors.Is(err, database.ErrMembershipDenied) {
		writeError(w, http.StatusForbidden, "you do not have permission to access this organization's resources")
		return
	}

	// 4. Missing resource
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "resource not found")
		return
	}

	// 5. Domain validation failure (typed application error)
	if errors.Is(err, ErrDomainValidation) {
		writeError(w, http.StatusBadRequest, "invalid request data or referenced entity not found")
		return
	}

	// 6. PostgreSQL-specific error code classification
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "28000":
			// Direct 28000 unwrapped SQLSTATE check (invalid/expired session credentials)
			writeError(w, http.StatusUnauthorized, "authentication required")
			return

		case "42501":
			// Direct 42501 SQLSTATE check: only documented tenant membership denial from authenticate_session
			// maps to 403 Forbidden. All other, ambiguous, or unexpected system privilege failures
			// fail safely as generic 500 Internal Server Error to avoid concealing DB configuration errors.
			if isTenantMembershipDenial(pgErr) {
				writeError(w, http.StatusForbidden, "you do not have permission to access this organization's resources")
				return
			}
			if isRowSecurityViolation(pgErr) {
				writeError(w, http.StatusForbidden, "you do not have permission to modify this resource")
				return
			}
			writeError(w, http.StatusInternalServerError, "an unexpected internal error occurred")
			return

		case "23505":
			writeError(w, http.StatusConflict, "resource already exists")
			return

		case "23503", "23514":
			writeError(w, http.StatusBadRequest, "invalid request data or referenced entity not found")
			return

		case "22P02":
			writeError(w, http.StatusBadRequest, "invalid resource identifier format")
			return

		case "CN404":
			writeError(w, http.StatusNotFound, "resource not found")
			return

		case "CN409":
			writeError(w, http.StatusConflict, "resource conflict")
			return

		case "CN410":
			writeError(w, http.StatusGone, "resource no longer available")
			return

		case "CN422":
			writeError(w, http.StatusUnprocessableEntity, "unprocessable entity")
			return

		case "P0001":
			// Map only recognized, documented academic core domain validation triggers to 400 Bad Request.
			// Unknown P0001 must remain generic 500 to avoid misclassifying internal trigger/system faults.
			if isRecognizedDomainValidationError(pgErr) {
				writeError(w, http.StatusBadRequest, "invalid request data or referenced entity not found")
				return
			}
			writeError(w, http.StatusInternalServerError, "an unexpected internal error occurred")
			return
		}
	}

	// 7. Fallback for genuine internal server errors: safe generic error message.
	writeError(w, http.StatusInternalServerError, "an unexpected internal error occurred")
}

func (h *Handler) listCourses(w http.ResponseWriter, r *http.Request) {
	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		courses, err := h.repo.ListLabCourses(r.Context(), tx, orgID)
		if err != nil {
			return err
		}
		if courses == nil {
			courses = []LabCourse{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"courses": courses})
		return nil
	})
	if err != nil {
		h.handleLabError(w, r, err)
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
		h.handleLabError(w, r, err)
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
		h.handleLabError(w, r, err)
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
		h.handleLabError(w, r, err)
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
		if assignments == nil {
			assignments = []LabAssignment{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"assignments": assignments})
		return nil
	})
	if err != nil {
		h.handleLabError(w, r, err)
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
		h.handleLabError(w, r, err)
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

// defaultAllowedLanguages mirrors the lab_assignments column default. A nil slice would be
// sent as NULL and violate the NOT NULL constraint, turning an omitted field into a 500.
func defaultAllowedLanguages(langs []string) []string {
	if len(langs) == 0 {
		return []string{"cpp", "python", "java", "javascript", "sql"}
	}
	return langs
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
	if len(req.Title) > 255 {
		writeError(w, http.StatusBadRequest, "title cannot exceed 255 characters")
		return
	}
	if len(req.Description) > 50000 {
		writeError(w, http.StatusBadRequest, "description cannot exceed 50000 characters")
		return
	}
	if len(req.StarterCode) > 65536 {
		writeError(w, http.StatusBadRequest, "starter code exceeds maximum limit of 64KB")
		return
	}
	if len(req.TestCases) > 50 {
		writeError(w, http.StatusBadRequest, "cannot attach more than 50 test cases per assignment")
		return
	}
	if req.MaxScore <= 0 {
		req.MaxScore = 100
	}
	if req.Status == "" {
		req.Status = "published"
	}
	req.AllowedLanguages = defaultAllowedLanguages(req.AllowedLanguages)

	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		if !h.isFacultyOrAdmin(authCtx.Role, authCtx.IsSuperAdmin) {
			writeError(w, http.StatusForbidden, "only faculty or administrators may create assignments")
			return nil
		}
		authorID, err := uuid.Parse(authCtx.UserID)
		if err != nil {
			return errInvalidUserID
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
		h.handleLabError(w, r, err)
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
	if req.SourceCode == "" {
		writeError(w, http.StatusBadRequest, "source_code is required")
		return
	}
	if len(req.SourceCode) > 65536 {
		writeError(w, http.StatusBadRequest, "source code exceeds maximum size limit of 64KB")
		return
	}
	if req.Language == "" {
		writeError(w, http.StatusBadRequest, "language is required")
		return
	}
	// With a runner, C++ and Java are graded on the server; otherwise results stay self-checks.
	if h.runner != nil && serverRunLanguages[req.Language] {
		h.submitAssignmentOnServer(w, r, assignID, req)
		return
	}

	err = h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		studentID, err := uuid.Parse(authCtx.UserID)
		if err != nil {
			return errInvalidUserID
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

		// Enforce deadline for students
		isStudent := !h.isFacultyOrAdmin(authCtx.Role, authCtx.IsSuperAdmin)
		if isStudent && !assignment.DueAt.IsZero() && time.Now().After(assignment.DueAt) {
			writeError(w, http.StatusBadRequest, "assignment submission deadline has passed")
			return nil
		}

		// Validate language against assignment allowed languages
		if len(assignment.AllowedLanguages) > 0 {
			allowed := false
			for _, l := range assignment.AllowedLanguages {
				if l == req.Language {
					allowed = true
					break
				}
			}
			if !allowed {
				writeError(w, http.StatusBadRequest, fmt.Sprintf("language '%s' is not permitted for this assignment", req.Language))
				return nil
			}
		}

		// In zero-trust architecture without server-side isolated microVM runners:
		// Client-reported execution outputs are non-authoritative preview telemetry.
		// Assignment submissions are queued in status 'pending' with official score 0
		// until an authorized faculty member evaluates and assigns the grade.
		_, passedCount, totalCount, _, results := EvaluateSubmissionAgainstTestCases(
			testCases, req.Outputs, req.Errors, req.Durations, assignment.MaxScore, isStudent,
		)

		sub := &LabSubmission{
			ID:                  uuid.New(),
			OrganizationID:      orgID,
			AssignmentID:        &assignID,
			StudentUserID:       studentID,
			Language:            req.Language,
			SourceCode:          req.SourceCode,
			Status:              "pending",
			Score:               0,
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

		// Record student activity: 0 points awarded until faculty reviews and grades
		_ = h.repo.RecordStudentActivity(r.Context(), tx, orgID, assignment.LabCourseID, studentID, 0, true, false)

		writeJSON(w, http.StatusOK, map[string]any{
			"submission": sub,
			"score":      0,
			"status":     "pending",
			"message":    "Submission successfully queued for faculty review. Automated test results are preliminary self-checks.",
		})
		return nil
	})
	if err != nil {
		h.handleLabError(w, r, err)
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
			return errInvalidUserID
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
		h.handleLabError(w, r, err)
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
		h.handleLabError(w, r, err)
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
			return errInvalidUserID
		}

		sub, err := h.repo.GetSubmission(r.Context(), tx, orgID, subID)
		if err != nil || sub == nil {
			writeError(w, http.StatusNotFound, "submission not found")
			return nil
		}

		// Enforce score bounds against assignment max score
		var courseID uuid.UUID
		if sub.AssignmentID != nil {
			assignment, err := h.repo.GetLabAssignment(r.Context(), tx, orgID, *sub.AssignmentID, false, uuid.Nil)
			if err != nil || assignment == nil {
				writeError(w, http.StatusNotFound, "associated assignment not found")
				return nil
			}
			if req.Score < 0 || req.Score > assignment.MaxScore {
				writeError(w, http.StatusBadRequest, fmt.Sprintf("score must be between 0 and %d", assignment.MaxScore))
				return nil
			}
			courseID = assignment.LabCourseID
		} else if req.Score < 0 {
			writeError(w, http.StatusBadRequest, "score cannot be negative")
			return nil
		}

		if err := h.repo.UpdateSubmissionGrade(r.Context(), tx, orgID, subID, graderID, req.Score, req.Feedback); err != nil {
			return err
		}

		// Recalculate student course progress points using MAX(score) of graded submissions
		if courseID != uuid.Nil {
			_ = h.repo.RecalculateStudentCoursePoints(r.Context(), tx, orgID, courseID, sub.StudentUserID)
		}

		// Audit faculty grading action
		if h.audit != nil {
			h.audit.Record(r.Context(), audit.AuditParams{
				EventType: audit.EventType("lab.submission.graded"),
				Severity:  "INFO",
				ActorID:   graderID.String(),
				Metadata: map[string]any{
					"organization_id": orgID.String(),
					"submission_id":   subID.String(),
					"student_id":      sub.StudentUserID.String(),
					"score":           req.Score,
				},
			})
		}

		writeJSON(w, http.StatusOK, map[string]any{"success": true, "score": req.Score, "status": "graded"})
		return nil
	})
	if err != nil {
		h.handleLabError(w, r, err)
	}
}

func (h *Handler) getProgress(w http.ResponseWriter, r *http.Request) {
	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		studentID, err := uuid.Parse(authCtx.UserID)
		if err != nil {
			return errInvalidUserID
		}
		progress, err := h.repo.GetStudentProgress(r.Context(), tx, orgID, studentID)
		if err != nil {
			return err
		}
		if progress == nil {
			progress = []LabStudentProgress{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"progress": progress})
		return nil
	})
	if err != nil {
		h.handleLabError(w, r, err)
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
		h.handleLabError(w, r, err)
	}
}
