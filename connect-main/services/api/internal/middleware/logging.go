package middleware

import (
	"bufio"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"time"
)

type responseRecorder struct {
	http.ResponseWriter
	statusCode int
	bytesRead  int
}

func (rec *responseRecorder) WriteHeader(code int) {
	rec.statusCode = code
	rec.ResponseWriter.WriteHeader(code)
}

func (rec *responseRecorder) Write(b []byte) (int, error) {
	rec.bytesRead += len(b)
	return rec.ResponseWriter.Write(b)
}

// Hijack implements http.Hijacker to allow WebSocket upgrades.
func (rec *responseRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := rec.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, errors.New("http.Hijacker not supported by underlying ResponseWriter")
}

// Flush implements http.Flusher to support streaming responses.
func (rec *responseRecorder) Flush() {
	if fl, ok := rec.ResponseWriter.(http.Flusher); ok {
		fl.Flush()
	}
}

// StructuredLogging logs incoming HTTP requests with latency, status, and correlation ID using slog.
func StructuredLogging(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &responseRecorder{
				ResponseWriter: w,
				statusCode:     http.StatusOK,
			}

			next.ServeHTTP(rec, r)

			duration := time.Since(start)
			reqID := GetRequestID(r.Context())

			// Log request with strict redaction of sensitive credentials
			logger.Info("http_request",
				slog.String("request_id", reqID),
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", rec.statusCode),
				slog.Duration("duration_ms", duration),
				slog.Int("bytes", rec.bytesRead),
			)
		})
	}
}
