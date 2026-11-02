package lab

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Repository handles database queries for the practical learning platform.
type Repository struct{}

func NewRepository() *Repository {
	return &Repository{}
}

// ListLabCourses returns all active lab courses in the tenant.
func (r *Repository) ListLabCourses(ctx context.Context, tx pgx.Tx, orgID uuid.UUID) ([]LabCourse, error) {
	query := `
		SELECT
			lc.id, lc.organization_id, lc.course_id, lc.slug, lc.title, lc.description,
			lc.category, lc.primary_language, lc.allowed_languages, lc.interactive_tools,
			lc.starter_code, lc.status, lc.created_at, lc.updated_at,
			(SELECT COUNT(*) FROM lab_modules lm WHERE lm.lab_course_id = lc.id) as modules_count,
			(SELECT COUNT(*) FROM lab_assignments la WHERE la.lab_course_id = lc.id AND la.status = 'published') as assignments_count
		FROM lab_courses lc
		WHERE lc.organization_id = $1 AND lc.status = 'active'
		ORDER BY lc.title ASC;
	`
	rows, err := tx.Query(ctx, query, orgID)
	if err != nil {
		return nil, fmt.Errorf("failed to query lab courses: %w", err)
	}
	defer rows.Close()

	var courses []LabCourse
	for rows.Next() {
		var c LabCourse
		var starterCodeRaw []byte
		if err := rows.Scan(
			&c.ID, &c.OrganizationID, &c.CourseID, &c.Slug, &c.Title, &c.Description,
			&c.Category, &c.PrimaryLanguage, &c.AllowedLanguages, &c.InteractiveTools,
			&starterCodeRaw, &c.Status, &c.CreatedAt, &c.UpdatedAt,
			&c.ModulesCount, &c.AssignmentsCount,
		); err != nil {
			return nil, fmt.Errorf("failed to scan lab course: %w", err)
		}
		c.StarterCode = json.RawMessage(starterCodeRaw)
		courses = append(courses, c)
	}
	return courses, nil
}

// GetLabCourseBySlug retrieves a course by its slug.
func (r *Repository) GetLabCourseBySlug(ctx context.Context, tx pgx.Tx, orgID uuid.UUID, slug string) (*LabCourse, error) {
	query := `
		SELECT
			lc.id, lc.organization_id, lc.course_id, lc.slug, lc.title, lc.description,
			lc.category, lc.primary_language, lc.allowed_languages, lc.interactive_tools,
			lc.starter_code, lc.status, lc.created_at, lc.updated_at,
			(SELECT COUNT(*) FROM lab_modules lm WHERE lm.lab_course_id = lc.id) as modules_count,
			(SELECT COUNT(*) FROM lab_assignments la WHERE la.lab_course_id = lc.id AND la.status = 'published') as assignments_count
		FROM lab_courses lc
		WHERE lc.organization_id = $1 AND lc.slug = $2;
	`
	var c LabCourse
	var starterCodeRaw []byte
	err := tx.QueryRow(ctx, query, orgID, slug).Scan(
		&c.ID, &c.OrganizationID, &c.CourseID, &c.Slug, &c.Title, &c.Description,
		&c.Category, &c.PrimaryLanguage, &c.AllowedLanguages, &c.InteractiveTools,
		&starterCodeRaw, &c.Status, &c.CreatedAt, &c.UpdatedAt,
		&c.ModulesCount, &c.AssignmentsCount,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get lab course by slug: %w", err)
	}
	c.StarterCode = json.RawMessage(starterCodeRaw)
	return &c, nil
}

