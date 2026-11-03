package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/model"
)

var (
	errInvalidOrgID    = errors.New("invalid organization id")
	errUnauthenticated = errors.New("authentication required")
	errUnauthorized    = errors.New("insufficient permissions for this action")
)

type withAuthContextFunc func(ctx context.Context, pool *pgxpool.Pool, tokenHash string, orgID *string, fn func(pgx.Tx, *database.AuthContext) error) error

// Handler serves HTTP endpoints for AI learning intelligence.
type Handler struct {
	pool          *pgxpool.Pool
	service       *Service
	repo          *Repository
	keyManager    *KeyPoolManager
	withAuthCtxFn withAuthContextFunc
}

// NewHandler constructs an AI HTTP handler.
func NewHandler(pool *pgxpool.Pool, service *Service) *Handler {
	return &Handler{
		pool:       pool,
		service:    service,
		repo:       NewRepository(),
		keyManager: LoadKeyPoolsFromEnv(),
	}
}

// SetWithAuthContext overrides the context runner for isolated testing.
func (h *Handler) SetWithAuthContext(fn withAuthContextFunc) {
	h.withAuthCtxFn = fn
}

// RegisterRoutes mounts all AI endpoints onto the provided Chi router.
func (h *Handler) RegisterRoutes(r chi.Router) {
	r.Route("/organizations/{org}/ai", func(aiRouter chi.Router) {
		// System status and health (admins and faculty)
		aiRouter.Get("/status", h.getStatus)

		// Synchronous generative endpoints
		aiRouter.Post("/summaries/generate", h.generateSummary)
		aiRouter.Post("/quizzes/generate", h.generateQuiz)
		aiRouter.Post("/flashcards/generate", h.generateFlashcards)

		// Asynchronous background job endpoints
		aiRouter.Post("/jobs/summary", h.submitSummaryJob)
		aiRouter.Get("/jobs/{id}", h.getJobStatus)

		// Persistent artifact management
		aiRouter.Get("/artifacts", h.listArtifacts)
		aiRouter.Get("/artifacts/{id}", h.getArtifact)
		aiRouter.Post("/artifacts/{id}/review", h.reviewArtifact)

		// Policy and usage reporting
		aiRouter.Get("/policy", h.getPolicy)
		aiRouter.Put("/policy", h.updatePolicy)
		aiRouter.Get("/usage", h.getUsage)
	})
}

func (h *Handler) inOrg(r *http.Request, fn func(pgx.Tx, *database.AuthContext, uuid.UUID) error) error {
	orgStr := chi.URLParam(r, "org")
	orgID, err := uuid.Parse(orgStr)
	if err != nil {
		return errInvalidOrgID
	}
	runner := database.WithAuthContext
	if h.withAuthCtxFn != nil {
		runner = h.withAuthCtxFn
	}
	return runner(r.Context(), h.pool, database.SessionTokenHash(r.Context()), &orgStr, func(tx pgx.Tx, authCtx *database.AuthContext) error {
		return fn(tx, authCtx, orgID)
	})
}

func (h *Handler) isFacultyOrAdmin(authCtx *database.AuthContext) bool {
	if authCtx.IsSuperAdmin {
		return true
	}
	if authCtx.Role == nil {
		return false
	}
	switch *authCtx.Role {
	case "institution_admin", "department_coordinator", "faculty":
		return true
	default:
		return false
	}
}

// getStatus returns safe operational status of configured AI providers (Admin/Faculty only).
func (h *Handler) getStatus(w http.ResponseWriter, r *http.Request) {
	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		if !h.isFacultyOrAdmin(authCtx) {
			return errUnauthorized
		}
		statuses := h.keyManager.GetStatuses()
		policy := h.service.PolicyEngine().GetPolicy(orgID.String())
		modelList := h.service.registry.List()

		model.SendJSON(w, http.StatusOK, map[string]any{
			"status":         "ok",
			"organizationId": orgID,
			"budgetMode":     policy.BudgetMode,
			"providers":      statuses,
			"allowedModels":  policy.AllowedModels,
			"catalogModels":  len(modelList),
		})
		return nil
	})
	if err != nil {
		h.handleError(w, r, err)
	}
}

