package ai

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

// RouterConfig holds settings for model routing and fallback.
type RouterConfig struct {
	DefaultTimeout time.Duration
	MaxRetries     int
	FallbackChain  map[string][]string // model -> []fallbackModel
}

// Router orchestrates completion requests across registered providers with fallback and timeouts.
type Router struct {
	mu            sync.RWMutex
	providers     map[string]Provider
	registry      *ModelRegistry
	fallbackChain map[string][]string
	timeout       time.Duration
}

// NewRouter creates an AI Router.
func NewRouter(registry *ModelRegistry, cfg *RouterConfig) *Router {
	timeout := 30 * time.Second
	fallbacks := make(map[string][]string)

	if cfg != nil {
		if cfg.DefaultTimeout > 0 {
			timeout = cfg.DefaultTimeout
		}
		if cfg.FallbackChain != nil {
			fallbacks = cfg.FallbackChain
		}
	}

	return &Router{
		providers:     make(map[string]Provider),
		registry:      registry,
		fallbackChain: fallbacks,
		timeout:       timeout,
	}
}

// RegisterProvider registers a provider with the router.
func (r *Router) RegisterProvider(p Provider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.providers[p.ID()] = p
}

// SetFallback configures an ordered list of fallback models for a primary model.
func (r *Router) SetFallback(primaryModel string, fallbacks ...string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.fallbackChain[primaryModel] = fallbacks
}

// Complete routes a completion request to the appropriate provider, automatically falling back
// if the primary provider fails.
func (r *Router) Complete(ctx context.Context, req CompletionRequest) (*CompletionResult, error) {
	modelsToTry := []string{req.Model}

	r.mu.RLock()
	if fb, ok := r.fallbackChain[req.Model]; ok {
		modelsToTry = append(modelsToTry, fb...)
	}
	r.mu.RUnlock()

	var failures []error

	for _, modelID := range modelsToTry {
		modelInfo, ok := r.registry.Get(modelID)
		if !ok {
			failures = append(failures, fmt.Errorf("%w: %s", ErrModelNotFound, modelID))
			continue
		}

		r.mu.RLock()
		provider, hasProvider := r.providers[modelInfo.ProviderID]
		r.mu.RUnlock()

		if !hasProvider {
			failures = append(failures, fmt.Errorf("%w: provider %s for model %s", ErrProviderNotConfigured, modelInfo.ProviderID, modelID))
			continue
		}

		currentReq := req
		currentReq.Model = modelID

		callCtx, cancel := context.WithTimeout(ctx, r.timeout)
		result, err := provider.Complete(callCtx, currentReq)
		cancel()

		if err == nil {
			result.Model = modelID
			cost, costErr := r.registry.CalculateCostMicroUSD(modelID, result.Usage.InputTokens, result.Usage.OutputTokens)
			if costErr == nil {
				result.Usage.CostMicroUSD = cost
			}
			return result, nil
		}

		// Never log prompts or keys: only the model, provider and error class.
		slog.Warn("ai_provider_attempt_failed",
			slog.String("model", modelID),
			slog.String("provider", modelInfo.ProviderID),
			slog.String("class", failureClass(err).Error()),
		)
		failures = append(failures, err)
		if ctx.Err() != nil {
			break // caller gave up; do not burn quota on further fallbacks
		}
	}

	return nil, fmt.Errorf("%w: all providers in fallback chain failed: %v", classifyFailures(failures), errors.Join(failures...))
}

// failureClass returns the sentinel that best describes a single provider failure.
func failureClass(err error) error {
	for _, sentinel := range []error{
		ErrProviderNotConfigured, ErrModelNotFound, ErrProviderQuotaExhausted, ErrProviderOverloaded,
		ErrUnauthorizedProvider, ErrProviderTimeout, ErrInvalidStructuredOutput,
	} {
		if errors.Is(err, sentinel) {
			return sentinel
		}
	}
	return ErrProviderUnavailable
}

// classifyFailures reduces every attempt in a fallback chain to one truthful sentinel.
// Models without a configured provider are ignored unless nothing else was attempted.
func classifyFailures(failures []error) error {
	var attempted []error
	for _, err := range failures {
		class := failureClass(err)
		if class != ErrProviderNotConfigured && class != ErrModelNotFound {
			attempted = append(attempted, class)
		}
	}
	if len(attempted) == 0 {
		return ErrProviderNotConfigured
	}
	all := func(ok func(error) bool) bool {
		for _, c := range attempted {
			if !ok(c) {
				return false
			}
		}
		return true
	}
	switch {
	case all(func(c error) bool { return c == ErrProviderQuotaExhausted }):
		return ErrProviderQuotaExhausted
	case all(func(c error) bool { return c == ErrProviderQuotaExhausted || c == ErrProviderOverloaded }):
		return ErrProviderOverloaded
	case all(func(c error) bool { return c == ErrUnauthorizedProvider }):
		return ErrUnauthorizedProvider
	case all(func(c error) bool { return c == ErrProviderTimeout }):
		return ErrProviderTimeout
	case all(func(c error) bool { return c == ErrInvalidStructuredOutput }):
		return ErrInvalidStructuredOutput
	default:
		return ErrProviderUnavailable
	}
}

// Stream initiates a streaming completion with timeout.
func (r *Router) Stream(ctx context.Context, req CompletionRequest) (<-chan StreamChunk, error) {
	modelInfo, ok := r.registry.Get(req.Model)
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrModelNotFound, req.Model)
	}

	r.mu.RLock()
	provider, hasProvider := r.providers[modelInfo.ProviderID]
	r.mu.RUnlock()

	if !hasProvider {
		return nil, fmt.Errorf("%w: provider %s for model %s", ErrProviderNotConfigured, modelInfo.ProviderID, req.Model)
	}

	return provider.Stream(ctx, req)
}
