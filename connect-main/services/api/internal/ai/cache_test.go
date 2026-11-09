package ai

import (
	"context"
	"testing"
	"time"
)

func TestResponseCache(t *testing.T) {
	c := NewResponseCache(2, time.Hour)
	now := time.Now()
	c.now = func() time.Time { return now }
	req := CompletionRequest{Model: "m", UserPrompt: "a"}
	if cacheKey("org1", req) == cacheKey("org2", req) {
		t.Fatal("keys must differ by organization")
	}
	other := req
	other.Temperature = 0.5
	if cacheKey("org1", req) == cacheKey("org1", other) {
		t.Fatal("keys must differ by settings")
	}
	c.Put("k1", &CompletionResult{Content: "one"})
	c.Put("k2", &CompletionResult{Content: "two"})
	c.Get("k1") // k1 is now the most recent
	c.Put("k3", &CompletionResult{Content: "three"})
	if _, ok := c.Get("k2"); ok {
		t.Error("least recently used entry should be evicted")
	}
	if got, ok := c.Get("k1"); !ok || got.Content != "one" {
		t.Error("recent entry lost")
	}
	c.Put("mock", &CompletionResult{Content: "x", IsMock: true})
	if _, ok := c.Get("mock"); ok {
		t.Error("mock output must not be cached")
	}
	now = now.Add(2 * time.Hour)
	if _, ok := c.Get("k1"); ok {
		t.Error("expired entry returned")
	}
}

func TestServiceCachesIdenticalRequests(t *testing.T) {
	reg := NewDefaultModelRegistry()
	router := NewRouter(reg, nil)
	provider := NewMockProvider("gemini")
	router.RegisterProvider(provider)
	svc := NewService(router, reg, nil, ServiceConfig{DefaultModel: ModelGeminiFlash, DefaultFastModel: ModelGeminiFlashLite})
	provider.SetResponse(`{"title":"Stacks","slides":[{"layout":"title","title":"Stacks"}]}`)
	// The mock marks its output as mock, which is never cached; pretend it is a real provider.
	real := &realLike{provider}
	router.RegisterProvider(real)
	ctx := context.Background()
	if _, _, err := svc.GenerateLiveSlides(ctx, "org", "user", "Explain stacks", ""); err != nil {
		t.Fatal(err)
	}
	calls := provider.CallCount()
	_, _, err := svc.GenerateLiveSlides(ctx, "org", "user", "Explain stacks", "")
	if err != nil || provider.CallCount() != calls {
		t.Errorf("second identical request should be served from cache: calls %d -> %d, %v", calls, provider.CallCount(), err)
	}
	if _, _, err := svc.GenerateLiveSlides(ctx, "other-org", "user", "Explain stacks", ""); err != nil || provider.CallCount() != calls+1 {
		t.Errorf("another organization must not share the cache: calls %d", provider.CallCount())
	}
}

// realLike wraps the mock but reports its output as real, as a live provider would.
type realLike struct{ *MockProvider }

func (r *realLike) Complete(ctx context.Context, req CompletionRequest) (*CompletionResult, error) {
	res, err := r.MockProvider.Complete(ctx, req)
	if res != nil {
		res.IsMock = false
	}
	return res, err
}
