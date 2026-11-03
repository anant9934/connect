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
	router       *Router
	registry     *ModelRegistry
	sanitizer    *Sanitizer
	validator    *Validator
	limiter      ratelimit.Limiter
	cfg          ServiceConfig
	policyEngine *PolicyEngine

	mu sync.RWMutex
}

// NewService constructs a fully wired AI service.
func NewService(
	router *Router,
	registry *ModelRegistry,
	limiter ratelimit.Limiter,
	cfg ServiceConfig,
) *Service {
	if cfg.DefaultModel == "" {
		cfg.DefaultModel = ModelGeminiFlash
	}
	if cfg.DefaultFastModel == "" {
		cfg.DefaultFastModel = ModelGeminiFlashLite
	}
	if cfg.RateLimitRPM <= 0 {
		cfg.RateLimitRPM = 30 // Conservative default for free tier
	}

	pe := NewPolicyEngine(registry)

	return &Service{
		router:       router,
		registry:     registry,
		sanitizer:    NewSanitizer(),
		validator:    NewValidator(),
		limiter:      limiter,
		cfg:          cfg,
		policyEngine: pe,
	}
}

// PolicyEngine returns the policy engine for org budget and permission management.
func (s *Service) PolicyEngine() *PolicyEngine {
	return s.policyEngine
}

// SetOrgBudget sets a custom monthly budget in micro-USD for an organization under capped mode.
func (s *Service) SetOrgBudget(orgID string, limitMicroUSD int64) {
	if limitMicroUSD > 0 {
		_ = s.policyEngine.SetPolicy(&OrgPolicy{
			OrganizationID:        orgID,
			BudgetMode:            BudgetModeCapped,
			MonthlyBudgetMicroUSD: limitMicroUSD,
			AllowedModels:         append([]string(nil), DefaultAllowedModels...),
			BillingCycleAnchor:    time.Now().UTC().Truncate(24 * time.Hour),
		})
	} else {
		_ = s.policyEngine.SetPolicy(NewDefaultOrgPolicy(orgID))
	}
}

// GetOrgSpend retrieves the total spend for an organization this month.
func (s *Service) GetOrgSpend(orgID string) (spend int64, budget int64) {
	policy := s.policyEngine.GetPolicy(orgID)
	return policy.CurrentSpendMicroUSD, policy.MonthlyBudgetMicroUSD
}

func (s *Service) checkLimits(ctx context.Context, orgID, userID, model string, estimatedTokens int) (int64, error) {
	// 1. Rate Limit Check
	if s.limiter != nil {
		key := fmt.Sprintf("ai:ratelimit:org:%s", orgID)
		allowed, err := s.limiter.Allow(ctx, key, s.cfg.RateLimitRPM, time.Minute)
		if err == nil && !allowed {
			return 0, ErrRateLimitExceeded
		}
	}

	// 2. Policy check and atomic budget reservation via PolicyEngine
	return s.policyEngine.AuthorizeRequest(ctx, orgID, model, estimatedTokens)
}

// complete enforces limits, reserves budget, calls the router and settles the reservation
// against the amount actually billed. The reservation is released if the call fails.
func (s *Service) complete(ctx context.Context, orgID, userID string, req CompletionRequest) (*CompletionResult, error) {
	reserved, err := s.checkLimits(ctx, orgID, userID, req.Model, req.MaxTokens)
	if err != nil {
		return nil, err
	}

	res, err := s.router.Complete(ctx, req)
	if err != nil {
		s.policyEngine.SettleSpend(orgID, reserved, 0)
		return nil, err
	}

	res.Usage.EstimatedCostMicroUSD = res.Usage.CostMicroUSD
	res.Usage.IsMock = res.IsMock
	res.Usage.BilledCostMicroUSD = res.Usage.CostMicroUSD
	if info, ok := s.registry.Get(res.Model); ok && info.IsFreeTierEligible {
		res.Usage.BilledCostMicroUSD = 0
	}
	s.policyEngine.SettleSpend(orgID, reserved, res.Usage.BilledCostMicroUSD)
	return res, nil
}

// SummarizeLecture generates a structured summary from an authoritative classroom transcript.
func (s *Service) SummarizeLecture(ctx context.Context, orgID, userID, courseCode, transcriptText string) (*LectureSummary, *Usage, error) {
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

	res, err := s.complete(ctx, orgID, userID, req)
	if err != nil {
		return nil, nil, err
	}

	summary, err := s.validator.ValidateLectureSummary(res.Content)
	if err != nil {
		return nil, &res.Usage, err
	}

	return summary, &res.Usage, nil
}

// GeneratePracticeQuiz creates multiple-choice revision questions for students.
func (s *Service) GeneratePracticeQuiz(ctx context.Context, orgID, userID, courseTitle, topic string, count int) (*PracticeQuiz, *Usage, error) {
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

	res, err := s.complete(ctx, orgID, userID, req)
	if err != nil {
		return nil, nil, err
	}

	quiz, err := s.validator.ValidatePracticeQuiz(res.Content)
	if err != nil {
		return nil, &res.Usage, err
	}

	return quiz, &res.Usage, nil
}

// GenerateFlashcards creates a revision deck for a study topic.
func (s *Service) GenerateFlashcards(ctx context.Context, orgID, userID, deckTitle, notesText string) (*FlashcardSet, *Usage, error) {
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

	res, err := s.complete(ctx, orgID, userID, req)
	if err != nil {
		return nil, nil, err
	}

	cards, err := s.validator.ValidateFlashcards(res.Content)
	if err != nil {
		return nil, &res.Usage, err
	}

	return cards, &res.Usage, nil
}
