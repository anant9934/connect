package ai

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/tathastu/connect/services/api/internal/ratelimit"
)

// ServiceConfig holds service-level operational limits and default model assignments.
type ServiceConfig struct {
	DefaultModel       string
	DefaultFastModel   string
	RateLimitRPM       int
	MonthlyBudgetMicro int64
}

// Service is the primary interface for AI capabilities across Connect.
type Service struct {
	router    *Router
	registry  *ModelRegistry
	sanitizer *Sanitizer
	validator *Validator
	limiter   ratelimit.Limiter
	cfg       ServiceConfig

	mu           sync.RWMutex
	orgSpendMap  map[string]int64 // orgID -> micro-USD spend this month
	orgBudgetMap map[string]int64 // orgID -> monthly spend limit in micro-USD
}

// NewService constructs a fully wired AI service.
func NewService(
	router *Router,
	registry *ModelRegistry,
	limiter ratelimit.Limiter,
	cfg ServiceConfig,
) *Service {
	if cfg.DefaultModel == "" {
		cfg.DefaultModel = "gemini-2.0-flash"
	}
	if cfg.DefaultFastModel == "" {
		cfg.DefaultFastModel = "gemini-1.5-flash"
	}
	if cfg.RateLimitRPM <= 0 {
		cfg.RateLimitRPM = 30 // Conservative default for free tier
	}

	return &Service{
		router:       router,
		registry:     registry,
		sanitizer:    NewSanitizer(),
		validator:    NewValidator(),
		limiter:      limiter,
		cfg:          cfg,
		orgSpendMap:  make(map[string]int64),
		orgBudgetMap: make(map[string]int64),
	}
}

// SetOrgBudget sets a custom monthly budget in micro-USD for an organization.
func (s *Service) SetOrgBudget(orgID string, limitMicroUSD int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.orgBudgetMap[orgID] = limitMicroUSD
}

// GetOrgSpend retrieves the total spend for an organization this month.
func (s *Service) GetOrgSpend(orgID string) (spend int64, budget int64) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	spend = s.orgSpendMap[orgID]
	budget = s.orgBudgetMap[orgID]
	if budget == 0 {
		budget = s.cfg.MonthlyBudgetMicro
	}
	return spend, budget
}

func (s *Service) checkLimits(ctx context.Context, orgID, userID string) error {
	// 1. Rate Limit Check
	if s.limiter != nil {
		key := fmt.Sprintf("ai:ratelimit:org:%s", orgID)
		allowed, err := s.limiter.Allow(ctx, key, s.cfg.RateLimitRPM, time.Minute)
		if err == nil && !allowed {
			return ErrRateLimitExceeded
		}
	}

	// 2. Spend Limit Check
	s.mu.RLock()
	spend := s.orgSpendMap[orgID]
	budget := s.orgBudgetMap[orgID]
	s.mu.RUnlock()

	if budget == 0 {
		budget = s.cfg.MonthlyBudgetMicro
	}

	if budget > 0 && spend >= budget {
		return ErrBudgetExceeded
	}

	return nil
}

func (s *Service) recordSpend(orgID string, costMicroUSD int64) {
	if costMicroUSD <= 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.orgSpendMap[orgID] += costMicroUSD
}

// SummarizeLecture generates a structured summary from an authoritative classroom transcript.
func (s *Service) SummarizeLecture(ctx context.Context, orgID, userID, courseCode, transcriptText string) (*LectureSummary, *Usage, error) {
	if err := s.checkLimits(ctx, orgID, userID); err != nil {
		return nil, nil, err
	}

	cleanTranscript, err := s.sanitizer.ValidateAndSanitize(transcriptText)
	if err != nil {
		return nil, nil, err
	}

	systemPrompt := `You are an expert academic lecture assistant. Analyze the provided lecture transcript and return a structured JSON summary matching this schema:
{
  "title": "Concise Lecture Topic Title",
  "overview": "2-3 paragraph academic overview",
  "keyConcepts": ["Concept 1", "Concept 2"],
  "takeaways": ["Takeaway 1", "Takeaway 2"],
  "actionItems": ["Homework or revision item 1"]
}
Return only valid JSON.`

	userPrompt := fmt.Sprintf("Course: %s\nTranscript:\n%s", courseCode, s.sanitizer.WrapUserContent("lecture_transcript", cleanTranscript))

	req := CompletionRequest{
		Model:          s.cfg.DefaultFastModel,
		SystemPrompt:   systemPrompt,
		UserPrompt:     userPrompt,
		Temperature:    0.2,
		MaxTokens:      2048,
		ResponseFormat: "json",
	}

	res, err := s.router.Complete(ctx, req)
	if err != nil {
		return nil, nil, err
	}

	s.recordSpend(orgID, res.Usage.CostMicroUSD)

	summary, err := s.validator.ValidateLectureSummary(res.Content)
	if err != nil {
		return nil, &res.Usage, err
	}

	return summary, &res.Usage, nil
}

