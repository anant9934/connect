package worker

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Job status constants
const (
	StatusPending    = "pending"
	StatusProcessing = "processing"
	StatusCompleted  = "completed"
	StatusFailed     = "failed"
	StatusDeadLetter = "dead_letter"
)

// Default job configuration values
const (
	DefaultQueue       = "default"
	DefaultMaxAttempts = 5
	DefaultLeaseTTL    = 30 * time.Second
)

// Standard queue names
const (
	QueueDefault            = "default"
	QueueAttendanceCritical = "attendance_critical"
	QueueWebhooks           = "webhooks"
	QueueMediaProcessing    = "media_processing"
)

// Standard job type constants
const (
	TypeSystemAuditPing     = "system.audit_ping"
	TypeRoomCleanup         = "room.cleanup"
	TypeAttendanceReconcile = "attendance.reconcile"
	TypeFilePurge           = "file.purge"
	TypeRoomHostSuccession  = "room.host_succession"
)

// Job represents a durable background task stored in the outbox.
type Job struct {
	ID             uuid.UUID
	Queue          string
	IdempotencyKey string
	Payload        []byte
	Status         string
	AttemptCount   int
	MaxAttempts    int
	ScheduledAt    time.Time
	LockedBy       *string
	LockedUntil    *time.Time
	FencingToken   int64
	LastError      *string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// JobPayload provides standard structured envelope for job type dispatching.
type JobPayload struct {
	Type      string          `json:"type"`
	Data      json.RawMessage `json:"data,omitempty"`
	CreatedAt time.Time       `json:"createdAt,omitempty"`
}
