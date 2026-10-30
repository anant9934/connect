package model

import (
	"encoding/json"
	"net/http"
	"time"
)

// HealthResponse represents minimal status for liveness/readiness probes.
type HealthResponse struct {
	Status string `json:"status"`
}

// SystemStatusResponse represents minimal versioned operational status.
type SystemStatusResponse struct {
	Status    string `json:"status"`
	Service   string `json:"service"`
	Version   string `json:"version"`
	Timestamp string `json:"timestamp"`
}

// ErrorDetail defines safe client-facing error diagnostics.
type ErrorDetail struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId"`
	Timestamp string `json:"timestamp"`
}

// ErrorResponse wraps safe errors without disclosing internal paths or database topology.
type ErrorResponse struct {
	Error ErrorDetail `json:"error"`
}

// TathastuAssertionDTO defines the expected structure of federated claims.
type TathastuAssertionDTO struct {
	Iss               string   `json:"iss"`
	Aud               string   `json:"aud"`
	Sub               string   `json:"sub"`
	Exp               int64    `json:"exp"`
	Nbf               int64    `json:"nbf"`
	Iat               int64    `json:"iat"`
	Jti               string   `json:"jti"`
	Purpose           string   `json:"purpose"`
	ContextRef        string   `json:"contextRef"`
	RecommendedTopics []string `json:"recommendedTopics,omitempty"`
}

// SendJSON encodes a payload as JSON with appropriate Content-Type header.
func SendJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(payload)
}

// SendJSONError writes a safe, structured JSON error response.
func SendJSONError(w http.ResponseWriter, r *http.Request, statusCode int, code, message string) {
	reqID := w.Header().Get("X-Request-ID")
	if reqID == "" {
		reqID = r.Header.Get("X-Request-ID")
	}
	if reqID == "" {
		reqID = "unknown"
	}

	resp := ErrorResponse{
		Error: ErrorDetail{
			Code:      code,
			Message:   message,
			RequestID: reqID,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		},
	}

	SendJSON(w, statusCode, resp)
}
