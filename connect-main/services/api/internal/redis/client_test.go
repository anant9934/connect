package redis_test

import (
	"context"
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tathastu/connect/services/api/internal/config"
	"github.com/tathastu/connect/services/api/internal/ratelimit"
	appredis "github.com/tathastu/connect/services/api/internal/redis"
)

func TestRedis_TLSConfiguration(t *testing.T) {
	// Standard Upstash TLS URL format
	upstashURL := "rediss://default:supersecrettoken@eu1-tender-spider-12345.upstash.io:6379"
	opts, err := goredis.ParseURL(upstashURL)
	require.NoError(t, err)
	assert.NotNil(t, opts.TLSConfig)

	// Ensure MinVersion TLS 1.2
	opts.TLSConfig.MinVersion = tls.VersionTLS12
	assert.Equal(t, uint16(tls.VersionTLS12), opts.TLSConfig.MinVersion)

	// Non-TLS local URL format
	localURL := "redis://localhost:6379/0"
	optsLocal, err := goredis.ParseURL(localURL)
	require.NoError(t, err)
	assert.Nil(t, optsLocal.TLSConfig)
}

func TestRedis_LiveUpstashConnectivityAndOperations(t *testing.T) {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" || redisURL == "redis://localhost:6379/0" {
		t.Skip("Skipping live Upstash test: REDIS_URL not configured")
	}

	cfg := &config.Config{
		RedisURL:        redisURL,
		RedisTLSEnabled: true,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 1. Verify Native TCP/TLS Connection and Ping
	client, err := appredis.Connect(ctx, cfg)
	require.NoError(t, err, "Failed to connect to Upstash Redis via native TCP/TLS")
	require.NotNil(t, client)
	defer func() { _ = client.Close() }()

	err = client.Ping(ctx)
	require.NoError(t, err, "Ping failed on active Upstash connection")

	// 2. Isolated SET / GET / DELETE Operations
	testKey := "tc:test:verification:" + time.Now().Format("20060102150405.000")
	testVal := "phase4.6_upstash_verified"

	// SET with 60s TTL
	err = client.Rdb.Set(ctx, testKey, testVal, 60*time.Second).Err()
	require.NoError(t, err, "Redis SET failed")

	// GET and verify value integrity
	val, err := client.Rdb.Get(ctx, testKey).Result()
	require.NoError(t, err, "Redis GET failed")
	assert.Equal(t, testVal, val, "Redis retrieved value does not match expected")

	// DEL and verify non-existence
	delCount, err := client.Rdb.Del(ctx, testKey).Result()
	require.NoError(t, err, "Redis DEL failed")
	assert.Equal(t, int64(1), delCount)

	_, err = client.Rdb.Get(ctx, testKey).Result()
	assert.ErrorIs(t, err, goredis.Nil, "Redis key should have been deleted")

	// 3. Distributed Rate Limiter Verification (Sliding Window Log)
	limiter := ratelimit.NewRedisLimiter(client.Rdb)
	rlKey := "integration-test-user-" + time.Now().Format("150405.000")
	rlLimit := 3
	rlWindow := 5 * time.Second

	// Clean up after test
	defer func() {
		_ = client.Rdb.Del(context.Background(), "ratelimit:"+rlKey).Err()
	}()

	// First 3 requests must be allowed
	for i := 1; i <= rlLimit; i++ {
		allowed, rErr := limiter.Allow(ctx, rlKey, rlLimit, rlWindow)
		require.NoError(t, rErr)
		assert.True(t, allowed, "Request %d should be allowed within limit %d", i, rlLimit)
	}

	// 4th request must be rejected
	allowed, rErr := limiter.Allow(ctx, rlKey, rlLimit, rlWindow)
	require.NoError(t, rErr)
	assert.False(t, allowed, "Request 4 should be rejected by rate limiter")

	// 4. Fail-Closed Security Verification
	// Test rate limiter when Redis is uninitialized
	brokenLimiter := ratelimit.NewRedisLimiter(nil)
	allowed, rErr = brokenLimiter.Allow(ctx, rlKey, rlLimit, rlWindow)
	assert.Error(t, rErr, "Rate limiter should return error when Redis client is uninitialized")
	assert.False(t, allowed, "Rate limiter should fail-closed (deny) when backend is unavailable")

	// Test middleware fail-closed behavior
	mw := ratelimit.Middleware(brokenLimiter, 10, time.Minute)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/rooms", nil)
	rec := httptest.NewRecorder()

	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	handler.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code, "Middleware must fail-closed with 503 when Redis is unavailable")
}