// SummaryRequest defines the payload for lecture summary generation.
type SummaryRequest struct {
	CourseCode     string  `json:"courseCode"`
	TranscriptText string  `json:"transcriptText"`
	CourseID       *string `json:"courseId,omitempty"`
	ClassID        *string `json:"classId,omitempty"`
	SessionID      *string `json:"sessionId,omitempty"`
}

// generateSummary handles on-demand lecture summarization.
func (h *Handler) generateSummary(w http.ResponseWriter, r *http.Request) {
	var req SummaryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Malformed JSON request body")
		return
	}
	if strings.TrimSpace(req.TranscriptText) == "" {
		model.SendJSONError(w, r, http.StatusBadRequest, "MISSING_FIELD", "transcriptText is required")
		return
	}

	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		if !h.isFacultyOrAdmin(authCtx) {
			return errUnauthorized
		}

		userUUID, err := uuid.Parse(authCtx.UserID)
		if err != nil {
			return errUnauthenticated
		}

		summary, usage, err := h.service.SummarizeLecture(r.Context(), orgID.String(), authCtx.UserID, req.CourseCode, req.TranscriptText)
		if err != nil {
			return err
		}

		summaryBytes, err := json.Marshal(summary)
		if err != nil {
			return err
		}

		var courseUUID, classUUID, sessionUUID *uuid.UUID
		if req.CourseID != nil {
			if id, err := uuid.Parse(*req.CourseID); err == nil {
				courseUUID = &id
			}
		}
		if req.ClassID != nil {
			if id, err := uuid.Parse(*req.ClassID); err == nil {
				classUUID = &id
			}
		}
		if req.SessionID != nil {
			if id, err := uuid.Parse(*req.SessionID); err == nil {
				sessionUUID = &id
			}
		}

		artifact := &Artifact{
			ID:             uuid.New(),
			OrganizationID: orgID,
			CourseID:       courseUUID,
			ClassID:        classUUID,
			SessionID:      sessionUUID,
			CreatorUserID:  userUUID,
			ArtifactType:   "lecture_summary",
			Title:          summary.Title,
			Content:        summaryBytes,
			Visibility:     "faculty_only",
			HumanReviewed:  false,
		}

		if err := h.repo.CreateArtifact(r.Context(), tx, artifact); err != nil {
			return err
		}

		if usage != nil {
			_ = h.repo.RecordUsage(r.Context(), tx, &UsageRecord{
				ID:                    uuid.New(),
				OrganizationID:        orgID,
				UserID:                userUUID,
				CourseID:              courseUUID,
				ClassID:               classUUID,
				SessionID:             sessionUUID,
				ProviderName:          "gemini",
				ModelName:             h.service.cfg.DefaultFastModel,
				FeatureName:           "lecture_summary",
				PromptTokens:          usage.InputTokens,
				CompletionTokens:      usage.OutputTokens,
				TotalTokens:           usage.TotalTokens,
				EstimatedCostMicroUSD: usage.EstimatedCostMicroUSD,
				BilledCostMicroUSD:    usage.BilledCostMicroUSD,
				Status:                "success",
			})
		}

		model.SendJSON(w, http.StatusOK, map[string]any{
			"artifact": artifact,
			"summary":  summary,
			"usage":    usage,
		})
		return nil
	})
	if err != nil {
		h.handleError(w, r, err)
	}
}

// QuizRequest defines the payload for practice quiz generation.
type QuizRequest struct {
	CourseTitle   string  `json:"courseTitle"`
	Topic         string  `json:"topic"`
	QuestionCount int     `json:"questionCount"`
	CourseID      *string `json:"courseId,omitempty"`
	ClassID       *string `json:"classId,omitempty"`
}