// GeneratePracticeQuiz creates multiple-choice revision questions for students.
func (s *Service) GeneratePracticeQuiz(ctx context.Context, orgID, userID, courseTitle, topic string, count int) (*PracticeQuiz, *Usage, error) {
	if err := s.checkLimits(ctx, orgID, userID); err != nil {
		return nil, nil, err
	}

	cleanTopic, err := s.sanitizer.ValidateAndSanitize(topic)
	if err != nil {
		return nil, nil, err
	}

	if count <= 0 || count > 20 {
		count = 5
	}

	systemPrompt := `You are an educational assessment assistant. Generate multiple-choice practice questions strictly in JSON matching this schema:
{
  "courseTitle": "Course Title",
  "topic": "Topic Name",
  "questions": [
    {
      "question": "Question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "explanation": "Why Option A is correct",
      "difficulty": "medium",
      "conceptTag": "Specific Concept"
    }
  ]
}
Return only valid JSON.`

	userPrompt := fmt.Sprintf("Course: %s\nTopic: %s\nTarget Question Count: %d", courseTitle, cleanTopic, count)

	req := CompletionRequest{
		Model:          s.cfg.DefaultModel,
		SystemPrompt:   systemPrompt,
		UserPrompt:     userPrompt,
		Temperature:    0.3,
		MaxTokens:      4096,
		ResponseFormat: "json",
	}

	res, err := s.router.Complete(ctx, req)
	if err != nil {
		return nil, nil, err
	}

	s.recordSpend(orgID, res.Usage.CostMicroUSD)

	quiz, err := s.validator.ValidatePracticeQuiz(res.Content)
	if err != nil {
		return nil, &res.Usage, err
	}

	return quiz, &res.Usage, nil
}

// GenerateFlashcards creates a revision deck for a study topic.
func (s *Service) GenerateFlashcards(ctx context.Context, orgID, userID, deckTitle, notesText string) (*FlashcardSet, *Usage, error) {
	if err := s.checkLimits(ctx, orgID, userID); err != nil {
		return nil, nil, err
	}

	cleanNotes, err := s.sanitizer.ValidateAndSanitize(notesText)
	if err != nil {
		return nil, nil, err
	}

	systemPrompt := `You are an academic study assistant. Create interactive flashcards from the provided notes strictly in JSON matching this schema:
{
  "deckTitle": "Deck Title",
  "cards": [
    {
      "front": "Term, formula or question",
      "back": "Definition, explanation or answer",
      "concept": "Specific concept tag"
    }
  ]
}
Return only valid JSON.`

	userPrompt := fmt.Sprintf("Deck Title: %s\nSource Material:\n%s", deckTitle, s.sanitizer.WrapUserContent("study_notes", cleanNotes))

	req := CompletionRequest{
		Model:          s.cfg.DefaultFastModel,
		SystemPrompt:   systemPrompt,
		UserPrompt:     userPrompt,
		Temperature:    0.3,
		MaxTokens:      2048,
		ResponseFormat: "json",
	}

	res, err := s.router.Complete(ctx, req)
	if err != nil {
		return nil, nil, err
	}

	s.recordSpend(orgID, res.Usage.CostMicroUSD)

	cards, err := s.validator.ValidateFlashcards(res.Content)
	if err != nil {
		return nil, &res.Usage, err
	}

	return cards, &res.Usage, nil
}
