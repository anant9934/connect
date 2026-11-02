package ai

import (
	"fmt"
	"sync"
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

	// 1. Google Gemini 2.0 Flash (Free tier available)
	r.Register(ModelInfo{
		ID:                    "gemini-2.0-flash",
		ProviderID:            "gemini",
		DisplayName:           "Gemini 2.0 Flash",
		ContextWindowTokens:   1_048_576,
		MaxOutputTokens:       8_192,
		InputMicroUSDPerMTok:  100_000,  // $0.10 / MTok
		OutputMicroUSDPerMTok: 400_000,  // $0.40 / MTok
		IsFreeTierEligible:    true,     // 15 RPM free tier
		SupportsStreaming:     true,
		SupportsJSONMode:      true,
	})

	// 2. Google Gemini 1.5 Flash (Free tier available)
	r.Register(ModelInfo{
		ID:                    "gemini-1.5-flash",
		ProviderID:            "gemini",
		DisplayName:           "Gemini 1.5 Flash",
		ContextWindowTokens:   1_048_576,
		MaxOutputTokens:       8_192,
		InputMicroUSDPerMTok:  75_000,   // $0.075 / MTok
		OutputMicroUSDPerMTok: 300_000,  // $0.30 / MTok
		IsFreeTierEligible:    true,     // 15 RPM free tier
		SupportsStreaming:     true,
		SupportsJSONMode:      true,
	})

	// 3. Meta LLaMA 3.3 70B via Groq (Free tier available)
	r.Register(ModelInfo{
		ID:                    "llama-3.3-70b-versatile",
		ProviderID:            "groq",
		DisplayName:           "LLaMA 3.3 70B (Groq)",
		ContextWindowTokens:   131_072,
		MaxOutputTokens:       8_192,
		InputMicroUSDPerMTok:  590_000,  // $0.59 / MTok
		OutputMicroUSDPerMTok: 790_000,  // $0.79 / MTok
		IsFreeTierEligible:    true,     // 30 RPM free tier
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
		InputMicroUSDPerMTok:  150_000,  // $0.15 / MTok
		OutputMicroUSDPerMTok: 600_000,  // $0.60 / MTok
		IsFreeTierEligible:    false,
		SupportsStreaming:     true,
		SupportsJSONMode:      true,
	})

	// 5. Offline Mock Model (Zero-cost test runner)
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