// generateQuiz handles interactive quiz creation.
func (h *Handler) generateQuiz(w http.ResponseWriter, r *http.Request) {
	var req QuizRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Malformed JSON request body")
		return
	}
	if strings.TrimSpace(req.Topic) == "" {
		model.SendJSONError(w, r, http.StatusBadRequest, "MISSING_FIELD", "topic is required")
		return
	}

	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		userUUID, err := uuid.Parse(authCtx.UserID)
		if err != nil {
			return errUnauthenticated
		}

		quiz, usage, err := h.service.GeneratePracticeQuiz(r.Context(), orgID.String(), authCtx.UserID, req.CourseTitle, req.Topic, req.QuestionCount)
		if err != nil {
			return err
		}

		quizBytes, err := json.Marshal(quiz)
		if err != nil {
			return err
		}

		var courseUUID, classUUID *uuid.UUID
		if req.CourseID != nil {
			if id, err := uuid.Parse(*req.CourseID); err == nil {
				courseUUID = &id
			}
		}
		if req.ClassID != nil {
			if id, err := uuid.Parse(*req.ClassID); err == nil {
				classUUID = &id
			}
		}

		// Self-practice quizzes created by students are automatically published to self
		visibility := "faculty_only"
		if !h.isFacultyOrAdmin(authCtx) {
			visibility = "published"
		}

		artifact := &Artifact{
			ID:             uuid.New(),
			OrganizationID: orgID,
			CourseID:       courseUUID,
			ClassID:        classUUID,
			CreatorUserID:  userUUID,
			ArtifactType:   "practice_quiz",
			Title:          fmt.Sprintf("Practice Quiz: %s", req.Topic),
			Content:        quizBytes,
			Visibility:     visibility,
			HumanReviewed:  h.isFacultyOrAdmin(authCtx),
		}

		if err := h.repo.CreateArtifact(r.Context(), tx, artifact); err != nil {
			return err
		}

		model.SendJSON(w, http.StatusOK, map[string]any{
			"artifact": artifact,
			"quiz":     quiz,
			"usage":    usage,
		})
		return nil
	})
	if err != nil {
		h.handleError(w, r, err)
	}
}

// FlashcardRequest defines the payload for flashcard creation.
type FlashcardRequest struct {
	DeckTitle string  `json:"deckTitle"`
	NotesText string  `json:"notesText"`
	CourseID  *string `json:"courseId,omitempty"`
	ClassID   *string `json:"classId,omitempty"`
}

// generateFlashcards handles revision flashcards creation.
func (h *Handler) generateFlashcards(w http.ResponseWriter, r *http.Request) {
	var req FlashcardRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Malformed JSON request body")
		return
	}
	if strings.TrimSpace(req.NotesText) == "" {
		model.SendJSONError(w, r, http.StatusBadRequest, "MISSING_FIELD", "notesText is required")
		return
	}

	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		userUUID, err := uuid.Parse(authCtx.UserID)
		if err != nil {
			return errUnauthenticated
		}

		cards, usage, err := h.service.GenerateFlashcards(r.Context(), orgID.String(), authCtx.UserID, req.DeckTitle, req.NotesText)
		if err != nil {
			return err
		}

		cardsBytes, err := json.Marshal(cards)
		if err != nil {
			return err
		}

		var courseUUID, classUUID *uuid.UUID
		if req.CourseID != nil {
			if id, err := uuid.Parse(*req.CourseID); err == nil {
				courseUUID = &id
			}
		}
		if req.ClassID != nil {
			if id, err := uuid.Parse(*req.ClassID); err == nil {
				classUUID = &id
			}
		}

		artifact := &Artifact{
			ID:             uuid.New(),
			OrganizationID: orgID,
			CourseID:       courseUUID,
			ClassID:        classUUID,
			CreatorUserID:  userUUID,
			ArtifactType:   "flashcard_deck",
			Title:          cards.DeckTitle,
			Content:        cardsBytes,
			Visibility:     "faculty_only",
			HumanReviewed:  false,
		}

		if err := h.repo.CreateArtifact(r.Context(), tx, artifact); err != nil {
			return err
		}

		model.SendJSON(w, http.StatusOK, map[string]any{
			"artifact": artifact,
			"cards":    cards,
			"usage":    usage,
		})
		return nil
	})
	if err != nil {
		h.handleError(w, r, err)
	}
}

