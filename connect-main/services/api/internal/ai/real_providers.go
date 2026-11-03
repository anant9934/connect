package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// providerUserAgent identifies Connect to upstream APIs. Some edge networks reject default
// library user agents.
const providerUserAgent = "TathastuConnect/1.0 (+https://connect-alpha-seven.vercel.app)"

// upstreamSnippet bounds upstream error bodies kept in error chains so large payloads or
// echoed request content are not carried into logs.
func upstreamSnippet(b []byte) string {
	const max = 200
	s := strings.TrimSpace(string(b))
	if len(s) > max {
		return s[:max] + "..."
	}
	return s
}

// classifyHTTPFailure maps an upstream HTTP failure to a sentinel. Short-window 429s are rate
// limits; 402s and 429s that name a daily or credit quota are quota exhaustion.
func classifyHTTPFailure(provider string, status int, body []byte) error {
	lower := strings.ToLower(string(body))
	quota := status == http.StatusPaymentRequired
	for _, marker := range []string{"per day", "perday", "per-day", "daily", "insufficient_quota", "credits"} {
		if strings.Contains(lower, marker) {
			quota = true
		}
	}
	switch {
	case quota && (status == http.StatusTooManyRequests || status == http.StatusPaymentRequired):
		return fmt.Errorf("%w: %s quota (%d)", ErrProviderQuotaExhausted, provider, status)
	case status == http.StatusTooManyRequests:
		return fmt.Errorf("%w: %s rate limit (429)", ErrProviderOverloaded, provider)
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return fmt.Errorf("%w: %s auth error (%d)", ErrUnauthorizedProvider, provider, status)
	case status == http.StatusGatewayTimeout:
		return fmt.Errorf("%w: %s upstream timeout (504)", ErrProviderTimeout, provider)
	case status >= 500:
		return fmt.Errorf("%w: %s server error (%d)", ErrProviderUnavailable, provider, status)
	default:
		return fmt.Errorf("%w: %s returned status %d: %s", ErrProviderUnavailable, provider, status, upstreamSnippet(body))
	}
}

// classifyTransportError distinguishes timeouts from other network failures.
func classifyTransportError(provider string, err error) error {
	var netErr interface{ Timeout() bool }
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &netErr) && netErr.Timeout()) {
		return fmt.Errorf("%w: %s request timed out", ErrProviderTimeout, provider)
	}
	return fmt.Errorf("%w: %s network error: %v", ErrProviderUnavailable, provider, err)
}

// GeminiProvider connects to Google's Generative Language API.
type GeminiProvider struct {
	id         string
	baseURL    string
	keyPool    *KeyPool
	httpClient *http.Client
}

// NewGeminiProvider constructs a GeminiProvider backed by a key pool.
func NewGeminiProvider(id string, keyPool *KeyPool, client *http.Client) *GeminiProvider {
	if id == "" {
		id = "gemini"
	}
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &GeminiProvider{
		id:         id,
		baseURL:    "https://generativelanguage.googleapis.com/v1beta",
		keyPool:    keyPool,
		httpClient: client,
	}
}

func (p *GeminiProvider) ID() string {
	return p.id
}

