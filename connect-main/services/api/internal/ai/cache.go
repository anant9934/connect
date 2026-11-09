package ai

import (
	"container/list"
	"context"
	"errors"
	"log/slog"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ResponseCache returns a stored completion for a request seen before, so repeating a request
// costs no provider tokens or quota. Keys include the organization, so nothing crosses tenants.
type ResponseCache struct {
	mu      sync.Mutex
	ttl     time.Duration
	max     int
	order   *list.List
	entries map[string]*list.Element
	now     func() time.Time
}

type cacheEntry struct {
	key     string
	result  CompletionResult
	expires time.Time
}

// NewResponseCache keeps up to max completions for ttl each, evicting the least recently used.
func NewResponseCache(max int, ttl time.Duration) *ResponseCache {
	return &ResponseCache{ttl: ttl, max: max, order: list.New(), entries: map[string]*list.Element{}, now: time.Now}
}

// cacheKey is the SHA-256 of the organization and everything that shapes the output.
func cacheKey(orgID string, req CompletionRequest) string {
	raw, _ := json.Marshal(struct {
		Org         string
		Model       string
		System      string
		User        string
		Temperature float32
		MaxTokens   int
		Format      string
		Stop        []string
	}{orgID, req.Model, req.SystemPrompt, req.UserPrompt, req.Temperature, req.MaxTokens, req.ResponseFormat, req.StopSequences})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// Get returns a copy of a fresh entry.
func (c *ResponseCache) Get(key string) (*CompletionResult, bool) {
	if c == nil {
		return nil, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.entries[key]
	if !ok {
		return nil, false
	}
	entry := el.Value.(*cacheEntry)
	if c.now().After(entry.expires) {
		c.order.Remove(el)
		delete(c.entries, key)
		return nil, false
	}
	c.order.MoveToFront(el)
	result := entry.result
	return &result, true
}

// Put stores a completion. Mock output is never stored.
func (c *ResponseCache) Put(key string, result *CompletionResult) {
	if c == nil || result == nil || result.IsMock || result.Content == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.entries[key]; ok {
		el.Value.(*cacheEntry).result = *result
		el.Value.(*cacheEntry).expires = c.now().Add(c.ttl)
		c.order.MoveToFront(el)
		return
	}
	c.entries[key] = c.order.PushFront(&cacheEntry{key: key, result: *result, expires: c.now().Add(c.ttl)})
	for c.order.Len() > c.max {
		oldest := c.order.Back()
		c.order.Remove(oldest)
		delete(c.entries, oldest.Value.(*cacheEntry).key)
	}
}

// Len reports how many completions are stored.
func (c *ResponseCache) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.order.Len()
}

// CacheStore persists completions across restarts, behind the in-memory cache.
type CacheStore interface {
	Get(ctx context.Context, key string) (*CompletionResult, bool)
	Put(ctx context.Context, key, budgetKey string, result *CompletionResult)
}

// PgCacheStore keeps completions in ai_response_cache through security-definer functions.
// Failures only cost a cache miss; they never fail the request.
type PgCacheStore struct {
	pool *pgxpool.Pool
	ttl  time.Duration
}

// NewPgCacheStore stores completions for a week.
func NewPgCacheStore(pool *pgxpool.Pool) *PgCacheStore {
	return &PgCacheStore{pool: pool, ttl: 7 * 24 * time.Hour}
}

func (s *PgCacheStore) Get(ctx context.Context, key string) (*CompletionResult, bool) {
	if s == nil || s.pool == nil {
		return nil, false
	}
	var res CompletionResult
	err := s.pool.QueryRow(ctx, `SELECT content, model, provider FROM connect_auth.ai_cache_get($1)`, key).Scan(&res.Content, &res.Model, &res.Provider)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.Warn("ai_cache_read_failed", slog.String("error", err.Error()))
		}
		return nil, false
	}
	return &res, true
}

func (s *PgCacheStore) Put(ctx context.Context, key, budgetKey string, result *CompletionResult) {
	if s == nil || s.pool == nil || result == nil || result.IsMock || result.Content == "" {
		return
	}
	if _, err := s.pool.Exec(ctx, `SELECT connect_auth.ai_cache_put($1, $2, $3, $4, $5, $6)`,
		key, budgetKey, result.Model, result.Provider, result.Content, int(s.ttl.Seconds())); err != nil {
		slog.Warn("ai_cache_write_failed", slog.String("error", err.Error()))
	}
}
