// Package institution exposes academic management. Every request runs in a transaction carrying
// the caller's verified organization role, so row level security decides what they may touch.
package institution

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/audit"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/middleware"
	"github.com/tathastu/connect/services/api/internal/model"
	"github.com/tathastu/connect/services/api/internal/room"
	"github.com/tathastu/connect/services/api/internal/worker"
)

// Handler serves the institution routes.
type Handler struct {
	pool  *pgxpool.Pool
	audit *audit.Service
}

// NewHandler constructs the handler.
func NewHandler(pool *pgxpool.Pool, auditService *audit.Service) *Handler {
	return &Handler{pool: pool, audit: auditService}
}

// RegisterRoutes mounts the routes. The caller applies session authentication and CSRF.
func (h *Handler) RegisterRoutes(r chi.Router) {
	r.Get("/organizations", h.listOrganizations)
	r.Post("/organizations", h.createOrganization)
	r.Route("/organizations/{org}", func(o chi.Router) {
		o.Get("/admin/overview", h.overview)
		o.Get("/admin/audit", h.auditLog)
		o.Get("/admin/engagement", h.adminEngagement)
		o.Get("/members", h.listMembers)
		o.Post("/members", h.addMember)
		o.Patch("/members/{user}", h.updateMember)
		o.Get("/departments", h.listDepartments)
		o.Post("/departments", h.createDepartment)
		o.Get("/courses", h.listCourses)
		o.Post("/courses", h.createCourse)
		o.Get("/batches", h.listBatches)
		o.Post("/batches", h.createBatch)
		o.Get("/allocations", h.listAllocations)
		o.Post("/allocations", h.createAllocation)
		o.Post("/allocations/{id}/revoke", h.revokeAllocation)
		o.Get("/enrollments", h.listEnrollments)
		o.Post("/enrollments", h.createEnrollment)
		o.Post("/enrollments/{id}/drop", h.dropEnrollment)
		o.Get("/sessions", h.listSessions)
		o.Post("/sessions", h.createSessions)
		o.Patch("/sessions/{id}", h.rescheduleSession)
		o.Post("/sessions/{id}/cancel", h.cancelSession)
		o.Get("/sessions/{id}/attendance", h.sessionAttendance)
		o.Get("/sessions/{id}/attendance.csv", h.sessionAttendanceCSV)
		o.Post("/sessions/{id}/attendance/{student}/overrule", h.overruleAttendance)
		o.Get("/attendance/summary", h.attendanceSummary)
		o.Get("/attendance/classes", h.attendanceByClass)
		o.Get("/sessions/{id}/engagement", h.sessionEngagement)
		o.Get("/attendance-policies", h.listPolicies)
		o.Post("/attendance-policies", h.createPolicy)
	})
}

// inOrg runs fn with the caller's role in the organization named by the URL. The database
// verifies membership, so the URL grants nothing by itself.
func (h *Handler) inOrg(r *http.Request, fn func(pgx.Tx, *database.AuthContext) error) error {
	org := chi.URLParam(r, "org")
	if _, err := uuid.Parse(org); err != nil {
		return errNotPermitted
	}
	return database.WithAuthContext(r.Context(), h.pool, database.SessionTokenHash(r.Context()), &org, fn)
}

var (
	errNotPermitted = errors.New("not permitted")
)

type userError struct {
	status int
	code   string
	msg    string
}

func (e *userError) Error() string { return e.msg }

func invalid(msg string) error {
	return &userError{status: http.StatusBadRequest, code: "VALIDATION_FAILED", msg: msg}
}

func sendError(w http.ResponseWriter, r *http.Request, err error) {
	var ue *userError
	if errors.As(err, &ue) {
		model.SendJSONError(w, r, ue.status, ue.code, ue.msg)
		return
	}
	if errors.Is(err, errNotPermitted) {
		model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You do not have permission to do this.")
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "This was not found.")
		return
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "42501", "28000":
			model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You do not have permission to do this.")
			return
		case "23505":
			model.SendJSONError(w, r, http.StatusConflict, "ALREADY_EXISTS", "This already exists.")
			return
		case "23503", "23514", "22P02", "P0001":
			// Includes references to another organization's records, which composite keys refuse.
			model.SendJSONError(w, r, http.StatusBadRequest, "VALIDATION_FAILED", "This request refers to something invalid or not in this organization.")
			return
		case "CN404":
			model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", pgErr.Message)
			return
		}
	}
	model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "This could not be completed.")
}

func decode(r *http.Request, dest any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dest); err != nil {
		return invalid("Invalid request body.")
	}
	return nil
}

// queryJSON returns the rows of query as a JSON array built by PostgreSQL.
func queryJSON(ctx context.Context, tx pgx.Tx, query string, args ...any) (json.RawMessage, error) {
	var raw []byte
	err := tx.QueryRow(ctx, `SELECT COALESCE(json_agg(t), '[]'::json) FROM (`+query+`) t`, args...).Scan(&raw)
	return raw, err
}

