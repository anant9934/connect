package lab

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestNormalizeOutput(t *testing.T) {
	cases := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "CRLF normalization",
			input:    "Hello\r\nWorld\r\n",
			expected: "Hello\nWorld",
		},
		{
			name:     "Trailing spaces on lines",
			input:    "line1   \nline2 \t\nline3",
			expected: "line1\nline2\nline3",
		},
		{
			name:     "Multiple trailing newlines",
			input:    "result\n\n\n",
			expected: "result",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := NormalizeOutput(tc.input)
			if got != tc.expected {
				t.Errorf("NormalizeOutput(%q) = %q, want %q", tc.input, got, tc.expected)
			}
		})
	}
}

func TestEvaluateSubmissionAgainstTestCases(t *testing.T) {
	tc1ID := uuid.New()
	tc2ID := uuid.New()
	hiddenTcID := uuid.New()

	testCases := []LabTestCase{
		{
			ID:             tc1ID,
			Input:          "5\n",
			ExpectedOutput: "25",
			IsHidden:       false,
			Weight:         1,
		},
		{
			ID:             tc2ID,
			Input:          "10\n",
			ExpectedOutput: "100",
			IsHidden:       false,
			Weight:         2,
		},
		{
			ID:             hiddenTcID,
			Input:          "1000\n",
			ExpectedOutput: "1000000",
			IsHidden:       true,
			Weight:         3,
		},
	}

	// Case 1: Student submission passes public tests, fails hidden test
	outputs := map[string]string{
		tc1ID.String():      "25",
		tc2ID.String():      "100",
		hiddenTcID.String(): "999", // wrong
	}

	score, passed, total, status, results := EvaluateSubmissionAgainstTestCases(
		testCases, outputs, nil, nil, 100, true,
	)

	if passed != 2 || total != 3 {
		t.Errorf("expected 2/3 passed, got %d/%d", passed, total)
	}
	if status != "failed" {
		t.Errorf("expected status 'failed', got %q", status)
	}
	// Weight total = 1 + 2 + 3 = 6. Passed weight = 1 + 2 = 3. Score = (3 * 100) / 6 = 50.
	if score != 50 {
		t.Errorf("expected score 50, got %d", score)
	}

	// Verify hidden test case masking for student
	for _, res := range results {
		if res.TestCaseID == hiddenTcID {
			if res.Input != "" || res.ExpectedOutput != "" {
				t.Errorf("security breach: student received hidden test case data! Input=%q, Expected=%q", res.Input, res.ExpectedOutput)
			}
		}
	}

	// Case 2: All pass
	outputsAllPass := map[string]string{
		tc1ID.String():      "25",
		tc2ID.String():      "100\n",
		hiddenTcID.String(): "1000000",
	}

	score2, passed2, total2, status2, _ := EvaluateSubmissionAgainstTestCases(
		testCases, outputsAllPass, nil, nil, 100, true,
	)
	if score2 != 100 || passed2 != 3 || total2 != 3 || status2 != "passed" {
		t.Errorf("expected perfect score 100 passed, got %d score, %d/%d passed, status=%s", score2, passed2, total2, status2)
	}

	// Case 3: Blocked execution for compiled binaries queues as pending
	blockedErrors := map[string]string{
		tc1ID.String():      "Execution BLOCKED: compilation disabled under ₹0 policy",
		tc2ID.String():      "Execution BLOCKED: compilation disabled under ₹0 policy",
		hiddenTcID.String(): "Execution BLOCKED: compilation disabled under ₹0 policy",
	}
	score3, passed3, total3, status3, _ := EvaluateSubmissionAgainstTestCases(
		testCases, nil, blockedErrors, nil, 100, true,
	)
	if status3 != "pending" || score3 != 0 || passed3 != 0 || total3 != 3 {
		t.Errorf("expected status 'pending' for blocked execution, got status=%s, score=%d", status3, score3)
	}
}

func TestComputeStreak(t *testing.T) {
	now := time.Date(2026, 11, 2, 14, 0, 0, 0, time.UTC)

	// First activity ever
	streak1 := ComputeStreak(0, time.Time{}, now)
	if streak1 != 1 {
		t.Errorf("expected initial streak 1, got %d", streak1)
	}

	// Activity on same day
	streakSameDay := ComputeStreak(3, now.Add(-2*time.Hour), now)
	if streakSameDay != 3 {
		t.Errorf("expected same day streak to remain 3, got %d", streakSameDay)
	}

	// Activity consecutive day (yesterday)
	yesterday := now.Add(-24 * time.Hour)
	streakConsecutive := ComputeStreak(3, yesterday, now)
	if streakConsecutive != 4 {
		t.Errorf("expected consecutive day streak 4, got %d", streakConsecutive)
	}

	// Streak broken (3 days ago)
	threeDaysAgo := now.Add(-72 * time.Hour)
	streakBroken := ComputeStreak(5, threeDaysAgo, now)
	if streakBroken != 1 {
		t.Errorf("expected broken streak to reset to 1, got %d", streakBroken)
	}
}
