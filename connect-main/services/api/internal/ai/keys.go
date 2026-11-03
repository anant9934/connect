package ai

import (
	"os"
	"strings"
	"sync"
	"sync/atomic"
)

// KeyPool manages a rotating set of API keys for an upstream provider.
type KeyPool struct {
	providerName string
	keys         []string
	counter      uint64
	mu           sync.RWMutex
}

// NewKeyPool creates a key pool from a slice of keys.
func NewKeyPool(providerName string, keys []string) *KeyPool {
	var cleanKeys []string
	for _, k := range keys {
		trimmed := strings.TrimSpace(k)
		if trimmed != "" {
			cleanKeys = append(cleanKeys, trimmed)
		}
	}
	return &KeyPool{
		providerName: providerName,
		keys:         cleanKeys,
	}
}

// NextKey returns the next key using lock-free round-robin rotation.
func (kp *KeyPool) NextKey() string {
	kp.mu.RLock()
	defer kp.mu.RUnlock()
	if len(kp.keys) == 0 {
		return ""
	}
	idx := atomic.AddUint64(&kp.counter, 1) % uint64(len(kp.keys))
	return kp.keys[idx]
}

// Size returns the number of keys in the pool.
func (kp *KeyPool) Size() int {
	kp.mu.RLock()
	defer kp.mu.RUnlock()
	return len(kp.keys)
}

// KeyPoolManager holds key pools for all supported external providers.
type KeyPoolManager struct {
	pools map[string]*KeyPool
	mu    sync.RWMutex
}

// LoadKeyPoolsFromEnv parses provider key pools from environment variables.
// Crucially, full keys are kept strictly in memory and NEVER logged or exported to client JSON.
func LoadKeyPoolsFromEnv() *KeyPoolManager {
	mgr := &KeyPoolManager{
		pools: make(map[string]*KeyPool),
	}

	parseEnvList := func(envVar string) []string {
		val := os.Getenv(envVar)
		if val == "" {
			return nil
		}
		parts := strings.Split(val, ",")
		var res []string
		for _, p := range parts {
			trimmed := strings.TrimSpace(p)
			if trimmed != "" {
				res = append(res, trimmed)
			}
		}
		return res
	}

	// Load keys for Groq, Gemini, OpenRouter
	mgr.pools["groq"] = NewKeyPool("groq", parseEnvList("GROQ_KEYS"))
	mgr.pools["gemini"] = NewKeyPool("gemini", parseEnvList("GEMINI_KEYS"))
	mgr.pools["openrouter"] = NewKeyPool("openrouter", parseEnvList("OPENROUTER_KEYS"))

	return mgr
}

// GetKey returns the next round-robin key for a provider, or empty string if none configured.
func (m *KeyPoolManager) GetKey(providerName string) string {
	m.mu.RLock()
	pool, ok := m.pools[strings.ToLower(providerName)]
	m.mu.RUnlock()
	if !ok || pool == nil {
		return ""
	}
	return pool.NextKey()
}

// GetKeyPool returns the key pool for a provider, or nil if none configured.
func (m *KeyPoolManager) GetKeyPool(providerName string) *KeyPool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.pools[strings.ToLower(providerName)]
}

// ProviderStatus reports safe, redacted status of available providers.
type ProviderStatus struct {
	ProviderName string `json:"providerName"`
	ActiveKeys   int    `json:"activeKeys"`
	IsConfigured bool   `json:"isConfigured"`
}

// GetStatuses returns safe metadata about available key pools without disclosing keys.
func (m *KeyPoolManager) GetStatuses() []ProviderStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var statuses []ProviderStatus
	for name, pool := range m.pools {
		size := pool.Size()
		statuses = append(statuses, ProviderStatus{
			ProviderName: name,
			ActiveKeys:   size,
			IsConfigured: size > 0,
		})
	}
	return statuses
}
