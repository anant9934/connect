package ai

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// BudgetMode specifies the strict financial constraints governing an organization's AI consumption.
type BudgetMode string

const (
	// BudgetModeFreeOnly permits ONLY models flagged as free tier ($0/MTok).
	// Any paid model request is blocked immediately with ErrNonFreeModelBlocked.
	BudgetModeFreeOnly BudgetMode = "free_only"

	// BudgetModeCapped enforces a hard upper bound on spend in micro-USD.
	// MonthlyBudgetMicroUSD MUST be strictly > 0.
	// Requests are blocked once current spend reaches or exceeds the budget.
	BudgetModeCapped BudgetMode = "capped"

	// BudgetModeUnlimited allows execution without a monetary ceiling, but tracks all spend.
	// Must be explicitly enabled by an institution admin.
	BudgetModeUnlimited BudgetMode = "unlimited"
)

// DefaultAllowedModels represents the default safe free-tier models permitted for every tenant.
var DefaultAllowedModels = []string{
	"gemini-2.0-flash",
	"gemini-1.5-flash",
	"llama-3.3-70b-versatile",
	"mock-academic-v1",
}

// OrgPolicy represents the living AI governance state for a specific tenant.
type OrgPolicy struct {
	OrganizationID          string     `json:"organizationId"`
	BudgetMode              BudgetMode `json:"budgetMode"`
	MonthlyBudgetMicroUSD   int64      `json:"monthlyBudgetMicroUSD"`
	CurrentSpendMicroUSD    int64      `json:"currentSpendMicroUSD"`
	BillingCycleAnchor      time.Time  `json:"billingCycleAnchor"`
	AllowedModels           []string   `json:"allowedModels"`
	UpdatedAt               time.Time  `json:"updatedAt"`
}

// NewDefaultOrgPolicy returns the initial safe configuration for a new organization.
// Every organization defaults strictly to free_only.
func NewDefaultOrgPolicy(orgID string) *OrgPolicy {
	return &OrgPolicy{
		OrganizationID:        orgID,
		BudgetMode:            BudgetModeFreeOnly,
		MonthlyBudgetMicroUSD: 0, // In free_only mode, 0 does NOT mean unlimited!
		CurrentSpendMicroUSD:  0,
		BillingCycleAnchor:    time.Now().UTC().Truncate(24 * time.Hour),
		AllowedModels:         append([]string(nil), DefaultAllowedModels...),
		UpdatedAt:             time.Now().UTC(),
	}
}

// PolicyEngine provides thread-safe, atomic evaluation and ledger reservation.
type PolicyEngine struct {
	mu       sync.RWMutex
	policies map[string]*OrgPolicy
	registry *ModelRegistry
}

// NewPolicyEngine constructs an in-memory policy engine.
func NewPolicyEngine(registry *ModelRegistry) *PolicyEngine {
	return &PolicyEngine{
		policies: make(map[string]*OrgPolicy),
		registry: registry,
	}
}

// GetPolicy retrieves the policy for an organization, defaulting to FreeOnly if absent.
func (pe *PolicyEngine) GetPolicy(orgID string) *OrgPolicy {
	pe.mu.RLock()
	p, ok := pe.policies[orgID]
	pe.mu.RUnlock()

	if !ok {
		p = NewDefaultOrgPolicy(orgID)
		pe.mu.Lock()
		if existing, exists := pe.policies[orgID]; exists {
			p = existing
		} else {
			pe.policies[orgID] = p
		}
		pe.mu.Unlock()
	}

	pe.mu.RLock()
	defer pe.mu.RUnlock()
	// Return a defensive copy
	return &OrgPolicy{
		OrganizationID:        p.OrganizationID,
		BudgetMode:            p.BudgetMode,
		MonthlyBudgetMicroUSD: p.MonthlyBudgetMicroUSD,
		CurrentSpendMicroUSD:  p.CurrentSpendMicroUSD,
		BillingCycleAnchor:    p.BillingCycleAnchor,
		AllowedModels:         append([]string(nil), p.AllowedModels...),
		UpdatedAt:             p.UpdatedAt,
	}
}

