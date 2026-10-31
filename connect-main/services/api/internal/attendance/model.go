package attendance

import (
	"errors"
	"time"
)

var (
	ErrRecordNotFound        = errors.New("attendance record not found")
	ErrInvalidSequenceNumber = errors.New("sequence number must be strictly positive")
	ErrInvalidOverruleReason = errors.New("overrule reason must be at least 10 characters")
	ErrInvalidStatus         = errors.New("invalid attendance status")
	ErrUnauthorizedOverrule  = errors.New("unauthorized to overrule attendance record")
)

// ConnectionEventType defines standard lifecycle states for participant connections.
type ConnectionEventType string

const (
	EventJoin       ConnectionEventType = "JOIN"
	EventHeartbeat  ConnectionEventType = "HEARTBEAT"
	EventLeave      ConnectionEventType = "LEAVE"
	EventDisconnect ConnectionEventType = "DISCONNECT"
	EventKick       ConnectionEventType = "KICK"
)

// ConnectionEvent represents an append-only raw connection telemetry entry.
type ConnectionEvent struct {
	ID                 string              `json:"id"`
	OrganizationID     string              `json:"organizationId"`
	ClassSessionID     string              `json:"classSessionId"`
	RoomID             string              `json:"roomId"`
	UserID             *string             `json:"userId,omitempty"`
	Identity           string              `json:"identity"`
	IsGuest            bool                `json:"isGuest"`
	ClientConnectionID string              `json:"clientConnectionId"`
	SequenceNumber     int64               `json:"sequenceNumber"`
	EventType          ConnectionEventType `json:"eventType"`
	ClientTimestamp    time.Time           `json:"clientTimestamp"`
	ServerReceivedAt   time.Time           `json:"serverReceivedAt"`
	IdempotencyKey     string              `json:"idempotencyKey"`
	IPHash             string              `json:"ipHash"`
	UserAgentSummary   string              `json:"userAgentSummary"`
}

// AttendanceRecord represents a finalized academic attendance entry for a student in a class session.
type AttendanceRecord struct {
	ID                       string     `json:"id"`
	OrganizationID           string     `json:"organizationId"`
	BatchID                  string     `json:"batchId"`
	ClassSessionID           string     `json:"classSessionId"`
	StudentUserID            string     `json:"studentUserId"`
	TotalConnectedSeconds    int        `json:"totalConnectedSeconds"`
	AttendanceStatus         string     `json:"attendanceStatus"` // 'present', 'late', 'partial', 'absent'
	IsOverruled              bool       `json:"isOverruled"`
	OriginalStatus           *string    `json:"originalStatus,omitempty"`
	OriginalConnectedSeconds *int       `json:"originalConnectedSeconds,omitempty"`
	OverruledBy              *string    `json:"overruledBy,omitempty"`
	OverruleReason           *string    `json:"overruleReason,omitempty"`
	OverruledAt              *time.Time `json:"overruledAt,omitempty"`
	EvaluatedAt              time.Time  `json:"evaluatedAt"`
	UpdatedAt                time.Time  `json:"updatedAt"`
}

// OverruleAuditEntry records an immutable historical entry whenever an attendance record is manually adjusted.
type OverruleAuditEntry struct {
	ID                    string    `json:"id"`
	OrganizationID        string    `json:"organizationId"`
	AttendanceRecordID    string    `json:"attendanceRecordId"`
	ClassSessionID        string    `json:"classSessionId"`
	StudentUserID         string    `json:"studentUserId"`
	PriorStatus           string    `json:"priorStatus"`
	NewStatus             string    `json:"newStatus"`
	PriorConnectedSeconds int       `json:"priorConnectedSeconds"`
	NewConnectedSeconds   int       `json:"newConnectedSeconds"`
	OverruledBy           string    `json:"overruledBy"`
	OverruleReason        string    `json:"overruleReason"`
	CreatedAt             time.Time `json:"createdAt"`
}

// Interval represents a bounded continuous time span.
type Interval struct {
	Start time.Time
	End   time.Time
}
