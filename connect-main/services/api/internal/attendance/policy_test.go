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
	results := EvaluateEnrollment(enrolled, intervals, nil, policy, start, end)
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

func TestEvaluate_RulesAndWeights(t *testing.T) {
	start := time.Date(2026, 1, 5, 10, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	at := func(m int) time.Time { return start.Add(time.Duration(m) * time.Minute) }
	span := func(from, to int) []Interval { return []Interval{{Start: at(from), End: at(to)}} }
	grace := func(s int) *int { return &s }
	duration := Policy{MinPresentRatio: 0.75, MinPartialRatio: 0.4, DurationWeight: 1, EngagementTarget: 3}

	cases := []struct {
		name      string
		intervals []Interval
		signals   Signals
		policy    func(Policy) Policy
		status    string
		score     float64
	}{
		{"full attendance", span(0, 60), Signals{}, nil, "present", 1},
		{"exactly the present threshold", span(0, 45), Signals{}, nil, "present", 0.75},
		{"just under present is partial", span(0, 44), Signals{}, nil, "partial", 44.0 / 60},
		{"under partial is absent", span(0, 20), Signals{}, nil, "absent", 20.0 / 60},
		{"never connected is absent despite activity", nil, Signals{Actions: 9, Reported: true, VisibleSeconds: 60}, func(p Policy) Policy {
			p.DurationWeight, p.EngagementWeight = 0, 1
			return p
		}, "absent", 1},
		{"late within grace is present", span(5, 60), Signals{}, func(p Policy) Policy { p.LateGraceSeconds = grace(300); return p }, "present", 55.0 / 60},
		{"late past grace is late", span(6, 60), Signals{}, func(p Policy) Policy { p.LateGraceSeconds = grace(300); return p }, "late", 54.0 / 60},
		{"leaving within grace is present", span(0, 55), Signals{}, func(p Policy) Policy { p.EarlyLeaveGraceSeconds = grace(300); return p }, "present", 55.0 / 60},
		{"leaving before grace lowers to partial", span(0, 54), Signals{}, func(p Policy) Policy { p.EarlyLeaveGraceSeconds = grace(300); return p }, "partial", 54.0 / 60},
		{"late and early is partial", span(6, 54), Signals{}, func(p Policy) Policy {
			p.LateGraceSeconds, p.EarlyLeaveGraceSeconds = grace(300), grace(300)
			return p
		}, "partial", 48.0 / 60},
		{"engagement raises a borderline score", span(0, 42), Signals{Actions: 3}, func(p Policy) Policy {
			p.DurationWeight, p.EngagementWeight = 0.5, 0.5
			return p
		}, "present", 0.85},
		{"actions past the target add nothing", span(0, 30), Signals{Actions: 100}, func(p Policy) Policy {
			p.DurationWeight, p.EngagementWeight = 0.5, 0.5
			return p
		}, "present", 0.75},
		{"visibility counts when reported", span(0, 60), Signals{Reported: true, VisibleSeconds: 10, HiddenSeconds: 90}, func(p Policy) Policy {
			p.DurationWeight, p.BrowserWeight = 0.5, 0.5
			return p
		}, "partial", 0.55},
		{"exactly on the threshold despite floating point", span(0, 60), Signals{}, func(p Policy) Policy {
			p.DurationWeight, p.EngagementWeight, p.BrowserWeight = 0.6, 0.2, 0.2
			return p
		}, "present", 0.75},
		{"no browser report is not held against anyone", span(0, 60), Signals{}, func(p Policy) Policy {
			p.DurationWeight, p.BrowserWeight = 0.5, 0.5
			return p
		}, "present", 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			policy := duration
			if c.policy != nil {
				policy = c.policy(policy)
			}
			got := Evaluate(c.intervals, c.signals, policy, start, end)
			if got.Status != c.status {
				t.Errorf("status %s, want %s (%+v)", got.Status, c.status, got.Calculation)
			}
			if diff := got.Calculation.Score - c.score; diff > 0.001 || diff < -0.001 {
				t.Errorf("score %v, want %v", got.Calculation.Score, c.score)
			}
		})
	}
}
