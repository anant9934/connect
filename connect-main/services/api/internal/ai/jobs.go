package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/worker"
)

const (
	// Job types registered in worker registry
	TypeAILectureSummary = "ai:lecture_summary"
	TypeAIPracticeQuiz   = "ai:practice_quiz"
	TypeAIFlashcards     = "ai:flashcards"

	// Queue name for AI processing
	AIQueueName = "ai_processing"
)

// LectureSummaryJobPayload represents the persisted payload for an asynchronous lecture summarization job.
type LectureSummaryJobPayload struct {
	OrganizationID string  `json:"organizationId"`
	UserID         string  `json:"userId"`
	CourseID       *string `json:"courseId,omitempty"`
	ClassID        *string `json:"classId,omitempty"`
	SessionID      *string `json:"sessionId,omitempty"`
	CourseCode     string  `json:"courseCode"`
	TranscriptText string  `json:"transcriptText"`
	Title          string  `json:"title"`
}

// PracticeQuizJobPayload represents the payload for an asynchronous quiz generation job.
type PracticeQuizJobPayload struct {
	OrganizationID string  `json:"organizationId"`
	UserID         string  `json:"userId"`
	CourseID       *string `json:"courseId,omitempty"`
	ClassID        *string `json:"classId,omitempty"`
	CourseTitle    string  `json:"courseTitle"`
	Topic          string  `json:"topic"`
	QuestionCount  int     `json:"questionCount"`
}

// GenerateIdempotencyKey generates a stable hash for a job to prevent duplicate enqueueing.
func GenerateIdempotencyKey(jobType, orgID, identifier, content string) string {
	hasher := sha256.New()
	hasher.Write([]byte(jobType))
	hasher.Write([]byte(":"))
	hasher.Write([]byte(orgID))
	hasher.Write([]byte(":"))
	hasher.Write([]byte(identifier))
	hasher.Write([]byte(":"))
	hasher.Write([]byte(content))
	return fmt.Sprintf("%s:%s", jobType, hex.EncodeToString(hasher.Sum(nil))[:32])
}

// EnqueueLectureSummaryJob submits an asynchronous summarization job to the worker queue.
func EnqueueLectureSummaryJob(
	ctx context.Context,
	tx pgx.Tx,
	payload LectureSummaryJobPayload,
) (*worker.Job, error) {
	if payload.OrganizationID == "" || payload.UserID == "" {
		return nil, fmt.Errorf("organizationId and userId are required to enqueue AI job")
	}

	sessionKey := "no-session"
	if payload.SessionID != nil {
		sessionKey = *payload.SessionID
	}
	idempotencyKey := GenerateIdempotencyKey(
		TypeAILectureSummary,
		payload.OrganizationID,
		sessionKey,
		payload.TranscriptText,
	)

	workerPayload := worker.JobPayload{
		Type:      TypeAILectureSummary,
		CreatedAt: time.Now().UTC(),
	}

	rawBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal lecture summary payload: %w", err)
	}
	workerPayload.Data = rawBytes

	return worker.EnqueueJob(ctx, tx, AIQueueName, idempotencyKey, workerPayload, nil)
}

