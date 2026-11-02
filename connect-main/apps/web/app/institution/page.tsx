'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getSession } from '@/features/auth/api';
import { ApiError } from '@/lib/api/client';
import * as api from '@/features/institution/api';

const inputClass =
  'w-full px-3 py-2 rounded-xl border border-[#E9E9E5] bg-[#FCFCFA] text-[16px] sm:text-sm text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#7258E8] min-h-[44px]';
const labelClass = 'block text-xs font-semibold text-[#171717] mb-1';
const buttonClass = 'rounded-xl bg-[#7258E8] text-white text-sm font-semibold px-4 min-h-[44px] disabled:opacity-60';
const cardClass = 'p-4 rounded-2xl border border-[#E9E9E5] bg-white space-y-3';

const ROLE_LABELS: Record<string, string> = {
  institution_admin: 'Administrator',
  institution_auditor: 'Auditor',
  institution_member: 'Member',
  department_coordinator: 'Coordinator',
  faculty: 'Faculty',
  student: 'Student',
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Tab = 'classes' | 'attendance' | 'structure' | 'people';

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

function SimpleList({ empty, items }: { empty: string; items: string[] }) {
  if (items.length === 0) return <p className="text-sm text-[#686868]">{empty}</p>;
  return (
    <ul className="text-sm text-[#171717] space-y-1">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

export default function InstitutionPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<api.Organization[]>([]);
  const [orgId, setOrgId] = useState('');
  const [tab, setTab] = useState<Tab>('classes');
  const [error, setError] = useState<string | null>(null);

  const [members, setMembers] = useState<api.Member[]>([]);
  const [departments, setDepartments] = useState<api.Department[]>([]);
  const [courses, setCourses] = useState<api.Course[]>([]);
  const [batches, setBatches] = useState<api.Batch[]>([]);
  const [allocations, setAllocations] = useState<api.Allocation[]>([]);
  const [enrollments, setEnrollments] = useState<api.Enrollment[]>([]);
  const [sessions, setSessions] = useState<api.ClassSession[]>([]);
  const [policies, setPolicies] = useState<api.AttendancePolicy[]>([]);
  const [records, setRecords] = useState<api.AttendanceRow[] | null>(null);
  const [selectedSession, setSelectedSession] = useState('');

  const org = orgs.find((o) => o.id === orgId);
  const isAdmin = org?.role === 'institution_admin';
  const canTeach = isAdmin || org?.role === 'faculty' || org?.role === 'department_coordinator';
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const nameOf = useCallback((id: string) => members.find((m) => m.userId === id)?.displayName ?? id, [members]);
  const faculty = members.filter((m) => m.role === 'faculty' && m.status === 'active');
  const students = members.filter((m) => m.role === 'student' && m.status === 'active');
  const courseName = (id: string) => courses.find((c) => c.id === id)?.title ?? 'Course';

  const refresh = useCallback(async (id: string, role?: string) => {
    if (!id) return;
    setError(null);
    try {
      const allowed = role === 'institution_admin' || role === 'institution_auditor' || role === 'department_coordinator' || role === 'faculty';
      const [d, c, b, a, e, s, p, m] = await Promise.all([
        api.listDepartments(id),
        api.listCourses(id),
        api.listBatches(id),
        api.listAllocations(id),
        api.listEnrollments(id),
        api.listSessions(id),
        api.listPolicies(id),
        allowed ? api.listMembers(id) : Promise.resolve([]),
      ]);
      setDepartments(d);
      setCourses(c);
      setBatches(b);
      setAllocations(a);
      setEnrollments(e);
      setSessions(s);
      setPolicies(p);
      setMembers(m);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this institution.');
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      const user = await getSession().catch(() => null);
      if (!isMounted) return;
      if (!user) {
        router.replace('/sign-in?redirect=/institution');
        return;
      }
      try {
        const list = await api.listOrganizations();
        if (!isMounted) return;
        setOrgs(list);
        if (list[0]) {
          setOrgId(list[0].id);
          await refresh(list[0].id, list[0].role);
        }
      } catch {
        if (isMounted) setError('Could not load your institutions.');
      }
      if (isMounted) setLoading(false);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [refresh, router]);

  // Runs a change, shows any server refusal, and reloads on success.
  const act = async (action: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await action();
      after?.();
      await refresh(orgId, org?.role);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That could not be completed.');
    }
  };

  const submit = (handler: (form: FormData) => Promise<unknown>) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    act(() => handler(new FormData(target)), () => target.reset());
  };
  const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

  const openAttendance = async (id: string) => {
    setSelectedSession(id);
    setRecords(null);
    try {
      setRecords(await api.getAttendance(orgId, id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load attendance.');
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FCFCFA]">
        <Loader2 className="w-6 h-6 animate-spin text-[#7258E8]" aria-label="Loading" />
      </main>
    );
  }

  if (orgs.length === 0) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FCFCFA] px-4">
        <div className="text-center space-y-2 max-w-md">
          <h1 className="text-lg font-bold text-[#171717]">No institutions yet</h1>
          <p className="text-sm text-[#686868]">You are not a member of any institution. Ask your administrator to add your account.</p>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <Link href="/" className="text-sm text-[#7258E8] underline">Back to home</Link>
        </div>
      </main>
    );
  }

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'classes', label: 'Classes', show: true },
    { key: 'attendance', label: 'Attendance', show: true },
    { key: 'structure', label: 'Courses', show: canTeach },
    { key: 'people', label: 'People', show: isAdmin },
  ];

  return (
    <main className="min-h-screen bg-[#FCFCFA] px-4 py-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-[#171717]">{org?.name}</h1>
          {orgs.length > 1 && (
            <select
              aria-label="Institution"
              className={inputClass + ' max-w-xs'}
              value={orgId}
              onChange={(e) => {
                setOrgId(e.target.value);
                refresh(e.target.value, orgs.find((o) => o.id === e.target.value)?.role);
              }}
            >
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </header>

        <nav role="tablist" aria-label="Sections" className="flex flex-wrap gap-2">
          {tabs.filter((t) => t.show).map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 rounded-xl text-sm font-semibold min-h-[44px] border ${tab === t.key ? 'bg-[#EEE8FF] border-[#7258E8] text-[#171717]' : 'bg-white border-[#E9E9E5] text-[#686868]'}`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}

        {tab === 'classes' && (
          <section className="space-y-4">
            {canTeach && (
              <form
                id="schedule-class"
                className={cardClass}
                onSubmit={submit(async (form) => {
                  const batch = batches.find((b) => b.id === text(form, 'batch'));
                  const allocation = allocations.find((a) => a.courseId === batch?.courseId && a.status === 'active');
                  if (!batch || !allocation) {
                    throw new ApiError(400, { code: 'NO_TEACHER', message: 'Assign a teacher to this course before scheduling classes.' });
                  }
                  const weekdays = WEEKDAYS.map((_, i) => i).filter((i) => form.get(`day${i}`));
                  await api.createSessions(orgId, {
                    courseId: batch.courseId,
                    batchId: batch.id,
                    facultyAllocationId: allocation.id,
                    title: text(form, 'title'),
                    start: new Date(text(form, 'start')).toISOString(),
                    end: new Date(text(form, 'end')).toISOString(),
                    timeZone,
                    recurrence: weekdays.length > 0 ? { weekdays, until: text(form, 'until') } : undefined,
                  });
                })}
              >
                <h2 className="text-base font-semibold text-[#171717]">Schedule a class</h2>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field id="class-title" label="Title"><input id="class-title" name="title" required className={inputClass} /></Field>
                  <Field id="class-batch" label="Batch">
                    <select id="class-batch" name="batch" required className={inputClass}>
                      <option value="">Choose a batch</option>
                      {batches.map((b) => <option key={b.id} value={b.id}>{courseName(b.courseId)} · {b.name}</option>)}
                    </select>
                  </Field>
                  <Field id="class-start" label="Starts"><input id="class-start" name="start" type="datetime-local" required className={inputClass} /></Field>
                  <Field id="class-end" label="Ends"><input id="class-end" name="end" type="datetime-local" required className={inputClass} /></Field>
                </div>
                <fieldset>
                  <legend className={labelClass}>Repeat every (optional)</legend>
                  <div className="flex flex-wrap gap-3">
                    {WEEKDAYS.map((day, i) => (
                      <label key={day} className="flex items-center gap-1.5 text-sm text-[#171717] min-h-[44px]">
                        <input type="checkbox" name={`day${i}`} /> {day}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Field id="class-until" label="Repeat until"><input id="class-until" name="until" type="date" className={inputClass} /></Field>
                <p className="text-xs text-[#686868]">Times are in your time zone: {timeZone}. Repeats keep the same local time across daylight saving.</p>
                <button type="submit" className={buttonClass}>Schedule</button>
              </form>
            )}

            <div className={cardClass}>
              <h2 className="text-base font-semibold text-[#171717]">Class calendar</h2>
              {sessions.length === 0 && <p className="text-sm text-[#686868]">No classes yet.</p>}
              <ul className="space-y-2">
                {sessions.map((s) => (
                  <li key={s.id} className="border-t border-[#E9E9E5] pt-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-[#171717]">{s.title}</p>
                      <p className="text-xs text-[#686868]">
                        {courseName(s.courseId)} · {new Date(s.scheduledStart).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {s.status}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {s.roomCode && (s.status === 'scheduled' || s.status === 'active') && (
                        <Link href={`/room/${s.roomCode}/preview`} className="px-3 rounded-xl border border-[#E9E9E5] text-xs font-semibold text-[#171717] min-h-[44px] inline-flex items-center">
                          Open class
                        </Link>
                      )}
                      {canTeach && s.status === 'scheduled' && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm('Cancel this class?')) act(() => api.cancelSession(orgId, s.id, false));
                          }}
                          className="px-3 rounded-xl border border-[#E9E9E5] text-xs font-semibold text-red-600 min-h-[44px]"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {tab === 'attendance' && (
          <section className="space-y-4">
            <div className={cardClass}>
              <Field id="attendance-session" label="Class">
                <select id="attendance-session" className={inputClass} value={selectedSession} onChange={(e) => e.target.value && openAttendance(e.target.value)}>
                  <option value="">Choose a class</option>
                  {sessions.filter((s) => s.status === 'completed' || s.status === 'active').map((s) => (
                    <option key={s.id} value={s.id}>{s.title} · {new Date(s.scheduledStart).toLocaleDateString()}</option>
                  ))}
                </select>
              </Field>
              {selectedSession && records === null && <p className="text-sm text-[#686868]">Loading…</p>}
              {records && records.length === 0 && <p className="text-sm text-[#686868]">No attendance has been recorded for this class yet.</p>}
              {records && records.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left text-[#171717]">
                    <thead>
                      <tr className="text-xs text-[#686868]">
                        <th className="py-1 pr-3 font-semibold">Student</th>
                        <th className="py-1 pr-3 font-semibold">Status</th>
                        <th className="py-1 pr-3 font-semibold">Connected</th>
                        <th className="py-1 pr-3 font-semibold">Rule version</th>
                        {canTeach && <th className="py-1 font-semibold">Correct</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => (
                        <tr key={r.studentUserId} className="border-t border-[#E9E9E5]">
                          <td className="py-1.5 pr-3">{nameOf(r.studentUserId)}</td>
                          <td className="py-1.5 pr-3">{r.status}{r.isOverruled ? ` (corrected from ${r.originalStatus})` : ''}</td>
                          <td className="py-1.5 pr-3">{Math.round(r.connectedSeconds / 60)} min</td>
                          <td className="py-1.5 pr-3">{r.policyVersion ?? 'Default'}</td>
                          {canTeach && (
                            <td className="py-1.5">
                              <button
                                type="button"
                                className="text-xs font-semibold text-[#7258E8] underline min-h-[44px]"
                                onClick={() => {
                                  const status = window.prompt('New status: present, late, partial or absent');
                                  const reason = status && window.prompt('Reason, at least 10 characters');
                                  if (status && reason) {
                                    act(() => api.overruleAttendance(orgId, selectedSession, r.studentUserId, status.trim(), reason), () => openAttendance(selectedSession));
                                  }
                                }}
                              >
                                Correct
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {canTeach && (
                    <a href={`${process.env.NEXT_PUBLIC_API_URL || ''}${api.attendanceCsvPath(orgId, selectedSession)}`} className="text-xs font-semibold text-[#7258E8] underline inline-flex items-center min-h-[44px]">
                      Download CSV
                    </a>
                  )}
                </div>
              )}
              <p className="text-xs text-[#686868]">Attendance reflects time connected to the class. It does not show whether someone was paying attention.</p>
            </div>

            <div className={cardClass}>
              <h2 className="text-base font-semibold text-[#171717]">Attendance rules</h2>
              <SimpleList
                empty="Using the platform default: present at 75% of the class, partial at 40%."
                items={policies.map((p) => `Version ${p.version}: present at ${Math.round(p.minPresentRatio * 100)}%, partial at ${Math.round(p.minPartialRatio * 100)}%, late after ${p.lateGraceSeconds ?? 300} seconds`)}
              />
              {isAdmin && (
                <form
                  className="grid sm:grid-cols-3 gap-3 items-end"
                  onSubmit={submit((form) => api.createPolicy(orgId, Number(text(form, 'present')) / 100, Number(text(form, 'partial')) / 100, Number(text(form, 'grace'))))}
                >
                  <Field id="policy-present" label="Present at (%)"><input id="policy-present" name="present" type="number" min="0" max="100" required className={inputClass} /></Field>
                  <Field id="policy-partial" label="Partial at (%)"><input id="policy-partial" name="partial" type="number" min="0" max="100" required className={inputClass} /></Field>
                  <Field id="policy-grace" label="Late after (seconds)"><input id="policy-grace" name="grace" type="number" min="0" required className={inputClass} /></Field>
                  <button type="submit" className={buttonClass}>Add new version</button>
                  <p className="text-xs text-[#686868] sm:col-span-3">Classes already evaluated keep the rules they were evaluated with.</p>
                </form>
              )}
            </div>
          </section>
        )}

        {tab === 'structure' && (
          <section className="grid md:grid-cols-2 gap-4">
            <div className={cardClass}>
              <h2 className="text-base font-semibold text-[#171717]">Departments</h2>
              <SimpleList empty="No departments yet." items={departments.map((d) => `${d.code} · ${d.name}`)} />
              {isAdmin && (
                <form id="add-department" className="space-y-2" onSubmit={submit((f) => api.createDepartment(orgId, text(f, 'code'), text(f, 'name')))}>
                  <Field id="dept-code" label="Code"><input id="dept-code" name="code" required className={inputClass} /></Field>
                  <Field id="dept-name" label="Name"><input id="dept-name" name="name" required className={inputClass} /></Field>
                  <button type="submit" className={buttonClass}>Add department</button>
                </form>
              )}
            </div>

            <div className={cardClass}>
              <h2 className="text-base font-semibold text-[#171717]">Courses</h2>
              <SimpleList empty="No courses yet." items={courses.map((c) => `${c.code} · ${c.title}`)} />
              {isAdmin && (
                <form id="add-course" className="space-y-2" onSubmit={submit((f) => api.createCourse(orgId, text(f, 'department'), text(f, 'code'), text(f, 'title')))}>
                  <Field id="course-department" label="Department">
                    <select id="course-department" name="department" required className={inputClass}>
                      <option value="">Choose a department</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </Field>
                  <Field id="course-code" label="Code"><input id="course-code" name="code" required className={inputClass} /></Field>
                  <Field id="course-title" label="Title"><input id="course-title" name="title" required className={inputClass} /></Field>
                  <button type="submit" className={buttonClass}>Add course</button>
                </form>
              )}
            </div>

            <div className={cardClass}>
              <h2 className="text-base font-semibold text-[#171717]">Batches</h2>
              <SimpleList empty="No batches yet." items={batches.map((b) => `${courseName(b.courseId)} · ${b.name} · ${b.academicTerm}`)} />
              {isAdmin && (
                <form id="add-batch" className="space-y-2" onSubmit={submit((f) => api.createBatch(orgId, text(f, 'course'), text(f, 'name'), text(f, 'term'), text(f, 'from'), text(f, 'to')))}>
                  <Field id="batch-course" label="Course">
                    <select id="batch-course" name="course" required className={inputClass}>
                      <option value="">Choose a course</option>
                      {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  </Field>
                  <Field id="batch-name" label="Name"><input id="batch-name" name="name" required className={inputClass} /></Field>
                  <Field id="batch-term" label="Term"><input id="batch-term" name="term" required className={inputClass} /></Field>
                  <Field id="batch-from" label="Starts"><input id="batch-from" name="from" type="date" required className={inputClass} /></Field>
                  <Field id="batch-to" label="Ends"><input id="batch-to" name="to" type="date" required className={inputClass} /></Field>
                  <button type="submit" className={buttonClass}>Add batch</button>
                </form>
              )}
            </div>

            <div className={cardClass}>
              <h2 className="text-base font-semibold text-[#171717]">Teachers and students</h2>
              <SimpleList empty="No teachers assigned yet." items={allocations.filter((a) => a.status === 'active').map((a) => `${nameOf(a.facultyUserId)} teaches ${courseName(a.courseId)}`)} />
              {isAdmin && (
                <form id="assign-faculty" className="space-y-2" onSubmit={submit((f) => api.createAllocation(orgId, text(f, 'course'), text(f, 'faculty')))}>
                  <Field id="alloc-course" label="Course">
                    <select id="alloc-course" name="course" required className={inputClass}>
                      <option value="">Choose a course</option>
                      {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  </Field>
                  <Field id="alloc-faculty" label="Teacher">
                    <select id="alloc-faculty" name="faculty" required className={inputClass}>
                      <option value="">Choose a teacher</option>
                      {faculty.map((m) => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}
                    </select>
                  </Field>
                  <button type="submit" className={buttonClass}>Assign teacher</button>
                </form>
              )}
              <p className="text-xs text-[#686868]">{enrollments.filter((e) => e.status === 'enrolled').length} students enrolled</p>
              {isAdmin && (
                <form id="enroll-student" className="space-y-2" onSubmit={submit((f) => api.createEnrollment(orgId, text(f, 'batch'), text(f, 'student')))}>
                  <Field id="enroll-batch" label="Batch">
                    <select id="enroll-batch" name="batch" required className={inputClass}>
                      <option value="">Choose a batch</option>
                      {batches.map((b) => <option key={b.id} value={b.id}>{courseName(b.courseId)} · {b.name}</option>)}
                    </select>
                  </Field>
                  <Field id="enroll-student-select" label="Student">
                    <select id="enroll-student-select" name="student" required className={inputClass}>
                      <option value="">Choose a student</option>
                      {students.map((m) => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}
                    </select>
                  </Field>
                  <button type="submit" className={buttonClass}>Enroll student</button>
                </form>
              )}
            </div>
          </section>
        )}

        {tab === 'people' && isAdmin && (
          <section className={cardClass}>
            <h2 className="text-base font-semibold text-[#171717]">People</h2>
            <form id="add-member" className="grid sm:grid-cols-3 gap-3 items-end" onSubmit={submit((f) => api.addMember(orgId, text(f, 'email'), text(f, 'role')))}>
              <Field id="member-email" label="Account email"><input id="member-email" name="email" type="email" required className={inputClass} /></Field>
              <Field id="member-role" label="Role">
                <select id="member-role" name="role" required className={inputClass}>
                  {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <button type="submit" className={buttonClass}>Add person</button>
            </form>
            <SimpleList empty="Nobody here yet." items={members.map((m) => `${m.displayName} · ${m.email} · ${ROLE_LABELS[m.role] ?? m.role}${m.status === 'active' ? '' : ` · ${m.status}`}`)} />
          </section>
        )}
      </div>
    </main>
  );
}
