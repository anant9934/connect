package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/tathastu/connect/services/api/internal/livecanvas"
)

// MaxLivePromptChars bounds what a teacher types into the live command bar.
const MaxLivePromptChars = 2000

// MaxLiveContextChars bounds the optional lecture context sent with a live prompt.
const MaxLiveContextChars = 6000

const liveSlidesSystemPrompt = `You make slides a teacher shows live in class, in a few seconds.
Return only JSON, no prose and no code fence, matching:
{
  "title": "Deck title",
  "slides": [
    {"layout": "title", "title": "...", "subtitle": "..."},
    {"layout": "bullets", "title": "...", "bullets": ["...", "..."]},
    {"layout": "table", "title": "...", "table": {"headers": ["...", "..."], "rows": [["...", "..."]]}},
    {"layout": "comparison", "title": "...", "left": {"heading": "...", "bullets": ["..."]}, "right": {"heading": "...", "bullets": ["..."]}},
    {"layout": "steps", "title": "...", "steps": ["first", "then", "finally"]},
    {"layout": "code", "title": "...", "code": {"language": "cpp", "source": "..."}, "bullets": ["what to notice"]},
    {"layout": "diagram", "title": "...", "diagram": {"nodes": [{"id": "start", "label": "Start", "shape": "pill"}, {"id": "check", "label": "x > 0?", "shape": "diamond"}, {"id": "db", "label": "Database", "shape": "cylinder"}], "edges": [{"from": "start", "to": "check"}, {"from": "check", "to": "db", "label": "yes"}]}}
  ]
}
Rules: 4 to 8 slides. Start with a title slide. Choose layouts that fit the content: tables for
comparisons of several items, steps for processes and algorithms, code only when the topic is
programming, diagram for flowcharts, state machines, pipelines and system architecture (2 to 12
nodes; shapes rect, diamond for decisions, pill for start/end, cylinder for storage). At most 6 bullets per slide, each under 20 words. Code under 25 lines. Every slide may
add "notes" with one or two sentences for the teacher. Be accurate; prefer standard textbook content.`

// GenerateLiveSlides turns a teacher's prompt into a cleaned deck. budgetKey groups spend and
// limits (an organization, or the host for personal rooms); userKey limits one person.
func (s *Service) GenerateLiveSlides(ctx context.Context, budgetKey, userKey, prompt, lectureContext string) (json.RawMessage, int, error) {
	userPrompt, err := s.livePrompt(prompt, lectureContext)
	if err != nil {
		return nil, 0, err
	}
	res, err := s.complete(ctx, budgetKey, userKey, CompletionRequest{
		Model:          s.cfg.DefaultFastModel,
		SystemPrompt:   liveSlidesSystemPrompt,
		UserPrompt:     userPrompt,
		Temperature:    0.4,
		MaxTokens:      3000,
		ResponseFormat: "json",
	})
	if err != nil {
		return nil, 0, err
	}
	deck, err := livecanvas.ParseDeck(res.Content, livecanvas.MaxGeneratedSlides)
	if err != nil {
		return nil, 0, fmt.Errorf("%w: %v", ErrInvalidStructuredOutput, err)
	}
	content, err := json.Marshal(deck)
	return content, len(deck.Slides), err
}

func liveSimulationSystemPrompt() string {
	return `You set up an interactive simulation a teacher shows live in class. You do not write code:
you choose one built-in engine and its starting settings. Return only JSON, no code fence:
{"engine": "...", "title": "...", "explanation": "2-3 sentences students read", "observe": ["what to try or notice"], "params": {...}}
Engines and params (numbers must stay in range):
- projectile: angle 5-85 degrees, speed 5-50 m/s, gravity 1-25 m/s^2, height 0-50 m
- pendulum: length 0.2-5 m, gravity 1-25, amplitude 5-80 degrees, damping 0-0.5
- function: family one of linear|quadratic|cubic|sine|exponential|logarithm, a, b, c each -10 to 10
  (linear a*x+b, quadratic a*x^2+b*x+c, cubic a*x^3+b*x+c, sine a*sin(b*x+c), exponential a*e^(b*x)+c, logarithm a*ln(b*x)+c)
- scheduling: algorithm one of fcfs|sjf|rr, quantum 1-8, processes: up to 6 of {"name": "P1", "arrival": 0-20, "burst": 1-15}
- sorting: algorithm one of bubble|insertion|selection|merge|quick, size 5-40, speed 1-10, seed 1-999
- logic: circuit one of and|or|not|nand|nor|xor|xnor|half_adder|full_adder, a, b, c each 0 or 1
- perceptron: dataset one of and|or|xor, w1, w2, bias each -3 to 3
- tree: kind one of bst|avl, values: up to 15 distinct integers 1-99 inserted in order, traversal one of none|inorder|preorder|postorder|levelorder, remove 0-99 (a value to delete after inserting; 0 for none), speed 0.5-5
- graph: nodes 3-8 (named A, B, C...), edges: up to 16 of {"from": 0-7, "to": 0-7, "weight": 1-20} (undirected), algorithm one of bfs|dfs|dijkstra, start and target node indexes, speed 0.5-5
Pick the engine that best teaches the request. If none fits exactly, pick the closest and say in
the explanation what it shows. 2 to 4 "observe" items.`
}

// GenerateLiveSimulation picks a built-in simulation engine and its starting settings.
func (s *Service) GenerateLiveSimulation(ctx context.Context, budgetKey, userKey, prompt, lectureContext string) (json.RawMessage, json.RawMessage, error) {
	userPrompt, err := s.livePrompt(prompt, lectureContext)
	if err != nil {
		return nil, nil, err
	}
	res, err := s.complete(ctx, budgetKey, userKey, CompletionRequest{
		Model:          s.cfg.DefaultFastModel,
		SystemPrompt:   liveSimulationSystemPrompt(),
		UserPrompt:     userPrompt,
		Temperature:    0.2,
		MaxTokens:      800,
		ResponseFormat: "json",
	})
	if err != nil {
		return nil, nil, err
	}
	sim, params, err := livecanvas.ParseSimulation(res.Content)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %v", ErrInvalidStructuredOutput, err)
	}
	content, err := json.Marshal(sim)
	if err != nil {
		return nil, nil, err
	}
	encoded, err := json.Marshal(params)
	return content, encoded, err
}

func (s *Service) livePrompt(prompt, lectureContext string) (string, error) {
	prompt = strings.TrimSpace(prompt)
	lectureContext = strings.TrimSpace(lectureContext)
	if prompt == "" || len([]rune(prompt)) > MaxLivePromptChars || len([]rune(lectureContext)) > MaxLiveContextChars {
		return "", ErrPromptTooLarge
	}
	cleanPrompt, err := s.sanitizer.ValidateAndSanitize(prompt)
	if err != nil {
		return "", err
	}
	out := "Teacher request:\n" + s.sanitizer.WrapUserContent("teacher_request", cleanPrompt)
	if lectureContext != "" {
		cleanContext, err := s.sanitizer.ValidateAndSanitize(lectureContext)
		if err != nil {
			return "", err
		}
		out += "\n\nWhat the class has covered so far:\n" + s.sanitizer.WrapUserContent("lecture_context", cleanContext)
	}
	return out, nil
}

// WriteError sends the HTTP response for an AI error, for handlers outside this package.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	(&Handler{}).handleError(w, r, err)
}
