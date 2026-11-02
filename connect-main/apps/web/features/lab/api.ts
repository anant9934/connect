import { apiFetch } from '@/lib/api/client';
import type {
  LabCourse,
  LabModule,
  LabExercise,
  LabAssignment,
  LabSubmission,
  LabStudentProgress,
  FacultyOverview,
  SupportedLanguage,
} from './types';

const labBasePath = (orgId: string) => `/api/v1/organizations/${encodeURIComponent(orgId)}/lab`;

export async function fetchLabCourses(orgId: string): Promise<{ courses: LabCourse[] }> {
  return apiFetch<{ courses: LabCourse[] }>(`${labBasePath(orgId)}/courses`, {
    method: 'GET',
  });
}

export async function fetchLabCourse(orgId: string, slug: string): Promise<{ course: LabCourse; modules: LabModule[] }> {
  return apiFetch<{ course: LabCourse; modules: LabModule[] }>(`${labBasePath(orgId)}/courses/${encodeURIComponent(slug)}`, {
    method: 'GET',
  });
}

export async function fetchLabExercise(orgId: string, exerciseId: string): Promise<{ exercise: LabExercise }> {
  return apiFetch<{ exercise: LabExercise }>(`${labBasePath(orgId)}/exercises/${encodeURIComponent(exerciseId)}`, {
    method: 'GET',
  });
}

export async function fetchLabAssignments(orgId: string, courseId?: string): Promise<{ assignments: LabAssignment[] }> {
  const query = courseId ? `?course_id=${encodeURIComponent(courseId)}` : '';
  return apiFetch<{ assignments: LabAssignment[] }>(`${labBasePath(orgId)}/assignments${query}`, {
    method: 'GET',
  });
}

export async function fetchLabAssignment(orgId: string, assignmentId: string): Promise<{ assignment: LabAssignment }> {
  return apiFetch<{ assignment: LabAssignment }>(`${labBasePath(orgId)}/assignments/${encodeURIComponent(assignmentId)}`, {
    method: 'GET',
  });
}

export interface CreateAssignmentPayload {
  lab_course_id: string;
  title: string;
  description: string;
  allowed_languages: SupportedLanguage[];
  starter_code: string;
  due_at: string;
  max_score: number;
  status?: string;
  test_cases: Array<{
    input: string;
    expected_output: string;
    is_hidden: boolean;
    weight: number;
    time_limit_ms: number;
  }>;
}

export async function createLabAssignment(
  orgId: string,
  payload: CreateAssignmentPayload,
): Promise<{ assignment: LabAssignment }> {
  return apiFetch<{ assignment: LabAssignment }>(`${labBasePath(orgId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface SubmitCodePayload {
  language: SupportedLanguage;
  source_code: string;
  outputs?: Record<string, string>;
  errors?: Record<string, string>;
  durations?: Record<string, number>;
  execution_duration_ms?: number;
  stdout?: string;
  stderr?: string;
}

export async function submitAssignment(
  orgId: string,
  assignmentId: string,
  payload: SubmitCodePayload,
): Promise<{ submission: LabSubmission; score: number; status: string }> {
  return apiFetch<{ submission: LabSubmission; score: number; status: string }>(
    `${labBasePath(orgId)}/assignments/${encodeURIComponent(assignmentId)}/submit`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

export async function submitExercise(
  orgId: string,
  exerciseId: string,
  payload: SubmitCodePayload,
): Promise<{ submission: LabSubmission; score: number; status: string }> {
  return apiFetch<{ submission: LabSubmission; score: number; status: string }>(
    `${labBasePath(orgId)}/exercises/${encodeURIComponent(exerciseId)}/submit`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

export async function fetchSubmissions(
  orgId: string,
  assignmentId: string,
): Promise<{ submissions: LabSubmission[] }> {
  return apiFetch<{ submissions: LabSubmission[] }>(
    `${labBasePath(orgId)}/assignments/${encodeURIComponent(assignmentId)}/submissions`,
    {
      method: 'GET',
    },
  );
}

export async function gradeSubmission(
  orgId: string,
  submissionId: string,
  score: number,
  feedback: string,
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(
    `${labBasePath(orgId)}/submissions/${encodeURIComponent(submissionId)}/grade`,
    {
      method: 'POST',
      body: JSON.stringify({ score, feedback }),
    },
  );
}

export async function fetchStudentProgress(orgId: string): Promise<{ progress: LabStudentProgress[] }> {
  return apiFetch<{ progress: LabStudentProgress[] }>(`${labBasePath(orgId)}/progress`, {
    method: 'GET',
  });
}

export async function fetchFacultyOverview(orgId: string): Promise<{ overview: FacultyOverview }> {
  return apiFetch<{ overview: FacultyOverview }>(`${labBasePath(orgId)}/faculty/overview`, {
    method: 'GET',
  });
}
