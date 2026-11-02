package attendance

import (
	"math"
	"time"
)

// Policy holds the institution-defined rules used to evaluate a class session.
type Policy struct {
	// Version is the attendance_policies version applied; 0 means PlatformDefaultPolicy.
	Version         int
	MinPresentRatio float64
	MinPartialRatio float64
	// LateGraceSeconds is the allowed delay after session start; nil disables late marking.
	LateGraceSeconds *int
	// EarlyLeaveGraceSeconds is how long before the end someone may leave; nil disables the rule.
	EarlyLeaveGraceSeconds *int
	// The weights sum to 1, and each signal is measured from 0 to 1.
	DurationWeight   float64
	EngagementWeight float64
	BrowserWeight    float64
	// EngagementTarget is the number of actions that earns the full engagement signal.
	EngagementTarget int
}

// PlatformDefaultPolicy applies only to organizations without a configured policy.
// Records evaluated with it carry a NULL policy_version so they stay distinguishable.
var PlatformDefaultPolicy = Policy{MinPresentRatio: 0.75, MinPartialRatio: 0.40, DurationWeight: 1, EngagementTarget: 3}

// Signals is what a student did beyond being connected.
type Signals struct {
	Actions        int
	VisibleSeconds int
	HiddenSeconds  int
	// Reported is false when the browser sent nothing, which says nothing about the student.
	Reported bool
}

// Calculation explains a result, step by step, to the student and to staff.
type Calculation struct {
	SessionSeconds   int      `json:"sessionSeconds"`
	ConnectedSeconds int      `json:"connectedSeconds"`
	Actions          int      `json:"actions"`
	EngagementTarget int      `json:"engagementTarget"`
	DurationRatio    float64  `json:"durationRatio"`
	EngagementRatio  float64  `json:"engagementRatio"`
	BrowserRatio     *float64 `json:"browserRatio"`
	DurationWeight   float64  `json:"durationWeight"`
	EngagementWeight float64  `json:"engagementWeight"`
	BrowserWeight    float64  `json:"browserWeight"`
	Score            float64  `json:"score"`
	MinPresent       float64  `json:"minPresent"`
	MinPartial       float64  `json:"minPartial"`
	JoinedLate       bool     `json:"joinedLate"`
	LeftEarly        bool     `json:"leftEarly"`
	Rules            []string `json:"rules"`
}

// StudentResult is the evaluated attendance outcome for one enrolled student.
type StudentResult struct {
	StudentUserID    string
	ConnectedSeconds int
	Status           string
	FirstJoinedAt    *time.Time
	LastLeftAt       *time.Time
	Calculation      Calculation
}

// Evaluate derives a status from trusted connection intervals and the student's signals. A signal
// with no data leaves the score and the other weights share its part, so nobody is marked down
// because their browser could not report. Someone who never connected is absent whatever else is known.
func Evaluate(intervals []Interval, signals Signals, policy Policy, sessionStart, sessionEnd time.Time) StudentResult {
	if policy.DurationWeight+policy.EngagementWeight+policy.BrowserWeight == 0 {
		policy.DurationWeight = 1 // A policy that names no weights goes by time connected.
	}
	duration := int(sessionEnd.Sub(sessionStart).Seconds())
	connected := ReconcileIntervalUnion(intervals, sessionStart, sessionEnd)
	calc := Calculation{
		SessionSeconds: duration, ConnectedSeconds: connected, Actions: signals.Actions, EngagementTarget: policy.EngagementTarget,
		DurationWeight: policy.DurationWeight, EngagementWeight: policy.EngagementWeight, BrowserWeight: policy.BrowserWeight,
		MinPresent: policy.MinPresentRatio, MinPartial: policy.MinPartialRatio, Rules: []string{},
	}
	if duration > 0 {
		calc.DurationRatio = float64(connected) / float64(duration)
	}
	if policy.EngagementTarget > 0 {
		calc.EngagementRatio = math.Min(float64(signals.Actions)/float64(policy.EngagementTarget), 1)
	}
	if total := signals.VisibleSeconds + signals.HiddenSeconds; signals.Reported && total > 0 {
		ratio := float64(signals.VisibleSeconds) / float64(total)
		calc.BrowserRatio = &ratio
	}

	weighted := policy.DurationWeight*calc.DurationRatio + policy.EngagementWeight*calc.EngagementRatio
	counted := policy.DurationWeight + policy.EngagementWeight
	if calc.BrowserRatio != nil {
		weighted += policy.BrowserWeight * *calc.BrowserRatio
		counted += policy.BrowserWeight
	} else if policy.BrowserWeight > 0 {
		calc.Rules = append(calc.Rules, "browser_signal_unavailable")
	}
	if counted > 0 {
		// Scores are stored to 3 places. Comparing the same value stops rounding error from
		// moving someone exactly on a threshold.
		calc.Score = math.Round(weighted/counted*1000) / 1000
	}

	result := StudentResult{ConnectedSeconds: connected, Status: "absent"}
	if connected > 0 {
		switch {
		case calc.Score >= policy.MinPresentRatio:
			result.Status = "present"
		case calc.Score >= policy.MinPartialRatio:
			result.Status = "partial"
		}
		first, last := intervals[0].Start, intervals[0].End
		for _, iv := range intervals[1:] {
			if iv.Start.Before(first) {
				first = iv.Start
			}
			if iv.End.After(last) {
				last = iv.End
			}
		}
		result.FirstJoinedAt, result.LastLeftAt = &first, &last
		if policy.LateGraceSeconds != nil && first.After(sessionStart.Add(time.Duration(*policy.LateGraceSeconds)*time.Second)) {
			calc.JoinedLate = true
		}
		if policy.EarlyLeaveGraceSeconds != nil && last.Before(sessionEnd.Add(-time.Duration(*policy.EarlyLeaveGraceSeconds)*time.Second)) {
			calc.LeftEarly = true
		}
		if result.Status == "present" {
			switch {
			case calc.LeftEarly:
				result.Status = "partial"
				calc.Rules = append(calc.Rules, "left_early_lowered_present_to_partial")
			case calc.JoinedLate:
				result.Status = "late"
				calc.Rules = append(calc.Rules, "joined_late_marked_late")
			}
		}
	} else {
		calc.Rules = append(calc.Rules, "never_connected")
	}
	result.Calculation = calc
	return result
}

// EvaluateStudent derives a status from trusted connection intervals alone.
func EvaluateStudent(intervals []Interval, policy Policy, sessionStart, sessionEnd time.Time) (int, string) {
	result := Evaluate(intervals, Signals{}, policy, sessionStart, sessionEnd)
	return result.ConnectedSeconds, result.Status
}

// EvaluateEnrollment produces one result per enrolled student, so students who
// never connected are recorded as absent rather than omitted.
func EvaluateEnrollment(enrolled []string, intervals map[string][]Interval, signals map[string]Signals, policy Policy, sessionStart, sessionEnd time.Time) []StudentResult {
	results := make([]StudentResult, 0, len(enrolled))
	for _, studentID := range enrolled {
		result := Evaluate(intervals[studentID], signals[studentID], policy, sessionStart, sessionEnd)
		result.StudentUserID = studentID
		results = append(results, result)
	}
	return results
}
