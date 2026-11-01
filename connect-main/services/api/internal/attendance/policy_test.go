package attendance

import (
	"testing"
	"time"
)

func TestEvaluateEnrollment(t *testing.T) {
	start := time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	grace := 300
	policy := Policy{Version: 3, MinPresentRatio: 0.75, MinPartialRatio: 0.40, LateGraceSeconds: &grace}

	intervals := map[string][]Interval{
		// Reconnect with overlapping sessions must not inflate the total.
		"reconnected": {
			{Start: start, End: start.Add(30 * time.Minute)},
			{Start: start.Add(20 * time.Minute), End: end},
		},
		"late":    {{Start: start.Add(10 * time.Minute), End: end}},
		"partial": {{Start: start, End: start.Add(30 * time.Minute)}},
		"brief":   {{Start: start, End: start.Add(5 * time.Minute)}},
	}
	want := map[string]struct {
		seconds int
		status  string
	}{
		"reconnected": {3600, "present"},
		"late":        {3000, "late"},
		"partial":     {1800, "partial"},
		"brief":       {300, "absent"},
		"never":       {0, "absent"},
	}

	enrolled := []string{"reconnected", "late", "partial", "brief", "never"}
	results := EvaluateEnrollment(enrolled, intervals, policy, start, end)
	if len(results) != len(enrolled) {
		t.Fatalf("expected %d results, got %d", len(enrolled), len(results))
	}
	for _, r := range results {
		w := want[r.StudentUserID]
		if r.ConnectedSeconds != w.seconds || r.Status != w.status {
			t.Errorf("%s: got %d/%s, want %d/%s", r.StudentUserID, r.ConnectedSeconds, r.Status, w.seconds, w.status)
		}
	}
}

func TestEvaluateStudent_LateMarkingDisabledWithoutGrace(t *testing.T) {
	start := time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	ivs := []Interval{{Start: start.Add(10 * time.Minute), End: end}}

	if _, status := EvaluateStudent(ivs, PlatformDefaultPolicy, start, end); status != "present" {
		t.Fatalf("expected present without a grace rule, got %s", status)
	}
}