// insertJSON returns the single row of a writing statement as a JSON object.
func insertJSON(ctx context.Context, tx pgx.Tx, query string, args ...any) (json.RawMessage, error) {
	var raw []byte
	err := tx.QueryRow(ctx, `WITH t AS (`+query+`) SELECT row_to_json(t) FROM t`, args...).Scan(&raw)
	return raw, err
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request, key, query string, args ...any) {
	var raw json.RawMessage
	err := h.inOrg(r, func(tx pgx.Tx, _ *database.AuthContext) error {
		var qErr error
		raw, qErr = queryJSON(r.Context(), tx, query, args...)
		return qErr
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{key: raw})
}

// insert reports whether the row was created, so callers audit only what really happened.
func (h *Handler) insert(w http.ResponseWriter, r *http.Request, key, query string, args ...any) bool {
	var raw json.RawMessage
	err := h.inOrg(r, func(tx pgx.Tx, _ *database.AuthContext) error {
		var qErr error
		raw, qErr = insertJSON(r.Context(), tx, query, args...)
		return qErr
	})
	if err != nil {
		sendError(w, r, err)
		return false
	}
	model.SendJSON(w, http.StatusCreated, map[string]any{key: raw})
	return true
}

func (h *Handler) record(ctx context.Context, r *http.Request, event, target string) {
	if h.audit == nil {
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	actor := ""
	if user != nil {
		actor = user.ID
	}
	h.audit.Record(ctx, audit.AuditParams{
		EventType: audit.EventType(event), Severity: "INFO", ActorID: actor,
		Metadata: map[string]any{"organization_id": chi.URLParam(r, "org"), "target": target},
	})
}

func required(values ...string) bool {
	for _, v := range values {
		if strings.TrimSpace(v) == "" {
			return false
		}
	}
	return true
}

// --- Organizations and members ---

func (h *Handler) listOrganizations(w http.ResponseWriter, r *http.Request) {
	var raw json.RawMessage
	err := database.WithAuthContext(r.Context(), h.pool, database.SessionTokenHash(r.Context()), nil, func(tx pgx.Tx, _ *database.AuthContext) error {
		var qErr error
		raw, qErr = queryJSON(r.Context(), tx, `SELECT id, slug, name, role FROM connect_auth.my_organizations()`)
		return qErr
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"organizations": raw})
}

// createOrganization is for platform administrators, and names the institution's first admin.
func (h *Handler) createOrganization(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Slug       string `json:"slug"`
		Name       string `json:"name"`
		AdminEmail string `json:"adminEmail"`
	}
	if err := decode(r, &req); err != nil {
		sendError(w, r, err)
		return
	}
	if !required(req.Slug, req.Name, req.AdminEmail) {
		sendError(w, r, invalid("A slug, name and administrator email are required."))
		return
	}
	var raw json.RawMessage
	err := database.WithAuthContext(r.Context(), h.pool, database.SessionTokenHash(r.Context()), nil, func(tx pgx.Tx, auth *database.AuthContext) error {
		if !auth.IsSuperAdmin {
			return errNotPermitted
		}
		var id string
		if err := tx.QueryRow(r.Context(), `INSERT INTO organizations (slug, name) VALUES ($1, $2) RETURNING id::text`, req.Slug, req.Name).Scan(&id); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `SELECT connect_auth.org_add_member($1::UUID, $2, 'institution_admin', '')`, id, req.AdminEmail); err != nil {
			return err
		}
		var qErr error
		raw, qErr = insertJSON(r.Context(), tx, `SELECT id, slug, name FROM organizations WHERE id = $1`, id)
		return qErr
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	model.SendJSON(w, http.StatusCreated, map[string]any{"organization": raw})
}

func (h *Handler) listMembers(w http.ResponseWriter, r *http.Request) {
	h.list(w, r, "members", `SELECT user_id AS "userId", display_name AS "displayName", email, role, status, member_identifier AS "memberIdentifier" FROM connect_auth.org_members($1::UUID)`, chi.URLParam(r, "org"))
}

var memberRoles = map[string]bool{"institution_admin": true, "institution_auditor": true, "institution_member": true, "department_coordinator": true, "faculty": true, "student": true}

func (h *Handler) addMember(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email      string `json:"email"`
		Role       string `json:"role"`
		Identifier string `json:"memberIdentifier"`
	}
	if err := decode(r, &req); err != nil {
		sendError(w, r, err)
		return
	}
	if !required(req.Email) || !memberRoles[req.Role] {
		sendError(w, r, invalid("An email and a valid role are required."))
		return
	}
	var userID string
	err := h.inOrg(r, func(tx pgx.Tx, _ *database.AuthContext) error {
		return tx.QueryRow(r.Context(), `SELECT connect_auth.org_add_member($1::UUID, $2, $3, $4)::text`, chi.URLParam(r, "org"), req.Email, req.Role, req.Identifier).Scan(&userID)
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	h.record(r.Context(), r, "institution.member_added", userID)
	model.SendJSON(w, http.StatusCreated, map[string]any{"userId": userID})
}

func (h *Handler) updateMember(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Role   string `json:"role"`
		Status string `json:"status"`
	}
	if err := decode(r, &req); err != nil {
		sendError(w, r, err)
		return
	}
	if !memberRoles[req.Role] || (req.Status != "active" && req.Status != "suspended" && req.Status != "revoked") {
		sendError(w, r, invalid("A valid role and status are required."))
		return
	}
	target := chi.URLParam(r, "user")
	err := h.inOrg(r, func(tx pgx.Tx, auth *database.AuthContext) error {
		if target == auth.UserID {
			return &userError{status: http.StatusConflict, code: "SELF_CHANGE", msg: "You cannot change your own membership."}
		}
		tag, err := tx.Exec(r.Context(), `
			UPDATE organization_memberships SET role = $1, status = $2::varchar, updated_at = clock_timestamp(),
			       revoked_at = CASE WHEN $2::varchar = 'revoked' THEN clock_timestamp() END,
			       revoked_by = CASE WHEN $2::varchar = 'revoked' THEN $3::uuid END
			WHERE organization_id = $4 AND user_id = $5
		`, req.Role, req.Status, auth.UserID, chi.URLParam(r, "org"), target)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errNotPermitted
		}
		return nil
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	h.record(r.Context(), r, "institution.member_updated", target)
	model.SendJSON(w, http.StatusOK, map[string]any{"success": true})
}

// --- Academic structure ---

func (h *Handler) listDepartments(w http.ResponseWriter, r *http.Request) {
	h.list(w, r, "departments", `SELECT id, code, name, status FROM departments WHERE organization_id = $1 ORDER BY code`, chi.URLParam(r, "org"))
}

func (h *Handler) createDepartment(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code string `json:"code"`
		Name string `json:"name"`
	}
	if err := decode(r, &req); err != nil {
		sendError(w, r, err)
		return
	}
	if !required(req.Code, req.Name) {
		sendError(w, r, invalid("A code and name are required."))
		return
	}
	h.insert(w, r, "department", `INSERT INTO departments (organization_id, code, name) VALUES ($1, $2, $3) RETURNING id, code, name, status`, chi.URLParam(r, "org"), req.Code, req.Name)
}

func (h *Handler) listCourses(w http.ResponseWriter, r *http.Request) {
	h.list(w, r, "courses", `SELECT id, department_id AS "departmentId", code, title, description, credits, status FROM courses WHERE organization_id = $1 ORDER BY code`, chi.URLParam(r, "org"))
}

func (h *Handler) createCourse(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DepartmentID string `json:"departmentId"`
		Code         string `json:"code"`
		Title        string `json:"title"`
		Description  string `json:"description"`
		Credits      int    `json:"credits"`
	}
	if err := decode(r, &req); err != nil {
		sendError(w, r, err)
		return
	}
	if !required(req.DepartmentID, req.Code, req.Title) {
		sendError(w, r, invalid("A department, code and title are required."))
		return
	}
	if req.Credits <= 0 {
		req.Credits = 3
	}
	h.insert(w, r, "course", `INSERT INTO courses (organization_id, department_id, code, title, description, credits) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, department_id AS "departmentId", code, title, description, credits, status`,
		chi.URLParam(r, "org"), req.DepartmentID, req.Code, req.Title, req.Description, req.Credits)
}

func (h *Handler) listBatches(w http.ResponseWriter, r *http.Request) {
	h.list(w, r, "batches", `SELECT id, course_id AS "courseId", name, academic_term AS "academicTerm", start_date AS "startDate", end_date AS "endDate", status FROM course_batches WHERE organization_id = $1 ORDER BY start_date DESC, name`, chi.URLParam(r, "org"))
}

func (h *Handler) createBatch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CourseID     string `json:"courseId"`
		Name         string `json:"name"`
		AcademicTerm string `json:"academicTerm"`
		StartDate    string `json:"startDate"`
		EndDate      string `json:"endDate"`
	}
	if err := decode(r, &req); err != nil {
		sendError(w, r, err)
		return
	}
	if !required(req.CourseID, req.Name, req.AcademicTerm, req.StartDate, req.EndDate) {
		sendError(w, r, invalid("A course, name, term, start date and end date are required."))
		return
	}
	h.insert(w, r, "batch", `INSERT INTO course_batches (organization_id, course_id, name, academic_term, start_date, end_date) VALUES ($1, $2, $3, $4, $5::date, $6::date) RETURNING id, course_id AS "courseId", name, academic_term AS "academicTerm", start_date AS "startDate", end_date AS "endDate", status`,
		chi.URLParam(r, "org"), req.CourseID, req.Name, req.AcademicTerm, req.StartDate, req.EndDate)
}

