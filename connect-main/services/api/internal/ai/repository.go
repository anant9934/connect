package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	// ErrArtifactNotFound is returned when an AI artifact cannot be located or is inaccessible under RLS.
	ErrArtifactNotFound = errors.New("ai artifact not found")
)

// Artifact represents a persistent AI-generated learning asset.
type Artifact struct {
	ID             uuid.UUID       `json:"id"`
	OrganizationID uuid.UUID       `json:"organizationId"`
	CourseID       *uuid.UUID      `json:"courseId,omitempty"`
	ClassID        *uuid.UUID      `json:"classId,omitempty"`
	SessionID      *uuid.UUID      `json:"sessionId,omitempty"`
	CreatorUserID  uuid.UUID       `json:"creatorUserId"`
	ArtifactType   string          `json:"artifactType"` // 'lecture_summary', 'practice_quiz', 'flashcard_deck', 'study_plan'
	Title          string          `json:"title"`
	Content        json.RawMessage `json:"content"`
	StoragePath    *string         `json:"storagePath,omitempty"`
	Visibility     string          `json:"visibility"` // 'faculty_only', 'published', 'archived'
	HumanReviewed  bool            `json:"humanReviewed"`
	ReviewedBy     *uuid.UUID      `json:"reviewedBy,omitempty"`
	ReviewedAt     *time.Time      `json:"reviewedAt,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

// UsageRecord represents an immutable token consumption log entry.
type UsageRecord struct {
	ID                    uuid.UUID  `json:"id"`
	OrganizationID        uuid.UUID  `json:"organizationId"`
	UserID                uuid.UUID  `json:"userId"`
	CourseID              *uuid.UUID `json:"courseId,omitempty"`
	ClassID               *uuid.UUID `json:"classId,omitempty"`
	SessionID             *uuid.UUID `json:"sessionId,omitempty"`
	ProviderName          string     `json:"providerName"`
	ModelName             string     `json:"modelName"`
	FeatureName           string     `json:"featureName"`
	PromptTokens          int        `json:"promptTokens"`
	CompletionTokens      int        `json:"completionTokens"`
	TotalTokens           int        `json:"totalTokens"`
	EstimatedCostMicroUSD int64      `json:"estimatedCostMicroUSD"`
	BilledCostMicroUSD    int64      `json:"billedCostMicroUSD"`
	LatencyMS             int        `json:"latencyMs"`
	Status                string     `json:"status"`
	CreatedAt             time.Time  `json:"createdAt"`
}

// UsageSummary aggregates usage metrics for an organization over a period.
type UsageSummary struct {
	OrganizationID         uuid.UUID `json:"organizationId"`
	TotalRequests          int       `json:"totalRequests"`
	TotalPromptTokens      int64     `json:"totalPromptTokens"`
	TotalCompletionTokens  int64     `json:"totalCompletionTokens"`
	TotalTokens            int64     `json:"totalTokens"`
	EstimatedCostMicroUSD  int64     `json:"estimatedCostMicroUSD"`
	BilledCostMicroUSD     int64     `json:"billedCostMicroUSD"`
	FeaturesBreakdown      map[string]int `json:"featuresBreakdown"`
}

// Repository manages database interactions for AI tables, always operating within
// a transaction authenticated via connect_auth.authenticate_session to respect RLS.
type Repository struct{}

// NewRepository constructs an AI repository.
func NewRepository() *Repository {
	return &Repository{}
}

// GetOrgPolicy loads the organization policy from the database within the current auth context.
func (r *Repository) GetOrgPolicy(ctx context.Context, tx pgx.Tx, orgID uuid.UUID) (*OrgPolicy, error) {
	query := `
		SELECT organization_id, budget_mode, monthly_budget_micro_usd, current_spend_micro_usd,
		       billing_cycle_anchor, allowed_models, updated_at
		FROM ai_organization_policies
		WHERE organization_id = $1;
	`
	var (
		orgIDOut   uuid.UUID
		mode       string
		budget     int64
		spend      int64
		anchor     time.Time
		models     []string
		updatedAt  time.Time
	)

	err := tx.QueryRow(ctx, query, orgID).Scan(
		&orgIDOut,
		&mode,
		&budget,
		&spend,
		&anchor,
		&models,
		&updatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// If no row exists yet, return default free_only policy
			return NewDefaultOrgPolicy(orgID.String()), nil
		}
		return nil, fmt.Errorf("failed to query ai_organization_policies: %w", err)
	}

	return &OrgPolicy{
		OrganizationID:        orgIDOut.String(),
		BudgetMode:            BudgetMode(mode),
		MonthlyBudgetMicroUSD: budget,
		CurrentSpendMicroUSD:  spend,
		BillingCycleAnchor:    anchor,
		AllowedModels:         models,
		UpdatedAt:             updatedAt,
	}, nil
}

// UpsertOrgPolicy saves or updates the organization policy in the database.
func (r *Repository) UpsertOrgPolicy(ctx context.Context, tx pgx.Tx, p *OrgPolicy) error {
	orgID, err := uuid.Parse(p.OrganizationID)
	if err != nil {
		return fmt.Errorf("invalid organization UUID: %w", err)
	}

	query := `
		INSERT INTO ai_organization_policies (
			organization_id, budget_mode, monthly_budget_micro_usd, current_spend_micro_usd,
			billing_cycle_anchor, allowed_models, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, clock_timestamp()
		)
		ON CONFLICT (organization_id) DO UPDATE SET
			budget_mode = EXCLUDED.budget_mode,
			monthly_budget_micro_usd = EXCLUDED.monthly_budget_micro_usd,
			allowed_models = EXCLUDED.allowed_models,
			updated_at = clock_timestamp();
	`

	_, err = tx.Exec(ctx, query,
		orgID,
		string(p.BudgetMode),
		p.MonthlyBudgetMicroUSD,
		p.CurrentSpendMicroUSD,
		p.BillingCycleAnchor,
		p.AllowedModels,
	)
	if err != nil {
		return fmt.Errorf("failed to upsert ai_organization_policies: %w", err)
	}
	return nil
}

// RecordUsage inserts an immutable token usage record into the ledger.
func (r *Repository) RecordUsage(ctx context.Context, tx pgx.Tx, rec *UsageRecord) error {
	if rec.ID == uuid.Nil {
		rec.ID = uuid.New()
	}

	query := `
		INSERT INTO ai_usage_ledger (
			id, organization_id, user_id, course_id, class_id, session_id,
			provider_name, model_name, feature_name, prompt_tokens, completion_tokens,
			total_tokens, estimated_cost_micro_usd, billed_cost_micro_usd, latency_ms,
			status, created_at
		) VALUES (
			$1, $2, $3, $4, $5, $6,
			$7, $8, $9, $10, $11,
			$12, $13, $14, $15,
			$16, clock_timestamp()
		);
	`

	_, err := tx.Exec(ctx, query,
		rec.ID,
		rec.OrganizationID,
		rec.UserID,
		rec.CourseID,
		rec.ClassID,
		rec.SessionID,
		rec.ProviderName,
		rec.ModelName,
		rec.FeatureName,
		rec.PromptTokens,
		rec.CompletionTokens,
		rec.TotalTokens,
		rec.EstimatedCostMicroUSD,
		rec.BilledCostMicroUSD,
		rec.LatencyMS,
		rec.Status,
	)
	if err != nil {
		return fmt.Errorf("failed to insert ai_usage_ledger record: %w", err)
	}

	// Also atomically update current_spend_micro_usd on ai_organization_policies if billed cost > 0
	if rec.BilledCostMicroUSD > 0 {
		updateSpendQuery := `
			UPDATE ai_organization_policies
			SET current_spend_micro_usd = current_spend_micro_usd + $1,
			    updated_at = clock_timestamp()
			WHERE organization_id = $2;
		`
		_, _ = tx.Exec(ctx, updateSpendQuery, rec.BilledCostMicroUSD, rec.OrganizationID)
	}

	return nil
}

// CreateArtifact persists a validated AI-generated learning artifact.
func (r *Repository) CreateArtifact(ctx context.Context, tx pgx.Tx, a *Artifact) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	if a.Visibility == "" {
		a.Visibility = "faculty_only"
	}

	query := `
		INSERT INTO ai_artifacts (
			id, organization_id, course_id, class_id, session_id,
			creator_user_id, artifact_type, title, content, storage_path,
			visibility, human_reviewed, reviewed_by, reviewed_at, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9, $10,
			$11, $12, $13, $14, clock_timestamp(), clock_timestamp()
		)
		RETURNING created_at, updated_at;
	`

	err := tx.QueryRow(ctx, query,
		a.ID,
		a.OrganizationID,
		a.CourseID,
		a.ClassID,
		a.SessionID,
		a.CreatorUserID,
		a.ArtifactType,
		a.Title,
		a.Content,
		a.StoragePath,
		a.Visibility,
		a.HumanReviewed,
		a.ReviewedBy,
		a.ReviewedAt,
	).Scan(&a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return fmt.Errorf("failed to create ai_artifact: %w", err)
	}
	return nil
}

// GetArtifact retrieves a single artifact by ID under RLS.
func (r *Repository) GetArtifact(ctx context.Context, tx pgx.Tx, orgID, artifactID uuid.UUID) (*Artifact, error) {
	query := `
		SELECT id, organization_id, course_id, class_id, session_id,
		       creator_user_id, artifact_type, title, content, storage_path,
		       visibility, human_reviewed, reviewed_by, reviewed_at, created_at, updated_at
		FROM ai_artifacts
		WHERE organization_id = $1 AND id = $2;
	`

	var a Artifact
	err := tx.QueryRow(ctx, query, orgID, artifactID).Scan(
		&a.ID,
		&a.OrganizationID,
		&a.CourseID,
		&a.ClassID,
		&a.SessionID,
		&a.CreatorUserID,
		&a.ArtifactType,
		&a.Title,
		&a.Content,
		&a.StoragePath,
		&a.Visibility,
		&a.HumanReviewed,
		&a.ReviewedBy,
		&a.ReviewedAt,
		&a.CreatedAt,
		&a.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrArtifactNotFound
		}
		return nil, fmt.Errorf("failed to query ai_artifact: %w", err)
	}
	return &a, nil
}

// ListArtifacts retrieves artifacts filtered by course, class, or type, governed by RLS.
func (r *Repository) ListArtifacts(
	ctx context.Context,
	tx pgx.Tx,
	orgID uuid.UUID,
	courseID, classID, artifactType *string,
	limit, offset int,
) ([]Artifact, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	query := `
		SELECT id, organization_id, course_id, class_id, session_id,
		       creator_user_id, artifact_type, title, content, storage_path,
		       visibility, human_reviewed, reviewed_by, reviewed_at, created_at, updated_at,
		       count(*) OVER() AS total_count
		FROM ai_artifacts
		WHERE organization_id = $1
		  AND ($2::uuid IS NULL OR course_id = $2::uuid)
		  AND ($3::uuid IS NULL OR class_id = $3::uuid)
		  AND ($4::varchar IS NULL OR artifact_type = $4::varchar)
		ORDER BY created_at DESC
		LIMIT $5 OFFSET $6;
	`

	rows, err := tx.Query(ctx, query, orgID, courseID, classID, artifactType, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list ai_artifacts: %w", err)
	}
	defer rows.Close()

	var artifacts []Artifact
	var totalCount int

	for rows.Next() {
		var a Artifact
		if err := rows.Scan(
			&a.ID,
			&a.OrganizationID,
			&a.CourseID,
			&a.ClassID,
			&a.SessionID,
			&a.CreatorUserID,
			&a.ArtifactType,
			&a.Title,
			&a.Content,
			&a.StoragePath,
			&a.Visibility,
			&a.HumanReviewed,
			&a.ReviewedBy,
			&a.ReviewedAt,
			&a.CreatedAt,
			&a.UpdatedAt,
			&totalCount,
		); err != nil {
			return nil, 0, fmt.Errorf("failed to scan ai_artifact row: %w", err)
		}
		artifacts = append(artifacts, a)
	}

	return artifacts, totalCount, rows.Err()
}

// ReviewArtifact marks an artifact as human-reviewed and updates visibility.
func (r *Repository) ReviewArtifact(
	ctx context.Context,
	tx pgx.Tx,
	orgID, artifactID, reviewerID uuid.UUID,
	visibility string,
) error {
	query := `
		UPDATE ai_artifacts
		SET human_reviewed = true,
		    reviewed_by = $1,
		    reviewed_at = clock_timestamp(),
		    visibility = $2,
		    updated_at = clock_timestamp()
		WHERE organization_id = $3 AND id = $4;
	`

	tag, err := tx.Exec(ctx, query, reviewerID, visibility, orgID, artifactID)
	if err != nil {
		return fmt.Errorf("failed to review ai_artifact: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrArtifactNotFound
	}
	return nil
}

// GetOrgUsageSummary computes aggregated usage metrics for the given organization.
func (r *Repository) GetOrgUsageSummary(ctx context.Context, tx pgx.Tx, orgID uuid.UUID, from, to time.Time) (*UsageSummary, error) {
	query := `
		SELECT count(*),
		       COALESCE(sum(prompt_tokens), 0),
		       COALESCE(sum(completion_tokens), 0),
		       COALESCE(sum(total_tokens), 0),
		       COALESCE(sum(estimated_cost_micro_usd), 0),
		       COALESCE(sum(billed_cost_micro_usd), 0)
		FROM ai_usage_ledger
		WHERE organization_id = $1
		  AND created_at >= $2
		  AND created_at <= $3;
	`

	summary := &UsageSummary{
		OrganizationID:    orgID,
		FeaturesBreakdown: make(map[string]int),
	}

	err := tx.QueryRow(ctx, query, orgID, from, to).Scan(
		&summary.TotalRequests,
		&summary.TotalPromptTokens,
		&summary.TotalCompletionTokens,
		&summary.TotalTokens,
		&summary.EstimatedCostMicroUSD,
		&summary.BilledCostMicroUSD,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query usage summary: %w", err)
	}

	// Features breakdown query
	breakdownQuery := `
		SELECT feature_name, count(*)
		FROM ai_usage_ledger
		WHERE organization_id = $1
		  AND created_at >= $2
		  AND created_at <= $3
		GROUP BY feature_name;
	`
	rows, err := tx.Query(ctx, breakdownQuery, orgID, from, to)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var feat string
			var cnt int
			if err := rows.Scan(&feat, &cnt); err == nil {
				summary.FeaturesBreakdown[feat] = cnt
			}
		}
	}

	return summary, nil
}
