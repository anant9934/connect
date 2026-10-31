package academic

import (
	"errors"
	"time"
)

var (
	ErrDepartmentNotFound    = errors.New("department not found")
	ErrCourseNotFound        = errors.New("course not found")
	ErrBatchNotFound         = errors.New("course batch not found")
	ErrAllocationNotFound    = errors.New("faculty allocation not found")
	ErrEnrollmentNotFound    = errors.New("course enrollment not found")
	ErrSessionNotFound       = errors.New("class session not found")
	ErrCourseMismatch        = errors.New("course mismatch between batch and faculty allocation")
	ErrInactiveMembership    = errors.New("user does not have an active institutional membership")
	ErrAllocationRevoked     = errors.New("faculty allocation is revoked or expired")
	ErrStudentNotEnrolled    = errors.New("student is not actively enrolled in batch for session time")
	ErrInvalidRevocation     = errors.New("revocation reason must be at least 10 characters")
	ErrInvalidDateRange      = errors.New("end date must be after start date")
)

// Department represents an academic department within an institutional tenant.
type Department struct {
	ID                string     `json:"id"`
	OrganizationID    string     `json:"organizationId"`
	Code              string     `json:"code"` // e.g. "CSE"
	Name              string     `json:"name"`
	CoordinatorUserID *string    `json:"coordinatorUserId,omitempty"`
	Status            string     `json:"status"` // 'active', 'archived'
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

// Course represents an academic curriculum course.
type Course struct {
	ID             string    `json:"id"`
	OrganizationID string    `json:"organizationId"`
	DepartmentID   string    `json:"departmentId"`
	Code           string    `json:"code"` // e.g. "CS101"
	Title          string    `json:"title"`
	Description    string    `json:"description"`
	Credits        int       `json:"credits"`
	Status         string    `json:"status"` // 'active', 'archived'
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// CourseBatch represents a specific cohort/section of a course for a semester.
type CourseBatch struct {
	ID             string    `json:"id"`
	OrganizationID string    `json:"organizationId"`
	CourseID       string    `json:"courseId"`
	Name           string    `json:"name"` // e.g. "Section A"
	AcademicTerm   string    `json:"academicTerm"`
	StartDate      time.Time `json:"startDate"`
	EndDate        time.Time `json:"endDate"`
	Status         string    `json:"status"` // 'active', 'archived'
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// FacultyAllocation represents teacher assignment to a course with full lifecycle tracking.
type FacultyAllocation struct {
	ID               string     `json:"id"`
	OrganizationID   string     `json:"organizationId"`
	CourseID         string     `json:"courseId"`
	FacultyUserID    string     `json:"facultyUserId"`
	Role             string     `json:"role"` // 'primary_instructor', 'teaching_assistant'
	Status           string     `json:"status"` // 'active', 'ended', 'revoked'
	EffectiveFrom    time.Time  `json:"effectiveFrom"`
	EffectiveTo      *time.Time `json:"effectiveTo,omitempty"`
	RevokedAt        *time.Time `json:"revokedAt,omitempty"`
	RevokedBy        *string    `json:"revokedBy,omitempty"`
	RevocationReason *string    `json:"revocationReason,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
}

// CourseEnrollment represents student cohort membership with temporal status.
type CourseEnrollment struct {
	ID             string     `json:"id"`
	OrganizationID string     `json:"organizationId"`
	BatchID        string     `json:"batchId"`
	StudentUserID  string     `json:"studentUserId"`
	Status         string     `json:"status"` // 'enrolled', 'dropped', 'completed'
	EnrolledAt     time.Time  `json:"enrolledAt"`
	DroppedAt      *time.Time `json:"droppedAt,omitempty"`
	CompletedAt    *time.Time `json:"completedAt,omitempty"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

// ClassSession represents an authoritative scheduled lecture session.
type ClassSession struct {
	ID                  string     `json:"id"`
	OrganizationID      string     `json:"organizationId"`
	CourseID            string     `json:"courseId"`
	BatchID             string     `json:"batchId"`
	FacultyAllocationID string     `json:"facultyAllocationId"`
	Title               string     `json:"title"`
	Description         string     `json:"description"`
	ScheduledStart      time.Time  `json:"scheduledStart"`
	ScheduledEnd        time.Time  `json:"scheduledEnd"`
	ActualStart         *time.Time `json:"actualStart,omitempty"`
	ActualEnd           *time.Time `json:"actualEnd,omitempty"`
	Status              string     `json:"status"` // 'scheduled', 'active', 'completed', 'cancelled'
	AttendanceFinalized bool       `json:"attendanceFinalized"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}
