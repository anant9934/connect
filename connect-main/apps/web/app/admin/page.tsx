'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { getSession } from '@/features/auth/api';
import { ApiError } from '@/lib/api/client';
import * as api from '@/features/institution/api';

const AUDIT_PAGE_SIZE = 25;
const AUDIT_REFRESH_MS = 5000;
const inputClass =
  'w-full px-3 py-2 rounded-xl border border-[#E9E9E5] bg-[#FCFCFA] text-[16px] sm:text-sm text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#7258E8] min-h-[44px]';
const labelClass = 'block text-xs font-semibold text-[#171717] mb-1';
const cardClass = 'p-4 rounded-2xl border border-[#E9E9E5] bg-white space-y-3';
const pagerClass = 'px-4 rounded-xl border border-[#E9E9E5] text-sm font-semibold text-[#171717] min-h-[44px] disabled:opacity-50';
const OVERSEER_ROLES = ['institution_admin', 'institution_auditor'];
const ROLE_LABELS: Record<string, string> = {
  institution_admin: 'Administrator',
  institution_auditor: 'Auditor',
  institution_member: 'Member',
  department_coordinator: 'Coordinator',
  faculty: 'Faculty',
  student: 'Student',
};
const STATUS_LABELS: Record<string, string> = { active: 'Active', suspended: 'Suspended', revoked: 'Removed' };
const messageOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function Stat({ label, value, id }: { label: string; value: number; id: string }) {
  return (
    <div className="p-3 rounded-xl bg-[#FCFCFA] border border-[#E9E9E5] min-w-0">
      <p data-testid={`stat-${id}`} className="text-xl font-bold text-[#171717]">{value}</p>
      <p className="text-xs text-[#686868]">{label}</p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={cardClass}>
      <h2 className="text-sm font-semibold text-[#171717]">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{children}</div>
    </section>
  );
}

