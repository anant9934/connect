package worker

import (
	"log/slog"
	"sync/atomic"
	"time"
)

// Metrics records operational runtime statistics for the background worker.
type Metrics struct {
	JobsClaimed       atomic.Uint64
	JobsCompleted     atomic.Uint64
	JobsFailed        atomic.Uint64
	JobsRetried       atomic.Uint64
	JobsDeadLettered  atomic.Uint64
	LeaseReclamations atomic.Uint64
	DBErrors          atomic.Uint64
	ActiveInFlight    atomic.Int64
	startTime         time.Time
}

// NewMetrics initializes a fresh metrics collector.
func NewMetrics() *Metrics {
	return &Metrics{
		startTime: time.Now().UTC(),
	}
}

// MetricsSnapshot represents a read-only point-in-time metrics snapshot.
type MetricsSnapshot struct {
	UptimeSeconds     int64  `json:"uptimeSeconds"`
	JobsClaimed       uint64 `json:"jobsClaimed"`
	JobsCompleted     uint64 `json:"jobsCompleted"`
	JobsFailed        uint64 `json:"jobsFailed"`
	JobsRetried       uint64 `json:"jobsRetried"`
	JobsDeadLettered  uint64 `json:"jobsDeadLettered"`
	LeaseReclamations uint64 `json:"leaseReclamations"`
	DBErrors          uint64 `json:"dbErrors"`
	ActiveInFlight    int64  `json:"activeInFlight"`
}

// Snapshot returns a copy of current metrics values.
func (m *Metrics) Snapshot() MetricsSnapshot {
	return MetricsSnapshot{
		UptimeSeconds:     int64(time.Since(m.startTime).Seconds()),
		JobsClaimed:       m.JobsClaimed.Load(),
		JobsCompleted:     m.JobsCompleted.Load(),
		JobsFailed:        m.JobsFailed.Load(),
		JobsRetried:       m.JobsRetried.Load(),
		JobsDeadLettered:  m.JobsDeadLettered.Load(),
		LeaseReclamations: m.LeaseReclamations.Load(),
		DBErrors:          m.DBErrors.Load(),
		ActiveInFlight:    m.ActiveInFlight.Load(),
	}
}

// LogSummary emits a structured slog summary of worker metrics.
func (m *Metrics) LogSummary(logger *slog.Logger) {
	snap := m.Snapshot()
	logger.Info("worker_metrics_summary",
		slog.Int64("uptime_sec", snap.UptimeSeconds),
		slog.Uint64("claimed", snap.JobsClaimed),
		slog.Uint64("completed", snap.JobsCompleted),
		slog.Uint64("failed", snap.JobsFailed),
		slog.Uint64("retried", snap.JobsRetried),
		slog.Uint64("dead_lettered", snap.JobsDeadLettered),
		slog.Uint64("lease_reclamations", snap.LeaseReclamations),
		slog.Uint64("db_errors", snap.DBErrors),
		slog.Int64("in_flight", snap.ActiveInFlight),
	)
}
