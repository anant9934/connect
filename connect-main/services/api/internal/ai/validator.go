package ai

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// LectureSummary represents structured classroom intelligence extracted from transcripts/notes.
type LectureSummary struct {
	Title       string   `json:"title"`
	Overview    string   `json:"overview"`
	KeyConcepts []string `json:"keyConcepts"`
	Takeaways   []string `json:"takeaways"`
	ActionItems []string `json:"actionItems"`
	// Topics in the order taught; At is MM:SS into the recording when the transcript has times.
	Topics      []SummaryTopic `json:"topics,omitempty"`
	Definitions []Definition   `json:"definitions,omitempty"`
	// RevisionNotes is a short pre-exam cheat sheet.
	RevisionNotes []string `json:"revisionNotes,omitempty"`
	// Questions students asked, with the teacher's answer when there was one.
	Questions  []ExtractedQuestion `json:"questions,omitempty"`
	Unresolved []string            `json:"unresolved,omitempty"`
	// Source is set by the server, never by the model.
	Source *SummarySource `json:"source,omitempty"`
}

// SummaryTopic is one part of the lecture.
type SummaryTopic struct {
	Title  string   `json:"title"`
	At     string   `json:"at,omitempty"`
	Points []string `json:"points,omitempty"`
}

// Definition is a term the lecture defined.
type Definition struct {
	Term    string `json:"term"`
	Meaning string `json:"meaning"`
}

// ExtractedQuestion is a student question found in the transcript or the doubt queue.
type ExtractedQuestion struct {
	Question string `json:"question"`
	Answer   string `json:"answer,omitempty"`
	At       string `json:"at,omitempty"`
	Answered bool   `json:"answered"`
}

// SummarySource ties a summary to its meeting, so MM:SS times can seek that meeting's recording.
type SummarySource struct {
	RoomID             string     `json:"roomId"`
	RecordingStartedAt *time.Time `json:"recordingStartedAt,omitempty"`
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
	cleanSummary(&s)
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

var timestampPattern = regexp.MustCompile(`^(\d{1,2}:)?\d{1,2}:\d{2}$`)

// cleanTimestamp keeps MM:SS or H:MM:SS and drops anything else a model invents.
func cleanTimestamp(at string) string {
	at = strings.Trim(strings.TrimSpace(at), "[]")
	if timestampPattern.MatchString(at) {
		return at
	}
	return ""
}

func limitStrings(items []string, n int) []string {
	out := []string{}
	for _, item := range items {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
		if len(out) == n {
			break
		}
	}
	return out
}

// cleanSummary bounds list sizes, keeps only valid times, and drops server-only fields.
func cleanSummary(s *LectureSummary) {
	s.Source = nil
	s.KeyConcepts, s.Takeaways, s.ActionItems = limitStrings(s.KeyConcepts, 20), limitStrings(s.Takeaways, 20), limitStrings(s.ActionItems, 20)
	s.RevisionNotes, s.Unresolved = limitStrings(s.RevisionNotes, 25), limitStrings(s.Unresolved, 20)
	topics := []SummaryTopic{}
	for _, t := range s.Topics {
		if strings.TrimSpace(t.Title) == "" {
			continue
		}
		topics = append(topics, SummaryTopic{Title: strings.TrimSpace(t.Title), At: cleanTimestamp(t.At), Points: limitStrings(t.Points, 8)})
		if len(topics) == 30 {
			break
		}
	}
	s.Topics = topics
	defs := []Definition{}
	for _, d := range s.Definitions {
		if strings.TrimSpace(d.Term) != "" && strings.TrimSpace(d.Meaning) != "" {
			defs = append(defs, Definition{strings.TrimSpace(d.Term), strings.TrimSpace(d.Meaning)})
		}
		if len(defs) == 30 {
			break
		}
	}
	s.Definitions = defs
	qs := []ExtractedQuestion{}
	for _, q := range s.Questions {
		if strings.TrimSpace(q.Question) == "" {
			continue
		}
		q.Question, q.Answer, q.At = strings.TrimSpace(q.Question), strings.TrimSpace(q.Answer), cleanTimestamp(q.At)
		q.Answered = q.Answered && q.Answer != ""
		qs = append(qs, q)
		if len(qs) == 40 {
			break
		}
	}
	s.Questions = qs
}
