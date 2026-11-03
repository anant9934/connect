package ai

import (
	"context"
	"errors"
	"time"
)

var (
	// ErrProviderUnavailable is returned when a requested AI provider is offline or unconfigured.
	ErrProviderUnavailable = errors.New("ai provider unavailable")

	// ErrModelNotFound is returned when an AI model is not registered in the catalog.
	ErrModelNotFound = errors.New("ai model not registered")

	// ErrRateLimitExceeded is returned when an organization or user exceeds their AI rate limit.
	ErrRateLimitExceeded = errors.New("ai request rate limit exceeded")

	// ErrBudgetExceeded is returned when the organization's monthly spend limit is reached.
	ErrBudgetExceeded = errors.New("ai monthly budget limit exceeded")

	// ErrPromptTooLarge is returned when prompt input exceeds safety thresholds.
	ErrPromptTooLarge = errors.New("prompt input exceeds maximum allowed size")

	// ErrPromptInjectionDetected is returned when input contains adversarial prompt injection markers.
	ErrPromptInjectionDetected = errors.New("potential prompt injection detected in input")

	// ErrInvalidStructuredOutput is returned when an AI completion fails schema validation.
	ErrInvalidStructuredOutput = errors.New("ai completion failed schema validation")

	// ErrUnauthorizedProvider is returned when provider credentials or keys are rejected (HTTP 401/403).
	ErrUnauthorizedProvider = errors.New("ai provider authorization failed")

	// ErrProviderOverloaded is returned when provider returns 429 (rate limit) or 503 (overloaded).
	ErrProviderOverloaded = errors.New("ai provider capacity exhausted or overloaded")

	// ErrProviderTimeout is returned when provider times out.
	ErrProviderTimeout = errors.New("ai provider request timed out")

	// ErrNonFreeModelBlocked is returned when an organization in free_only budget mode attempts to call a paid model.
	ErrNonFreeModelBlocked = errors.New("paid model blocked: organization is configured in free_only budget mode")

	// ErrModelNotAllowed is returned when a requested model is not in the organization's allowed models list.
	ErrModelNotAllowed = errors.New("model not permitted by organization policy")
)

// Usage tracks tokens consumed by an AI operation with separate estimated and billed costs.
type Usage struct {
	InputTokens           int   `json:"inputTokens"`
	OutputTokens          int   `json:"outputTokens"`
	TotalTokens           int   `json:"totalTokens"`
	CostMicroUSD          int64 `json:"costMicroUSD"`          // backward-compat: mirrors EstimatedCostMicroUSD
	EstimatedCostMicroUSD int64 `json:"estimatedCostMicroUSD"` // provider theoretical cost
	BilledCostMicroUSD    int64 `json:"billedCostMicroUSD"`    // actual amount billed to organization (0 for free tier)
	IsMock                bool  `json:"isMock,omitempty"`
}

// CompletionRequest is a provider-neutral request for text generation.
type CompletionRequest struct {
	Model          string            `json:"model"`
	SystemPrompt   string            `json:"systemPrompt"`
	UserPrompt     string            `json:"userPrompt"`
	Temperature    float32           `json:"temperature"`
	MaxTokens      int               `json:"maxTokens"`
	StopSequences  []string          `json:"stopSequences,omitempty"`
	ResponseFormat string            `json:"responseFormat,omitempty"` // "text", "json"
	Metadata       map[string]string `json:"metadata,omitempty"`
}

// CompletionResult is a provider-neutral response from text generation.
type CompletionResult struct {
	Provider       string            `json:"provider"`
	Model          string            `json:"model"`
	Content        string            `json:"content"`
	Usage          Usage             `json:"usage"`
	Latency        time.Duration     `json:"latency"`
	FinishReason   string            `json:"finishReason"` // "stop", "length", "filter", "mock_simulation"
	IsMock         bool              `json:"isMock,omitempty"`
	Metadata       map[string]string `json:"metadata,omitempty"`
}

// StreamChunk represents a streamed chunk of an AI completion.
type StreamChunk struct {
	DeltaContent string
	Usage        *Usage
	IsFinal      bool
	Error        error
}

// Provider defines the interface for an external LLM vendor (e.g. Gemini, Groq, OpenAI, Mock).
type Provider interface {
	ID() string
	Complete(ctx context.Context, req CompletionRequest) (*CompletionResult, error)
	Stream(ctx context.Context, req CompletionRequest) (<-chan StreamChunk, error)
	HealthCheck(ctx context.Context) error
}
