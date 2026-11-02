package ai

import (
	"encoding/json"
	"fmt"
	"strings"
)

// LectureSummary represents structured classroom intelligence extracted from transcripts/notes.
type LectureSummary struct {
	Title        string   `json:"title"`
	Overview     string   `json:"overview"`
	KeyConcepts  []string `json:"keyConcepts"`
	Takeaways    []string `json:"takeaways"`
	ActionItems  []string `json:"actionItems"`
}

// QuizQuestion represents a structured practice or assessment question.
type QuizQuestion struct {
	Question      string   `json:"question"`
	Options       []string `json:"options"`
	CorrectIndex  int      `json:"correctIndex"`
	Explanation   string   `json:"explanation"`
	Difficulty    string   `json:"difficulty"` // "easy", "medium", "hard"
	ConceptTag    string   `json:"conceptTag"`
}

// PracticeQuiz holds a collection of generated quiz questions.
type PracticeQuiz struct {
	CourseTitle string         `json:"courseTitle"`
	Topic       string         `json:"topic"`
	Questions   []QuizQuestion `json:"questions"`
}

// Flashcard represents a study card.
type Flashcard struct {
	Front   string `json:"front"`
	Back    string `json:"back"`
	Concept string `json:"concept"`
}

// FlashcardSet holds a deck of study flashcards.
type FlashcardSet struct {
	DeckTitle string      `json:"deckTitle"`
	Cards     []Flashcard `json:"cards"`
}

// StudyPlan represents personalized revision guidance for a student.
type StudyPlan struct {
	StudentFocus     string   `json:"studentFocus"`
	IdentifiedGaps   []string `json:"identifiedGaps"`
	ActionSteps      []string `json:"actionSteps"`
	RecommendedHours int      `json:"recommendedHours"`
}

// Validator validates raw LLM output against target structured schemas.
type Validator struct{}

// NewValidator creates a Validator instance.
func NewValidator() *Validator {
	return &Validator{}
}

// ValidateLectureSummary parses and validates a lecture summary.
func (v *Validator) ValidateLectureSummary(raw string) (*LectureSummary, error) {
	clean := extractJSON(raw)
	var s LectureSummary
	if err := json.Unmarshal([]byte(clean), &s); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidStructuredOutput, err)
	}
	if s.Title == "" || s.Overview == "" {
		return nil, fmt.Errorf("%w: summary missing title or overview", ErrInvalidStructuredOutput)
	}
	return &s, nil
}

// ValidatePracticeQuiz parses and validates a quiz response.
func (v *Validator) ValidatePracticeQuiz(raw string) (*PracticeQuiz, error) {
	clean := extractJSON(raw)
	var q PracticeQuiz
	if err := json.Unmarshal([]byte(clean), &q); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidStructuredOutput, err)
	}
	if len(q.Questions) == 0 {
		return nil, fmt.Errorf("%w: quiz must contain at least 1 question", ErrInvalidStructuredOutput)
	}
	for i, qn := range q.Questions {
		if qn.Question == "" || len(qn.Options) < 2 {
			return nil, fmt.Errorf("%w: question %d has insufficient options", ErrInvalidStructuredOutput, i+1)
		}
		if qn.CorrectIndex < 0 || qn.CorrectIndex >= len(qn.Options) {
			return nil, fmt.Errorf("%w: question %d has out-of-range correct index", ErrInvalidStructuredOutput, i+1)
		}
	}
	return &q, nil
}

// ValidateFlashcards parses and validates a flashcard deck.
func (v *Validator) ValidateFlashcards(raw string) (*FlashcardSet, error) {
	clean := extractJSON(raw)
	var f FlashcardSet
	if err := json.Unmarshal([]byte(clean), &f); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidStructuredOutput, err)
	}
	if len(f.Cards) == 0 {
		return nil, fmt.Errorf("%w: flashcard set must contain at least 1 card", ErrInvalidStructuredOutput)
	}
	for i, c := range f.Cards {
		if c.Front == "" || c.Back == "" {
			return nil, fmt.Errorf("%w: card %d missing front or back", ErrInvalidStructuredOutput, i+1)
		}
	}
	return &f, nil
}

// extractJSON extracts a JSON object or array from markdown code fences if present.
func extractJSON(raw string) string {
	s := strings.TrimSpace(raw)
	if strings.HasPrefix(s, "```json") {
		s = strings.TrimPrefix(s, "```json")
		if idx := strings.LastIndex(s, "```"); idx != -1 {
			s = s[:idx]
		}
	} else if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```")
		if idx := strings.LastIndex(s, "```"); idx != -1 {
			s = s[:idx]
		}
	}
	return strings.TrimSpace(s)
}
