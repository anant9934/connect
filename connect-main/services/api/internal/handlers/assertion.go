package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/tathastu/connect/services/api/internal/config"
	"github.com/tathastu/connect/services/api/internal/model"
)

// AssertionHandler validates federated collaboration assertion handoffs from AI Tathastu.
type AssertionHandler struct {
	cfg *config.Config
}

// NewAssertionHandler creates an AssertionHandler instance.
func NewAssertionHandler(cfg *config.Config) *AssertionHandler {
	return &AssertionHandler{cfg: cfg}
}

// ValidateAssertion handles POST /api/v1/collab/validate-assertion.
// Implements strict JSON decoding, unknown field rejection, and claim boundary checks.
func (h *AssertionHandler) ValidateAssertion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		model.SendJSONError(w, r, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	// Strictly decode JSON rejecting unknown fields (Anti-Mass-Assignment)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	var req model.TathastuAssertionDTO
	if err := dec.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			model.SendJSONError(w, r, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Request body exceeds allowed size")
			return
		}
		if strings.Contains(err.Error(), "unknown field") {
			model.SendJSONError(w, r, http.StatusBadRequest, "UNKNOWN_FIELD", "Request contains forbidden unknown fields")
			return
		}
		model.SendJSONError(w, r, http.StatusBadRequest, "MALFORMED_JSON", "Invalid JSON payload structure")
		return
	}

	// Ensure there is no trailing trailing data in the stream
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		model.SendJSONError(w, r, http.StatusBadRequest, "MALFORMED_JSON", "Request payload must contain a single JSON object")
		return
	}

	// Schema & length validation limits
	if strings.TrimSpace(req.Sub) == "" || len(req.Sub) > 128 {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_SUBJECT", "Missing or invalid assertion subject")
		return
	}
	if strings.TrimSpace(req.Jti) == "" || len(req.Jti) > 128 {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_NONCE", "Missing or invalid assertion unique token identifier (jti)")
		return
	}
	if len(req.RecommendedTopics) > 20 {
		model.SendJSONError(w, r, http.StatusBadRequest, "LIMIT_EXCEEDED", "Topics array exceeds maximum allowed limit (20)")
		return
	}

	// Federated Claims Validation
	if req.Iss != h.cfg.TathastuIssuer {
		model.SendJSONError(w, r, http.StatusUnauthorized, "INVALID_ISSUER", "Assertion issuer mismatch")
		return
	}
	if req.Aud != h.cfg.TathastuAudience {
		model.SendJSONError(w, r, http.StatusUnauthorized, "INVALID_AUDIENCE", "Assertion audience mismatch")
		return
	}

	now := time.Now().Unix()
	if req.Exp <= now {
		model.SendJSONError(w, r, http.StatusUnauthorized, "ASSERTION_EXPIRED", "Assertion token has expired")
		return
	}

	// Successful validation response
	model.SendJSON(w, http.StatusOK, map[string]any{
		"valid":   true,
		"subject": req.Sub,
		"purpose": req.Purpose,
	})
}
