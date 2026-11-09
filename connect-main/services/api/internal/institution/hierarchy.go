package institution

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// Schools sit above departments, and degree programs between a department and its courses:
// University -> School -> Department -> Degree program -> Course -> Batch.

var programLevels = map[string]bool{"certificate": true, "diploma": true, "undergraduate": true, "postgraduate": true, "doctoral": true}

func (h *Handler) listSchools(w http.ResponseWriter, r *http.Request) {
	h.list(w, r, "schools", `SELECT id, code, name, status FROM schools WHERE organization_id = $1 ORDER BY code`, chi.URLParam(r, "org"))
}

func (h *Handler) createSchool(w http.ResponseWriter, r *http.Request) {
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
	h.insert(w, r, "school", `INSERT INTO schools (organization_id, code, name) VALUES ($1, $2, $3) RETURNING id, code, name, status`, chi.URLParam(r, "org"), req.Code, req.Name)
}

func (h *Handler) listPrograms(w http.ResponseWriter, r *http.Request) {
	h.list(w, r, "programs", `SELECT id, department_id AS "departmentId", code, name, level, duration_years AS "durationYears", status FROM degree_programs WHERE organization_id = $1 ORDER BY code`, chi.URLParam(r, "org"))
}

func (h *Handler) createProgram(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DepartmentID  string `json:"departmentId"`
		Code          string `json:"code"`
		Name          string `json:"name"`
		Level         string `json:"level"`
		DurationYears int    `json:"durationYears"`
	}
	if err := decode(r, &req); err != nil {
		sendError(w, r, err)
		return
	}
	if req.Level == "" {
		req.Level = "undergraduate"
	}
	if req.DurationYears == 0 {
		req.DurationYears = 4
	}
	if !required(req.DepartmentID, req.Code, req.Name) || !programLevels[req.Level] || req.DurationYears < 1 || req.DurationYears > 7 {
		sendError(w, r, invalid("A department, code, name, a valid level and 1 to 7 years are required."))
		return
	}
	h.insert(w, r, "program", `INSERT INTO degree_programs (organization_id, department_id, code, name, level, duration_years) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, department_id AS "departmentId", code, name, level, duration_years AS "durationYears", status`,
		chi.URLParam(r, "org"), req.DepartmentID, req.Code, req.Name, req.Level, req.DurationYears)
}
