export type SupportedLanguage = 'cpp' | 'python' | 'java' | 'html' | 'css' | 'javascript' | 'sql';

export interface LabCourse {
  id: string;
  organization_id: string;
  course_id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  primary_language: SupportedLanguage;
  allowed_languages: SupportedLanguage[];
  interactive_tools: string[];
  starter_code: Record<string, string>;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
  modules_count?: number;
  assignments_count?: number;
}

export interface LabModule {
  id: string;
  organization_id: string;
  lab_course_id: string;
  module_order: number;
  title: string;
  description: string;
  learning_objectives: string[];
  status: 'active' | 'archived';
  created_at: string;
  exercises?: LabExercise[];
}

export interface LabExercise {
  id: string;
  organization_id: string;
  lab_module_id: string;
  exercise_order: number;
  title: string;
  problem_statement: string;
  difficulty: 'beginner' | 'easy' | 'medium' | 'hard' | 'advanced';
  language: SupportedLanguage;
  starter_code: string;
  solution_template?: string;
  hints: string[];
  points: number;
  status: 'active' | 'archived';
  created_at: string;
  test_cases?: LabTestCase[];
  completed?: boolean;
}

export interface LabAssignment {
  id: string;
  organization_id: string;
  lab_course_id: string;
  created_by_user_id: string;
  author_name?: string;
  title: string;
  description: string;
  allowed_languages: SupportedLanguage[];
  starter_code: Record<string, string> | { code: string };
  due_at: string;
  max_score: number;
  status: 'draft' | 'published' | 'archived';
  created_at: string;
  updated_at: string;
  submission_count?: number;
  test_cases?: LabTestCase[];
  user_submission?: LabSubmission;
}

export interface LabTestCase {
  id: string;
  organization_id: string;
  assignment_id?: string;
  exercise_id?: string;
  input: string;
  expected_output: string;
  is_hidden: boolean;
  weight: number;
  time_limit_ms: number;
  created_at?: string;
}

export interface TestCaseResult {
  test_case_id: string;
  passed: boolean;
  execution_time_ms: number;
  input?: string;
  expected_output?: string;
  actual_output?: string;
  error_message?: string;
  is_hidden: boolean;
}

export interface LabSubmission {
  id: string;
  organization_id: string;
  assignment_id?: string;
  exercise_id?: string;
  student_user_id: string;
  student_name?: string;
  language: SupportedLanguage;
  source_code: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'error' | 'graded';
  score: number;
  passed_count: number;
  total_count: number;
  execution_duration_ms: number;
  stdout: string;
  stderr: string;
  test_results: TestCaseResult[];
  faculty_feedback: string;
  graded_by_user_id?: string;
  graded_at?: string;
  created_at: string;
}

export interface LabStudentProgress {
  id: string;
  organization_id: string;
  lab_course_id: string;
  course_slug?: string;
  course_title?: string;
  student_user_id: string;
  exercises_completed: number;
  assignments_submitted: number;
  total_points: number;
  current_streak_days: number;
  last_activity_at: string;
}

export interface FacultyOverview {
  pending_submissions: number;
  graded_submissions: number;
  total_assignments: number;
  recent_submissions: LabSubmission[];
  course_stats: Array<{
    course_id: string;
    course_title: string;
    student_count: number;
    avg_score: number;
    pass_rate: number;
  }>;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  durationMs: number;
  status: 'passed' | 'failed' | 'error';
  testResults?: TestCaseResult[];
}

export interface PilotCourseMeta {
  slug: string;
  title: string;
  code: string;
  tagline: string;
  description: string;
  badge: string;
  primaryLanguage: SupportedLanguage;
  tools: string[];
  accentColor: string;
  modules: Array<{
    order: number;
    title: string;
    description: string;
    lessons: string[];
    sampleExercise: {
      title: string;
      problem: string;
      difficulty: 'beginner' | 'easy' | 'medium' | 'hard';
      language: SupportedLanguage;
      starterCode: string;
      testCases: Array<{ input: string; expected_output: string; is_hidden: boolean }>;
    };
  }>;
}
