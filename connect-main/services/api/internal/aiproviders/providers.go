// Package aiproviders defines provider-independent contracts for Phase 5 speech and
// LLM features. No vendor is implemented here, so nothing can consume paid credits.
package aiproviders

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// ErrUnknownModel means a model has no configured price, so its cost cannot be tracked.
var ErrUnknownModel = errors.New("no price configured for model")

// TranscriptSegment is one timestamped span of speech.
type TranscriptSegment struct {
	Start      time.Duration
	End        time.Duration
	Text       string
	Speaker    string
	Language   string
	Confidence *float64 // nil when the provider reports none
}

// TranscriptionResult holds a transcript and its billable audio duration.
type TranscriptionResult struct {
	Segments []TranscriptSegment
	Billed   time.Duration
}

// Transcriber converts a recording into a timestamped transcript.
type Transcriber interface {
	Transcribe(ctx context.Context, audioURL string, languageHints []string) (*TranscriptionResult, error)
}

// Usage records the tokens consumed by one completion.
type Usage struct {
	InputTokens  int
	OutputTokens int
}

// CompletionRequest is a provider-neutral LLM request.
type CompletionRequest struct {
	Model     string
	System    string
	Prompt    string
	MaxTokens int
}

// CompletionResult is a provider-neutral LLM response.
type CompletionResult struct {
	Text  string
	Usage Usage
}

// LLM generates text from a prompt.
type LLM interface {
	Complete(ctx context.Context, req CompletionRequest) (*CompletionResult, error)
}

// ModelPrice is expressed in micro-USD per million tokens to avoid float rounding.
type ModelPrice struct {
	InputMicroUSDPerMTok  int64
	OutputMicroUSDPerMTok int64
}

// PriceTable maps model names to configured prices.
type PriceTable map[string]ModelPrice

// CostMicroUSD returns the cost of a usage record, rounded up so spend is never understated.
func (t PriceTable) CostMicroUSD(model string, u Usage) (int64, error) {
	price, ok := t[model]
	if !ok {
		return 0, fmt.Errorf("%w: %s", ErrUnknownModel, model)
	}
	const perMillion = 1_000_000
	total := int64(u.InputTokens)*price.InputMicroUSDPerMTok + int64(u.OutputTokens)*price.OutputMicroUSDPerMTok
	return (total + perMillion - 1) / perMillion, nil
}