// ListLabModules returns all modules for a course with exercises.
func (r *Repository) ListLabModules(ctx context.Context, tx pgx.Tx, orgID, labCourseID uuid.UUID) ([]LabModule, error) {
	query := `
		SELECT
			lm.id, lm.organization_id, lm.lab_course_id, lm.module_order,
			lm.title, lm.description, lm.learning_objectives, lm.status, lm.created_at
		FROM lab_modules lm
		WHERE lm.organization_id = $1 AND lm.lab_course_id = $2 AND lm.status = 'active'
		ORDER BY lm.module_order ASC;
	`
	rows, err := tx.Query(ctx, query, orgID, labCourseID)
	if err != nil {
		return nil, fmt.Errorf("failed to query lab modules: %w", err)
	}
	defer rows.Close()

	var modules []LabModule
	for rows.Next() {
		var m LabModule
		if err := rows.Scan(
			&m.ID, &m.OrganizationID, &m.LabCourseID, &m.ModuleOrder,
			&m.Title, &m.Description, &m.LearningObjectives, &m.Status, &m.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan lab module: %w", err)
		}
		modules = append(modules, m)
	}

	// Fetch exercises for each module
	for i := range modules {
		exQuery := `
			SELECT
				le.id, le.organization_id, le.lab_module_id, le.exercise_order,
				le.title, le.problem_statement, le.difficulty, le.language,
				le.starter_code, le.hints, le.points, le.status, le.created_at
			FROM lab_exercises le
			WHERE le.organization_id = $1 AND le.lab_module_id = $2 AND le.status = 'active'
			ORDER BY le.exercise_order ASC;
		`
		exRows, err := tx.Query(ctx, exQuery, orgID, modules[i].ID)
		if err != nil {
			return nil, fmt.Errorf("failed to query lab exercises for module: %w", err)
		}
		var exercises []LabExercise
		for exRows.Next() {
			var ex LabExercise
			if err := exRows.Scan(
				&ex.ID, &ex.OrganizationID, &ex.LabModuleID, &ex.ExerciseOrder,
				&ex.Title, &ex.ProblemStatement, &ex.Difficulty, &ex.Language,
				&ex.StarterCode, &ex.Hints, &ex.Points, &ex.Status, &ex.CreatedAt,
			); err != nil {
				exRows.Close()
				return nil, fmt.Errorf("failed to scan lab exercise: %w", err)
			}
			exercises = append(exercises, ex)
		}
		exRows.Close()
		modules[i].Exercises = exercises
	}

	return modules, nil
}

// GetLabExercise retrieves an exercise and its test cases (with hidden test cases sanitized if isStudent=true).
func (r *Repository) GetLabExercise(ctx context.Context, tx pgx.Tx, orgID, exerciseID uuid.UUID, isStudent bool) (*LabExercise, error) {
	query := `
		SELECT
			le.id, le.organization_id, le.lab_module_id, le.exercise_order,
			le.title, le.problem_statement, le.difficulty, le.language,
			le.starter_code, le.solution_template, le.hints, le.points, le.status, le.created_at
		FROM lab_exercises le
		WHERE le.organization_id = $1 AND le.id = $2;
	`
	var ex LabExercise
	err := tx.QueryRow(ctx, query, orgID, exerciseID).Scan(
		&ex.ID, &ex.OrganizationID, &ex.LabModuleID, &ex.ExerciseOrder,
		&ex.Title, &ex.ProblemStatement, &ex.Difficulty, &ex.Language,
		&ex.StarterCode, &ex.SolutionTemplate, &ex.Hints, &ex.Points, &ex.Status, &ex.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get lab exercise: %w", err)
	}

	// Never reveal solution template to students
	if isStudent {
		ex.SolutionTemplate = ""
	}

	tcQuery := `
		SELECT id, organization_id, exercise_id, input, expected_output, is_hidden, weight, time_limit_ms, created_at
		FROM lab_test_cases
		WHERE organization_id = $1 AND exercise_id = $2
	`
	if isStudent {
		tcQuery += " AND is_hidden = false"
	}
	tcQuery += " ORDER BY created_at ASC;"

	tcRows, err := tx.Query(ctx, tcQuery, orgID, exerciseID)
	if err != nil {
		return nil, fmt.Errorf("failed to query test cases: %w", err)
	}
	defer tcRows.Close()

	for tcRows.Next() {
		var tc LabTestCase
		if err := tcRows.Scan(
			&tc.ID, &tc.OrganizationID, &tc.ExerciseID, &tc.Input,
			&tc.ExpectedOutput, &tc.IsHidden, &tc.Weight, &tc.TimeLimitMS, &tc.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan test case: %w", err)
		}
		ex.TestCases = append(ex.TestCases, tc)
	}

	return &ex, nil
}