// SetPolicy sets or updates the policy for an organization with rigorous validation.
func (pe *PolicyEngine) SetPolicy(policy *OrgPolicy) error {
	if policy == nil || policy.OrganizationID == "" {
		return fmt.Errorf("invalid organization policy: missing organization ID")
	}

	switch policy.BudgetMode {
	case BudgetModeFreeOnly:
		// free_only is always valid
	case BudgetModeCapped:
		if policy.MonthlyBudgetMicroUSD <= 0 {
			return fmt.Errorf("budget_mode 'capped' requires monthly_budget_micro_usd > 0 (zero is not unlimited)")
		}
	case BudgetModeUnlimited:
		// unlimited allowed when explicitly set
	default:
		return fmt.Errorf("unrecognized budget_mode: %q", policy.BudgetMode)
	}

	pe.mu.Lock()
	defer pe.mu.Unlock()

	policy.UpdatedAt = time.Now().UTC()
	pe.policies[policy.OrganizationID] = &OrgPolicy{
		OrganizationID:        policy.OrganizationID,
		BudgetMode:            policy.BudgetMode,
		MonthlyBudgetMicroUSD: policy.MonthlyBudgetMicroUSD,
		CurrentSpendMicroUSD:  policy.CurrentSpendMicroUSD,
		BillingCycleAnchor:    policy.BillingCycleAnchor,
		AllowedModels:         append([]string(nil), policy.AllowedModels...),
		UpdatedAt:             policy.UpdatedAt,
	}

	return nil
}

// AuthorizeRequest atomically verifies if a model request is permitted under the tenant policy.
// It returns an estimated reservation cost in micro-USD.
func (pe *PolicyEngine) AuthorizeRequest(ctx context.Context, orgID, modelID string, estimatedTokens int) (int64, error) {
	pe.mu.Lock()
	defer pe.mu.Unlock()

	p, ok := pe.policies[orgID]
	if !ok {
		p = NewDefaultOrgPolicy(orgID)
		pe.policies[orgID] = p
	}

	// 1. Fetch model definition to determine price
	modelInfo, err := pe.registry.GetModel(modelID)
	if err != nil {
		return 0, err
	}

	// 2. Evaluate Budget Mode
	switch p.BudgetMode {
	case BudgetModeFreeOnly:
		// In free_only mode, only models marked IsFreeTierEligible or zero pricing are authorized
		if !modelInfo.IsFreeTierEligible && (modelInfo.InputMicroUSDPerMTok > 0 || modelInfo.OutputMicroUSDPerMTok > 0) {
			return 0, fmt.Errorf("%w: %s requires paid credits but org %s is in free_only mode", ErrNonFreeModelBlocked, modelID, orgID)
		}
	}

	// 3. Check allowed models list
	modelAllowed := false
	for _, m := range p.AllowedModels {
		if m == modelID {
			modelAllowed = true
			break
		}
	}
	if !modelAllowed && len(p.AllowedModels) > 0 {
		return 0, fmt.Errorf("%w: model %q not permitted for organization %s", ErrModelNotAllowed, modelID, orgID)
	}

	estimatedCost, err := pe.registry.CalculateCostMicroUSD(modelID, estimatedTokens/2, estimatedTokens/2)
	if err != nil {
		return 0, err
	}

	switch p.BudgetMode {
	case BudgetModeFreeOnly:
		return 0, nil // Free models incur 0 billed cost

	case BudgetModeCapped:
		if p.MonthlyBudgetMicroUSD <= 0 {
			return 0, fmt.Errorf("%w: budget capped at 0 micro-USD", ErrBudgetExceeded)
		}
		// Atomic check against current spend
		if p.CurrentSpendMicroUSD+estimatedCost > p.MonthlyBudgetMicroUSD {
			return 0, fmt.Errorf("%w: current spend %d + est %d exceeds budget %d micro-USD",
				ErrBudgetExceeded, p.CurrentSpendMicroUSD, estimatedCost, p.MonthlyBudgetMicroUSD)
		}
		return estimatedCost, nil

	case BudgetModeUnlimited:
		return estimatedCost, nil

	default:
		return 0, fmt.Errorf("unknown budget mode: %s", p.BudgetMode)
	}
}

// CommitSpend atomically increments an organization's billed spend ledger.
func (pe *PolicyEngine) CommitSpend(orgID string, billedMicroUSD int64) {
	if billedMicroUSD <= 0 {
		return
	}
	pe.mu.Lock()
	defer pe.mu.Unlock()

	if p, ok := pe.policies[orgID]; ok {
		p.CurrentSpendMicroUSD += billedMicroUSD
		p.UpdatedAt = time.Now().UTC()
	}
}