// submitSummaryJob queues an asynchronous lecture summarization job into PostgreSQL background_jobs.
func (h *Handler) submitSummaryJob(w http.ResponseWriter, r *http.Request) {
	var req SummaryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Malformed JSON request body")
		return
	}
	if strings.TrimSpace(req.TranscriptText) == "" {
		model.SendJSONError(w, r, http.StatusBadRequest, "MISSING_FIELD", "transcriptText is required")
		return
	}

	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		if !h.isFacultyOrAdmin(authCtx) {
			return errUnauthorized
		}

		jobPayload := LectureSummaryJobPayload{
			OrganizationID: orgID.String(),
			UserID:         authCtx.UserID,
			CourseID:       req.CourseID,
			ClassID:        req.ClassID,
			SessionID:      req.SessionID,
			CourseCode:     req.CourseCode,
			TranscriptText: req.TranscriptText,
			Title:          fmt.Sprintf("Lecture Summary: %s", req.CourseCode),
		}

		job, err := EnqueueLectureSummaryJob(r.Context(), tx, jobPayload)
		if err != nil {
			return err
		}

		model.SendJSON(w, http.StatusAccepted, map[string]any{
			"status":         "queued",
			"jobId":          job.ID,
			"queue":          job.Queue,
			"idempotencyKey": job.IdempotencyKey,
			"scheduledAt":    job.ScheduledAt,
			"note":           "Background job enqueued in persistent ledger. Render Free instances may experience processing delays.",
		})
		return nil
	})
	if err != nil {
		h.handleError(w, r, err)
	}
}

// getJobStatus retrieves current execution status of an asynchronous background job.
func (h *Handler) getJobStatus(w http.ResponseWriter, r *http.Request) {
	jobIDStr := chi.URLParam(r, "id")
	jobID, err := uuid.Parse(jobIDStr)
	if err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_JOB_ID", "Invalid job UUID")
		return
	}

	err = h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		query := `
			SELECT id, queue, status, attempt_count, max_attempts, scheduled_at, last_error, created_at, updated_at
			FROM background_jobs
			WHERE id = $1;
		`
		var (
			id          uuid.UUID
			queue       string
			status      string
			attempts    int
			maxAttempts int
			scheduledAt time.Time
			lastError   *string
			createdAt   time.Time
			updatedAt   time.Time
		)

		err := tx.QueryRow(r.Context(), query, jobID).Scan(
			&id, &queue, &status, &attempts, &maxAttempts, &scheduledAt, &lastError, &createdAt, &updatedAt,
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrArtifactNotFound
			}
			return err
		}

		model.SendJSON(w, http.StatusOK, map[string]any{
			"id":           id,
			"queue":        queue,
			"status":       status,
			"attemptCount": attempts,
			"maxAttempts":  maxAttempts,
			"scheduledAt":  scheduledAt,
			"lastError":    lastError,
			"createdAt":    createdAt,
			"updatedAt":    updatedAt,
		})
		return nil
	})
	if err != nil {
		h.handleError(w, r, err)
	}
}

// listArtifacts lists AI artifacts with RLS filtering.
func (h *Handler) listArtifacts(w http.ResponseWriter, r *http.Request) {
	var courseIDPtr, classIDPtr, typePtr *string
	if c := r.URL.Query().Get("courseId"); c != "" {
		courseIDPtr = &c
	}
	if cl := r.URL.Query().Get("classId"); cl != "" {
		classIDPtr = &cl
	}
	if t := r.URL.Query().Get("type"); t != "" {
		typePtr = &t
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		artifacts, totalCount, err := h.repo.ListArtifacts(r.Context(), tx, orgID, courseIDPtr, classIDPtr, typePtr, limit, offset)
		if err != nil {
			return err
		}

		model.SendJSON(w, http.StatusOK, map[string]any{
			"artifacts":  artifacts,
			"totalCount": totalCount,
			"limit":      limit,
			"offset":     offset,
		})
		return nil
	})
	if err != nil {
		h.handleError(w, r, err)
	}
}

