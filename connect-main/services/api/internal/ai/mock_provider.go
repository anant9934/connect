package ai

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"
)

// MockProvider is an offline test provider that simulates completions and streaming.
type MockProvider struct {
	id             string
	mu             sync.RWMutex
	customResponse string
	simulatedError error
	latency        time.Duration
	calls          []CompletionRequest
}

// NewMockProvider creates an offline MockProvider.
func NewMockProvider(id string) *MockProvider {
	if id == "" {
		id = "mock"
	}
	return &MockProvider{
		id: id,
	}
}

// SetResponse sets a custom response content for future calls.
func (m *MockProvider) SetResponse(resp string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.customResponse = resp
}

// SetError forces future calls to return the specified error.
func (m *MockProvider) SetError(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.simulatedError = err
}

// SetLatency sets simulated execution latency.
func (m *MockProvider) SetLatency(d time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.latency = d
}

// CallCount returns the number of times Complete or Stream was invoked.
func (m *MockProvider) CallCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.calls)
}

// LastCall returns the most recent CompletionRequest.
func (m *MockProvider) LastCall() *CompletionRequest {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(m.calls) == 0 {
		return nil
	}
	req := m.calls[len(m.calls)-1]
	return &req
}

// ID returns the provider identifier.
func (m *MockProvider) ID() string {
	return m.id
}

// Complete implements Provider.Complete.
func (m *MockProvider) Complete(ctx context.Context, req CompletionRequest) (*CompletionResult, error) {
	m.mu.Lock()
	m.calls = append(m.calls, req)
	simErr := m.simulatedError
	latency := m.latency
	customResp := m.customResponse
	m.mu.Unlock()

	if latency > 0 {
		select {
		case <-time.After(latency):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	if simErr != nil {
		return nil, simErr
	}

	text := customResp
	if text == "" {
		if req.ResponseFormat == "json" {
			text = `{"_mock_warning":"[SIMULATED AI / MOCK OUTPUT - NOT A REAL MODEL RESPONSE]","title":"Mock Lecture Summary","overview":"Simulated summary for prompt: ` + req.UserPrompt + `","keyConcepts":["Mock Concept 1","Mock Concept 2"],"takeaways":["Mock Takeaway 1"],"actionItems":["Mock Action Item"]}`
		} else {
			text = "[SIMULATED AI / MOCK OUTPUT - NOT A REAL MODEL RESPONSE]\nMock completion generated for prompt: " + req.UserPrompt
		}
	}

	inputTokens := len(strings.Fields(req.SystemPrompt + " " + req.UserPrompt))
	outputTokens := len(strings.Fields(text))

	return &CompletionResult{
		Provider: m.id,
		Model:    req.Model,
		Content:  text,
		Usage: Usage{
			InputTokens:  inputTokens,
			OutputTokens: outputTokens,
			TotalTokens:  inputTokens + outputTokens,
		},
		Latency:      latency,
		FinishReason: "mock_simulation",
		IsMock:       true,
		Metadata: map[string]string{
			"is_mock":    "true",
			"mock_label": "SIMULATED AI - NOT A REAL MODEL RESPONSE",
		},
	}, nil
}

// Stream implements Provider.Stream.
func (m *MockProvider) Stream(ctx context.Context, req CompletionRequest) (<-chan StreamChunk, error) {
	m.mu.Lock()
	m.calls = append(m.calls, req)
	simErr := m.simulatedError
	customResp := m.customResponse
	m.mu.Unlock()

	if simErr != nil {
		return nil, simErr
	}

	out := make(chan StreamChunk)

	go func() {
		defer close(out)

		text := customResp
		if text == "" {
			text = "Mock stream chunk response."
		}

		words := strings.Fields(text)
		for _, w := range words {
			select {
			case <-ctx.Done():
				out <- StreamChunk{Error: ctx.Err(), IsFinal: true}
				return
			case out <- StreamChunk{DeltaContent: w + " "}:
				time.Sleep(5 * time.Millisecond)
			}
		}

		out <- StreamChunk{
			IsFinal: true,
			Usage: &Usage{
				InputTokens:  10,
				OutputTokens: len(words),
				TotalTokens:  10 + len(words),
			},
		}
	}()

	return out, nil
}

// HealthCheck implements Provider.HealthCheck.
func (m *MockProvider) HealthCheck(ctx context.Context) error {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.simulatedError != nil {
		return errors.New("mock provider unhealthy: " + m.simulatedError.Error())
	}
	return nil
}
