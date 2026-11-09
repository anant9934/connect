'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EngagementExplainer, EngagementTable, ScoreBadge } from '@/components/engagement/Engagement';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { getSession } from '@/features/auth/api';
import { ApiError } from '@/lib/api/client';
import * as api from '@/features/institution/api';
import { AttendancePillars } from '@/components/attendance/AttendancePillars';
import { getPillars, type Pillars } from '@/features/attendance/pillars';

const inputClass =
  'w-full px-3 py-2 rounded-xl border border-[#E9E9E5] bg-[#FCFCFA] text-[16px] sm:text-sm text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#7258E8] min-h-[44px]';
const labelClass = 'block text-xs font-semibold text-[#171717] mb-1';
const cardClass = 'p-4 rounded-2xl border border-[#E9E9E5] bg-white space-y-3';
const STAFF_ROLES = ['institution_admin', 'institution_auditor', 'department_coordinator', 'faculty'];
const AT_RISK_BELOW = 0.75;

const percent = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${Math.round(Number(value) * 100)}%`);
const attendedShare = (row: { present: number; late: number; partial: number; absent: number }) => {
  const total = Number(row.present) + Number(row.late) + Number(row.partial) + Number(row.absent);
  return total === 0 ? null : (Number(row.present) + Number(row.late)) / total;
};

export default function AttendancePage() {
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready'>('loading');
  const [orgs, setOrgs] = useState<api.Organization[]>([]);
  const [orgId, setOrgId] = useState('');
  const [batches, setBatches] = useState<api.Batch[]>([]);
  const [batchId, setBatchId] = useState('');
  const [members, setMembers] = useState<api.Member[]>([]);
  const [students, setStudents] = useState<api.StudentSummary[]>([]);
  const [classes, setClasses] = useState<api.ClassSummary[]>([]);
  const [engagement, setEngagement] = useState<{ title: string; sessionId: string; people: api.EngagementRow[] } | null>(null);
  const [pillars, setPillars] = useState<{ name: string; data: Pillars } | null>(null);
  const [pillarsError, setPillarsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const org = orgs.find((o) => o.id === orgId);
  const isStaff = Boolean(org && STAFF_ROLES.includes(org.role));
  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback);

  useEffect(() => {
    (async () => {
      try {
        if (!(await getSession())) {
          setState('signed-out');
          return;
        }
        const list = await api.listOrganizations();
        setOrgs(list);
        if (list.length > 0) setOrgId(list[0].id);
        setState('ready');
      } catch (err) {
        fail(err, 'Could not load your organizations.');
        setState('ready');
      }
    })();
  }, []);

  useEffect(() => {
    if (!orgId) return;
    setBatchId('');
    setBatches([]);
    setError(null);
    // Batch names repeat across courses ("Section A"), so label each batch with its course.
    Promise.all([api.listBatches(orgId), api.listCourses(orgId).catch(() => [] as api.Course[])])
      .then(([list, courses]) => {
        const codeOf = new Map(courses.map((c) => [c.id, c.code]));
        const labelled = list
          .map((b) => ({ ...b, name: codeOf.has(b.courseId) ? `${codeOf.get(b.courseId)} · ${b.name}` : b.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setBatches(labelled);
        if (labelled.length > 0) setBatchId(labelled[0].id);
      })
      .catch((err) => fail(err, 'Could not load batches.'));
  }, [orgId]);

  useEffect(() => {
    if (!orgId || !isStaff) return;
    api.listMembers(orgId).then(setMembers).catch(() => setMembers([]));
  }, [orgId, isStaff]);

  // Only the response for the batch currently selected may update the page, so a slow
  // earlier request can never show one course's numbers under another course's name.
  const latestBatch = useRef('');
  const load = useCallback(async () => {
    if (!orgId || !batchId) return;
    const requested = `${orgId}:${batchId}`;
    latestBatch.current = requested;
    setEngagement(null);
    setStudents([]);
    setClasses([]);
    try {
      const [nextStudents, nextClasses] = await Promise.all([api.getStudentSummaries(orgId, batchId), api.getClassSummaries(orgId, batchId)]);
      if (latestBatch.current !== requested) return;
      setStudents(nextStudents);
      setClasses(nextClasses);
    } catch (err) {
      if (latestBatch.current === requested) fail(err, 'Could not load attendance.');
    }
  }, [orgId, batchId]);

  useEffect(() => {
    load();
  }, [load]);

  const openEngagement = async (item: api.ClassSummary) => {
    setError(null);
    try {
      setEngagement({ title: item.title, sessionId: item.id, people: await api.getEngagement(orgId, item.id) });
      setPillars(null);
    } catch (err) {
      fail(err, 'Could not load engagement.');
    }
  };

  if (state === 'loading') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FCFCFA]">
        <Loader2 className="w-6 h-6 animate-spin text-[#7258E8]" aria-label="Loading" />
      </main>
    );
  }
  if (state === 'signed-out') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FCFCFA] px-4">
        <div className="text-center space-y-3">
          <h1 className="text-lg font-bold text-[#171717]">Authentication Required</h1>
          <Link href="/sign-in?redirect=/attendance" className="inline-flex items-center px-4 rounded-xl bg-[#7258E8] text-white text-sm font-semibold min-h-[44px]">Sign in</Link>
        </div>
      </main>
    );
  }

  const nameOf = (id: string) => members.find((m) => m.userId === id)?.displayName ?? (isStaff ? id : 'You');
  const atRisk = students.filter((s) => {
    const share = attendedShare(s);
    return share !== null && share < AT_RISK_BELOW;
  });

  return (
    <main className="min-h-screen bg-[#FCFCFA] px-4 py-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <Link href="/institution" className="inline-flex items-center gap-1.5 text-sm text-[#686868] hover:text-[#171717] min-h-[44px]">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Classes and courses
        </Link>
        <h1 className="text-xl font-bold text-[#171717]">Attendance</h1>
        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
        {orgs.length === 0 && !error && (
          <p className="text-sm text-[#686868] p-6 text-center rounded-2xl border border-dashed border-[#E9E9E5]">You do not belong to an organization yet.</p>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          {orgs.length > 1 && (
            <div>
              <label htmlFor="attendance-org" className={labelClass}>Organization</label>
              <select id="attendance-org" value={orgId} onChange={(e) => setOrgId(e.target.value)} className={inputClass}>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          {batches.length > 0 && (
            <div>
              <label htmlFor="attendance-batch" className={labelClass}>Batch</label>
              <select id="attendance-batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} className={inputClass}>
                {batches.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.academicTerm}</option>)}
              </select>
            </div>
          )}
        </div>

        {isStaff && atRisk.length > 0 && (
          <section className="p-4 rounded-2xl border border-amber-300 bg-amber-50 space-y-1">
            <h2 className="text-sm font-semibold text-[#171717]">Below 75% present or late</h2>
            <ul data-testid="at-risk" className="text-sm text-[#404040]">
              {atRisk.map((s) => <li key={s.studentUserId}>{nameOf(s.studentUserId)}: {percent(attendedShare(s))}</li>)}
            </ul>
          </section>
        )}

        <section className={cardClass}>
          <h2 className="text-sm font-semibold text-[#171717]">{isStaff ? 'Students' : 'Your attendance'}</h2>
          {students.length === 0 && <p className="text-sm text-[#686868]">No attendance has been recorded for this batch yet.</p>}
          {students.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="text-xs text-[#686868]">
                    {['Student', 'Engagement score', 'Classes', 'Present', 'Late', 'Partial', 'Absent', 'Time connected', 'Activity', 'Tab visible', 'Joined late', 'Left early', 'Corrected'].map((h) => (
                      <th key={h} className="py-1 pr-3 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.studentUserId} data-testid="student-row" className="border-t border-[#E9E9E5]">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{nameOf(s.studentUserId)}</td>
                      <td className="py-1.5 pr-3"><ScoreBadge score={s.engagementScore} showLabel /></td>
                      <td className="py-1.5 pr-3">{s.sessions}</td>
                      <td className="py-1.5 pr-3">{s.present}</td>
                      <td className="py-1.5 pr-3">{s.late}</td>
                      <td className="py-1.5 pr-3">{s.partial}</td>
                      <td className="py-1.5 pr-3">{s.absent}</td>
                      <td className="py-1.5 pr-3">{percent(s.durationRatio)}</td>
                      <td className="py-1.5 pr-3">{percent(s.engagementRatio)}</td>
                      <td className="py-1.5 pr-3">{percent(s.browserRatio)}</td>
                      <td className="py-1.5 pr-3">{s.joinedLate}</td>
                      <td className="py-1.5 pr-3">{s.leftEarly}</td>
                      <td className="py-1.5 pr-3">{s.corrected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <EngagementExplainer />
          <p className="text-xs text-[#686868]">
            These measure different things. Time connected comes from the meeting server, engagement from messages, reactions, raised hands, poll answers and questions, and tab visibility is reported by each browser. None of them shows whether someone was paying attention.
          </p>
        </section>

        <section className={cardClass}>
          <h2 className="text-sm font-semibold text-[#171717]">Classes</h2>
          {classes.length === 0 && <p className="text-sm text-[#686868]">No classes in this batch.</p>}
          <ul className="divide-y divide-[#E9E9E5]">
            {classes.map((item) => (
              <li key={item.id} data-testid="class-row" className="py-2 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#171717] break-words">{item.title}</p>
                  <p className="text-xs text-[#686868]">
                    {new Date(item.start).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {item.status} · present {item.present}, late {item.late}, partial {item.partial}, absent {item.absent}
                    {!item.attendanceFinalized && new Date(item.start) < new Date() && ' · attendance pending'}
                  </p>
                </div>
                {isStaff && <span className="text-xs text-[#686868] flex items-center gap-1">Avg engagement <ScoreBadge score={item.engagementScore} /></span>}
                {isStaff && (
                  <button type="button" onClick={() => openEngagement(item)} className="text-sm font-semibold text-[#7258E8] underline min-h-[44px]">Engagement</button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {engagement && (
          <section className={cardClass}>
            <h2 className="text-sm font-semibold text-[#171717]">Engagement in {engagement.title}</h2>
            {engagement.people.length === 0 && <p className="text-sm text-[#686868]">No activity recorded.</p>}
            {engagement.people.length > 0 && (
              <EngagementTable
                rows={engagement.people.map((p) => ({ ...p, pollsAnswered: p.pollAnswers }))}
                onSelect={async (userId, name) => {
                  setPillarsError(null);
                  try {
                    setPillars({ name, data: await getPillars(engagement.sessionId, { student: userId, org: orgId, session: true }) });
                  } catch {
                    setPillarsError('Could not load this student\'s attendance pillars.');
                  }
                }}
              />
            )}
            {pillarsError && <p role="alert" className="text-sm text-[#9B2C2C]">{pillarsError}</p>}
            {pillars && <AttendancePillars pillars={pillars.data} name={pillars.name} />}
            <EngagementExplainer />
          </section>
        )}
      </div>
    </main>
  );
}
