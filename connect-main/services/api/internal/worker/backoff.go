package worker

import (
	"crypto/rand"
	"math/big"
	"time"
)

const (
	DefaultBaseRetryDelay = 2 * time.Second
	DefaultMaxRetryDelay  = 300 * time.Second // 5 minutes max
)

// CalculateBackoff computes exponential backoff with full jitter to avoid thundering herds.
// Formula: Delay = random(0, min(maxDelay, baseDelay * 2^(attempt-1)))
func CalculateBackoff(attempt int, baseDelay, maxDelay time.Duration) time.Duration {
	if baseDelay <= 0 {
		baseDelay = DefaultBaseRetryDelay
	}
	if maxDelay <= 0 {
		maxDelay = DefaultMaxRetryDelay
	}
	if attempt <= 1 {
		return baseDelay
	}

	// Calculate 2^(attempt-1) with overflow protection
	shift := attempt - 1
	if shift > 30 {
		shift = 30
	}
	multiplier := int64(1) << shift

	calculated := time.Duration(multiplier) * baseDelay
	if calculated > maxDelay || calculated <= 0 {
		calculated = maxDelay
	}

	// Full jitter: random duration between baseDelay and calculated
	diff := calculated - baseDelay
	if diff <= 0 {
		return baseDelay
	}

	n, err := rand.Int(rand.Reader, big.NewInt(int64(diff)))
	if err != nil {
		// Fallback to half calculated if crypto/rand fails
		return baseDelay + (diff / 2)
	}

	return baseDelay + time.Duration(n.Int64())
}