func (h *Handler) listAllocations(w http.ResponseWriter, r *http.Request) {
	h.list(w, r, "allocations", `SELECT id, course_id AS "courseId", faculty_user_id AS "facultyUserId", role, status FROM faculty_allocations WHERE organization_id = $1 ORDER BY created_at DESC`, chi.URLParam(r, "org"))
}

func (h *Handler) createAllocation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CourseID      string `json:"courseId"`
		FacultyUserID string `json:"facultyUserId"`
		Role          string `json:"role"`
	}
	if err := decode(r, &req); err != nil {
		sendError(w, r, err)
		return
	}
	if req.Role == "" {
		req.Role = "primary_instructor"
	}
	if !required(req.CourseID, req.FacultyUserID) {
		sendError(w, r, invalid("A course and faculty member are required."))
		return
	}
	created := h.insert(w, r, "allocation", `INSERT INTO faculty_allocations (organization_id, course_id, faculty_user_id, role) VALUES ($1, $2, $3, $4) RETURNING id, course_id AS "courseId", faculty_user_id AS "facultyUserId", role, status`,
		chi.URLParam(r, "org"), req.CourseID, req.FacultyUserID, req.Role)
	if created {
		h.record(r.Context(), r, "institution.faculty_assigned", req.FacultyUserID)
	}
}

func (h *Handler) revokeAllocation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Reason string `json:"reason"`
	}
	if err := decode(r, &req); err != nil {
		sendError(w, r, err)
		return
	}
	if len(strings.TrimSpace(req.Reason)) < 10 {
		sendError(w, r, invalid("A reason of at least 10 characters is required."))
		return
	}
	err := h.inOrg(r, func(tx pgx.Tx, auth *database.AuthContext) error {
		tag, err := tx.Exec(r.Context(), `
			UPDATE faculty_allocations SET status = 'revoked', revoked_at = clock_timestamp(), effective_to = clock_timestamp(), revoked_by = $1, revocation_reason = $2
			WHERE id = $3 AND organization_id = $4 AND status = 'active'
		`, auth.UserID, req.Reason, chi.URLParam(r, "id"), chi.URLParam(r, "org"))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errNotPermitted
		}
		return nil
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	h.record(r.Context(), r, "institution.faculty_revoked", chi.URLParam(r, "id"))
	model.SendJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) listEnrollments(w http.ResponseWriter, r *http.Request) {
	h.list(w, r, "enrollments", `SELECT id, batch_id AS "batchId", student_user_id AS "studentUserId", status, enrolled_at AS "enrolledAt" FROM course_enrollments WHERE organization_id = $1 ORDER BY enrolled_at DESC`, chi.URLParam(r, "org"))
}

