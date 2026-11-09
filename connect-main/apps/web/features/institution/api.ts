import { apiFetch } from '@/lib/api/client';
import { AttendanceCalculation } from '@/features/rooms/meetings';

export interface Organization { id: string; slug: string; name: string; role: string }
export interface Member { userId: string; displayName: string; email: string; role: string; status: string; memberIdentifier?: string | null }
export interface Department { id: string; code: string; name: string }
export interface Course { id: string; departmentId: string; code: string; title: string }
export interface Batch { id: string; courseId: string; name: string; academicTerm: string; startDate: string; endDate: string }
export interface Allocation { id: string; courseId: string; facultyUserId: string; role: string; status: string }
export interface Enrollment { id: string; batchId: string; studentUserId: string; status: string }
export interface ClassSession {
  id: string;
  courseId: string;
  batchId: string;
  title: string;
  scheduledStart: string;
  scheduledEnd: string;
  timeZone: string;
  status: string;
  seriesId?: string | null;
  roomCode?: string | null;
}
export interface AttendanceRow {
  studentUserId: string;
  connectedSeconds: number;
  status: string;
  isOverruled: boolean;
  originalStatus?: string | null;
  overruleReason?: string | null;
  policyVersion?: number | null;
  joinedLate?: boolean;
  leftEarly?: boolean;
  durationRatio?: number | null;
  engagementRatio?: number | null;
  browserRatio?: number | null;
  score?: number | null;
  calculation?: AttendanceCalculation | null;
}
export interface AttendancePolicy {
  version: number;
  minPresentRatio: number;
  minPartialRatio: number;
  lateGraceSeconds: number | null;
  earlyLeaveGraceSeconds: number | null;
  durationWeight: number;
  engagementWeight: number;
  browserWeight: number;
  engagementTarget: number;
}
export interface NewPolicy {
  minPresentRatio: number;
  minPartialRatio: number;
  lateGraceSeconds: number;
  earlyLeaveGraceSeconds?: number;
  durationWeight: number;
  engagementWeight: number;
  browserWeight: number;
  engagementTarget: number;
}
export interface StudentSummary {
  studentUserId: string;
  sessions: number;
  present: number;
  late: number;
  partial: number;
  absent: number;
  connectedSeconds: number;
  joinedLate: number;
  leftEarly: number;
  corrected: number;
  durationRatio: number | null;
  engagementRatio: number | null;
  browserRatio: number | null;
  /** Average 0-100 engagement score across finalised classes; null before any. */
  engagementScore: number | null;
}
export interface ClassSummary {
  id: string;
  title: string;
  start: string;
  status: string;
  attendanceFinalized: boolean;
  present: number;
  late: number;
  partial: number;
  absent: number;
  durationRatio: number | null;
  engagementRatio: number | null;
  browserRatio: number | null;
  engagementScore: number | null;
}
export interface EngagementRow {
  userId: string;
  displayName: string;
  present?: boolean;
  connectedSeconds?: number;
  messages: number;
  reactions: number;
  hands: number;
  pollAnswers: number;
  pollsTotal?: number;
  quizPoints?: number;
  doubts: number;
  codingSubmitted?: number;
  codingTotal?: number;
  visibleSeconds: number;
  hiddenSeconds: number;
  reported: boolean;
  pollsRatio?: number | null;
  codingRatio?: number | null;
  interactionRatio?: number | null;
  focusRatio?: number | null;
  score?: number;
}
export interface AdminEngagementRow {
  studentUserId: string;
  displayName: string;
  sessions: number;
  attended: number;
  absent: number;
  engagementScore: number | null;
  attendanceScore: number | null;
  lastClass: string | null;
}

const orgPath = (org: string, rest: string) => `/api/v1/organizations/${encodeURIComponent(org)}${rest}`;
const post = <T,>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const listOrganizations = async () =>
  (await apiFetch<{ organizations: Organization[] }>('/api/v1/organizations', { method: 'GET' })).organizations;
export const listMembers = async (org: string) =>
  (await apiFetch<{ members: Member[] }>(orgPath(org, '/members'), { method: 'GET' })).members;
export const addMember = (org: string, email: string, role: string, memberIdentifier = '') =>
  post(orgPath(org, '/members'), { email, role, memberIdentifier });
/** A one-time reset code to give the member in person. Shown once; valid for 24 hours. */
export const issuePasswordReset = (org: string, userId: string) =>
  apiFetch<{ code: string; expiresAt: string }>(orgPath(org, `/members/${encodeURIComponent(userId)}/password-reset`), { method: 'POST', body: '{}' });
export const listDepartments = async (org: string) =>
  (await apiFetch<{ departments: Department[] }>(orgPath(org, '/departments'), { method: 'GET' })).departments;