// ListLabAssignments returns assignments for a course.
func (r *Repository) ListLabAssignments(ctx context.Context, tx pgx.Tx, orgID, labCourseID uuid.UUID, isStudent bool) ([]LabAssignment, error) {
	query := `
		SELECT
			la.id, la.organization_id, la.lab_course_id, la.created_by_user_id,
			u.display_name, la.title, la.description, la.allowed_languages,
			la.starter_code, la.due_at, la.max_score, la.status, la.created_at, la.updated_at,
			(SELECT COUNT(*) FROM lab_submissions ls WHERE ls.assignment_id = la.id) as submission_count
		FROM lab_assignments la
		JOIN users u ON u.id = la.created_by_user_id
		WHERE la.organization_id = $1 AND la.lab_course_id = $2
	`
	if isStudent {
		query += " AND la.status = 'published'"
	}
	query += " ORDER BY la.due_at ASC;"

	rows, err := tx.Query(ctx, query, orgID, labCourseID)
	if err != nil {
		return nil, fmt.Errorf("failed to list lab assignments: %w", err)
	}
	defer rows.Close()

	var assignments []LabAssignment
	for rows.Next() {
		var a LabAssignment
		var starterCodeRaw []byte
		if err := rows.Scan(
			&a.ID, &a.OrganizationID, &a.LabCourseID, &a.CreatedByUserID,
			&a.AuthorName, &a.Title, &a.Description, &a.AllowedLanguages,
			&starterCodeRaw, &a.DueAt, &a.MaxScore, &a.Status, &a.CreatedAt, &a.UpdatedAt,
			&a.SubmissionCount,
		); err != nil {
			return nil, fmt.Errorf("failed to scan assignment: %w", err)
		}
		a.StarterCode = json.RawMessage(starterCodeRaw)
		assignments = append(assignments, a)
	}
	return assignments, nil
}

// GetLabAssignment retrieves an assignment and its test cases (hiding secret tests from students).
func (r *Repository) GetLabAssignment(ctx context.Context, tx pgx.Tx, orgID, assignmentID uuid.UUID, isStudent bool, currentUserID uuid.UUID) (*LabAssignment, error) {
	query := `
		SELECT
			la.id, la.organization_id, la.lab_course_id, la.created_by_user_id,
			u.display_name, la.title, la.description, la.allowed_languages,
			la.starter_code, la.due_at, la.max_score, la.status, la.created_at, la.updated_at
		FROM lab_assignments la
		JOIN users u ON u.id = la.created_by_user_id
		WHERE la.organization_id = $1 AND la.id = $2;
	`
	var a LabAssignment
	var starterCodeRaw []byte
	err := tx.QueryRow(ctx, query, orgID, assignmentID).Scan(
		&a.ID, &a.OrganizationID, &a.LabCourseID, &a.CreatedByUserID,
		&a.AuthorName, &a.Title, &a.Description, &a.AllowedLanguages,
		&starterCodeRaw, &a.DueAt, &a.MaxScore, &a.Status, &a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get lab assignment: %w", err)
	}
	a.StarterCode = json.RawMessage(starterCodeRaw)

	// Fetch test cases (enforcing RLS: students only see is_hidden=false)
	tcQuery := `
		SELECT id, organization_id, assignment_id, input, expected_output, is_hidden, weight, time_limit_ms, created_at
		FROM lab_test_cases
		WHERE organization_id = $1 AND assignment_id = $2
	`
	if isStudent {
		tcQuery += " AND is_hidden = false"
	}
	tcQuery += " ORDER BY created_at ASC;"

	tcRows, err := tx.Query(ctx, tcQuery, orgID, assignmentID)
	if err != nil {
		return nil, fmt.Errorf("failed to query assignment test cases: %w", err)
	}
	defer tcRows.Close()

	for tcRows.Next() {
		var tc LabTestCase
		if err := tcRows.Scan(
			&tc.ID, &tc.OrganizationID, &tc.AssignmentID, &tc.Input,
			&tc.ExpectedOutput, &tc.IsHidden, &tc.Weight, &tc.TimeLimitMS, &tc.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan test case: %w", err)
		}
		a.TestCases = append(a.TestCases, tc)
	}

	// If current user is student, attach their latest submission
	if currentUserID != uuid.Nil {
		subQuery := `
			SELECT
				id, organization_id, assignment_id, student_user_id, language, source_code,
				status, score, passed_count, total_count, execution_duration_ms, stdout, stderr,
				test_results, faculty_feedback, graded_by_user_id, graded_at, created_at
			FROM lab_submissions
			WHERE organization_id = $1 AND assignment_id = $2 AND student_user_id = $3
			ORDER BY created_at DESC LIMIT 1;
		`
		var sub LabSubmission
		var testResultsRaw []byte
		subErr := tx.QueryRow(ctx, subQuery, orgID, assignmentID, currentUserID).Scan(
			&sub.ID, &sub.OrganizationID, &sub.AssignmentID, &sub.StudentUserID, &sub.Language, &sub.SourceCode,
			&sub.Status, &sub.Score, &sub.PassedCount, &sub.TotalCount, &sub.ExecutionDurationMS, &sub.Stdout, &sub.Stderr,
			&testResultsRaw, &sub.FacultyFeedback, &sub.GradedByUserID, &sub.GradedAt, &sub.CreatedAt,
		)
		if subErr == nil {
			_ = json.Unmarshal(testResultsRaw, &sub.TestResults)
			a.UserSubmission = &sub
		}
	}

	return &a, nil
}

