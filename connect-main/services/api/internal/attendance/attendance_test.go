package attendance_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tathastu/connect/services/api/internal/attendance"
)

func TestGenerateIdempotencyKey(t *testing.T) {
	roomID := uuid.New().String()
	connID := uuid.New().String()

	key1 := attendance.GenerateIdempotencyKey(roomID, connID, 1)
	key2 := attendance.GenerateIdempotencyKey(roomID, connID, 1)
	key3 := attendance.GenerateIdempotencyKey(roomID, connID, 2)

	if key1 == "" {
		t.Fatal("expected non-empty idempotency key")
	}
	if key1 != key2 {
		t.Error("expected identical key for same inputs (deterministic)")
	}
	if key1 == key3 {
		t.Error("expected different key for different sequence number")
	}
}

func TestReconcileIntervalUnion_MultiTabOverlapping(t *testing.T) {
	start := time.Date(2026, 10, 31, 10, 0, 0, 0, time.UTC)
	end := time.Date(2026, 10, 31, 11, 0, 0, 0, time.UTC) // 1 hour session = 3600s

	// Tab 1: 10:00 to 10:30 (1800s)
	// Tab 2: 10:15 to 10:45 (1800s)
	// Overlapping: 10:15 to 10:30 (15 min overlap)
	// Expected Union: 10:00 to 10:45 = 45 min = 2700 seconds (NOT 3600s!)
	intervals := []attendance.Interval{
		{
			Start: time.Date(2026, 10, 31, 10, 0, 0, 0, time.UTC),
			End:   time.Date(2026, 10, 31, 10, 30, 0, 0, time.UTC),
		},
		{
			Start: time.Date(2026, 10, 31, 10, 15, 0, 0, time.UTC),
			End:   time.Date(2026, 10, 31, 10, 45, 0, 0, time.UTC),
		},
	}

	netDuration := attendance.ReconcileIntervalUnion(intervals, start, end)
	if netDuration != 2700 {
		t.Errorf("expected 2700 net seconds, got %d", netDuration)
	}

	// Idempotency: Duplicate identical intervals must produce identical duration
	duplicated := append(intervals, intervals...)
	dupDuration := attendance.ReconcileIntervalUnion(duplicated, start, end)
	if dupDuration != 2700 {
		t.Errorf("expected idempotent duration 2700 for duplicated intervals, got %d", dupDuration)
	}
}

func TestReconcileIntervalUnion_BoundaryClipping(t *testing.T) {
	start := time.Date(2026, 10, 31, 10, 0, 0, 0, time.UTC)
	end := time.Date(2026, 10, 31, 11, 0, 0, 0, time.UTC)

	// Interval started at 09:45 (15 min early) and ended at 11:15 (15 min late)
	// Entire session attended: expected 3600s (clipped cleanly to 10:00 - 11:00)
	intervals := []attendance.Interval{
		{
			Start: time.Date(2026, 10, 31, 9, 45, 0, 0, time.UTC),
			End:   time.Date(2026, 10, 31, 11, 15, 0, 0, time.UTC),
		},
	}

	netDuration := attendance.ReconcileIntervalUnion(intervals, start, end)
	if netDuration != 3600 {
		t.Errorf("expected clipped duration 3600, got %d", netDuration)
	}
}

func TestCalculateAttendanceStatus(t *testing.T) {
	sessionLength := 3600 // 60 mins

	// >= 75% (2700s) -> present
	if status := attendance.CalculateAttendanceStatus(2700, sessionLength, 0.75, 0.40); status != "present" {
		t.Errorf("expected present for 75%%, got %s", status)
	}

	// 50% (1800s) -> partial
	if status := attendance.CalculateAttendanceStatus(1800, sessionLength, 0.75, 0.40); status != "partial" {
		t.Errorf("expected partial for 50%%, got %s", status)
	}

	// 20% (720s) -> absent
	if status := attendance.CalculateAttendanceStatus(720, sessionLength, 0.75, 0.40); status != "absent" {
		t.Errorf("expected absent for 20%%, got %s", status)
	}
}

func TestApplyManualOverrule_AuditTracking(t *testing.T) {
	rec := &attendance.AttendanceRecord{
		ID:                    uuid.New().String(),
		OrganizationID:        uuid.New().String(),
		ClassSessionID:        uuid.New().String(),
		StudentUserID:         uuid.New().String(),
		TotalConnectedSeconds: 1200,
		AttendanceStatus:      "absent",
		IsOverruled:           false,
	}

	actorID := uuid.New().String()
	now := time.Now()

	// 1. Short reason rejected
	_, err := attendance.ApplyManualOverrule(rec, "present", nil, actorID, "sick", now)
	if err != attendance.ErrInvalidOverruleReason {
		t.Errorf("expected ErrInvalidOverruleReason, got %v", err)
	}

	// 2. Valid overrule
	reason := "Student submitted medical certificate for network outage"
	audit, err := attendance.ApplyManualOverrule(rec, "present", nil, actorID, reason, now)
	if err != nil {
		t.Fatalf("unexpected error applying overrule: %v", err)
	}

	// Check record mutated
	if rec.AttendanceStatus != "present" || !rec.IsOverruled {
		t.Errorf("expected record status present and is_overruled true: %+v", rec)
	}
	if rec.OriginalStatus == nil || *rec.OriginalStatus != "absent" {
		t.Errorf("expected original status absent, got %v", rec.OriginalStatus)
	}
	if rec.OriginalConnectedSeconds == nil || *rec.OriginalConnectedSeconds != 1200 {
		t.Errorf("expected original duration 1200, got %v", rec.OriginalConnectedSeconds)
	}

	// Check audit entry
	if audit.PriorStatus != "absent" || audit.NewStatus != "present" || audit.OverruleReason != reason || audit.OverruledBy != actorID {
		t.Errorf("unexpected audit entry state: %+v", audit)
	}
}
