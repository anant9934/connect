import { apiFetch } from '@/lib/api/client';

export interface Organization { id: string; slug: string; name: string; role: string }
export interface Member { userId: string; displayName: string; email: string; role: string; status: string }
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
}
export interface AttendancePolicy { version: number; minPresentRatio: number; minPartialRatio: number; lateGraceSeconds: number | null }

const orgPath = (org: string, rest: string) => `/api/v1/organizations/${encodeURIComponent(org)}${rest}`;
const post = <T,>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const listOrganizations = async () =>
  (await apiFetch<{ organizations: Organization[] }>('/api/v1/organizations', { method: 'GET' })).organizations;
export const listMembers = async (org: string) =>
  (await apiFetch<{ members: Member[] }>(orgPath(org, '/members'), { method: 'GET' })).members;
export const addMember = (org: string, email: string, role: string) => post(orgPath(org, '/members'), { email, role });
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
export const createPolicy = (org: string, minPresentRatio: number, minPartialRatio: number, lateGraceSeconds: number) =>
  post(orgPath(org, '/attendance-policies'), { minPresentRatio, minPartialRatio, lateGraceSeconds });