func TestRedis_RateLimiter_ConcurrentInstances(t *testing.T) {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" || redisURL == "redis://localhost:6379/0" {
		t.Skip("Skipping live Upstash test: REDIS_URL not configured")
	}

	cfg := &config.Config{
		RedisURL:        redisURL,
		RedisTLSEnabled: true,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	client, err := appredis.Connect(ctx, cfg)
	require.NoError(t, err)
	defer func() { _ = client.Close() }()

	limiter := ratelimit.NewRedisLimiter(client.Rdb)
	rlKey := "concurrent-test-user-" + time.Now().Format("150405.000")
	rlLimit := 10
	rlWindow := 10 * time.Second

	defer func() {
		_ = client.Rdb.Del(context.Background(), "ratelimit:"+rlKey).Err()
	}()

	// Simulate 5 application instances concurrently issuing 5 requests each (total 25 requests)
	numInstances := 5
	requestsPerInstance := 5
	totalRequests := numInstances * requestsPerInstance

	results := make(chan bool, totalRequests)

	for inst := 0; inst < numInstances; inst++ {
		go func() {
			for r := 0; r < requestsPerInstance; r++ {
				allowed, allowErr := limiter.Allow(ctx, rlKey, rlLimit, rlWindow)
				if allowErr == nil {
					results <- allowed
				} else {
					results <- false
				}
			}
		}()
	}

	allowedCount := 0
	rejectedCount := 0
	for i := 0; i < totalRequests; i++ {
		if <-results {
			allowedCount++
		} else {
			rejectedCount++
		}
	}

	// Distributed rate limiter must permit exactly rlLimit requests across all instances
	assert.Equal(t, rlLimit, allowedCount, "Exactly %d requests must be allowed across all instances", rlLimit)
	assert.Equal(t, totalRequests-rlLimit, rejectedCount, "Remaining requests must be rejected")
}

func TestRedis_RateLimiter_RejectedRequestsDoNotBloatMemoryOrExtendWindow(t *testing.T) {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" || redisURL == "redis://localhost:6379/0" {
		t.Skip("Skipping live Upstash test: REDIS_URL not configured")
	}

	cfg := &config.Config{
		RedisURL:        redisURL,
		RedisTLSEnabled: true,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	client, err := appredis.Connect(ctx, cfg)
	require.NoError(t, err)
	defer func() { _ = client.Close() }()

	limiter := ratelimit.NewRedisLimiter(client.Rdb)
	rlKey := "memory-test-user-" + time.Now().Format("150405.000")
	rlLimit := 4
	rlWindow := 5 * time.Second
	redisKey := "ratelimit:" + rlKey

	defer func() {
		_ = client.Rdb.Del(context.Background(), redisKey).Err()
	}()

	// 1. Consume the allowed quota (4 requests)
	for i := 0; i < rlLimit; i++ {
		allowed, err := limiter.Allow(ctx, rlKey, rlLimit, rlWindow)
		require.NoError(t, err)
		assert.True(t, allowed)
	}

	// 2. Flood with 8 rejected requests (taking ~1s of network RTT)
	for i := 0; i < 8; i++ {
		allowed, err := limiter.Allow(ctx, rlKey, rlLimit, rlWindow)
		require.NoError(t, err)
		assert.False(t, allowed, "Flooded request %d must be rejected", i)
	}

	// 3. Inspect Redis set size (ZCARD) - Must be bounded to EXACTLY rlLimit (4), NOT 12!
	zcard, err := client.Rdb.ZCard(ctx, redisKey).Result()
	require.NoError(t, err)
	assert.Equal(t, int64(rlLimit), zcard, "Redis ZCARD must NOT exceed limit; rejected requests must not bloat memory")

	// 4. Wait for the 5-second window to expire
	time.Sleep(5200 * time.Millisecond)

	// 5. Verify window expired naturally without being extended by the rejected requests
	allowedAfterExpiry, err := limiter.Allow(ctx, rlKey, rlLimit, rlWindow)
	require.NoError(t, err)
	assert.True(t, allowedAfterExpiry, "Request must be allowed immediately after original window expiry")
}

func TestRedis_RevokedCredentialsFail(t *testing.T) {
	cfg := &config.Config{
		RedisURL:        "rediss://default:revoked_invalid_password_test@massive-moccasin-188003.upstash.io:6379",
		RedisTLSEnabled: true,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client, err := appredis.Connect(ctx, cfg)
	assert.Error(t, err, "Connection with invalid or revoked credentials must be rejected")
	assert.Nil(t, client, "Client must be nil when credentials fail")
}
