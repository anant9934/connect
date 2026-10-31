package academic_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tathastu/connect/services/api/internal/academic"
)

func TestClassSessionConsistency(t *testing.T) {
	orgID := uuid.New().String()
	courseA := uuid.New().String()
	courseB := uuid.New().String()

	batchA := &academic.CourseBatch{
		ID:             uuid.New().String(),
		OrganizationID: orgID,
		CourseID:       courseA,
	}

	allocA := &academic.FacultyAllocation{
		ID:             uuid.New().String(),
		OrganizationID: orgID,
		CourseID:       courseA,
		FacultyUserID:  uuid.New().String(),
		Status:         "active",
	}

	allocB := &academic.FacultyAllocation{
		ID:             uuid.New().String(),
		OrganizationID: orgID,
		CourseID:       courseB,
		FacultyUserID:  uuid.New().String(),
		Status:         "active",
	}

	// 1. Same Course -> Match
	if err := academic.ValidateClassSessionConsistency(batchA, allocA); err != nil {
		t.Errorf("expected consistency match, got err: %v", err)
	}

	// 2. Different Course -> Mismatch
	if err := academic.ValidateClassSessionConsistency(batchA, allocB); err != academic.ErrCourseMismatch {
		t.Errorf("expected ErrCourseMismatch, got: %v", err)
	}

	// 3. Different Org -> Mismatch
	allocOtherOrg := &academic.FacultyAllocation{
		ID:             uuid.New().String(),
		OrganizationID: uuid.New().String(),
		CourseID:       courseA,
	}
	if err := academic.ValidateClassSessionConsistency(batchA, allocOtherOrg); err != academic.ErrCourseMismatch {
		t.Errorf("expected ErrCourseMismatch for cross-org, got: %v", err)
	}
}

func TestFacultyAllocationLifecycle_Revocation(t *testing.T) {
	alloc := &academic.FacultyAllocation{
		ID:            uuid.New().String(),
		Status:        "active",
		EffectiveFrom: time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC),
	}

	adminID := uuid.New().String()

	// 1. Short reason rejected
	if err := academic.RevokeFacultyAllocation(alloc, adminID, "short", time.Now()); err != academic.ErrInvalidRevocation {
		t.Errorf("expected ErrInvalidRevocation for short reason, got: %v", err)
	}

	// 2. Valid reason succeeds
	revokeTime := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	validReason := "Faculty member reassigned to administrative duties"
	if err := academic.RevokeFacultyAllocation(alloc, adminID, validReason, revokeTime); err != nil {
		t.Fatalf("unexpected error revoking allocation: %v", err)
	}

	if alloc.Status != "revoked" || alloc.RevokedBy == nil || *alloc.RevokedBy != adminID || alloc.RevocationReason == nil || *alloc.RevocationReason != validReason {
		t.Errorf("unexpected revoked allocation state: %+v", alloc)
	}

	// Active check before revocation: true
	beforeTime := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	if !academic.IsFacultyAllocationActiveAt(alloc, beforeTime) {
		t.Error("expected allocation to be active before revocation timestamp")
	}

	// Active check after revocation: false
	afterTime := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	if academic.IsFacultyAllocationActiveAt(alloc, afterTime) {
		t.Error("expected allocation to NOT be active after revocation timestamp")
	}
}

func TestStudentEnrollmentLifecycle_TemporalEligibility(t *testing.T) {
	enrollTime := time.Date(2026, 9, 1, 9, 0, 0, 0, time.UTC)
	enrollment := &academic.CourseEnrollment{
		ID:            uuid.New().String(),
		StudentUserID: uuid.New().String(),
		Status:        "enrolled",
		EnrolledAt:    enrollTime,
	}

	// 1. Session before enrollment -> Ineligible
	beforeSession := time.Date(2026, 8, 30, 10, 0, 0, 0, time.UTC)
	if academic.IsStudentEligibleAt(enrollment, beforeSession) {
		t.Error("expected student to be ineligible before enrollment date")
	}

	// 2. Session during active enrollment -> Eligible
	activeSession := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	if !academic.IsStudentEligibleAt(enrollment, activeSession) {
		t.Error("expected student to be eligible during active enrollment")
	}

	// 3. Drop student on Oct 1
	dropTime := time.Date(2026, 10, 1, 14, 0, 0, 0, time.UTC)
	if err := academic.DropStudentEnrollment(enrollment, dropTime); err != nil {
		t.Fatalf("unexpected error dropping student: %v", err)
	}

	// 4. Session before drop date (Sept 20) -> Still eligible (historical transcript preserved!)
	historicalSession := time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC)
	if !academic.IsStudentEligibleAt(enrollment, historicalSession) {
		t.Error("expected historical session before drop date to remain eligible")
	}

	// 5. Session after drop date (Oct 5) -> Ineligible!
	afterDropSession := time.Date(2026, 10, 5, 10, 0, 0, 0, time.UTC)
	if academic.IsStudentEligibleAt(enrollment, afterDropSession) {
		t.Error("expected session after drop date to be INELIGIBLE")
	}
}
