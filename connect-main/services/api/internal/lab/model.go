package lab

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// LabCourse represents a dedicated practical workspace configuration.
type LabCourse struct {
	ID               uuid.UUID       `json:"id"`
	OrganizationID   uuid.UUID       `json:"organization_id"`
	CourseID         uuid.UUID       `json:"course_id"`
	Slug             string          `json:"slug"`
	Title            string          `json:"title"`
	Description      string          `json:"description"`
	Category         string          `json:"category"`
	PrimaryLanguage  string          `json:"primary_language"`
	AllowedLanguages []string        `json:"allowed_languages"`
	InteractiveTools []string        `json:"interactive_tools"`
	StarterCode      json.RawMessage `json:"starter_code"`
	Status           string          `json:"status"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
	ModulesCount     int             `json:"modules_count,omitempty"`
	AssignmentsCount int             `json:"assignments_count,omitempty"`
}

// LabModule is a unit or syllabus chapter containing exercises.
type LabModule struct {
	ID                 uuid.UUID     `json:"id"`
	OrganizationID     uuid.UUID     `json:"organization_id"`
	LabCourseID        uuid.UUID     `json:"lab_course_id"`
	ModuleOrder        int           `json:"module_order"`
	Title              string        `json:"title"`
	Description        string        `json:"description"`
	LearningObjectives []string      `json:"learning_objectives"`
	Status             string        `json:"status"`
	CreatedAt          time.Time     `json:"created_at"`
	Exercises          []LabExercise `json:"exercises,omitempty"`
}

// LabExercise is an interactive coding lesson/exercise with starter code and public tests.
type LabExercise struct {
	ID               uuid.UUID     `json:"id"`
	OrganizationID   uuid.UUID     `json:"organization_id"`
	LabModuleID      uuid.UUID     `json:"lab_module_id"`
	ExerciseOrder    int           `json:"exercise_order"`
	Title            string        `json:"title"`
	ProblemStatement string        `json:"problem_statement"`
	Difficulty       string        `json:"difficulty"`
	Language         string        `json:"language"`
	StarterCode      string        `json:"starter_code"`
	SolutionTemplate string        `json:"solution_template,omitempty"`
	Hints            []string      `json:"hints"`
	Points           int           `json:"points"`
	Status           string        `json:"status"`
	CreatedAt        time.Time     `json:"created_at"`
	TestCases        []LabTestCase `json:"test_cases,omitempty"`
	Completed        bool          `json:"completed,omitempty"`
}

// LabAssignment is a practical homework or exam set by faculty.
type LabAssignment struct {
	ID               uuid.UUID       `json:"id"`
	OrganizationID   uuid.UUID       `json:"organization_id"`
	LabCourseID      uuid.UUID       `json:"lab_course_id"`
	CreatedByUserID  uuid.UUID       `json:"created_by_user_id"`
	AuthorName       string          `json:"author_name,omitempty"`
	Title            string          `json:"title"`
	Description      string          `json:"description"`
	AllowedLanguages []string        `json:"allowed_languages"`
	StarterCode      json.RawMessage `json:"starter_code"`
	DueAt            time.Time       `json:"due_at"`
	MaxScore         int             `json:"max_score"`
	Status           string          `json:"status"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
	SubmissionCount  int             `json:"submission_count,omitempty"`
	TestCases        []LabTestCase   `json:"test_cases,omitempty"`
	UserSubmission   *LabSubmission  `json:"user_submission,omitempty"`
}

// LabTestCase is an input/output specification. Hidden cases are never exposed to students.
type LabTestCase struct {
	ID             uuid.UUID  `json:"id"`
	OrganizationID uuid.UUID  `json:"organization_id"`
	AssignmentID   *uuid.UUID `json:"assignment_id,omitempty"`
	ExerciseID     *uuid.UUID `json:"exercise_id,omitempty"`
	Input          string     `json:"input"`
	ExpectedOutput string     `json:"expected_output"`
	IsHidden       bool       `json:"is_hidden"`
	Weight         int        `json:"weight"`
	TimeLimitMS    int        `json:"time_limit_ms"`
	CreatedAt      time.Time  `json:"created_at"`
}

// TestCaseResult is the outcome of running one test case.
type TestCaseResult struct {
	TestCaseID     uuid.UUID `json:"test_case_id"`
	Passed         bool      `json:"passed"`
	ExecutionTimeMS int      `json:"execution_time_ms"`
	Input          string    `json:"input,omitempty"`
	ExpectedOutput string    `json:"expected_output,omitempty"`
	ActualOutput   string    `json:"actual_output,omitempty"`
	ErrorMessage   string    `json:"error_message,omitempty"`
	IsHidden       bool      `json:"is_hidden"`
}

// LabSubmission records a student's solution attempt and evaluation.
type LabSubmission struct {
	ID                  uuid.UUID        `json:"id"`
	OrganizationID      uuid.UUID        `json:"organization_id"`
	AssignmentID        *uuid.UUID       `json:"assignment_id,omitempty"`
	ExerciseID          *uuid.UUID       `json:"exercise_id,omitempty"`
	StudentUserID       uuid.UUID        `json:"student_user_id"`
	StudentName         string           `json:"student_name,omitempty"`
	Language            string           `json:"language"`
	SourceCode          string           `json:"source_code"`
	Status              string           `json:"status"` // pending, running, passed, failed, error, graded
	Score               int              `json:"score"`
	PassedCount         int              `json:"passed_count"`
	TotalCount          int              `json:"total_count"`
	ExecutionDurationMS int              `json:"execution_duration_ms"`
	Stdout              string           `json:"stdout"`
	Stderr              string           `json:"stderr"`
	TestResults         []TestCaseResult `json:"test_results"`
	FacultyFeedback     string           `json:"faculty_feedback"`
	GradedByUserID      *uuid.UUID       `json:"graded_by_user_id,omitempty"`
	GradedAt            *time.Time       `json:"graded_at,omitempty"`
	CreatedAt           time.Time        `json:"created_at"`
}

// LabStudentProgress tracks cumulative progress and streaks for a student.
type LabStudentProgress struct {
	ID                   uuid.UUID `json:"id"`
	OrganizationID       uuid.UUID `json:"organization_id"`
	LabCourseID          uuid.UUID `json:"lab_course_id"`
	CourseSlug           string    `json:"course_slug,omitempty"`
	CourseTitle          string    `json:"course_title,omitempty"`
	StudentUserID        uuid.UUID `json:"student_user_id"`
	ExercisesCompleted   int       `json:"exercises_completed"`
	AssignmentsSubmitted int       `json:"assignments_submitted"`
	TotalPoints          int       `json:"total_points"`
	CurrentStreakDays    int       `json:"current_streak_days"`
	LastActivityAt       time.Time `json:"last_activity_at"`
}

// FacultyOverview contains queue metrics for instructors.
type FacultyOverview struct {
	PendingSubmissions int               `json:"pending_submissions"`
	GradedSubmissions  int               `json:"graded_submissions"`
	TotalAssignments   int               `json:"total_assignments"`
	RecentSubmissions  []LabSubmission   `json:"recent_submissions"`
	CourseStats        []CourseStatEntry `json:"course_stats"`
}

// CourseStatEntry holds aggregate performance per course.
type CourseStatEntry struct {
	CourseID     uuid.UUID `json:"course_id"`
	CourseTitle  string    `json:"course_title"`
	StudentCount int       `json:"student_count"`
	AvgScore     float64   `json:"avg_score"`
	PassRate     float64   `json:"pass_rate"`
}
