package handlers

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/tathastu/connect/services/api/internal/model"
)

// Pinger defines an interface for dependencies providing health status.
type Pinger interface {
	Ping(ctx context.Context) error
}

// HealthHandler provides Kubernetes/load-balancer liveness and readiness probes.
type HealthHandler struct {
	db     Pinger
	redis  Pinger
	logger *slog.Logger
}

// NewHealthHandler creates a health probe handler.
func NewHealthHandler(db Pinger, redis Pinger, logger *slog.Logger) *HealthHandler {
	return &HealthHandler{
		db:     db,
		redis:  redis,
		logger: logger,
	}
}

// Live handles GET /health/live (Process aliveness only).
// Returns minimal {"status":"ok"}.
func (h *HealthHandler) Live(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		model.SendJSONError(w, r, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	model.SendJSON(w, http.StatusOK, model.HealthResponse{Status: "ok"})
}

// Ready handles GET /health/ready (Verifies capability to accept work).
// Never leaks internal connection strings, IPs, or error details to the caller.
func (h *HealthHandler) Ready(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		model.SendJSONError(w, r, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	// Check DB if wired
	if h.db != nil {
		if err := h.db.Ping(ctx); err != nil {
			h.logger.Error("readiness_check_failed", slog.String("dependency", "postgres"), slog.String("error", err.Error()))
			model.SendJSON(w, http.StatusServiceUnavailable, model.HealthResponse{Status: "degraded"})
			return
		}
	}

	// Check Redis if wired
	if h.redis != nil {
		if err := h.redis.Ping(ctx); err != nil {
			h.logger.Error("readiness_check_failed", slog.String("dependency", "redis"), slog.String("error", err.Error()))
			model.SendJSON(w, http.StatusServiceUnavailable, model.HealthResponse{Status: "degraded"})
			return
		}
	}

	model.SendJSON(w, http.StatusOK, model.HealthResponse{Status: "ok"})
}
