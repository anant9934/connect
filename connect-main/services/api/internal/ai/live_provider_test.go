package ai

import (
	"context"
	"os"
	"testing"
	"time"
)

// TestLiveProviders calls the real provider APIs. It is skipped unless AI_LIVE_TEST=1 and the
// provider key variables are set, so CI and normal runs never spend quota or need secrets.
// Each model is exercised alone (no fallback) so a pass proves that specific model works.
func TestLiveProviders(t *testing.T) {
	if os.Getenv("AI_LIVE_TEST") != "1" {
		t.Skip("set AI_LIVE_TEST=1 with GEMINI_KEYS/GROQ_KEYS/OPENROUTER_KEYS to call real providers")
	}
	keys := LoadKeyPoolsFromEnv()
	models := []string{ModelGeminiFlash, ModelGeminiFlashLite, ModelGroqLarge, ModelGroqSmall, ModelOpenRouterFree}
	if only := os.Getenv("AI_LIVE_MODEL"); only != "" {
		models = []string{only}
	}
	const orgID = "00000000-0000-0000-0000-00000000live"
	transcript := "Today we covered binary search trees. Each node has at most two children; " +
		"left subtree keys are smaller, right subtree keys are larger. Search, insert and delete " +
		"run in O(h) time where h is the height. Balanced trees such as AVL keep h at O(log n)."

	for _, m := range models {
		m := m
		t.Run(m, func(t *testing.T) {
			reg := NewDefaultModelRegistry()
			router := BuildRouter(reg, keys, false)
			router.fallbackChain = map[string][]string{} // isolate this model
			svc := NewService(router, reg, nil, ServiceConfig{DefaultModel: m, DefaultFastModel: m})
			ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
			defer cancel()

			start := time.Now()
			sum, u, err := svc.SummarizeLecture(ctx, orgID, "live-user", "CS201", transcript)
			if err != nil {
				t.Fatalf("summary: %v", err)
			}
			t.Logf("summary ok in %s: provider=%s model=%s tokens=%d concepts=%d", time.Since(start).Round(time.Millisecond), u.Provider, u.Model, u.TotalTokens, len(sum.KeyConcepts))

			start = time.Now()
			quiz, u, err := svc.GeneratePracticeQuiz(ctx, orgID, "live-user", "Data Structures", "Binary search trees", 3)
			if err != nil {
				t.Fatalf("quiz: %v", err)
			}
			t.Logf("quiz ok in %s: provider=%s questions=%d", time.Since(start).Round(time.Millisecond), u.Provider, len(quiz.Questions))

			start = time.Now()
			deck, u, err := svc.GenerateFlashcards(ctx, orgID, "live-user", "BST basics", transcript)
			if err != nil {
				t.Fatalf("flashcards: %v", err)
			}
			t.Logf("flashcards ok in %s: provider=%s cards=%d", time.Since(start).Round(time.Millisecond), u.Provider, len(deck.Cards))
		})
	}
}