// CreateLabAssignment creates an assignment and inserts associated test cases atomically.
func (r *Repository) CreateLabAssignment(ctx context.Context, tx pgx.Tx, a *LabAssignment, testCases []LabTestCase) error {
	starterJSON, err := json.Marshal(a.StarterCode)
	if err != nil || len(starterJSON) == 0 {
		starterJSON = []byte("{}")
	}

	query := `
		INSERT INTO lab_assignments (
			id, organization_id, lab_course_id, created_by_user_id,
			title, description, allowed_languages, starter_code, due_at, max_score, status
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING created_at, updated_at;
	`
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}

	err = tx.QueryRow(
		ctx, query,
		a.ID, a.OrganizationID, a.LabCourseID, a.CreatedByUserID,
		a.Title, a.Description, a.AllowedLanguages, starterJSON, a.DueAt, a.MaxScore, a.Status,
	).Scan(&a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return fmt.Errorf("failed to insert lab assignment: %w", err)
	}

	for i := range testCases {
		tc := &testCases[i]
		if tc.ID == uuid.Nil {
			tc.ID = uuid.New()
		}
		tc.OrganizationID = a.OrganizationID
		tc.AssignmentID = &a.ID

		tcQuery := `
			INSERT INTO lab_test_cases (
				id, organization_id, assignment_id, input, expected_output, is_hidden, weight, time_limit_ms
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
		`
		_, err := tx.Exec(
			ctx, tcQuery,
			tc.ID, tc.OrganizationID, tc.AssignmentID, tc.Input, tc.ExpectedOutput,
			tc.IsHidden, tc.Weight, tc.TimeLimitMS,
		)
		if err != nil {
			return fmt.Errorf("failed to insert assignment test case: %w", err)
		}
	}

	return nil
}

// GetAllTestCasesForEvaluation retrieves all test cases (both public and hidden) for evaluation.
func (r *Repository) GetAllTestCasesForEvaluation(ctx context.Context, tx pgx.Tx, orgID uuid.UUID, assignmentID *uuid.UUID, exerciseID *uuid.UUID) ([]LabTestCase, error) {
	query := `
		SELECT id, organization_id, assignment_id, exercise_id, input, expected_output, is_hidden, weight, time_limit_ms, created_at
		FROM lab_test_cases
		WHERE organization_id = $1 AND (
			($2::uuid IS NOT NULL AND assignment_id = $2) OR
			($3::uuid IS NOT NULL AND exercise_id = $3)
		)
		ORDER BY is_hidden ASC, created_at ASC;
	`
	rows, err := tx.Query(ctx, query, orgID, assignmentID, exerciseID)
	if err != nil {
		return nil, fmt.Errorf("failed to query all test cases: %w", err)
	}
	defer rows.Close()

	var testCases []LabTestCase
	for rows.Next() {
		var tc LabTestCase
		if err := rows.Scan(
			&tc.ID, &tc.OrganizationID, &tc.AssignmentID, &tc.ExerciseID, &tc.Input,
			&tc.ExpectedOutput, &tc.IsHidden, &tc.Weight, &tc.TimeLimitMS, &tc.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan evaluation test case: %w", err)
		}
		testCases = append(testCases, tc)
	}
	return testCases, nil
}

// CreateSubmission records a student's submission.
func (r *Repository) CreateSubmission(ctx context.Context, tx pgx.Tx, sub *LabSubmission) error {
	if sub.ID == uuid.Nil {
		sub.ID = uuid.New()
	}
	testResultsJSON, err := json.Marshal(sub.TestResults)
	if err != nil {
		testResultsJSON = []byte("[]")
	}

	query := `
		INSERT INTO lab_submissions (
			id, organization_id, assignment_id, exercise_id, student_user_id,
			language, source_code, status, score, passed_count, total_count,
			execution_duration_ms, stdout, stderr, test_results, faculty_feedback
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		RETURNING created_at;
	`
	err = tx.QueryRow(
		ctx, query,
		sub.ID, sub.OrganizationID, sub.AssignmentID, sub.ExerciseID, sub.StudentUserID,
		sub.Language, sub.SourceCode, sub.Status, sub.Score, sub.PassedCount, sub.TotalCount,
		sub.ExecutionDurationMS, sub.Stdout, sub.Stderr, testResultsJSON, sub.FacultyFeedback,
	).Scan(&sub.CreatedAt)
	if err != nil {
		return fmt.Errorf("failed to insert submission: %w", err)
	}
	return nil
}

