package ai

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestChunkLines(t *testing.T) {
	start := time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC)
	var lines []meetingLine
	for m := 0; m <= 60; m++ {
		lines = append(lines, meetingLine{"T", start.Add(time.Duration(m) * time.Minute), "minute"})
	}
	chunks := chunkLines(lines)
	if len(chunks) != 7 {
		t.Fatalf("a 60-minute class should make 7 overlapping ten-minute chunks, got %d", len(chunks))
	}
	seen := map[time.Time]int{}
	for _, c := range chunks {
		if span := c[len(c)-1].SpokenAt.Sub(c[0].SpokenAt); span >= chunkWindow {
			t.Errorf("chunk spans %v", span)
		}
		for _, l := range c {
			seen[l.SpokenAt]++
		}
	}
	if len(seen) != len(lines) {
		t.Errorf("every line must appear in some chunk: %d of %d", len(seen), len(lines))
	}
	if seen[start.Add(9*time.Minute)] != 2 {
		t.Errorf("the overlap minute should appear in two chunks, got %d", seen[start.Add(9*time.Minute)])
	}
	if chunkLines(nil) != nil {
		t.Error("no lines, no chunks")
	}
}

// memStore is a CacheStore for tests.
type memStore struct {
	mu   sync.Mutex
	data map[string]CompletionResult
}

func (m *memStore) Get(_ context.Context, key string) (*CompletionResult, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.data[key]
	return &r, ok
}

func (m *memStore) Put(_ context.Context, key, _ string, r *CompletionResult) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data[key] = *r
}

func TestSummarizeLongLecture(t *testing.T) {
	reg := NewDefaultModelRegistry()
	router := NewRouter(reg, nil)
	mock := NewMockProvider("gemini")
	real := &realLike{mock}
	router.RegisterProvider(real)
	limiter := &keyedLimiter{counts: map[string]int{}}
	svc := NewService(router, reg, limiter, ServiceConfig{DefaultModel: ModelGeminiFlash, DefaultFastModel: ModelGeminiFlashLite, UserRPM: 2})
	store := &memStore{data: map[string]CompletionResult{}}
	svc.SetCacheStore(store)
	mock.SetResponse(`{"title":"Heaps","overview":"Part notes.","keyConcepts":["heap"],"takeaways":[],"actionItems":[],"topics":[{"title":"Sift","at":"12:30"}]}`)

	chunks := []string{"[00:10] T: one", "[09:30] T: two", "[18:40] T: three", "[27:50] T: four"}
	summary, usage, err := svc.SummarizeLongLecture(context.Background(), "org", "user", "DSA", chunks, "\nQuestions from the class Q&A list:\n- Q (open): why?")
	if err != nil {
		t.Fatal(err)
	}
	if mock.CallCount() != len(chunks)+1 {
		t.Errorf("want %d calls (parts and a merge), got %d", len(chunks)+1, mock.CallCount())
	}
	if limiter.counts["ai:rl:user:min:user"] != 1 {
		t.Errorf("a long lecture should count as one request, counted %d", limiter.counts["ai:rl:user:min:user"])
	}
	if summary.Topics[0].At != "12:30" || usage.TotalTokens == 0 {
		t.Errorf("summary %+v usage %+v", summary.Topics, usage)
	}
	if !strings.Contains(mock.LastCall().UserPrompt, "class_questions") {
		t.Error("the merge should include the class Q&A")
	}
	if len(store.data) != len(chunks)+1 {
		t.Errorf("each completion should be persisted: %d", len(store.data))
	}

	// A fresh service (as after a restart) answers the same request from the persistent store.
	again := NewService(router, reg, &keyedLimiter{counts: map[string]int{}}, ServiceConfig{DefaultModel: ModelGeminiFlash, DefaultFastModel: ModelGeminiFlashLite})
	again.SetCacheStore(store)
	before := mock.CallCount()
	if _, _, err := again.SummarizeLongLecture(context.Background(), "org", "user", "DSA", chunks, "\nQuestions from the class Q&A list:\n- Q (open): why?"); err != nil {
		t.Fatal(err)
	}
	if mock.CallCount() != before {
		t.Errorf("after a restart the persisted answers should be reused: %d new calls", mock.CallCount()-before)
	}
}