// getArtifact retrieves a specific artifact by ID.
func (h *Handler) getArtifact(w http.ResponseWriter, r *http.Request) {
	artifactIDStr := chi.URLParam(r, "id")
	artifactID, err := uuid.Parse(artifactIDStr)
	if err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_ID", "Invalid artifact UUID")
		return
	}

	err = h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		artifact, err := h.repo.GetArtifact(r.Context(), tx, orgID, artifactID)
		if err != nil {
			return err
		}

		model.SendJSON(w, http.StatusOK, map[string]any{
			"artifact": artifact,
		})
		return nil
	})
	if err != nil {
		h.handleError(w, r, err)
	}
}

// ReviewRequest defines the payload for faculty artifact review.
type ReviewRequest struct {
	Visibility string `json:"visibility"` // 'published', 'archived', 'faculty_only'
}

// reviewArtifact updates the review status of an artifact (Faculty only).
func (h *Handler) reviewArtifact(w http.ResponseWriter, r *http.Request) {
	artifactIDStr := chi.URLParam(r, "id")
	artifactID, err := uuid.Parse(artifactIDStr)
	if err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_ID", "Invalid artifact UUID")
		return
	}

	var req ReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Malformed JSON request body")
		return
	}
	if req.Visibility == "" {
		req.Visibility = "published"
	}

	err = h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		if !h.isFacultyOrAdmin(authCtx) {
			return errUnauthorized
		}
		userUUID, err := uuid.Parse(authCtx.UserID)
		if err != nil {
			return errUnauthenticated
		}

		if err := h.repo.ReviewArtifact(r.Context(), tx, orgID, artifactID, userUUID, req.Visibility); err != nil {
			return err
		}

		model.SendJSON(w, http.StatusOK, map[string]any{
			"status":     "reviewed",
			"artifactId": artifactID,
			"visibility": req.Visibility,
		})
		return nil
	})
	if err != nil {
		h.handleError(w, r, err)
	}
}

// getPolicy retrieves the organization policy.
func (h *Handler) getPolicy(w http.ResponseWriter, r *http.Request) {
	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		policy, err := h.repo.GetOrgPolicy(r.Context(), tx, orgID)
		if err != nil {
			return err
		}
		model.SendJSON(w, http.StatusOK, map[string]any{
			"policy": policy,
		})
		return nil
	})
	if err != nil {
		h.handleError(w, r, err)
	}
}

// updatePolicy updates the organization policy (Institution Admin only).
func (h *Handler) updatePolicy(w http.ResponseWriter, r *http.Request) {
	var p OrgPolicy
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Malformed JSON request body")
		return
	}

	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		if authCtx.Role == nil || (*authCtx.Role != "institution_admin" && !authCtx.IsSuperAdmin) {
			return errUnauthorized
		}
		p.OrganizationID = orgID.String()

		if err := h.service.PolicyEngine().SetPolicy(&p); err != nil {
			return err
		}
		if err := h.repo.UpsertOrgPolicy(r.Context(), tx, &p); err != nil {
			return err
		}

		model.SendJSON(w, http.StatusOK, map[string]any{
			"policy": p,
		})
		return nil
	})
	if err != nil {
		h.handleError(w, r, err)
	}
}

// getUsage returns usage and cost analytics for the organization.
func (h *Handler) getUsage(w http.ResponseWriter, r *http.Request) {
	err := h.inOrg(r, func(tx pgx.Tx, authCtx *database.AuthContext, orgID uuid.UUID) error {
		now := time.Now().UTC()
		startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)

		summary, err := h.repo.GetOrgUsageSummary(r.Context(), tx, orgID, startOfMonth, now)
		if err != nil {
			return err
		}

		policy, _ := h.repo.GetOrgPolicy(r.Context(), tx, orgID)

		model.SendJSON(w, http.StatusOK, map[string]any{
			"usageSummary": summary,
			"policy":       policy,
		})
		return nil
	})
	if err != nil {
		h.handleError(w, r, err)
	}
}

