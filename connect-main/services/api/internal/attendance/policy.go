package attendance

import "time"

// Policy holds the institution-defined thresholds used to evaluate a class session.
type Policy struct {
	// Version is the attendance_policies version applied; 0 means PlatformDefaultPolicy.
	Version         int
	MinPresentRatio float64
	MinPartialRatio float64
	// LateGraceSeconds is the allowed delay after session start; nil disables late marking.
	LateGraceSeconds *int
}

// PlatformDefaultPolicy applies only to organizations without a configured policy.
// Records evaluated with it carry a NULL policy_version so they stay distinguishable.
var PlatformDefaultPolicy = Policy{MinPresentRatio: 0.75, MinPartialRatio: 0.40}

// StudentResult is the evaluated attendance outcome for one enrolled student.
type StudentResult struct {
	StudentUserID    string
	ConnectedSeconds int
	Status           string
}

// EvaluateStudent derives a status from trusted connection intervals.
func EvaluateStudent(intervals []Interval, policy Policy, sessionStart, sessionEnd time.Time) (int, string) {
	duration := int(sessionEnd.Sub(sessionStart).Seconds())
	connected := ReconcileIntervalUnion(intervals, sessionStart, sessionEnd)
	status := CalculateAttendanceStatus(connected, duration, policy.MinPresentRatio, policy.MinPartialRatio)

	if status == "present" && policy.LateGraceSeconds != nil {
		deadline := sessionStart.Add(time.Duration(*policy.LateGraceSeconds) * time.Second)
		first := intervals[0].Start
		for _, iv := range intervals[1:] {
			if iv.Start.Before(first) {
				first = iv.Start
			}
		}
		if first.After(deadline) {
			status = "late"
		}
	}
	return connected, status
}

// EvaluateEnrollment produces one result per enrolled student, so students who
// never connected are recorded as absent rather than omitted.
func EvaluateEnrollment(enrolled []string, intervals map[string][]Interval, policy Policy, sessionStart, sessionEnd time.Time) []StudentResult {
	results := make([]StudentResult, 0, len(enrolled))
	for _, studentID := range enrolled {
		connected, status := EvaluateStudent(intervals[studentID], policy, sessionStart, sessionEnd)
		results = append(results, StudentResult{StudentUserID: studentID, ConnectedSeconds: connected, Status: status})
	}
	return results
}
