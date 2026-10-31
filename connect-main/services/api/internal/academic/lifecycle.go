package academic

import (
	"strings"
	"time"
)

// ValidateClassSessionConsistency guarantees that the associated batch and faculty allocation
// belong to the exact same organization and course, preventing cross-course mismatches.
func ValidateClassSessionConsistency(batch *CourseBatch, alloc *FacultyAllocation) error {
	if batch == nil || alloc == nil {
		return ErrSessionNotFound
	}
	if batch.OrganizationID != alloc.OrganizationID {
		return ErrCourseMismatch
	}
	if batch.CourseID != alloc.CourseID {
		return ErrCourseMismatch
	}
	return nil
}

// IsFacultyAllocationActiveAt checks whether the faculty allocation was active at timestamp t.
func IsFacultyAllocationActiveAt(alloc *FacultyAllocation, t time.Time) bool {
	if alloc == nil {
		return false
	}
	if t.Before(alloc.EffectiveFrom) {
		return false
	}
	if alloc.EffectiveTo != nil && !t.Before(*alloc.EffectiveTo) {
		return false
	}
	if alloc.Status == "revoked" {
		if alloc.RevokedAt != nil && !t.Before(*alloc.RevokedAt) {
			return false
		}
		return true
	}
	return alloc.Status == "active" || alloc.Status == "ended"
}

// IsStudentEligibleAt checks whether the student enrollment was actively valid when the session started.
// Handles dropped and completed students without corrupting historical attendance rights.
func IsStudentEligibleAt(enrollment *CourseEnrollment, sessionStart time.Time) bool {
	if enrollment == nil {
		return false
	}
	// Cannot earn attendance before enrollment began
	if sessionStart.Before(enrollment.EnrolledAt) {
		return false
	}
	// If dropped, session must have occurred strictly before the drop timestamp
	if enrollment.DroppedAt != nil && !sessionStart.Before(*enrollment.DroppedAt) {
		return false
	}
	// If completed, session must have occurred strictly before completion timestamp
	if enrollment.CompletedAt != nil && !sessionStart.Before(*enrollment.CompletedAt) {
		return false
	}
	return true
}

// RevokeFacultyAllocation transitions an allocation to 'revoked' with audit reasons.
func RevokeFacultyAllocation(alloc *FacultyAllocation, revokedBy string, reason string, at time.Time) error {
	if alloc == nil {
		return ErrAllocationNotFound
	}
	trimmedReason := strings.TrimSpace(reason)
	if len(trimmedReason) < 10 {
		return ErrInvalidRevocation
	}

	alloc.Status = "revoked"
	alloc.RevokedAt = &at
	alloc.RevokedBy = &revokedBy
	alloc.RevocationReason = &trimmedReason
	return nil
}

// DropStudentEnrollment records course drop timestamp while preserving prior transcript rights.
func DropStudentEnrollment(enrollment *CourseEnrollment, at time.Time) error {
	if enrollment == nil {
		return ErrEnrollmentNotFound
	}
	if at.Before(enrollment.EnrolledAt) {
		return ErrInvalidDateRange
	}
	enrollment.Status = "dropped"
	enrollment.DroppedAt = &at
	enrollment.UpdatedAt = at
	return nil
}

// CompleteStudentEnrollment records course completion.
func CompleteStudentEnrollment(enrollment *CourseEnrollment, at time.Time) error {
	if enrollment == nil {
		return ErrEnrollmentNotFound
	}
	if at.Before(enrollment.EnrolledAt) {
		return ErrInvalidDateRange
	}
	enrollment.Status = "completed"
	enrollment.CompletedAt = &at
	enrollment.UpdatedAt = at
	return nil
}