func (h *Handler) createEnrollment(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BatchID       string `json:"batchId"`
		StudentUserID string `json:"studentUserId"`
	}
	if err := decode(r, &req); err != nil {
		sendError(w, r, err)
		return
	}
	if !required(req.BatchID, req.StudentUserID) {
		sendError(w, r, invalid("A batch and student are required."))
		return
	}
	created := h.insert(w, r, "enrollment", `INSERT INTO course_enrollments (organization_id, batch_id, student_user_id) VALUES ($1, $2, $3) RETURNING id, batch_id AS "batchId", student_user_id AS "studentUserId", status`,
		chi.URLParam(r, "org"), req.BatchID, req.StudentUserID)
	if created {
		h.record(r.Context(), r, "institution.student_enrolled", req.StudentUserID)
	}
}

func (h *Handler) dropEnrollment(w http.ResponseWriter, r *http.Request) {
	err := h.inOrg(r, func(tx pgx.Tx, _ *database.AuthContext) error {
		tag, err := tx.Exec(r.Context(), `UPDATE course_enrollments SET status = 'dropped', dropped_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1 AND organization_id = $2 AND status = 'enrolled'`, chi.URLParam(r, "id"), chi.URLParam(r, "org"))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errNotPermitted
		}
		return nil
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	h.record(r.Context(), r, "institution.student_dropped", chi.URLParam(r, "id"))
	model.SendJSON(w, http.StatusOK, map[string]any{"success": true})
}

// --- Class sessions ---

// enqueueSessionNotice queues a notice in the same transaction as the change, so a rolled-back
// change never notifies anyone and a committed one always does.
func enqueueSessionNotice(ctx context.Context, tx pgx.Tx, sessionID, event string, startsAt time.Time, count int) error {
	data, err := json.Marshal(worker.NotifySessionData{SessionID: sessionID, Event: event, StartsAt: startsAt.UTC(), Count: count})
	if err != nil {
		return err
	}
	key := fmt.Sprintf("notify-session-%s-%s-%d", sessionID, event, startsAt.Unix())
	return worker.EnqueueJobWriteOnly(ctx, tx, worker.QueueDefault, key, worker.JobPayload{Type: worker.TypeNotifySession, Data: data, CreatedAt: time.Now().UTC()})
}

// enqueueReminder schedules a reminder. The job checks the start time again when it runs, so one
// left behind by a reschedule does nothing.
func enqueueReminder(ctx context.Context, tx pgx.Tx, sessionID string, startsAt time.Time) error {
	data, err := json.Marshal(worker.NotifySessionData{SessionID: sessionID, Event: worker.NotifySessionReminder, StartsAt: startsAt.UTC()})
	if err != nil {
		return err
	}
	at := startsAt.Add(-worker.ReminderLead)
	if now := time.Now(); at.Before(now) {
		at = now
	}
	key := fmt.Sprintf("notify-session-%s-%s-%d", sessionID, worker.NotifySessionReminder, startsAt.Unix())
	return worker.EnqueueJobWriteOnlyAt(ctx, tx, worker.QueueDefault, key, worker.JobPayload{Type: worker.TypeNotifySession, Data: data, CreatedAt: time.Now().UTC()}, at)
}

const sessionColumns = `cs.id, cs.course_id AS "courseId", cs.batch_id AS "batchId", cs.faculty_allocation_id AS "facultyAllocationId",
	cs.series_id AS "seriesId", cs.title, cs.scheduled_start AS "scheduledStart", cs.scheduled_end AS "scheduledEnd", cs.time_zone AS "timeZone", cs.status,
	(SELECT r.public_code FROM rooms r WHERE r.class_session_id = cs.id LIMIT 1) AS "roomCode"`

// listSessions is a calendar: RLS narrows it to what each role may see, so students get their
// batches and faculty their courses.
func (h *Handler) listSessions(w http.ResponseWriter, r *http.Request) {
	from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	start, err := time.Parse(time.RFC3339, from)
	if err != nil {
		start = time.Now().Add(-30 * 24 * time.Hour)
	}
	end, err := time.Parse(time.RFC3339, to)
	if err != nil {
		end = start.Add(120 * 24 * time.Hour)
	}
	h.list(w, r, "sessions", `SELECT `+sessionColumns+` FROM class_sessions cs WHERE cs.organization_id = $1 AND cs.scheduled_start >= $2 AND cs.scheduled_start < $3 ORDER BY cs.scheduled_start`, chi.URLParam(r, "org"), start, end)
}

func (h *Handler) createSessions(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CourseID            string      `json:"courseId"`
		BatchID             string      `json:"batchId"`
		FacultyAllocationID string      `json:"facultyAllocationId"`
		Title               string      `json:"title"`
		Start               time.Time   `json:"start"`
		End                 time.Time   `json:"end"`
		TimeZone            string      `json:"timeZone"`
		Recurrence          *Recurrence `json:"recurrence"`
	}
	if err := decode(r, &req); err != nil {
		sendError(w, r, err)
		return
	}
	if !required(req.CourseID, req.BatchID, req.FacultyAllocationID, req.Title) {
		sendError(w, r, invalid("A course, batch, faculty allocation and title are required."))
		return
	}
	if !req.Start.After(time.Now()) {
		sendError(w, r, invalid("A class must start in the future."))
		return
	}
	occurrences, err := ExpandOccurrences(req.Start, req.End, req.TimeZone, req.Recurrence)
	if err != nil {
		sendError(w, r, invalid(err.Error()))
		return
	}
	var seriesID *string
	if req.Recurrence != nil {
		id := uuid.NewString()
		seriesID = &id
	}
	org := chi.URLParam(r, "org")
	var raw json.RawMessage
	err = h.inOrg(r, func(tx pgx.Tx, _ *database.AuthContext) error {
		ids := make([]string, 0, len(occurrences))
		for _, o := range occurrences {
			if err := checkConflict(r.Context(), tx, org, req.BatchID, req.FacultyAllocationID, o.Start, o.End, nil); err != nil {
				return err
			}
			var id string
			err := tx.QueryRow(r.Context(), `
				INSERT INTO class_sessions (organization_id, course_id, batch_id, faculty_allocation_id, title, scheduled_start, scheduled_end, time_zone, series_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text
			`, org, req.CourseID, req.BatchID, req.FacultyAllocationID, req.Title, o.Start, o.End, req.TimeZone, seriesID).Scan(&id)
			if err != nil {
				return err
			}
			code, err := room.GeneratePublicCode()
			if err != nil {
				return err
			}
			if _, err := tx.Exec(r.Context(), `SELECT connect_auth.create_session_room($1::UUID, $2)`, id, code); err != nil {
				return err
			}
			if err := enqueueReminder(r.Context(), tx, id, o.Start); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		// One notice for a whole series, not one per class.
		if err := enqueueSessionNotice(r.Context(), tx, ids[0], worker.NotifySessionScheduled, occurrences[0].Start, len(ids)); err != nil {
			return err
		}
		var qErr error
		raw, qErr = queryJSON(r.Context(), tx, `SELECT `+sessionColumns+` FROM class_sessions cs WHERE cs.id = ANY($1::uuid[]) ORDER BY cs.scheduled_start`, ids)
		return qErr
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	h.record(r.Context(), r, "institution.sessions_scheduled", req.BatchID)
	model.SendJSON(w, http.StatusCreated, map[string]any{"sessions": raw})
}

func checkConflict(ctx context.Context, tx pgx.Tx, org, batch, allocation string, start, end time.Time, exclude *string) error {
	var conflict bool
	err := tx.QueryRow(ctx, `SELECT connect_auth.session_conflict($1::UUID, $2::UUID, $3::UUID, $4, $5, $6::UUID)`, org, batch, allocation, start, end, exclude).Scan(&conflict)
	if err != nil {
		return err
	}
	if conflict {
		return &userError{status: http.StatusConflict, code: "SCHEDULE_CONFLICT", msg: "This batch or teacher already has a class at " + start.UTC().Format(time.RFC3339) + "."}
	}
	return nil
}

func (h *Handler) rescheduleSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title string    `json:"title"`
		Start time.Time `json:"start"`
		End   time.Time `json:"end"`
	}
	if err := decode(r, &req); err != nil {
		sendError(w, r, err)
		return
	}
	if !req.End.After(req.Start) || !req.Start.After(time.Now()) {
		sendError(w, r, invalid("A class must start in the future and end after it starts."))
		return
	}
	id, org := chi.URLParam(r, "id"), chi.URLParam(r, "org")
	var raw json.RawMessage
	err := h.inOrg(r, func(tx pgx.Tx, _ *database.AuthContext) error {
		var batch, allocation, status, title string
		err := tx.QueryRow(r.Context(), `SELECT batch_id::text, faculty_allocation_id::text, status, title FROM class_sessions WHERE id = $1 AND organization_id = $2 FOR UPDATE`, id, org).Scan(&batch, &allocation, &status, &title)
		if err != nil {
			return err
		}
		if status != "scheduled" {
			return invalid("Only a class that has not started can be changed.")
		}
		if err := checkConflict(r.Context(), tx, org, batch, allocation, req.Start, req.End, &id); err != nil {
			return err
		}
		if strings.TrimSpace(req.Title) != "" {
			title = req.Title
		}
		tag, err := tx.Exec(r.Context(), `UPDATE class_sessions SET title = $1, scheduled_start = $2, scheduled_end = $3, updated_at = clock_timestamp() WHERE id = $4`, title, req.Start, req.End, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errNotPermitted
		}
		if _, err := tx.Exec(r.Context(), `SELECT connect_auth.sync_session_room($1::UUID)`, id); err != nil {
			return err
		}
		if err := enqueueSessionNotice(r.Context(), tx, id, worker.NotifySessionRescheduled, req.Start, 0); err != nil {
			return err
		}
		if err := enqueueReminder(r.Context(), tx, id, req.Start); err != nil {
			return err
		}
		var qErr error
		raw, qErr = insertJSON(r.Context(), tx, `SELECT `+sessionColumns+` FROM class_sessions cs WHERE cs.id = $1`, id)
		return qErr
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	h.record(r.Context(), r, "institution.session_rescheduled", id)
	model.SendJSON(w, http.StatusOK, map[string]any{"session": raw})
}

// cancelSession cancels one class, or with ?scope=following it and the rest of its series.
func (h *Handler) cancelSession(w http.ResponseWriter, r *http.Request) {
	id, org := chi.URLParam(r, "id"), chi.URLParam(r, "org")
	following := r.URL.Query().Get("scope") == "following"
	var cancelled int
	err := h.inOrg(r, func(tx pgx.Tx, _ *database.AuthContext) error {
		query := `SELECT id::text FROM class_sessions WHERE id = $1 AND organization_id = $2 AND status = 'scheduled'`
		if following {
			query = `SELECT cs.id::text FROM class_sessions cs JOIN class_sessions pick ON pick.id = $1
				WHERE cs.organization_id = $2 AND cs.status = 'scheduled' AND cs.scheduled_start >= pick.scheduled_start
				  AND (cs.id = pick.id OR cs.series_id = pick.series_id)`
		}
		rows, err := tx.Query(r.Context(), query, id, org)
		if err != nil {
			return err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		if len(ids) == 0 {
			return pgx.ErrNoRows
		}
		for _, sessionID := range ids {
			tag, err := tx.Exec(r.Context(), `UPDATE class_sessions SET status = 'cancelled', updated_at = clock_timestamp() WHERE id = $1`, sessionID)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return errNotPermitted
			}
			if _, err := tx.Exec(r.Context(), `SELECT connect_auth.sync_session_room($1::UUID)`, sessionID); err != nil {
				return err
			}
			if err := enqueueSessionNotice(r.Context(), tx, sessionID, worker.NotifySessionCancelled, time.Now(), 0); err != nil {
				return err
			}
		}
		cancelled = len(ids)
		return nil
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	h.record(r.Context(), r, "institution.session_cancelled", id)
	model.SendJSON(w, http.StatusOK, map[string]any{"cancelled": cancelled})
}

// --- Attendance ---

const attendanceQuery = `
	SELECT ar.student_user_id AS "studentUserId", ar.total_connected_seconds AS "connectedSeconds", ar.attendance_status AS status,
	       ar.is_overruled AS "isOverruled", ar.original_status AS "originalStatus", ar.overrule_reason AS "overruleReason", ar.policy_version AS "policyVersion",
	       ar.first_joined_at AS "firstJoinedAt", ar.last_left_at AS "lastLeftAt", ar.joined_late AS "joinedLate", ar.left_early AS "leftEarly",
	       ar.duration_ratio AS "durationRatio", ar.engagement_ratio AS "engagementRatio", ar.browser_ratio AS "browserRatio", ar.score, ar.calculation
	FROM attendance_records ar
	WHERE ar.organization_id = $1 AND ar.class_session_id = $2
	ORDER BY ar.student_user_id`

func (h *Handler) sessionAttendance(w http.ResponseWriter, r *http.Request) {
	h.list(w, r, "records", attendanceQuery, chi.URLParam(r, "org"), chi.URLParam(r, "id"))
}

// csvCell stops a spreadsheet treating user-controlled text as a formula.
func csvCell(value string) string {
	if value != "" && strings.ContainsRune("=+-@\t\r", rune(value[0])) {
		return "'" + value
	}
	return value
}

func (h *Handler) sessionAttendanceCSV(w http.ResponseWriter, r *http.Request) {
	type row struct {
		student, status                      string
		seconds                              int
		overruled                            bool
		reason, version                      *string
		late, early                          bool
		duration, engagement, browser, score *string
	}
	var rows []row
	err := h.inOrg(r, func(tx pgx.Tx, _ *database.AuthContext) error {
		result, err := tx.Query(r.Context(), `
			SELECT student_user_id::text, attendance_status, total_connected_seconds, is_overruled, overrule_reason, policy_version::text,
			       joined_late, left_early, duration_ratio::text, engagement_ratio::text, browser_ratio::text, score::text
			FROM attendance_records WHERE organization_id = $1 AND class_session_id = $2 ORDER BY student_user_id
		`, chi.URLParam(r, "org"), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		defer result.Close()
		for result.Next() {
			var item row
			if err := result.Scan(&item.student, &item.status, &item.seconds, &item.overruled, &item.reason, &item.version,
				&item.late, &item.early, &item.duration, &item.engagement, &item.browser, &item.score); err != nil {
				return err
			}
			rows = append(rows, item)
		}
		return result.Err()
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="attendance.csv"`)
	out := csv.NewWriter(w)
	_ = out.Write([]string{"student_user_id", "status", "connected_seconds", "overruled", "overrule_reason", "policy_version", "joined_late", "left_early", "duration_ratio", "engagement_ratio", "browser_ratio", "score"})
	deref := func(s *string) string {
		if s == nil {
			return ""
		}
		return *s
	}
	for _, item := range rows {
		_ = out.Write([]string{item.student, item.status, strconv.Itoa(item.seconds), strconv.FormatBool(item.overruled), csvCell(deref(item.reason)), deref(item.version),
			strconv.FormatBool(item.late), strconv.FormatBool(item.early), deref(item.duration), deref(item.engagement), deref(item.browser), deref(item.score)})
	}
	out.Flush()
}

func (h *Handler) overruleAttendance(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	if err := decode(r, &req); err != nil {
		sendError(w, r, err)
		return
	}
	if req.Status != "present" && req.Status != "late" && req.Status != "partial" && req.Status != "absent" {
		sendError(w, r, invalid("A valid attendance status is required."))
		return
	}
	if len(strings.TrimSpace(req.Reason)) < 10 {
		sendError(w, r, invalid("A reason of at least 10 characters is required."))
		return
	}
	org, session, student := chi.URLParam(r, "org"), chi.URLParam(r, "id"), chi.URLParam(r, "student")
	err := h.inOrg(r, func(tx pgx.Tx, auth *database.AuthContext) error {
		var recordID, prior string
		var seconds int
		err := tx.QueryRow(r.Context(), `
			SELECT id::text, attendance_status, total_connected_seconds FROM attendance_records
			WHERE organization_id = $1 AND class_session_id = $2 AND student_user_id = $3 FOR UPDATE
		`, org, session, student).Scan(&recordID, &prior, &seconds)
		if err != nil {
			return err
		}
		tag, err := tx.Exec(r.Context(), `
			UPDATE attendance_records
			SET attendance_status = $1, is_overruled = true, original_status = COALESCE(original_status, $2),
			    original_connected_seconds = COALESCE(original_connected_seconds, $3), overruled_by = $4, overrule_reason = $5,
			    overruled_at = clock_timestamp(), updated_at = clock_timestamp()
			WHERE id = $6
		`, req.Status, prior, seconds, auth.UserID, req.Reason, recordID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errNotPermitted
		}
		_, err = tx.Exec(r.Context(), `
			INSERT INTO attendance_overrule_audit_log (organization_id, attendance_record_id, class_session_id, student_user_id, prior_status, new_status, prior_connected_seconds, new_connected_seconds, overruled_by, overrule_reason)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)
		`, org, recordID, session, student, prior, req.Status, seconds, auth.UserID, req.Reason)
		if err != nil {
			return err
		}
		key := fmt.Sprintf("attendance:%s:%d", recordID, time.Now().UnixNano())
		data, err := json.Marshal(worker.NotifyUserData{
			UserID: student, OrganizationID: org, Kind: "attendance_corrected",
			Title: "Your attendance was corrected", Body: "Your attendance for a class is now marked " + req.Status + ".",
			Link: "/institution", DedupeKey: key,
		})
		if err != nil {
			return err
		}
		return worker.EnqueueJobWriteOnly(r.Context(), tx, worker.QueueDefault, "notify-user-"+key, worker.JobPayload{Type: worker.TypeNotifyUser, Data: data, CreatedAt: time.Now().UTC()})
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	h.record(r.Context(), r, "attendance.overruled", student)
	model.SendJSON(w, http.StatusOK, map[string]any{"success": true})
}

// attendanceSummary aggregates what the caller may read: a student sees only their own records.
func (h *Handler) attendanceSummary(w http.ResponseWriter, r *http.Request) {
	batch := r.URL.Query().Get("batchId")
	if _, err := uuid.Parse(batch); err != nil {
		sendError(w, r, invalid("A batchId is required."))
		return
	}
	h.list(w, r, "students", `
		SELECT student_user_id AS "studentUserId", count(*) AS sessions,
		       count(*) FILTER (WHERE attendance_status = 'present') AS present,
		       count(*) FILTER (WHERE attendance_status = 'late') AS late,
		       count(*) FILTER (WHERE attendance_status = 'partial') AS partial,
		       count(*) FILTER (WHERE attendance_status = 'absent') AS absent,
		       sum(total_connected_seconds) AS "connectedSeconds",
		       count(*) FILTER (WHERE joined_late) AS "joinedLate", count(*) FILTER (WHERE left_early) AS "leftEarly",
		       count(*) FILTER (WHERE is_overruled) AS corrected,
		       round(avg(duration_ratio), 3) AS "durationRatio", round(avg(engagement_ratio), 3) AS "engagementRatio",
		       round(avg(browser_ratio), 3) AS "browserRatio", `+engagementScoreSQL+` AS "engagementScore"
		FROM attendance_records ar WHERE organization_id = $1 AND batch_id = $2
		GROUP BY student_user_id ORDER BY student_user_id`, chi.URLParam(r, "org"), batch)
}

// attendanceByClass reports each class in a batch. RLS decides which records count for this caller.
func (h *Handler) attendanceByClass(w http.ResponseWriter, r *http.Request) {
	batch := r.URL.Query().Get("batchId")
	if _, err := uuid.Parse(batch); err != nil {
		sendError(w, r, invalid("A batchId is required."))
		return
	}
	h.list(w, r, "classes", `
		SELECT cs.id, cs.title, cs.scheduled_start AS start, cs.status, cs.attendance_finalized AS "attendanceFinalized",
		       count(ar.id) FILTER (WHERE ar.attendance_status = 'present') AS present,
		       count(ar.id) FILTER (WHERE ar.attendance_status = 'late') AS late,
		       count(ar.id) FILTER (WHERE ar.attendance_status = 'partial') AS partial,
		       count(ar.id) FILTER (WHERE ar.attendance_status = 'absent') AS absent,
		       round(avg(ar.duration_ratio), 3) AS "durationRatio", round(avg(ar.engagement_ratio), 3) AS "engagementRatio",
		       round(avg(ar.browser_ratio), 3) AS "browserRatio", `+engagementScoreSQL+` AS "engagementScore"
		FROM class_sessions cs
		LEFT JOIN attendance_records ar ON ar.organization_id = cs.organization_id AND ar.class_session_id = cs.id
		WHERE cs.organization_id = $1 AND cs.batch_id = $2
		GROUP BY cs.id ORDER BY cs.scheduled_start DESC LIMIT 200`, chi.URLParam(r, "org"), batch)
}

// sessionEngagement reports what each student did in a class and their engagement score.
// The database limits it to the class's teachers and institution overseers.
func (h *Handler) sessionEngagement(w http.ResponseWriter, r *http.Request) {
	if _, err := uuid.Parse(chi.URLParam(r, "id")); err != nil {
		sendError(w, r, invalid("A valid class is required."))
		return
	}
	h.list(w, r, "people", `
		SELECT user_id AS "userId", display_name AS "displayName", present, connected_seconds AS "connectedSeconds",
		       messages, reactions, hands, polls_answered AS "pollAnswers", polls_total AS "pollsTotal", quiz_points AS "quizPoints",
		       doubts, coding_submitted AS "codingSubmitted", coding_total AS "codingTotal",
		       visible_seconds AS "visibleSeconds", hidden_seconds AS "hiddenSeconds", reported,
		       polls_ratio AS "pollsRatio", coding_ratio AS "codingRatio", interaction_ratio AS "interactionRatio",
		       focus_ratio AS "focusRatio", score
		FROM connect_auth.session_engagement_scores($1::uuid)`, chi.URLParam(r, "id"))
}

// engagementScoreSQL reads the engagement score the attendance worker stored with each record.
const engagementScoreSQL = `round(avg(NULLIF(ar.calculation->'engagement'->>'score', '')::numeric), 1)`

// adminEngagement lists every student's engagement and attendance over the last 30 days, lowest
// engagement first. Only institution administrators, auditors and platform admins may see it;
// row level security still limits the rows to this organization.
func (h *Handler) adminEngagement(w http.ResponseWriter, r *http.Request) {
	org := chi.URLParam(r, "org")
	var raw json.RawMessage
	err := h.inOrg(r, func(tx pgx.Tx, auth *database.AuthContext) error {
		overseer := auth.IsSuperAdmin || (auth.Role != nil && (*auth.Role == "institution_admin" || *auth.Role == "institution_auditor"))
		if !overseer {
			return errNotPermitted
		}
		var qErr error
		raw, qErr = queryJSON(r.Context(), tx, `
			SELECT ar.student_user_id AS "studentUserId", u.display_name AS "displayName", count(*) AS sessions,
			       count(*) FILTER (WHERE ar.attendance_status IN ('present', 'late')) AS attended,
			       count(*) FILTER (WHERE ar.attendance_status = 'absent') AS absent,
			       `+engagementScoreSQL+` AS "engagementScore",
			       round(avg(ar.score), 3) AS "attendanceScore",
			       max(cs.scheduled_start) AS "lastClass"
			FROM attendance_records ar
			JOIN class_sessions cs ON cs.id = ar.class_session_id AND cs.organization_id = ar.organization_id
			JOIN users u ON u.id = ar.student_user_id
			WHERE ar.organization_id = $1 AND cs.scheduled_start > now() - interval '30 days'
			GROUP BY ar.student_user_id, u.display_name
			ORDER BY "engagementScore" ASC NULLS FIRST, u.display_name`, org)
		return qErr
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"students": raw})
}

func (h *Handler) listPolicies(w http.ResponseWriter, r *http.Request) {
	h.list(w, r, "policies", `SELECT version, min_present_ratio AS "minPresentRatio", min_partial_ratio AS "minPartialRatio", late_grace_seconds AS "lateGraceSeconds", early_leave_grace_seconds AS "earlyLeaveGraceSeconds", duration_weight AS "durationWeight", engagement_weight AS "engagementWeight", browser_weight AS "browserWeight", engagement_target AS "engagementTarget", created_at AS "createdAt" FROM attendance_policies WHERE organization_id = $1 ORDER BY version DESC`, chi.URLParam(r, "org"))
}

// createPolicy adds a new version. Past records keep the version they were evaluated with.
func (h *Handler) createPolicy(w http.ResponseWriter, r *http.Request) {
	var req struct {
		MinPresentRatio  float64 `json:"minPresentRatio"`
		MinPartialRatio  float64 `json:"minPartialRatio"`
		LateGraceSeconds *int    `json:"lateGraceSeconds"`
		// Each of these is optional, and left out means duration alone decides, as before.
		EarlyLeaveGraceSeconds *int     `json:"earlyLeaveGraceSeconds"`
		DurationWeight         *float64 `json:"durationWeight"`
		EngagementWeight       *float64 `json:"engagementWeight"`
		BrowserWeight          *float64 `json:"browserWeight"`
		EngagementTarget       *int     `json:"engagementTarget"`
	}
	if err := decode(r, &req); err != nil {
		sendError(w, r, err)
		return
	}
	weight := func(value *float64, fallback float64) float64 {
		if value == nil {
			return fallback
		}
		return *value
	}
	durationWeight := weight(req.DurationWeight, 1)
	engagementWeight, browserWeight := weight(req.EngagementWeight, 0), weight(req.BrowserWeight, 0)
	if durationWeight < 0 || engagementWeight < 0 || browserWeight < 0 || math.Abs(durationWeight+engagementWeight+browserWeight-1) > 0.0001 {
		sendError(w, r, invalid("Weights cannot be negative and must add up to 100%."))
		return
	}
	engagementTarget := 3
	if req.EngagementTarget != nil {
		engagementTarget = *req.EngagementTarget
	}
	if engagementTarget < 1 || engagementTarget > 1000 {
		sendError(w, r, invalid("The engagement target must be between 1 and 1000 actions."))
		return
	}
	if (req.LateGraceSeconds != nil && *req.LateGraceSeconds < 0) || (req.EarlyLeaveGraceSeconds != nil && *req.EarlyLeaveGraceSeconds < 0) {
		sendError(w, r, invalid("Grace periods cannot be negative."))
		return
	}
	if req.MinPartialRatio < 0 || req.MinPartialRatio > req.MinPresentRatio || req.MinPresentRatio > 1 {
		sendError(w, r, invalid("Ratios must satisfy 0 ≤ partial ≤ present ≤ 1."))
		return
	}
	org := chi.URLParam(r, "org")
	var raw json.RawMessage
	err := h.inOrg(r, func(tx pgx.Tx, auth *database.AuthContext) error {
		if auth.Role == nil || *auth.Role != "institution_admin" {
			return errNotPermitted
		}
		var qErr error
		raw, qErr = insertJSON(r.Context(), tx, `
			INSERT INTO attendance_policies (organization_id, version, min_present_ratio, min_partial_ratio, late_grace_seconds, created_by,
			       early_leave_grace_seconds, duration_weight, engagement_weight, browser_weight, engagement_target)
			SELECT $1::uuid, COALESCE(max(version), 0) + 1, $2::numeric, $3::numeric, $4::int, $5::uuid,
			       $6::int, round($7::numeric, 3), round($8::numeric, 3), 1 - round($7::numeric, 3) - round($8::numeric, 3), $9::int FROM attendance_policies WHERE organization_id = $1::uuid
			RETURNING version, min_present_ratio AS "minPresentRatio", min_partial_ratio AS "minPartialRatio", late_grace_seconds AS "lateGraceSeconds", early_leave_grace_seconds AS "earlyLeaveGraceSeconds", duration_weight AS "durationWeight", engagement_weight AS "engagementWeight", browser_weight AS "browserWeight", engagement_target AS "engagementTarget"
		`, org, req.MinPresentRatio, req.MinPartialRatio, req.LateGraceSeconds, auth.UserID, req.EarlyLeaveGraceSeconds, durationWeight, engagementWeight, engagementTarget)
		return qErr
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	h.record(r.Context(), r, "attendance.policy_created", org)
	model.SendJSON(w, http.StatusCreated, map[string]any{"policy": raw})
}