// ListSubmissions returns submissions for assignment or student.
func (r *Repository) ListSubmissions(ctx context.Context, tx pgx.Tx, orgID uuid.UUID, assignmentID *uuid.UUID, studentID *uuid.UUID) ([]LabSubmission, error) {
	query := `
		SELECT
			ls.id, ls.organization_id, ls.assignment_id, ls.exercise_id, ls.student_user_id,
			u.display_name, ls.language, ls.source_code, ls.status, ls.score,
			ls.passed_count, ls.total_count, ls.execution_duration_ms, ls.stdout, ls.stderr,
			ls.test_results, ls.faculty_feedback, ls.graded_by_user_id, ls.graded_at, ls.created_at
		FROM lab_submissions ls
		JOIN users u ON u.id = ls.student_user_id
		WHERE ls.organization_id = $1
		  AND ($2::uuid IS NULL OR ls.assignment_id = $2)
		  AND ($3::uuid IS NULL OR ls.student_user_id = $3)
		ORDER BY ls.created_at DESC;
	`
	rows, err := tx.Query(ctx, query, orgID, assignmentID, studentID)
	if err != nil {
		return nil, fmt.Errorf("failed to query submissions: %w", err)
	}
	defer rows.Close()

	var submissions []LabSubmission
	for rows.Next() {
		var s LabSubmission
		var testResultsRaw []byte
		if err := rows.Scan(
			&s.ID, &s.OrganizationID, &s.AssignmentID, &s.ExerciseID, &s.StudentUserID,
			&s.StudentName, &s.Language, &s.SourceCode, &s.Status, &s.Score,
			&s.PassedCount, &s.TotalCount, &s.ExecutionDurationMS, &s.Stdout, &s.Stderr,
			&testResultsRaw, &s.FacultyFeedback, &s.GradedByUserID, &s.GradedAt, &s.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan submission: %w", err)
		}
		_ = json.Unmarshal(testResultsRaw, &s.TestResults)
		submissions = append(submissions, s)
	}
	return submissions, nil
}

