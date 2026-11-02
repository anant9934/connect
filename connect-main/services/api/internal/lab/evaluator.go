package lab

import (
	"strings"
	"time"
)

// NormalizeOutput normalizes text for test case comparison.
// It trims trailing whitespace from each line, unifies CRLF to LF, and strips trailing newlines.
func NormalizeOutput(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	lines := strings.Split(s, "\n")
	var cleaned []string
	for _, line := range lines {
		cleaned = append(cleaned, strings.TrimRight(line, " \t"))
	}
	// Strip trailing empty lines
	for len(cleaned) > 0 && cleaned[len(cleaned)-1] == "" {
		cleaned = cleaned[:len(cleaned)-1]
	}
	return strings.Join(cleaned, "\n")
}

// CompareOutputs compares actual execution output against expected output with tolerance.
func CompareOutputs(actual, expected string) bool {
	return NormalizeOutput(actual) == NormalizeOutput(expected)
}

// EvaluateSubmissionAgainstTestCases compares test cases and computes the final score.
// If isStudentCaller is true, hidden test inputs, expected outputs, and actual outputs are scrubbed.
func EvaluateSubmissionAgainstTestCases(
	testCases []LabTestCase,
	outputs map[string]string, // test_case_id string -> stdout
	errors map[string]string,  // test_case_id string -> stderr
	durations map[string]int,  // test_case_id string -> duration_ms
	maxScore int,
	isStudentCaller bool,
) (score int, passedCount int, totalCount int, status string, results []TestCaseResult) {
	totalCount = len(testCases)
	if totalCount == 0 {
		return maxScore, 0, 0, "passed", []TestCaseResult{}
	}

	totalWeight := 0
	passedWeight := 0

	for _, tc := range testCases {
		weight := tc.Weight
		if weight <= 0 {
			weight = 1
		}
		totalWeight += weight

		tcIDStr := tc.ID.String()
		actualOut := outputs[tcIDStr]
		errOut := errors[tcIDStr]
		dur := durations[tcIDStr]
		if dur == 0 {
			dur = 5 // default nominal execution ms
		}

		passed := false
		var errMsg string

		if errOut != "" {
			errMsg = errOut
		} else if CompareOutputs(actualOut, tc.ExpectedOutput) {
			passed = true
			passedCount++
			passedWeight += weight
		} else {
			errMsg = "Output does not match expected result"
		}

		res := TestCaseResult{
			TestCaseID:      tc.ID,
			Passed:          passed,
			ExecutionTimeMS: dur,
			IsHidden:        tc.IsHidden,
		}

		if !tc.IsHidden || !isStudentCaller {
			res.Input = tc.Input
			res.ExpectedOutput = tc.ExpectedOutput
			res.ActualOutput = actualOut
			res.ErrorMessage = errMsg
		} else {
			// For students, hidden test case inputs and outputs are never leaked
			if !passed {
				if strings.Contains(errMsg, "BLOCKED") {
					res.ErrorMessage = "Hidden test case execution BLOCKED"
				} else {
					res.ErrorMessage = "Hidden test case failed"
				}
			}
		}

		results = append(results, res)
	}

	if totalWeight > 0 {
		score = (passedWeight * maxScore) / totalWeight
	} else {
		score = 0
	}

	allBlocked := true
	for _, res := range results {
		if !strings.Contains(res.ErrorMessage, "BLOCKED") {
			allBlocked = false
			break
		}
	}

	if allBlocked && len(results) > 0 {
		status = "pending"
	} else if passedCount == totalCount {
		status = "passed"
	} else if passedCount > 0 {
		status = "failed"
	} else {
		status = "failed"
	}

	return score, passedCount, totalCount, status, results
}

// ComputeStreak calculates consecutive days of learning activity.
func ComputeStreak(currentStreak int, lastActivity time.Time, now time.Time) int {
	if lastActivity.IsZero() {
		return 1
	}

	lastDay := lastActivity.UTC().Truncate(24 * time.Hour)
	today := now.UTC().Truncate(24 * time.Hour)
	diffDays := int(today.Sub(lastDay).Hours() / 24)

	if diffDays == 0 {
		// Same day activity, maintain streak
		if currentStreak <= 0 {
			return 1
		}
		return currentStreak
	} else if diffDays == 1 {
		// Next day consecutive activity
		return currentStreak + 1
	} else {
		// Streak broken
		return 1
	}
}
