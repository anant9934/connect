package worker

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/tathastu/connect/services/api/internal/attendance"
)

func TestReconcileJobFor(t *testing.T) {
	now := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	key, payload, err := reconcileJobFor(dueSession{RoomID: "room-1", ClassSessionID: "class-9"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if key != "attendance-sweep-class-9" {
		t.Fatalf("key must be stable per class so sweeps never double-queue, got %q", key)
	}
	if payload.Type != TypeAttendanceReconcile {
		t.Fatalf("wrong job type %q", payload.Type)
	}
	var data AttendanceReconcileData
	if err := json.Unmarshal(payload.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.RoomID != "room-1" || data.ClassSessionID != "class-9" || !data.Before.Equal(now) {
		t.Fatalf("unexpected payload %+v", data)
	}
}

func TestCalculationWithEngagement(t *testing.T) {
	focus := 0.8
	raw, err := calculationWithEngagement(attendance.Calculation{DurationRatio: 0.9, Score: 0.9}, EngagementBreakdown{Score: 72, PollsAnswered: 2, PollsTotal: 3, FocusRatio: &focus})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got["durationRatio"] != 0.9 {
		t.Fatalf("attendance fields must be kept, got %v", got["durationRatio"])
	}
	e, ok := got["engagement"].(map[string]any)
	if !ok || e["score"] != float64(72) || e["pollsTotal"] != float64(3) || e["focusRatio"] != 0.8 {
		t.Fatalf("engagement not stored as expected: %v", got["engagement"])
	}
}