// NewAILectureSummaryHandler constructs the worker handler for TypeAILectureSummary.
func NewAILectureSummaryHandler(
	pool *pgxpool.Pool,
	aiService *Service,
	repo *Repository,
	logger *slog.Logger,
) worker.HandlerFunc {
	return func(ctx context.Context, job *worker.Job) error {
		if logger == nil {
			logger = slog.Default()
		}

		// 1. Parse and validate job payload
		payload, err := worker.ParsePayload(job.Payload)
		if err != nil {
			return worker.MarkPermanent(fmt.Errorf("malformed worker payload: %w", err))
		}

		var jobData LectureSummaryJobPayload
		if err := json.Unmarshal(payload.Data, &jobData); err != nil {
			return worker.MarkPermanent(fmt.Errorf("invalid LectureSummaryJobPayload: %w", err))
		}

		orgID, err := uuid.Parse(jobData.OrganizationID)
		if err != nil {
			return worker.MarkPermanent(fmt.Errorf("invalid organizationId in job: %w", err))
		}
		userID, err := uuid.Parse(jobData.UserID)
		if err != nil {
			return worker.MarkPermanent(fmt.Errorf("invalid userId in job: %w", err))
		}

		// 2. Execute AI Summarization with bounded execution time
		jobCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
		defer cancel()

		logger.Info("processing_ai_lecture_summary_job",
			slog.String("job_id", job.ID.String()),
			slog.String("org_id", jobData.OrganizationID),
			slog.String("course_code", jobData.CourseCode),
		)

		summary, usage, err := aiService.SummarizeLecture(
			jobCtx,
			jobData.OrganizationID,
			jobData.UserID,
			jobData.CourseCode,
			jobData.TranscriptText,
		)
		if err != nil {
			// Distinguish permanent validation / format errors from transient 429/503/timeout
			if errors.Is(err, ErrPromptTooLarge) || errors.Is(err, ErrPromptInjectionDetected) || errors.Is(err, ErrInvalidStructuredOutput) ||
				errors.Is(err, ErrProviderNotConfigured) || errors.Is(err, ErrUnauthorizedProvider) ||
				errors.Is(err, ErrNonFreeModelBlocked) || errors.Is(err, ErrModelNotAllowed) || errors.Is(err, ErrBudgetExceeded) {
				return worker.MarkPermanent(err)
			}
			// Rate limits, provider timeouts or overload are retryable
			return fmt.Errorf("transient ai summarization error: %w", err)
		}

		// 3. Persist the generated artifact and usage record in a transaction
		tx, err := pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("failed to begin transaction for job completion: %w", err)
		}
		defer func() { _ = tx.Rollback(ctx) }()

		summaryJSON, err := json.Marshal(summary)
		if err != nil {
			return worker.MarkPermanent(fmt.Errorf("failed to marshal summary result: %w", err))
		}

		var courseUUID, classUUID, sessionUUID *uuid.UUID
		if jobData.CourseID != nil {
			if parsed, err := uuid.Parse(*jobData.CourseID); err == nil {
				courseUUID = &parsed
			}
		}
		if jobData.ClassID != nil {
			if parsed, err := uuid.Parse(*jobData.ClassID); err == nil {
				classUUID = &parsed
			}
		}
		if jobData.SessionID != nil {
			if parsed, err := uuid.Parse(*jobData.SessionID); err == nil {
				sessionUUID = &parsed
			}
		}

		title := jobData.Title
		if title == "" {
			title = summary.Title
		}

		artifact := &Artifact{
			ID:             uuid.New(),
			OrganizationID: orgID,
			CourseID:       courseUUID,
			ClassID:        classUUID,
			SessionID:      sessionUUID,
			CreatorUserID:  userID,
			ArtifactType:   "lecture_summary",
			Title:          title,
			Content:        summaryJSON,
			Visibility:     "faculty_only", // Requires faculty review before student publishing
			HumanReviewed:  false,
		}

		if err := repo.CreateArtifact(ctx, tx, artifact); err != nil {
			return fmt.Errorf("failed to save generated artifact: %w", err)
		}

		if usage != nil {
			usageRec := &UsageRecord{
				ID:                    uuid.New(),
				OrganizationID:        orgID,
				UserID:                userID,
				CourseID:              courseUUID,
				ClassID:               classUUID,
				SessionID:             sessionUUID,
				ProviderName:          usage.Provider,
				ModelName:             usage.Model,
				FeatureName:           "lecture_summary",
				PromptTokens:          usage.InputTokens,
				CompletionTokens:      usage.OutputTokens,
				TotalTokens:           usage.TotalTokens,
				EstimatedCostMicroUSD: usage.EstimatedCostMicroUSD,
				BilledCostMicroUSD:    usage.BilledCostMicroUSD,
				Status:                "success",
			}
			if err := repo.RecordUsage(ctx, tx, usageRec); err != nil {
				logger.Warn("failed_to_record_ai_usage", slog.String("error", err.Error()))
			}
		}

		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("failed to commit job completion transaction: %w", err)
		}

		logger.Info("completed_ai_lecture_summary_job",
			slog.String("job_id", job.ID.String()),
			slog.String("artifact_id", artifact.ID.String()),
		)

		return nil
	}
}

// RegisterAIHandlers registers AI background job handlers with the worker registry.
func RegisterAIHandlers(
	r *worker.Registry,
	pool *pgxpool.Pool,
	aiService *Service,
	repo *Repository,
	logger *slog.Logger,
) {
	if r == nil || pool == nil || aiService == nil {
		return
	}
	r.RegisterFunc(TypeAILectureSummary, NewAILectureSummaryHandler(pool, aiService, repo, logger))
}
