package ai

import (
	"regexp"
	"strings"
)

const (
	// MaxPromptSizeBytes enforces strict limits on LLM prompt inputs (64KB).
	MaxPromptSizeBytes = 65536
)

var (
	// Injection detection heuristics (case-insensitive)
	injectionPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)\bignore\s+(?:all\s+)?previous\s+instructions\b`),
		regexp.MustCompile(`(?i)\bdisregard\s+(?:all\s+)?prior\s+(?:system\s+)?prompts?\b`),
		regexp.MustCompile(`(?i)\bsystem\s+override\b`),
		regexp.MustCompile(`(?i)\b(?:enable|activate|switch\s+to)\s+developer\s+mode\b`),
		regexp.MustCompile(`(?i)\byou\s+are\s+now\s+(?:in\s+)?(?:developer|dan|jailbreak)\s+mode\b`),
		regexp.MustCompile(`(?i)\byou\s+are\s+now\s+(?:unrestricted|jailbroken)\b`),
		regexp.MustCompile(`(?i)\bbypass\s+(?:all\s+)?(?:ethical|safety|system)\s+filters?\b`),
		regexp.MustCompile(`(?i)\bprint\s+(?:your\s+)?system\s+prompt\b`),
		regexp.MustCompile(`(?i)\brepeat\s+the\s+words\s+above\b`),
	}

	// Secret/credential redaction patterns
	bearerTokenRegex = regexp.MustCompile(`(?i)\b(Bearer\s+)[A-Za-z0-9\-\._~\+\/]+=*`)
	sessionHashRegex = regexp.MustCompile(`\b[a-f0-9]{64}\b`)
	apiKeyRegex      = regexp.MustCompile(`(?i)\b(sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z-_]{35})\b`)
)

// Sanitizer provides input validation and security screening for AI prompts.
type Sanitizer struct {
	maxBytes int
}

// NewSanitizer creates a Sanitizer with standard security thresholds.
func NewSanitizer() *Sanitizer {
	return &Sanitizer{
		maxBytes: MaxPromptSizeBytes,
	}
}

// ValidateAndSanitize checks input size, tests for adversarial prompt injection,
// and redacts accidental secrets from prompt text.
func (s *Sanitizer) ValidateAndSanitize(input string) (string, error) {
	if len(input) > s.maxBytes {
		return "", ErrPromptTooLarge
	}

	// 1. Detect Adversarial Prompt Injection
	for _, pattern := range injectionPatterns {
		if pattern.MatchString(input) {
			return "", ErrPromptInjectionDetected
		}
	}

	// 2. Redact Sensitive Credentials
	sanitized := bearerTokenRegex.ReplaceAllString(input, "${1}[REDACTED_TOKEN]")
	sanitized = apiKeyRegex.ReplaceAllString(sanitized, "[REDACTED_API_KEY]")
	sanitized = sessionHashRegex.ReplaceAllString(sanitized, "[REDACTED_HASH]")

	return strings.TrimSpace(sanitized), nil
}

// WrapUserContent encapsulates untrusted input within XML-style boundary tags to defeat delimiter attacks.
func (s *Sanitizer) WrapUserContent(tag string, content string) string {
	cleanTag := strings.ToLower(strings.TrimSpace(tag))
	if cleanTag == "" {
		cleanTag = "user_content"
	}
	return "<" + cleanTag + ">\n" + content + "\n</" + cleanTag + ">"
}