export const createDepartment = (org: string, code: string, name: string) => post(orgPath(org, '/departments'), { code, name });
export const listCourses = async (org: string) =>
  (await apiFetch<{ courses: Course[] }>(orgPath(org, '/courses'), { method: 'GET' })).courses;
export const createCourse = (org: string, departmentId: string, code: string, title: string) =>
  post(orgPath(org, '/courses'), { departmentId, code, title });
export const listBatches = async (org: string) =>
  (await apiFetch<{ batches: Batch[] }>(orgPath(org, '/batches'), { method: 'GET' })).batches;
export const createBatch = (org: string, courseId: string, name: string, academicTerm: string, startDate: string, endDate: string) =>
  post(orgPath(org, '/batches'), { courseId, name, academicTerm, startDate, endDate });
export const listAllocations = async (org: string) =>
  (await apiFetch<{ allocations: Allocation[] }>(orgPath(org, '/allocations'), { method: 'GET' })).allocations;
export const createAllocation = (org: string, courseId: string, facultyUserId: string) =>
  post(orgPath(org, '/allocations'), { courseId, facultyUserId });
export const listEnrollments = async (org: string) =>
  (await apiFetch<{ enrollments: Enrollment[] }>(orgPath(org, '/enrollments'), { method: 'GET' })).enrollments;
export const createEnrollment = (org: string, batchId: string, studentUserId: string) =>
  post(orgPath(org, '/enrollments'), { batchId, studentUserId });
export const listSessions = async (org: string) =>
  (await apiFetch<{ sessions: ClassSession[] }>(orgPath(org, '/sessions'), { method: 'GET' })).sessions;
export const createSessions = (org: string, input: Record<string, unknown>) => post(orgPath(org, '/sessions'), input);
export const cancelSession = (org: string, id: string, following: boolean) =>
  post(orgPath(org, `/sessions/${id}/cancel${following ? '?scope=following' : ''}`));
export const getAttendance = async (org: string, session: string) =>
  (await apiFetch<{ records: AttendanceRow[] }>(orgPath(org, `/sessions/${session}/attendance`), { method: 'GET' })).records;
export const overruleAttendance = (org: string, session: string, student: string, status: string, reason: string) =>
  post(orgPath(org, `/sessions/${session}/attendance/${student}/overrule`), { status, reason });
export const attendanceCsvPath = (org: string, session: string) => orgPath(org, `/sessions/${session}/attendance.csv`);
export const listPolicies = async (org: string) =>
  (await apiFetch<{ policies: AttendancePolicy[] }>(orgPath(org, '/attendance-policies'), { method: 'GET' })).policies;
export const createPolicy = (org: string, policy: NewPolicy) => post(orgPath(org, '/attendance-policies'), policy);
export const getStudentSummaries = async (org: string, batchId: string) =>
  (await apiFetch<{ students: StudentSummary[] }>(orgPath(org, `/attendance/summary?batchId=${encodeURIComponent(batchId)}`), { method: 'GET' })).students;
export const getClassSummaries = async (org: string, batchId: string) =>
  (await apiFetch<{ classes: ClassSummary[] }>(orgPath(org, `/attendance/classes?batchId=${encodeURIComponent(batchId)}`), { method: 'GET' })).classes;
export const getEngagement = async (org: string, session: string) =>
  (await apiFetch<{ people: EngagementRow[] }>(orgPath(org, `/sessions/${encodeURIComponent(session)}/engagement`), { method: 'GET' })).people;

export interface OrgOverview {
  people: { active: number; suspended: number; revoked: number; faculty: number; students: number; administrators: number };
  structure: { departments: number; courses: number; batches: number; enrollments: number };
  classes: { live: number; next7Days: number; completed30Days: number; cancelled30Days: number; awaitingAttendance: number };
  attendance30Days: { present: number; late: number; partial: number; absent: number; corrected: number };
}
export interface AuditEvent {
  id: string;
  eventType: string;
  severity: string;
  actorName: string | null;
  targetName: string | null;
  target: string | null;
  createdAt: string;
}

export const getAdminEngagement = async (org: string) =>
  (await apiFetch<{ students: AdminEngagementRow[] | null }>(orgPath(org, '/admin/engagement'), { method: 'GET' })).students ?? [];
export const getOverview = async (org: string) =>
  (await apiFetch<{ overview: OrgOverview }>(orgPath(org, '/admin/overview'), { method: 'GET' })).overview;
export async function listAuditEvents(org: string, search: { event?: string; from?: string; to?: string; limit: number; offset: number }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return apiFetch<{ events: AuditEvent[]; total: number }>(orgPath(org, `/admin/audit?${params}`), { method: 'GET' });
}
export const updateMember = (org: string, user: string, role: string, status: string) =>
  apiFetch(orgPath(org, `/members/${encodeURIComponent(user)}`), { method: 'PATCH', body: JSON.stringify({ role, status }) });
