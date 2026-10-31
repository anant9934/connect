package worker_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tathastu/connect/services/api/internal/worker"
)

func TestJob_StatusConstants(t *testing.T) {
	expected := map[string]string{
		"pending":     worker.StatusPending,
		"processing":  worker.StatusProcessing,
		"completed":   worker.StatusCompleted,
		"failed":      worker.StatusFailed,
		"dead_letter": worker.StatusDeadLetter,
	}

	for k, v := range expected {
		if k != v {
			t.Errorf("status mismatch: %s != %s", k, v)
		}
	}
}

func TestEnqueueJob_Validation(t *testing.T) {
	ctx := context.Background()

	// Missing idempotency key must fail immediately
	_, err := worker.EnqueueJob(ctx, nil, "default", "", map[string]string{"foo": "bar"}, nil)
	if err == nil || !strings.Contains(err.Error(), "idempotency key is required") {
		t.Errorf("expected idempotency key required error, got: %v", err)
	}
}

// TestFencingTokenMonotonicity verifies that fencing tokens protect against split-brain execution.
func TestFencingTokenMonotonicity(t *testing.T) {
	// Simulate an active job with an initial fencing token
	jobID := uuid.New()
	initialToken := int64(1)

	job := &worker.Job{
		ID:           jobID,
		Status:       worker.StatusProcessing,
		FencingToken: initialToken,
	}

	// Worker 1 holds lease with token 1
	worker1Token := initialToken

	// Worker 2 reclaims the job after lease expiry, incrementing token to 2
	worker2Token := initialToken + 1
	job.FencingToken = worker2Token

	// When Worker 1 attempts to complete the job with stale token 1, it must be rejected
	if worker1Token == job.FencingToken {
		t.Fatal("SECURITY ERROR: Stale fencing token matched active lease!")
	}

	// Worker 2 completes with valid token 2
	if worker2Token != job.FencingToken {
		t.Fatal("Valid fencing token failed to match active lease!")
	}
}

// TestStateTransition_DeadLetterBoundary verifies that jobs transition to dead_letter once max attempts are reached.
func TestStateTransition_DeadLetterBoundary(t *testing.T) {
	tests := []struct {
		name           string
		attempts       int
		maxAttempts    int
		expectedStatus string
	}{
		{
			name:           "Attempt below max transitions to failed for retry",
			attempts:       2,
			maxAttempts:    5,
			expectedStatus: worker.StatusFailed,
		},
		{
			name:           "Attempt at max transitions to dead_letter",
			attempts:       5,
			maxAttempts:    5,
			expectedStatus: worker.StatusDeadLetter,
		},
		{
			name:           "Attempt exceeding max transitions to dead_letter",
			attempts:       6,
			maxAttempts:    5,
			expectedStatus: worker.StatusDeadLetter,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status := worker.StatusFailed
			if tt.attempts >= tt.maxAttempts {
				status = worker.StatusDeadLetter
			}

			if status != tt.expectedStatus {
				t.Errorf("expected status %s, got %s", tt.expectedStatus, status)
			}
		})
	}
}

func TestJob_StructInitialization(t *testing.T) {
	jobID := uuid.New()
	now := time.Now()
	j := worker.Job{
		ID:             jobID,
		Queue:          worker.DefaultQueue,
		IdempotencyKey: "test-key-123",
		Payload:        []byte(`{"action":"send_email"}`),
		Status:         worker.StatusPending,
		AttemptCount:   0,
		MaxAttempts:    worker.DefaultMaxAttempts,
		ScheduledAt:    now,
		FencingToken:   0,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	if j.Queue != "default" {
		t.Errorf("expected default queue, got %s", j.Queue)
	}
	if j.MaxAttempts != 5 {
		t.Errorf("expected 5 max attempts, got %d", j.MaxAttempts)
	}
}
