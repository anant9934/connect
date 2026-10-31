package worker

import (
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
