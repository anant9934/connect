package ratelimit

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/tathastu/connect/services/api/internal/model"
)

// Limiter defines the boundary for rate limiting strategies.
type Limiter interface {
	Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, error)
}

// RedisLimiter implements distributed sliding-window rate limiting via Redis.
type RedisLimiter struct {
	client *redis.Client
}

// NewRedisLimiter constructs a production Redis-backed rate limiter.
func NewRedisLimiter(client *redis.Client) *RedisLimiter {
	return &RedisLimiter{client: client}
}

var memberSeq uint64

var slidingWindowScript = redis.NewScript(`
local key = KEYS[1]
local window_micro = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local ttl_ms = tonumber(ARGV[3])
local nonce = ARGV[4]

-- Server-side time eliminates clock skew across multiple application instances
local server_time = redis.call('TIME')
local now_micro = tonumber(server_time[1]) * 1000000 + tonumber(server_time[2])
local clear_before = now_micro - window_micro
local member = tostring(now_micro) .. ":" .. nonce

redis.call('ZREMRANGEBYSCORE', key, 0, clear_before)
local count = redis.call('ZCARD', key)

if count < limit then
    redis.call('ZADD', key, now_micro, member)
    redis.call('PEXPIRE', key, ttl_ms)
    return 1
else
    return 0
end
`)

// Allow executes an atomic Redis sliding window check without querying PostgreSQL.
// It uses Redis server time to eliminate clock skew and guarantees that rejected requests
// do not unfairly extend the sliding window or bloat memory.
func (r *RedisLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	if r.client == nil {
		return false, errors.New("redis client not initialized")
	}

	windowMicro := window.Microseconds()
	ttlMs := window.Milliseconds()
	if ttlMs <= 0 {
		ttlMs = 1000
	}
	seq := atomic.AddUint64(&memberSeq, 1)
	nonce := fmt.Sprintf("%d", seq)
	redisKey := fmt.Sprintf("ratelimit:%s", key)

	res, err := slidingWindowScript.Run(ctx, r.client, []string{redisKey}, windowMicro, limit, ttlMs, nonce).Int()
	if err != nil {
		return false, fmt.Errorf("redis rate limit script failed: %w", err)
	}

	return res == 1, nil
}

// DevMemoryLimiter provides an in-memory token counter STRICTLY for local development.
// It is explicitly forbidden from silent execution in production environments.
type DevMemoryLimiter struct {
	mu      sync.Mutex
	buckets map[string][]int64
}

// NewDevMemoryLimiter initializes an in-memory limiter.
// Panics if called in a production environment to prevent insecure defaults.
func NewDevMemoryLimiter(appEnv string) (*DevMemoryLimiter, error) {
	if appEnv == "production" {
		return nil, errors.New("CRITICAL SECURITY ERROR: DevMemoryLimiter cannot be used in production mode; Redis is mandatory")
	}
	return &DevMemoryLimiter{
		buckets: make(map[string][]int64),
	}, nil
}

func (m *DevMemoryLimiter) Allow(_ context.Context, key string, limit int, window time.Duration) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UnixNano()
	cutoff := now - window.Nanoseconds()

	timestamps := m.buckets[key]
	var valid []int64
	for _, ts := range timestamps {
		if ts > cutoff {
			valid = append(valid, ts)
		}
	}

	if len(valid) >= limit {
		m.buckets[key] = valid
		return false, nil
	}

	valid = append(valid, now)
	m.buckets[key] = valid
	return true, nil
}

// Middleware creates an HTTP middleware that evaluates client rate limits.
func Middleware(limiter Limiter, limit int, window time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			clientIP := extractClientIP(r)
			allowed, err := limiter.Allow(r.Context(), clientIP, limit, window)
			if err != nil {
				// Fail closed on distributed rate limiting backend failure
				model.SendJSONError(w, r, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Rate limiter service temporarily unavailable")
				return
			}

			if !allowed {
				w.Header().Set("Retry-After", "5")
				model.SendJSONError(w, r, http.StatusTooManyRequests, "TOO_MANY_REQUESTS", "Rate limit exceeded. Please retry later.")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func extractClientIP(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}
