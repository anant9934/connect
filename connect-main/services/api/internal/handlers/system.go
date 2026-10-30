package handlers

import (
	"net/http"
	"time"

	"github.com/tathastu/connect/services/api/internal/model"
)

// SystemHandler provides minimal versioned operational diagnostics.
type SystemHandler struct {
	version string
}

// NewSystemHandler initializes the system handler with a build version tag.
func NewSystemHandler(version string) *SystemHandler {
	return &SystemHandler{version: version}
}

// Status handles GET /api/v1/system/status without leaking internal topology.
func (h *SystemHandler) Status(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		model.SendJSONError(w, r, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	model.SendJSON(w, http.StatusOK, model.SystemStatusResponse{
		Status:    "operational",
		Service:   "tathastu-connect-api",
		Version:   h.version,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}
