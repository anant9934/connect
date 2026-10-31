package attendance

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

// GenerateIdempotencyKey computes a deterministic SHA-256 hash from server-issued identifiers.
func GenerateIdempotencyKey(roomID, clientConnectionID string, sequenceNumber int64) string {
	payload := fmt.Sprintf("%s|%s|%d", roomID, clientConnectionID, sequenceNumber)
	h := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(h[:])
}

// ReconcileIntervalUnion computes the exact Lebesgue measure (non-overlapping total seconds)
// of all connection intervals, correctly clipping to [sessionStart, sessionEnd].
// It is mathematically idempotent across multiple devices, duplicate segments, and reconnects.
func ReconcileIntervalUnion(rawIntervals []Interval, sessionStart, sessionEnd time.Time) int {
	if sessionEnd.Before(sessionStart) || len(rawIntervals) == 0 {
		return 0
	}

	// 1. Clip raw intervals to session boundaries and filter out zero or negative durations
	var clipped []Interval
	for _, iv := range rawIntervals {
		s := iv.Start
		e := iv.End

		if s.Before(sessionStart) {
			s = sessionStart
		}
		if e.After(sessionEnd) {
			e = sessionEnd
		}

		if e.After(s) {
			clipped = append(clipped, Interval{Start: s, End: e})
		}
	}

	if len(clipped) == 0 {
		return 0
	}

	// 2. Sort intervals chronologically by Start time
	sort.Slice(clipped, func(i, j int) bool {
		if clipped[i].Start.Equal(clipped[j].Start) {
			return clipped[i].End.Before(clipped[j].End)
		}
		return clipped[i].Start.Before(clipped[j].Start)
	})

	// 3. Merge overlapping and contiguous intervals
	var merged []Interval
	current := clipped[0]

	for i := 1; i < len(clipped); i++ {
		next := clipped[i]
		if !next.Start.After(current.End) {
			// Overlap or contiguous: extend current interval End
			if next.End.After(current.End) {
				current.End = next.End
			}
		} else {
			// Disjoint gap: push current and start new interval
			merged = append(merged, current)
			current = next
		}
	}
	merged = append(merged, current)

	// 4. Sum disjoint seconds
	totalSeconds := 0
	for _, m := range merged {
		totalSeconds += int(m.End.Sub(m.Start).Seconds())
	}

	return totalSeconds
}

// CalculateAttendanceStatus determines presence classification based on institutional thresholds.
func CalculateAttendanceStatus(connectedSeconds, sessionDurationSeconds int, minPresentRatio, minPartialRatio float64) string {
	if sessionDurationSeconds <= 0 || connectedSeconds <= 0 {
		return "absent"
	}
	ratio := float64(connectedSeconds) / float64(sessionDurationSeconds)
	if ratio >= minPresentRatio {
		return "present"
	}
	if ratio >= minPartialRatio {
		return "partial"
	}
	return "absent"
}

// ApplyManualOverrule applies a faculty/admin overrule, capturing prior state into an audit entry.
func ApplyManualOverrule(
	record *AttendanceRecord,
	newStatus string,
	newDuration *int,
	actorID string,
	reason string,
	at time.Time,
) (*OverruleAuditEntry, error) {
	if record == nil {
		return nil, ErrRecordNotFound
	}
	trimmedReason := strings.TrimSpace(reason)
	if len(trimmedReason) < 10 {
		return nil, ErrInvalidOverruleReason
	}
	validStatuses := map[string]bool{"present": true, "late": true, "partial": true, "absent": true}
	if !validStatuses[newStatus] {
		return nil, ErrInvalidStatus
	}

	priorStatus := record.AttendanceStatus
	priorDuration := record.TotalConnectedSeconds

	// Preserve original calculated value on first overrule
	if !record.IsOverruled {
		origStatus := priorStatus
		origDuration := priorDuration
		record.OriginalStatus = &origStatus
		record.OriginalConnectedSeconds = &origDuration
	}

	effectiveDuration := priorDuration
	if newDuration != nil && *newDuration >= 0 {
		effectiveDuration = *newDuration
	}

	record.AttendanceStatus = newStatus
	record.TotalConnectedSeconds = effectiveDuration
	record.IsOverruled = true
	record.OverruledBy = &actorID
	record.OverruleReason = &trimmedReason
	record.OverruledAt = &at
	record.UpdatedAt = at

	audit := &OverruleAuditEntry{
		ID:                    uuid.New().String(),
		OrganizationID:        record.OrganizationID,
		AttendanceRecordID:    record.ID,
		ClassSessionID:        record.ClassSessionID,
		StudentUserID:         record.StudentUserID,
		PriorStatus:           priorStatus,
		NewStatus:             newStatus,
		PriorConnectedSeconds: priorDuration,
		NewConnectedSeconds:   effectiveDuration,
		OverruledBy:           actorID,
		OverruleReason:        trimmedReason,
		CreatedAt:             at,
	}

	return audit, nil
}
