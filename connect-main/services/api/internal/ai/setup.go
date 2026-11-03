package ai

// DefaultFallbacks returns the fallback chain for each default model. Every entry is a real,
// free-tier model on a different provider or tier. The mock model is never a fallback.
func DefaultFallbacks() map[string][]string {
	return map[string][]string{
		ModelGeminiFlash:     {ModelGroqLarge, ModelGeminiFlashLite, ModelOpenRouterFree},
		ModelGeminiFlashLite: {ModelGroqSmall, ModelGeminiFlash, ModelOpenRouterFree},
		ModelGroqLarge:       {ModelGeminiFlash, ModelOpenRouterFree},
		ModelGroqSmall:       {ModelGeminiFlashLite, ModelOpenRouterFree},
	}
}

// BuildRouter registers a real provider for every key pool that has keys and installs the
// default fallback chains. The mock provider is registered only when includeMock is true,
// which callers must restrict to non-production environments.
func BuildRouter(registry *ModelRegistry, keys *KeyPoolManager, includeMock bool) *Router {
	router := NewRouter(registry, nil)
	if pool := keys.GetKeyPool("gemini"); pool != nil && pool.Size() > 0 {
		router.RegisterProvider(NewGeminiProvider("gemini", pool, nil))
	}
	if pool := keys.GetKeyPool("groq"); pool != nil && pool.Size() > 0 {
		router.RegisterProvider(NewGroqProvider("groq", pool, nil))
	}
	if pool := keys.GetKeyPool("openrouter"); pool != nil && pool.Size() > 0 {
		router.RegisterProvider(NewOpenRouterProvider("openrouter", pool, nil))
	}
	for primary, chain := range DefaultFallbacks() {
		router.SetFallback(primary, chain...)
	}
	if includeMock {
		router.RegisterProvider(NewMockProvider("mock"))
	}
	return router
}

// ConfiguredProviderCount reports how many real providers have at least one key.
func (r *Router) ConfiguredProviderCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	n := 0
	for id := range r.providers {
		if id != "mock" {
			n++
		}
	}
	return n
}