export default function AdminPage() {
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready'>('loading');
  const [orgs, setOrgs] = useState<api.Organization[]>([]);
  const [orgId, setOrgId] = useState('');
  const [overview, setOverview] = useState<api.OrgOverview | null>(null);
  const [members, setMembers] = useState<api.Member[]>([]);
  const [memberFilter, setMemberFilter] = useState('');
  const [events, setEvents] = useState<api.AuditEvent[]>([]);
  const [eventTotal, setEventTotal] = useState(0);
  const [eventType, setEventType] = useState('');
  const [offset, setOffset] = useState(0);
  const [myId, setMyId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const org = orgs.find((o) => o.id === orgId);
  const canManage = org?.role === 'institution_admin';

  useEffect(() => {
    (async () => {
      try {
        const user = await getSession();
        if (!user) {
          setState('signed-out');
          return;
        }
        setMyId(user.id);
        const list = (await api.listOrganizations()).filter((o) => OVERSEER_ROLES.includes(o.role));
        setOrgs(list);
        if (list.length > 0) setOrgId(list[0].id);
        setState('ready');
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 401) {
          setState('signed-out');
          return;
        }
        setError(messageOf(err, 'Could not load your organizations.'));
        setState('ready');
      }
    })();
  }, []);

  const loadState = useCallback(async () => {
    if (!orgId) return;
    try {
      const [nextOverview, nextMembers] = await Promise.all([api.getOverview(orgId), api.listMembers(orgId)]);
      setOverview(nextOverview);
      setMembers(nextMembers);
    } catch (err) {
      setError(messageOf(err, 'Could not load this organization.'));
    }
  }, [orgId]);

  const loadEvents = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await api.listAuditEvents(orgId, { event: eventType.trim(), limit: AUDIT_PAGE_SIZE, offset });
      setEvents(res.events);
      setEventTotal(res.total);
    } catch (err) {
      setError(messageOf(err, 'Could not load the audit log.'));
    }
  }, [orgId, eventType, offset]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  // Audit entries are written just after each action, so the log refreshes on its own.
  useEffect(() => {
    loadEvents();
    const timer = setInterval(loadEvents, AUDIT_REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadEvents]);

  const changeMember = async (member: api.Member, role: string, status: string) => {
    setError(null);
    setNotice(null);
    try {
      await api.updateMember(orgId, member.userId, role, status);
      const roleLabel = ROLE_LABELS[role] || role;
      const statusLabel = (STATUS_LABELS[status] || status).toLowerCase();
      setNotice(`${member.displayName} is now ${roleLabel}, ${statusLabel}.`);
      await loadState();
    } catch (err) {
      setError(messageOf(err, 'Could not change this person.'));
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
          <Link href="/sign-in?redirect=/admin" className="inline-flex items-center px-4 rounded-xl bg-[#7258E8] text-white text-sm font-semibold min-h-[44px]">
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  const term = memberFilter.trim().toLowerCase();
  const visibleMembers = members.filter((m) => !term || m.displayName.toLowerCase().includes(term) || m.email.toLowerCase().includes(term));
  const attendance = overview?.attendance30Days;
  const attended = attendance ? attendance.present + attendance.late : 0;
  const counted = attendance ? attended + attendance.partial + attendance.absent : 0;

  return (
    <main className="min-h-screen bg-[#FCFCFA] px-4 py-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-[#686868] hover:text-[#171717] min-h-[44px]">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Home
          </Link>
          <div className="flex gap-4">
            <Link href="/institution" className="text-sm font-semibold text-[#7258E8] underline inline-flex items-center min-h-[44px]">Classes and courses</Link>
            <Link href="/history" className="text-sm font-semibold text-[#7258E8] underline inline-flex items-center min-h-[44px]">Meeting history</Link>
          </div>
        </div>
        <h1 className="text-xl font-bold text-[#171717]">Administration</h1>

        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
        {notice && <p role="status" className="text-sm text-[#171717] bg-[#F3F0FF] rounded-xl px-3 py-2">{notice}</p>}

        {orgs.length === 0 && !error && (
          <p className="text-sm text-[#686868] p-6 text-center rounded-2xl border border-dashed border-[#E9E9E5]">
            You do not administer an organization. Ask an administrator if you need access.
          </p>
        )}

        {orgs.length > 1 && (
          <div>
            <label htmlFor="admin-org" className={labelClass}>Organization</label>
            <select id="admin-org" value={orgId} onChange={(e) => { setOrgId(e.target.value); setOffset(0); }} className={inputClass}>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
        {org && <p className="text-sm text-[#404040]">{org.name} · {ROLE_LABELS[org.role]}</p>}

        {overview && (
          <>
            <Group title="People">
              <Stat id="active" label="Active" value={overview.people.active} />
              <Stat id="students" label="Students" value={overview.people.students} />
              <Stat id="faculty" label="Faculty" value={overview.people.faculty} />
              <Stat id="suspended" label="Suspended" value={overview.people.suspended} />
            </Group>
            <Group title="Courses">
              <Stat id="departments" label="Departments" value={overview.structure.departments} />
              <Stat id="courses" label="Courses" value={overview.structure.courses} />
              <Stat id="batches" label="Batches" value={overview.structure.batches} />
              <Stat id="enrollments" label="Enrollments" value={overview.structure.enrollments} />
            </Group>
            <Group title="Classes">
              <Stat id="live" label="Live now" value={overview.classes.live} />
              <Stat id="next7" label="Next 7 days" value={overview.classes.next7Days} />
              <Stat id="completed" label="Completed, 30 days" value={overview.classes.completed30Days} />
              <Stat id="awaiting" label="Attendance not final" value={overview.classes.awaitingAttendance} />
            </Group>
            <Group title="Attendance, last 30 days">
              <Stat id="attended" label="Present or late" value={attended} />
              <Stat id="partial" label="Partial" value={overview.attendance30Days.partial} />
              <Stat id="absent" label="Absent" value={overview.attendance30Days.absent} />
              <Stat id="corrected" label="Corrected" value={overview.attendance30Days.corrected} />
            </Group>
            {counted > 0 && (
              <p className="text-xs text-[#686868]">{Math.round((attended / counted) * 100)}% of {counted} attendance records were present or late.</p>
            )}
          </>
        )}

        {org && (
          <section className={cardClass}>
            <h2 className="text-sm font-semibold text-[#171717]">People</h2>
            <div>
              <label htmlFor="member-filter" className={labelClass}>Find by name or email</label>
              <input id="member-filter" type="search" value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)} className={inputClass} />
            </div>
            {visibleMembers.length === 0 && <p className="text-sm text-[#686868]">Nobody matches.</p>}
            <ul className="divide-y divide-[#E9E9E5]">
              {visibleMembers.map((member) => (
                <li key={member.userId} data-testid="admin-member" className="py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#171717] break-words">{member.displayName}</p>
                    <p className="text-xs text-[#686868] break-all">{member.email}</p>
                  </div>
                  {canManage && member.userId !== myId ? (
                    <div className="flex flex-wrap gap-2">
                      <select aria-label={`Role of ${member.displayName}`} value={member.role} onChange={(e) => changeMember(member, e.target.value, member.status)} className={`${inputClass} !w-auto`}>
                        {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      <select aria-label={`Status of ${member.displayName}`} value={member.status} onChange={(e) => changeMember(member, member.role, e.target.value)} className={`${inputClass} !w-auto`}>
                        {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </div>
                  ) : (
                    <p className="text-xs text-[#404040]">{ROLE_LABELS[member.role]} · {STATUS_LABELS[member.status]}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {org && (
          <section className={cardClass}>
            <h2 className="text-sm font-semibold text-[#171717]">Audit log</h2>
            <div>
              <label htmlFor="audit-event" className={labelClass}>Filter by event</label>
              <input id="audit-event" type="search" maxLength={64} placeholder="institution.member_updated" value={eventType} onChange={(e) => { setEventType(e.target.value); setOffset(0); }} className={inputClass} />
            </div>
            {events.length === 0 && <p className="text-sm text-[#686868]">No events.</p>}
            <ul className="divide-y divide-[#E9E9E5]">
              {events.map((event) => (
                <li key={event.id} data-testid="audit-event" className="py-2 text-sm text-[#171717] break-words">
                  <span className="font-semibold">{event.eventType}</span>
                  <span className="text-[#404040]"> by {event.actorName ?? 'the system'}{event.targetName ? `, on ${event.targetName}` : ''}</span>
                  <p className="text-xs text-[#686868]">{new Date(event.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
                </li>
              ))}
            </ul>
            {eventTotal > AUDIT_PAGE_SIZE && (
              <nav aria-label="Audit pages" className="flex items-center justify-between gap-2">
                <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - AUDIT_PAGE_SIZE))} className={pagerClass}>Previous</button>
                <span className="text-xs text-[#686868]">{offset + 1}–{Math.min(offset + AUDIT_PAGE_SIZE, eventTotal)} of {eventTotal}</span>
                <button type="button" disabled={offset + AUDIT_PAGE_SIZE >= eventTotal} onClick={() => setOffset(offset + AUDIT_PAGE_SIZE)} className={pagerClass}>Next</button>
              </nav>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
