package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

const (
	// chunkThresholdChars is where one request becomes several: free-tier context windows and
	// output limits make a single call over a long class lose detail.
	chunkThresholdChars = 18000
	chunkWindow         = 10 * time.Minute
	chunkOverlap        = 60 * time.Second
	chunkConcurrency    = 3
	maxChunks           = 18 // three hours
)

// chunkLines splits a transcript into windows of chunkWindow that overlap by chunkOverlap, so
// a point made across a boundary appears whole in at least one chunk. Times stay absolute.
func chunkLines(lines []meetingLine) [][]meetingLine {
	if len(lines) == 0 {
		return nil
	}
	start := lines[0].SpokenAt
	end := lines[len(lines)-1].SpokenAt
	var chunks [][]meetingLine
	for from := start; !from.After(end) && len(chunks) < maxChunks; from = from.Add(chunkWindow - chunkOverlap) {
		to := from.Add(chunkWindow)
		var chunk []meetingLine
		for _, l := range lines {
			if !l.SpokenAt.Before(from) && l.SpokenAt.Before(to) {
				chunk = append(chunk, l)
			}
		}
		if len(chunk) > 0 {
			chunks = append(chunks, chunk)
		}
		if !to.Before(end) {
			break
		}
	}
	return chunks
}

const reduceSystemPrompt = `You merge partial notes from consecutive parts of one lecture into a single set of notes.
Each part was summarised separately; neighbouring parts overlap by about a minute, so remove
duplicates. Keep every "at" time exactly as given; never invent one. Order topics by time.
Answer with the same JSON schema as the parts:
{"title","overview","keyConcepts","takeaways","actionItems","topics":[{"title","at","points"}],
"definitions":[{"term","meaning"}],"revisionNotes","questions":[{"question","answer","at","answered"}],"unresolved"}
Questions from the class Q&A list may be included after the parts; merge them with questions
found in the parts. Return only valid JSON.`

func addUsage(total *Usage, u Usage) {
	total.InputTokens += u.InputTokens
	total.OutputTokens += u.OutputTokens
	total.TotalTokens += u.TotalTokens
	total.CostMicroUSD += u.CostMicroUSD
	total.EstimatedCostMicroUSD += u.EstimatedCostMicroUSD
	total.BilledCostMicroUSD += u.BilledCostMicroUSD
	if u.Provider != "" {
		total.Provider, total.Model = u.Provider, u.Model
	}
}

// SummarizeLongLecture summarises each chunk (a few at a time), then merges the parts. It
// counts as one request against rate limits; every call is still checked against the budget.
func (s *Service) SummarizeLongLecture(ctx context.Context, orgID, userID, courseCode string, chunks []string, qaText string) (*LectureSummary, *Usage, error) {
	if len(chunks) == 0 {
		return nil, nil, fmt.Errorf("%w: empty transcript", ErrInvalidStructuredOutput)
	}
	total := &Usage{}
	parts := make([]*LectureSummary, len(chunks))
	errs := make([]error, len(chunks))

	part := func(i int, skipRate bool) {
		clean, err := s.sanitizer.ValidateAndSanitize(chunks[i])
		if err != nil {
			errs[i] = err
			return
		}
		res, err := s.completeWith(ctx, orgID, userID, CompletionRequest{
			Model:        s.cfg.DefaultFastModel,
			SystemPrompt: lectureSummarySystemPrompt,
			UserPrompt: fmt.Sprintf("Course: %s\nThis is part %d of %d of one lecture; summarise only this part.\nTranscript:\n%s",
				courseCode, i+1, len(chunks), s.sanitizer.WrapUserContent("lecture_transcript", clean)),
			Temperature: 0.2, MaxTokens: 3000, ResponseFormat: "json",
		}, skipRate)
		if err != nil {
			errs[i] = err
			return
		}
		summary, err := s.validator.ValidateLectureSummary(res.Content)
		if err != nil {
			errs[i] = err
			return
		}
		parts[i] = summary
		s.mu.Lock()
		addUsage(total, res.Usage)
		s.mu.Unlock()
	}

	// The first part carries the request's rate-limit check; the rest run a few at a time.
	part(0, false)
	if errs[0] != nil {
		return nil, total, errs[0]
	}
	var wg sync.WaitGroup
	slots := make(chan struct{}, chunkConcurrency)
	for i := 1; i < len(chunks); i++ {
		wg.Add(1)
		slots <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-slots }()
			part(i, true)
		}(i)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return nil, total, err
		}
	}
	if len(parts) == 1 && strings.TrimSpace(qaText) == "" {
		return parts[0], total, nil
	}

	encoded, err := json.Marshal(parts)
	if err != nil {
		return nil, total, err
	}
	user := fmt.Sprintf("Course: %s\nPartial notes, in order:\n%s", courseCode, s.sanitizer.WrapUserContent("partial_notes", string(encoded)))
	if strings.TrimSpace(qaText) != "" {
		cleanQA, err := s.sanitizer.ValidateAndSanitize(qaText)
		if err != nil {
			return nil, total, err
		}
		user += "\n\n" + s.sanitizer.WrapUserContent("class_questions", cleanQA)
	}
	res, err := s.completeWith(ctx, orgID, userID, CompletionRequest{
		Model: s.cfg.DefaultModel, SystemPrompt: reduceSystemPrompt, UserPrompt: user,
		Temperature: 0.2, MaxTokens: 4096, ResponseFormat: "json",
	}, true)
	if err != nil {
		return nil, total, err
	}
	addUsage(total, res.Usage)
	merged, err := s.validator.ValidateLectureSummary(res.Content)
	if err != nil {
		return nil, total, err
	}
	return merged, total, nil
}
