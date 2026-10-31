package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
)

var (
	// ErrUnknownJobType indicates that a job's type has no registered handler.
	ErrUnknownJobType = errors.New("unsupported or unregistered job type")

	// ErrMalformedPayload indicates that the job payload cannot be parsed.
	ErrMalformedPayload = errors.New("malformed job payload")

	// ErrPermanent marks a non-retryable error that immediately transitions a job to dead_letter.
	ErrPermanent = errors.New("permanent failure: non-retryable error")
)

// MarkPermanent wraps an underlying error as a permanent, non-retryable error.
func MarkPermanent(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%w: %v", ErrPermanent, err)
}

// IsPermanent returns true if the error or any wrapped error is ErrPermanent.
func IsPermanent(err error) bool {
	return errors.Is(err, ErrPermanent)
}

// Handler defines the contract for processing a background job.
type Handler interface {
	Handle(ctx context.Context, job *Job) error
}

// HandlerFunc allows regular functions to satisfy the Handler interface.
type HandlerFunc func(ctx context.Context, job *Job) error

func (f HandlerFunc) Handle(ctx context.Context, job *Job) error {
	return f(ctx, job)
}

// Registry manages the mapping of job type names to their respective handlers.
type Registry struct {
	mu       sync.RWMutex
	handlers map[string]Handler
}

// NewRegistry constructs an empty handler registry.
func NewRegistry() *Registry {
	return &Registry{
		handlers: make(map[string]Handler),
	}
}

// Register binds a job type identifier to a Handler.
func (r *Registry) Register(jobType string, h Handler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.handlers[jobType] = h
}

// RegisterFunc binds a job type identifier to a HandlerFunc.
func (r *Registry) RegisterFunc(jobType string, fn func(ctx context.Context, job *Job) error) {
	r.Register(jobType, HandlerFunc(fn))
}

// Get retrieves the handler registered for the given job type.
func (r *Registry) Get(jobType string) (Handler, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	h, ok := r.handlers[jobType]
	return h, ok
}

// ParsePayload extracts standard JobPayload envelope from raw job bytes.
func ParsePayload(raw []byte) (*JobPayload, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("%w: empty payload bytes", ErrMalformedPayload)
	}

	var p JobPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, fmt.Errorf("%w: json unmarshal failed: %v", ErrMalformedPayload, err)
	}

	if p.Type == "" {
		return nil, fmt.Errorf("%w: missing 'type' field in job payload", ErrMalformedPayload)
	}

	return &p, nil
}
