package ai

import (
	"fmt"
	"sync"
)

// Exact upstream model IDs used for routing.
const (
	ModelGeminiFlash     = "gemini-2.5-flash"
	ModelGeminiFlashLite = "gemini-3.5-flash-lite"
	ModelGroqLarge       = "openai/gpt-oss-120b"
	ModelGroqSmall       = "openai/gpt-oss-20b"
	ModelOpenRouterFree  = "nvidia/nemotron-3.5-super-vl:free"
	ModelMock            = "mock-academic-v1"
)

// ModelInfo describes capabilities, limits, and pricing for an LLM.
type ModelInfo struct {
	ID                    string `json:"id"`
	ProviderID            string `json:"providerId"`
	DisplayName           string `json:"displayName"`
	ContextWindowTokens   int    `json:"contextWindowTokens"`
	MaxOutputTokens       int    `json:"maxOutputTokens"`
	InputMicroUSDPerMTok  int64  `json:"inputMicroUSDPerMTok"`
	OutputMicroUSDPerMTok int64  `json:"outputMicroUSDPerMTok"`
	IsFreeTierEligible    bool   `json:"isFreeTierEligible"`
	SupportsStreaming     bool   `json:"supportsStreaming"`
	SupportsJSONMode      bool   `json:"supportsJsonMode"`
}

// ModelRegistry manages the catalog of available models and their pricing.
type ModelRegistry struct {
	mu     sync.RWMutex
	models map[string]ModelInfo
}

// NewDefaultModelRegistry constructs a ModelRegistry populated with standard free-tier and standard models.
func NewDefaultModelRegistry() *ModelRegistry {
	r := &ModelRegistry{
		models: make(map[string]ModelInfo),
	}

	// Model IDs are the exact upstream model names sent to each provider.
	// Verified available on 2026-11-03 with the configured free-tier keys.
	// Prices are list-price estimates for reporting only; free-tier usage is billed at 0.

	// 1. Google Gemini 2.5 Flash (quality default)
	r.Register(ModelInfo{
		ID:                    ModelGeminiFlash,
		ProviderID:            "gemini",
		DisplayName:           "Gemini 2.5 Flash",
		ContextWindowTokens:   1_048_576,
		MaxOutputTokens:       8_192,
		InputMicroUSDPerMTok:  300_000,   // $0.30 / MTok
		OutputMicroUSDPerMTok: 2_500_000, // $2.50 / MTok
		IsFreeTierEligible:    true,
		SupportsStreaming:     true,
		SupportsJSONMode:      true,
	})

	// 2. Google Gemini 3.5 Flash Lite (fast default)
	r.Register(ModelInfo{
		ID:                    ModelGeminiFlashLite,
		ProviderID:            "gemini",
		DisplayName:           "Gemini 3.5 Flash Lite",
		ContextWindowTokens:   1_048_576,
		MaxOutputTokens:       8_192,
		InputMicroUSDPerMTok:  100_000, // $0.10 / MTok
		OutputMicroUSDPerMTok: 400_000, // $0.40 / MTok
		IsFreeTierEligible:    true,
		SupportsStreaming:     true,
		SupportsJSONMode:      true,
	})

	// 3. OpenAI GPT-OSS 120B via Groq
	r.Register(ModelInfo{
		ID:                    ModelGroqLarge,
		ProviderID:            "groq",
		DisplayName:           "GPT-OSS 120B (Groq)",
		ContextWindowTokens:   131_072,
		MaxOutputTokens:       8_192,
		InputMicroUSDPerMTok:  150_000, // $0.15 / MTok
		OutputMicroUSDPerMTok: 600_000, // $0.60 / MTok
		IsFreeTierEligible:    true,
		SupportsStreaming:     true,
		SupportsJSONMode:      true,
	})

	// 3b. OpenAI GPT-OSS 20B via Groq
	r.Register(ModelInfo{
		ID:                    ModelGroqSmall,
		ProviderID:            "groq",
		DisplayName:           "GPT-OSS 20B (Groq)",
		ContextWindowTokens:   131_072,
		MaxOutputTokens:       8_192,
		InputMicroUSDPerMTok:  75_000,  // $0.075 / MTok
		OutputMicroUSDPerMTok: 300_000, // $0.30 / MTok
		IsFreeTierEligible:    true,
		SupportsStreaming:     true,
		SupportsJSONMode:      true,
	})

	// 4. OpenAI GPT-4o-mini (BYOK / Standard)
	r.Register(ModelInfo{
		ID:                    "gpt-4o-mini",
		ProviderID:            "openai",
		DisplayName:           "GPT-4o mini",
		ContextWindowTokens:   128_000,
		MaxOutputTokens:       16_384,
		InputMicroUSDPerMTok:  150_000, // $0.15 / MTok
		OutputMicroUSDPerMTok: 600_000, // $0.60 / MTok
		IsFreeTierEligible:    false,
		SupportsStreaming:     true,
		SupportsJSONMode:      true,
	})

	// 5. NVIDIA Nemotron 3.5 Super via OpenRouter (free model, last-resort fallback)
	r.Register(ModelInfo{
		ID:                    ModelOpenRouterFree,
		ProviderID:            "openrouter",
		DisplayName:           "Nemotron 3.5 Super (OpenRouter free)",
		ContextWindowTokens:   131_072,
		MaxOutputTokens:       8_192,
		InputMicroUSDPerMTok:  0,
		OutputMicroUSDPerMTok: 0,
		IsFreeTierEligible:    true,
		SupportsStreaming:     true,
		SupportsJSONMode:      true,
	})

	// 6. Offline Mock Model (Zero-cost test runner)
	r.Register(ModelInfo{
		ID:                    "mock-academic-v1",
		ProviderID:            "mock",
		DisplayName:           "Mock Academic Simulator",
		ContextWindowTokens:   64_000,
		MaxOutputTokens:       4_096,
		InputMicroUSDPerMTok:  0,
		OutputMicroUSDPerMTok: 0,
		IsFreeTierEligible:    true,
		SupportsStreaming:     true,
		SupportsJSONMode:      true,
	})

	return r
}

// Register registers or updates a model configuration.
func (r *ModelRegistry) Register(m ModelInfo) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.models[m.ID] = m
}

// Get retrieves model metadata.
func (r *ModelRegistry) Get(modelID string) (ModelInfo, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	m, ok := r.models[modelID]
	return m, ok
}

// GetModel retrieves model metadata or returns ErrModelNotFound.
func (r *ModelRegistry) GetModel(modelID string) (*ModelInfo, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	m, ok := r.models[modelID]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrModelNotFound, modelID)
	}
	return &m, nil
}

// List returns all registered models.
func (r *ModelRegistry) List() []ModelInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	list := make([]ModelInfo, 0, len(r.models))
	for _, m := range r.models {
		list = append(list, m)
	}
	return list
}

// CalculateCostMicroUSD computes cost in micro-USD (rounded up).
func (r *ModelRegistry) CalculateCostMicroUSD(modelID string, inputTokens, outputTokens int) (int64, error) {
	m, ok := r.Get(modelID)
	if !ok {
		return 0, fmt.Errorf("%w: %s", ErrModelNotFound, modelID)
	}

	const perMillion = 1_000_000
	cost := int64(inputTokens)*m.InputMicroUSDPerMTok + int64(outputTokens)*m.OutputMicroUSDPerMTok
	return (cost + perMillion - 1) / perMillion, nil
}