type geminiPart struct {
	Text string `json:"text"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiSystemInstruction struct {
	Parts []geminiPart `json:"parts"`
}

type geminiGenerationConfig struct {
	Temperature      float32 `json:"temperature,omitempty"`
	MaxOutputTokens  int     `json:"maxOutputTokens,omitempty"`
	ResponseMimeType string  `json:"responseMimeType,omitempty"`
}

type geminiRequest struct {
	SystemInstruction *geminiSystemInstruction `json:"system_instruction,omitempty"`
	Contents          []geminiContent          `json:"contents"`
	GenerationConfig  *geminiGenerationConfig  `json:"generationConfig,omitempty"`
}

type geminiCandidate struct {
	Content struct {
		Parts []geminiPart `json:"parts"`
		Role  string       `json:"role"`
	} `json:"content"`
	FinishReason string `json:"finishReason"`
}

type geminiUsageMetadata struct {
	PromptTokenCount     int `json:"promptTokenCount"`
	CandidatesTokenCount int `json:"candidatesTokenCount"`
	TotalTokenCount      int `json:"totalTokenCount"`
}

type geminiResponse struct {
	Candidates    []geminiCandidate    `json:"candidates"`
	UsageMetadata *geminiUsageMetadata `json:"usageMetadata,omitempty"`
	Error         *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
	} `json:"error,omitempty"`
}

func (p *GeminiProvider) Complete(ctx context.Context, req CompletionRequest) (*CompletionResult, error) {
	if p.keyPool == nil || p.keyPool.Size() == 0 {
		return nil, fmt.Errorf("%w: no active API keys configured for %s", ErrProviderNotConfigured, p.id)
	}

	modelName := req.Model
	if !strings.HasPrefix(modelName, "gemini-") {
		return nil, fmt.Errorf("%w: model %q is not served by %s", ErrModelNotFound, modelName, p.id)
	}

	maxAttempts := p.keyPool.Size()
	if maxAttempts > 3 {
		maxAttempts = 3
	}

	var lastErr error
	startTime := time.Now()

	for attempt := 0; attempt < maxAttempts; attempt++ {
		apiKey := p.keyPool.NextKey()
		if apiKey == "" {
			break
		}

		gReq := geminiRequest{
			Contents: []geminiContent{
				{
					Role:  "user",
					Parts: []geminiPart{{Text: req.UserPrompt}},
				},
			},
			GenerationConfig: &geminiGenerationConfig{
				Temperature:     req.Temperature,
				MaxOutputTokens: req.MaxTokens,
			},
		}

		if req.SystemPrompt != "" {
			gReq.SystemInstruction = &geminiSystemInstruction{
				Parts: []geminiPart{{Text: req.SystemPrompt}},
			}
		}

		if req.ResponseFormat == "json" {
			gReq.GenerationConfig.ResponseMimeType = "application/json"
		}

		bodyBytes, err := json.Marshal(gReq)
		if err != nil {
			return nil, fmt.Errorf("failed to encode gemini request: %w", err)
		}

		// The key travels in a header, never the URL, so transport errors (which embed the
		// URL) cannot leak it into logs or responses.
		url := fmt.Sprintf("%s/models/%s:generateContent", p.baseURL, modelName)
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
		if err != nil {
			return nil, fmt.Errorf("failed to create http request: %w", err)
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("User-Agent", providerUserAgent)
		httpReq.Header.Set("x-goog-api-key", apiKey)

		resp, err := p.httpClient.Do(httpReq)
		if err != nil {
			lastErr = classifyTransportError(p.id, err)
			if ctx.Err() != nil {
				break
			}
			continue
		}

		respBody, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if readErr != nil {
			lastErr = classifyTransportError(p.id, readErr)
			continue
		}

		if resp.StatusCode != http.StatusOK {
			lastErr = classifyHTTPFailure(p.id, resp.StatusCode, respBody)
			continue
		}

		var gResp geminiResponse
		if err := json.Unmarshal(respBody, &gResp); err != nil {
			lastErr = fmt.Errorf("failed to decode gemini response: %w", err)
			continue
		}

		if gResp.Error != nil {
			lastErr = fmt.Errorf("%w: gemini error: %s (code %d)", ErrProviderUnavailable, upstreamSnippet([]byte(gResp.Error.Message)), gResp.Error.Code)
			continue
		}

		if len(gResp.Candidates) == 0 || len(gResp.Candidates[0].Content.Parts) == 0 {
			lastErr = fmt.Errorf("%w: gemini returned no candidates", ErrInvalidStructuredOutput)
			continue
		}

		content := gResp.Candidates[0].Content.Parts[0].Text
		inputTokens := 0
		outputTokens := 0
		totalTokens := 0
		if gResp.UsageMetadata != nil {
			inputTokens = gResp.UsageMetadata.PromptTokenCount
			outputTokens = gResp.UsageMetadata.CandidatesTokenCount
			totalTokens = gResp.UsageMetadata.TotalTokenCount
		} else {
			inputTokens = len(strings.Fields(req.SystemPrompt + " " + req.UserPrompt))
			outputTokens = len(strings.Fields(content))
			totalTokens = inputTokens + outputTokens
		}

		return &CompletionResult{
			Provider: p.id,
			Model:    req.Model,
			Content:  content,
			Usage: Usage{
				InputTokens:  inputTokens,
				OutputTokens: outputTokens,
				TotalTokens:  totalTokens,
			},
			Latency:      time.Since(startTime),
			FinishReason: "stop",
			IsMock:       false,
		}, nil
	}

	return nil, fmt.Errorf("gemini provider failed after %d attempts: %w", maxAttempts, lastErr)
}

func (p *GeminiProvider) Stream(ctx context.Context, req CompletionRequest) (<-chan StreamChunk, error) {
	result, err := p.Complete(ctx, req)
	if err != nil {
		return nil, err
	}

	out := make(chan StreamChunk)
	go func() {
		defer close(out)
		words := strings.Fields(result.Content)
		for _, w := range words {
			// Check cancellation first: when both cases are ready, select picks at random.
			if err := ctx.Err(); err != nil {
				out <- StreamChunk{Error: err, IsFinal: true}
				return
			}
			select {
			case <-ctx.Done():
				out <- StreamChunk{Error: ctx.Err(), IsFinal: true}
				return
			case out <- StreamChunk{DeltaContent: w + " "}:
				time.Sleep(5 * time.Millisecond)
			}
		}
		out <- StreamChunk{
			IsFinal: true,
			Usage:   &result.Usage,
		}
	}()
	return out, nil
}

func (p *GeminiProvider) HealthCheck(ctx context.Context) error {
	if p.keyPool == nil || p.keyPool.Size() == 0 {
		return fmt.Errorf("%w: no gemini keys configured", ErrProviderNotConfigured)
	}
	return nil
}

// OpenAICompatibleProvider connects to Groq, OpenRouter, or other standard OpenAI-compatible endpoints.
type OpenAICompatibleProvider struct {
	id          string
	baseURL     string
	keyPool     *KeyPool
	httpClient  *http.Client
	extraHeader map[string]string
}

// NewGroqProvider constructs a Groq provider.
func NewGroqProvider(id string, keyPool *KeyPool, client *http.Client) *OpenAICompatibleProvider {
	if id == "" {
		id = "groq"
	}
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &OpenAICompatibleProvider{
		id:         id,
		baseURL:    "https://api.groq.com/openai/v1",
		keyPool:    keyPool,
		httpClient: client,
	}
}

// NewOpenRouterProvider constructs an OpenRouter provider.
func NewOpenRouterProvider(id string, keyPool *KeyPool, client *http.Client) *OpenAICompatibleProvider {
	if id == "" {
		id = "openrouter"
	}
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &OpenAICompatibleProvider{
		id:         id,
		baseURL:    "https://openrouter.ai/api/v1",
		keyPool:    keyPool,
		httpClient: client,
		extraHeader: map[string]string{
			"HTTP-Referer": "https://connect-alpha-seven.vercel.app",
			"X-Title":      "Connect Classroom",
		},
	}
}

func (p *OpenAICompatibleProvider) ID() string {
	return p.id
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIResponseFormat struct {
	Type string `json:"type"`
}

type openAIRequest struct {
	Model          string                `json:"model"`
	Messages       []openAIMessage       `json:"messages"`
	Temperature    float32               `json:"temperature,omitempty"`
	MaxTokens      int                   `json:"max_tokens,omitempty"`
	ResponseFormat *openAIResponseFormat `json:"response_format,omitempty"`
}

type openAIResponse struct {
	ID      string `json:"id"`
	Choices []struct {
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    any    `json:"code"`
	} `json:"error,omitempty"`
}

func (p *OpenAICompatibleProvider) Complete(ctx context.Context, req CompletionRequest) (*CompletionResult, error) {
	if p.keyPool == nil || p.keyPool.Size() == 0 {
		return nil, fmt.Errorf("%w: no active API keys configured for %s", ErrProviderNotConfigured, p.id)
	}

	modelName := req.Model
	if modelName == "" {
		return nil, fmt.Errorf("%w: empty model for %s", ErrModelNotFound, p.id)
	}

	maxAttempts := p.keyPool.Size()
	if maxAttempts > 3 {
		maxAttempts = 3
	}

	var lastErr error
	startTime := time.Now()

	for attempt := 0; attempt < maxAttempts; attempt++ {
		apiKey := p.keyPool.NextKey()
		if apiKey == "" {
			break
		}

		var messages []openAIMessage
		if req.SystemPrompt != "" {
			messages = append(messages, openAIMessage{Role: "system", Content: req.SystemPrompt})
		}
		messages = append(messages, openAIMessage{Role: "user", Content: req.UserPrompt})

		oReq := openAIRequest{
			Model:       modelName,
			Messages:    messages,
			Temperature: req.Temperature,
			MaxTokens:   req.MaxTokens,
		}

		if req.ResponseFormat == "json" {
			oReq.ResponseFormat = &openAIResponseFormat{Type: "json_object"}
		}

		bodyBytes, err := json.Marshal(oReq)
		if err != nil {
			return nil, fmt.Errorf("failed to encode request: %w", err)
		}

		url := fmt.Sprintf("%s/chat/completions", p.baseURL)
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
		if err != nil {
			return nil, fmt.Errorf("failed to create http request: %w", err)
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("User-Agent", providerUserAgent)
		httpReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
		for k, v := range p.extraHeader {
			httpReq.Header.Set(k, v)
		}

		resp, err := p.httpClient.Do(httpReq)
		if err != nil {
			lastErr = classifyTransportError(p.id, err)
			if ctx.Err() != nil {
				break
			}
			continue
		}

		respBody, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if readErr != nil {
			lastErr = classifyTransportError(p.id, readErr)
			continue
		}

		if resp.StatusCode != http.StatusOK {
			lastErr = classifyHTTPFailure(p.id, resp.StatusCode, respBody)
			continue
		}

		var oResp openAIResponse
		if err := json.Unmarshal(respBody, &oResp); err != nil {
			lastErr = fmt.Errorf("failed to decode response: %w", err)
			continue
		}

		if oResp.Error != nil {
			lastErr = fmt.Errorf("%w: %s error: %s", ErrProviderUnavailable, p.id, upstreamSnippet([]byte(oResp.Error.Message)))
			continue
		}

		if len(oResp.Choices) == 0 {
			lastErr = fmt.Errorf("%w: provider %s returned no choices", ErrInvalidStructuredOutput, p.id)
			continue
		}

		content := oResp.Choices[0].Message.Content
		inputTokens := oResp.Usage.PromptTokens
		outputTokens := oResp.Usage.CompletionTokens
		totalTokens := oResp.Usage.TotalTokens
		if totalTokens == 0 {
			inputTokens = len(strings.Fields(req.SystemPrompt + " " + req.UserPrompt))
			outputTokens = len(strings.Fields(content))
			totalTokens = inputTokens + outputTokens
		}

		return &CompletionResult{
			Provider: p.id,
			Model:    req.Model,
			Content:  content,
			Usage: Usage{
				InputTokens:  inputTokens,
				OutputTokens: outputTokens,
				TotalTokens:  totalTokens,
			},
			Latency:      time.Since(startTime),
			FinishReason: oResp.Choices[0].FinishReason,
			IsMock:       false,
		}, nil
	}

	return nil, fmt.Errorf("provider %s failed after %d attempts: %w", p.id, maxAttempts, lastErr)
}

func (p *OpenAICompatibleProvider) Stream(ctx context.Context, req CompletionRequest) (<-chan StreamChunk, error) {
	result, err := p.Complete(ctx, req)
	if err != nil {
		return nil, err
	}

	out := make(chan StreamChunk)
	go func() {
		defer close(out)
		words := strings.Fields(result.Content)
		for _, w := range words {
			// Check cancellation first: when both cases are ready, select picks at random.
			if err := ctx.Err(); err != nil {
				out <- StreamChunk{Error: err, IsFinal: true}
				return
			}
			select {
			case <-ctx.Done():
				out <- StreamChunk{Error: ctx.Err(), IsFinal: true}
				return
			case out <- StreamChunk{DeltaContent: w + " "}:
				time.Sleep(5 * time.Millisecond)
			}
		}
		out <- StreamChunk{
			IsFinal: true,
			Usage:   &result.Usage,
		}
	}()
	return out, nil
}

func (p *OpenAICompatibleProvider) HealthCheck(ctx context.Context) error {
	if p.keyPool == nil || p.keyPool.Size() == 0 {
		return fmt.Errorf("%w: no keys configured for %s", ErrProviderNotConfigured, p.id)
	}
	return nil
}