// UpdateSubmissionGrade allows an instructor to override the score and leave comments.
func (r *Repository) UpdateSubmissionGrade(ctx context.Context, tx pgx.Tx, orgID, subID, graderID uuid.UUID, score int, feedback string) error {
	query := `
		UPDATE lab_submissions
		SET score = $1, faculty_feedback = $2, graded_by_user_id = $3, graded_at = clock_timestamp(), status = 'graded'
		WHERE organization_id = $4 AND id = $5;
	`
	tag, err := tx.Exec(ctx, query, score, feedback, graderID, orgID, subID)
	if err != nil {
		return fmt.Errorf("failed to update submission grade: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("submission not found")
	}
	return nil
}

// GetStudentProgress retrieves progress metrics across courses for a student.
func (r *Repository) GetStudentProgress(ctx context.Context, tx pgx.Tx, orgID, studentID uuid.UUID) ([]LabStudentProgress, error) {
	query := `
		SELECT
			lsp.id, lsp.organization_id, lsp.lab_course_id, lc.slug, lc.title,
			lsp.student_user_id, lsp.exercises_completed, lsp.assignments_submitted,
			lsp.total_points, lsp.current_streak_days, lsp.last_activity_at
		FROM lab_student_progress lsp
		JOIN lab_courses lc ON lc.id = lsp.lab_course_id
		WHERE lsp.organization_id = $1 AND lsp.student_user_id = $2
		ORDER BY lsp.last_activity_at DESC;
	`
	rows, err := tx.Query(ctx, query, orgID, studentID)
	if err != nil {
		return nil, fmt.Errorf("failed to query student progress: %w", err)
	}
	defer rows.Close()

	var list []LabStudentProgress
	for rows.Next() {
		var p LabStudentProgress
		if err := rows.Scan(
			&p.ID, &p.OrganizationID, &p.LabCourseID, &p.CourseSlug, &p.CourseTitle,
			&p.StudentUserID, &p.ExercisesCompleted, &p.AssignmentsSubmitted,
			&p.TotalPoints, &p.CurrentStreakDays, &p.LastActivityAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan student progress: %w", err)
		}
		list = append(list, p)
	}
	return list, nil
}

// RecordStudentActivity updates exercises completed, assignments submitted, points, and streak.
func (r *Repository) RecordStudentActivity(ctx context.Context, tx pgx.Tx, orgID, labCourseID, studentID uuid.UUID, pointsDelta int, isAssignment bool, isExercise bool) error {
	exInc := 0
	if isExercise {
		exInc = 1
	}
	assignInc := 0
	if isAssignment {
		assignInc = 1
	}

	query := `
		INSERT INTO lab_student_progress (
			id, organization_id, lab_course_id, student_user_id,
			exercises_completed, assignments_submitted, total_points, current_streak_days, last_activity_at
		) VALUES (
			uuid_generate_v4(), $1, $2, $3, $4, $5, $6, 1, clock_timestamp()
		)
		ON CONFLICT (organization_id, lab_course_id, student_user_id) DO UPDATE SET
			exercises_completed = lab_student_progress.exercises_completed + EXCLUDED.exercises_completed,
			assignments_submitted = lab_student_progress.assignments_submitted + EXCLUDED.assignments_submitted,
			total_points = lab_student_progress.total_points + EXCLUDED.total_points,
			current_streak_days = CASE
				WHEN DATE(lab_student_progress.last_activity_at) = CURRENT_DATE THEN lab_student_progress.current_streak_days
				WHEN DATE(lab_student_progress.last_activity_at) = CURRENT_DATE - INTERVAL '1 day' THEN lab_student_progress.current_streak_days + 1
				ELSE 1
			END,
			last_activity_at = clock_timestamp();
	`
	_, err := tx.Exec(ctx, query, orgID, labCourseID, studentID, exInc, assignInc, pointsDelta)
	if err != nil {
		return fmt.Errorf("failed to record student activity: %w", err)
	}
	return nil
}

// GetFacultyOverview compiles submission queue and course performance metrics.
func (r *Repository) GetFacultyOverview(ctx context.Context, tx pgx.Tx, orgID uuid.UUID) (*FacultyOverview, error) {
	fo := &FacultyOverview{}

	// Counts
	countsQuery := `
		SELECT
			COUNT(*) FILTER (WHERE status = 'pending' OR status = 'running') as pending_count,
			COUNT(*) FILTER (WHERE status = 'graded') as graded_count,
			(SELECT COUNT(*) FROM lab_assignments WHERE organization_id = $1) as total_assignments
		FROM lab_submissions
		WHERE organization_id = $1;
	`
	err := tx.QueryRow(ctx, countsQuery, orgID).Scan(
		&fo.PendingSubmissions, &fo.GradedSubmissions, &fo.TotalAssignments,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query faculty counts: %w", err)
	}

	// Recent submissions
	recents, err := r.ListSubmissions(ctx, tx, orgID, nil, nil)
	if err == nil {
		if len(recents) > 10 {
			fo.RecentSubmissions = recents[:10]
		} else {
			fo.RecentSubmissions = recents
		}
	}

	// Course stats
	statsQuery := `
		SELECT
			lc.id, lc.title,
			COUNT(DISTINCT lsp.student_user_id) as student_count,
			COALESCE(AVG(ls.score), 0) as avg_score,
			COALESCE(
				COUNT(ls.id) FILTER (WHERE ls.status = 'passed') * 100.0 / NULLIF(COUNT(ls.id), 0),
				0
			) as pass_rate
		FROM lab_courses lc
		LEFT JOIN lab_student_progress lsp ON lsp.lab_course_id = lc.id
		LEFT JOIN lab_assignments la ON la.lab_course_id = lc.id
		LEFT JOIN lab_submissions ls ON ls.assignment_id = la.id
		WHERE lc.organization_id = $1 AND lc.status = 'active'
		GROUP BY lc.id, lc.title
		ORDER BY lc.title ASC;
	`
	sRows, err := tx.Query(ctx, statsQuery, orgID)
	if err == nil {
		defer sRows.Close()
		for sRows.Next() {
			var ce CourseStatEntry
			if err := sRows.Scan(&ce.CourseID, &ce.CourseTitle, &ce.StudentCount, &ce.AvgScore, &ce.PassRate); err == nil {
				fo.CourseStats = append(fo.CourseStats, ce)
			}
		}
	}

	return fo, nil
}