func (h *Handler) handleError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errInvalidOrgID):
		model.SendJSONError(w, r, http.StatusBadRequest, "INVALID_ORGANIZATION_ID", "Invalid organization UUID in path")
	case errors.Is(err, errUnauthenticated) || errors.Is(err, database.ErrSessionInvalid) || errors.Is(err, database.ErrNoSessionToken):
		model.SendJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required")
	case errors.Is(err, errUnauthorized) || errors.Is(err, database.ErrMembershipDenied):
		model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "You do not have permission to access this resource")
	case errors.Is(err, ErrModelNotAllowed):
		model.SendJSONError(w, r, http.StatusForbidden, "MODEL_NOT_PERMITTED", "Requested model is not permitted by organization policy")
	case errors.Is(err, ErrArtifactNotFound):
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "Requested resource not found")
	case errors.Is(err, ErrRateLimitExceeded):
		model.SendJSONError(w, r, http.StatusTooManyRequests, "RATE_LIMIT_EXCEEDED", "AI request limit exceeded. Please wait before retrying.")
	case errors.Is(err, ErrRateLimiterUnavailable):
		logAIFailure(r, err)
		model.SendJSONError(w, r, http.StatusServiceUnavailable, "AI_RATE_LIMITER_UNAVAILABLE", "AI is temporarily unavailable. Please retry shortly.")
	case errors.Is(err, ErrBudgetExceeded):
		model.SendJSONError(w, r, http.StatusPaymentRequired, "BUDGET_EXCEEDED", "Organization monthly AI budget reached")
	case errors.Is(err, ErrNonFreeModelBlocked):
		model.SendJSONError(w, r, http.StatusPaymentRequired, "FREE_TIER_ONLY", "Organization policy restricts AI usage to free-tier models only")
	case errors.Is(err, ErrPromptTooLarge):
		model.SendJSONError(w, r, http.StatusBadRequest, "PROMPT_TOO_LARGE", "Prompt exceeds maximum allowable token limit")
	case errors.Is(err, ErrPromptInjectionDetected):
		model.SendJSONError(w, r, http.StatusBadRequest, "PROMPT_INJECTION_DETECTED", "Input rejected: adversarial instruction patterns detected")
	case errors.Is(err, ErrInvalidStructuredOutput):
		model.SendJSONError(w, r, http.StatusBadGateway, "MODEL_OUTPUT_INVALID", "AI model response could not be validated against academic schema")
	case errors.Is(err, ErrProviderNotConfigured):
		model.SendJSONError(w, r, http.StatusServiceUnavailable, "AI_PROVIDER_NOT_CONFIGURED", "AI is not configured on this server.")
	case errors.Is(err, ErrProviderQuotaExhausted):
		model.SendJSONError(w, r, http.StatusServiceUnavailable, "AI_PROVIDER_QUOTA_EXHAUSTED", "The free AI quota is used up for now. Please try again later.")
	case errors.Is(err, ErrProviderOverloaded):
		w.Header().Set("Retry-After", "60")
		model.SendJSONError(w, r, http.StatusServiceUnavailable, "AI_PROVIDER_RATE_LIMITED", "AI providers are rate limiting requests. Please retry in a minute.")
	case errors.Is(err, ErrUnauthorizedProvider):
		logAIFailure(r, err)
		model.SendJSONError(w, r, http.StatusServiceUnavailable, "AI_PROVIDER_AUTH_FAILED", "AI providers rejected the server credentials.")
	case errors.Is(err, ErrProviderTimeout):
		model.SendJSONError(w, r, http.StatusGatewayTimeout, "AI_PROVIDER_TIMEOUT", "AI provider request timed out.")
	case errors.Is(err, ErrProviderUnavailable):
		logAIFailure(r, err)
		model.SendJSONError(w, r, http.StatusServiceUnavailable, "AI_PROVIDER_UNAVAILABLE", "AI providers are currently unavailable. Please retry later.")
	default:
		logAIFailure(r, err)
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "An error occurred processing the request")
	}
}

// logAIFailure records server-side failures. Error chains carry provider, status and a bounded
// upstream snippet only; prompts and keys are never part of them.
func logAIFailure(r *http.Request, err error) {
	slog.Error("ai_request_failed", slog.String("path", r.URL.Path), slog.String("error", err.Error()))
}
