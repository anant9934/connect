'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Code2, Loader2, Plus, Trash2, X } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import * as classroomApi from '@/features/classroom/api';
import type { Poll } from '@/features/classroom/api';
import { listOrganizations } from '@/features/institution/api';
import { createLabAssignment, fetchLabAssignment, fetchLabCourses, fetchSubmissions, gradeSubmission } from '@/features/lab/api';
import type { LabAssignment, LabCourse, LabSubmission, SupportedLanguage } from '@/features/lab/types';
import { AssignmentSolver } from '@/features/lab/components/AssignmentSolver';
import { buildCodingMarker, parseCodingMarker, type CodingAnnouncement } from '@/features/meeting/codingMarker';
import type { ChatMessage } from '@/features/chat/types';

const POLL_REFRESH_MS = 4000;
const SUBMISSIONS_REFRESH_MS = 5000;
// Problems announced longer ago than this do not pop up for someone joining late.
const POPUP_MAX_AGE_MS = 3 * 60 * 60 * 1000;

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function readSeen(key: string): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(key) || '[]'));
  } catch {
    return new Set();
  }
}
function writeSeen(key: string, seen: Set<string>) {
  try {
    sessionStorage.setItem(key, JSON.stringify(Array.from(seen)));
  } catch {
    // Pop-ups may repeat after reload without storage; harmless.
  }
}

interface LiveActivityProps {
  roomCode: string;
  canManage: boolean;
  syncTick: number;
  chatMessages: ChatMessage[];
  /** Tells everyone in the room to refresh now (low-latency data channel hint). */
  sendHint: () => void;
  /** Posts an announcement through the meeting chat. */
  announce: (text: string) => Promise<void> | void;
}

/**
 * Live classroom activity layered over the meeting: polls and coding problems pop up for
 * students the moment the teacher starts them, and teachers can assign a coding problem and
 * review submissions without leaving the class.
 */
export const LiveActivity: React.FC<LiveActivityProps> = ({ roomCode, canManage, syncTick, chatMessages, sendHint, announce }) => {
  const [orgId, setOrgId] = useState<string | null>(null);
  useEffect(() => {
    listOrganizations()
      .then((orgs) => setOrgId(orgs[0]?.id ?? null))
      .catch(() => setOrgId(null));
  }, []);

  const [openProblem, setOpenProblemState] = useState<CodingAnnouncement | null>(null);
  const [showAssign, setShowAssign] = useState(false);

  // ---------- Polls ----------
  const [polls, setPolls] = useState<Poll[]>([]);
  const refreshPolls = useCallback(async () => {
    try {
      const res = await classroomApi.listPolls(roomCode);
      setPolls(res.polls);
    } catch {
      // Next tick retries.
    }
  }, [roomCode]);
  useEffect(() => {
    refreshPolls();
    const timer = setInterval(refreshPolls, POLL_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshPolls]);
  useEffect(() => {
    refreshPolls();
  }, [syncTick, refreshPolls]);

  const pollSeenKey = `tc_poll_seen_${roomCode}`;
  const [dismissedPolls, setDismissedPolls] = useState<Set<string>>(() => (typeof window === 'undefined' ? new Set() : readSeen(pollSeenKey)));
  // Pop-ups never cover an open coding panel or form; they show once it is closed.
  const overlayOpen = openProblem !== null || showAssign;
  const activePoll = canManage || overlayOpen ? null : polls.find((p) => !p.closed && !p.myResponse && !dismissedPolls.has(p.id)) ?? null;
  const dismissPoll = (id: string) => {
    const next = new Set(dismissedPolls).add(id);
    setDismissedPolls(next);
    writeSeen(pollSeenKey, next);
  };

  // ---------- Coding problems ----------
  const codingProblems = useMemo(
    () =>
      chatMessages
        .filter((m) => m.kind === 'announcement')
        .map((m) => ({ message: m, coding: parseCodingMarker(m.text) }))
        .filter((x): x is { message: ChatMessage; coding: CodingAnnouncement } => x.coding !== null),
    [chatMessages]
  );
  const latestProblem = codingProblems.length > 0 ? codingProblems[codingProblems.length - 1] : null;

  const codingSeenKey = `tc_coding_seen_${roomCode}`;
  const [seenProblems, setSeenProblems] = useState<Set<string>>(() => (typeof window === 'undefined' ? new Set() : readSeen(codingSeenKey)));
  const markProblemSeen = (id: string) => {
    const next = new Set(seenProblems).add(id);
    setSeenProblems(next);
    writeSeen(codingSeenKey, next);
  };
  const setOpenProblem = (problem: CodingAnnouncement | null) => {
    if (problem) markProblemSeen(problem.assignmentId);
    setOpenProblemState(problem);
  };
  const problemPopup =
    !canManage &&
    !overlayOpen &&
    latestProblem &&
    !seenProblems.has(latestProblem.coding.assignmentId) &&
    Date.now() - latestProblem.message.timestamp < POPUP_MAX_AGE_MS
      ? latestProblem.coding
      : null;


  return (
    <>
      {/* Floating actions */}
      <div className="fixed left-3 bottom-24 z-40 flex flex-col gap-2 pointer-events-none">
        {canManage && (
          <button
            type="button"
            onClick={() => setShowAssign(true)}
            className="pointer-events-auto inline-flex items-center gap-2 px-3 py-2 rounded-full bg-[#7444E8] text-white text-xs font-semibold shadow-lg hover:bg-[#6537D6]"
            aria-label="Assign coding problem"
          >
            <Code2 className="w-4 h-4" /> Assign coding problem
          </button>
        )}
        {latestProblem && (
          <button
            type="button"
            onClick={() => setOpenProblem(latestProblem.coding)}
            className="pointer-events-auto inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white border border-[#E4E2DB] text-[#17151F] text-xs font-semibold shadow-lg hover:bg-[#FAF9FC] max-w-[260px]"
            aria-label={canManage ? 'Open coding submissions' : 'Open coding problem'}
          >
            <Code2 className="w-4 h-4 text-[#7444E8] shrink-0" />
            <span className="truncate">{canManage ? 'Submissions: ' : 'Coding: '}{latestProblem.coding.title}</span>
          </button>
        )}
      </div>

      {activePoll && (
        <PollPopup
          roomCode={roomCode}
          poll={activePoll}
          onAnswered={() => {
            sendHint();
            refreshPolls();
          }}
          onLater={() => dismissPoll(activePoll.id)}
        />
      )}

      {!activePoll && problemPopup && (
        <Popup ariaLabel="New coding problem" onClose={() => markProblemSeen(problemPopup.assignmentId)}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#F1EBFF] flex items-center justify-center shrink-0">
              <Code2 className="w-5 h-5 text-[#7444E8]" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#7444E8] uppercase tracking-wide">New coding problem</p>
              <h3 className="text-base font-bold text-[#17151F] break-words">{problemPopup.title}</h3>
              <p className="text-xs text-[#5E5A50] mt-1">Your teacher assigned this during class. Solve it here without leaving the meeting.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={() => markProblemSeen(problemPopup.assignmentId)} className="px-3 py-2 text-xs font-semibold rounded-lg text-[#5E5A50] hover:bg-[#F2F2F0]">
              Later
            </button>
            <button
              type="button"
              onClick={() => {
                markProblemSeen(problemPopup.assignmentId);
                setOpenProblem(problemPopup);
              }}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#7444E8] text-white hover:bg-[#6537D6]"
            >
              Solve now
            </button>
          </div>
        </Popup>
      )}

      {openProblem && (
        <Drawer title={openProblem.title} subtitle={canManage ? 'Live submissions' : 'Coding problem'} onClose={() => setOpenProblem(null)}>
          {canManage ? (
            <SubmissionsView problem={openProblem} syncTick={syncTick} onGraded={sendHint} />
          ) : (
            <SolveView problem={openProblem} onSubmitted={sendHint} />
          )}
        </Drawer>
      )}

      {showAssign && (
        <AssignCodingModal
          orgId={orgId}
          onClose={() => setShowAssign(false)}
          onAssigned={async (problem) => {
            await announce(buildCodingMarker(problem.orgId, problem.assignmentId, problem.title));
            sendHint();
            setShowAssign(false);
            setOpenProblem(problem);
          }}
        />
      )}
    </>
  );
};

// ---------- Building blocks ----------

const Popup: React.FC<{ ariaLabel: string; onClose: () => void; children: React.ReactNode }> = ({ ariaLabel, onClose, children }) => (
  <div className="fixed inset-x-0 top-20 z-[60] flex justify-center px-4 pointer-events-none">
    <div role="dialog" aria-label={ariaLabel} className="pointer-events-auto w-full max-w-md rounded-2xl bg-white border border-[#E4E2DB] shadow-2xl p-5 relative animate-in fade-in slide-in-from-top-2 duration-200">
      <button type="button" onClick={onClose} aria-label="Dismiss" className="absolute top-3 right-3 p-1 rounded-md text-[#9C988D] hover:bg-[#F2F2F0]">
        <X className="w-4 h-4" />
      </button>
      {children}
    </div>
  </div>
);

const Drawer: React.FC<{ title: string; subtitle: string; onClose: () => void; children: React.ReactNode }> = ({ title, subtitle, onClose, children }) => (
  <div className="fixed inset-0 z-[55] flex justify-end bg-black/20" onClick={onClose}>
    <aside
      role="dialog"
      aria-label={`${subtitle}: ${title}`}
      onClick={(e) => e.stopPropagation()}
      className="h-full w-full sm:w-[min(820px,92vw)] bg-[#FAF9FC] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
    >
      <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[#E4E2DB] bg-white">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-[#7444E8] uppercase tracking-wide">{subtitle}</p>
          <h2 className="text-sm font-bold text-[#17151F] truncate">{title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close coding panel" className="p-1.5 rounded-md text-[#5E5A50] hover:bg-[#F2F2F0]">
          <X className="w-4 h-4" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </aside>
  </div>
);

const PollPopup: React.FC<{ roomCode: string; poll: Poll; onAnswered: () => void; onLater: () => void }> = ({ roomCode, poll, onAnswered, onLater }) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) =>
    setSelected((prev) => (poll.choiceMode === 'single' ? [id] : prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await classroomApi.respondPoll(roomCode, poll.id, selected);
      onAnswered();
    } catch (err) {
      setError(errorText(err, 'Your answer could not be sent.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popup ariaLabel={poll.kind === 'quiz' ? 'New quiz question' : 'New poll'} onClose={onLater}>
      <div className="flex items-center gap-2 mb-2">
        <BarChart3 className="w-4 h-4 text-[#7444E8]" />
        <p className="text-xs font-semibold text-[#7444E8] uppercase tracking-wide">{poll.kind === 'quiz' ? `Quiz${poll.points ? ` · ${poll.points} pts` : ''}` : 'Poll'}</p>
      </div>
      <h3 className="text-base font-bold text-[#17151F] mb-3 pr-6 break-words">{poll.question}</h3>
      <div className="space-y-2">
        {poll.options.map((o) => (
          <label key={o.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer text-sm ${selected.includes(o.id) ? 'border-[#7444E8] bg-[#F1EBFF]' : 'border-[#E4E2DB] hover:bg-[#FAF9FC]'}`}>
            <input
              type={poll.choiceMode === 'single' ? 'radio' : 'checkbox'}
              name={`poll-${poll.id}`}
              checked={selected.includes(o.id)}
              onChange={() => toggle(o.id)}
              className="accent-[#7444E8]"
            />
            <span className="break-words">{o.label}</span>
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-[#B42318] mt-2">{error}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onLater} className="px-3 py-2 text-xs font-semibold rounded-lg text-[#5E5A50] hover:bg-[#F2F2F0]">
          Later
        </button>
        <button type="button" disabled={busy || selected.length === 0} onClick={submit} className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#7444E8] text-white hover:bg-[#6537D6] disabled:opacity-50">
          {busy ? 'Sending…' : 'Submit answer'}
        </button>
      </div>
    </Popup>
  );
};

const SolveView: React.FC<{ problem: CodingAnnouncement; onSubmitted: () => void }> = ({ problem, onSubmitted }) => {
  const [assignment, setAssignment] = useState<LabAssignment | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchLabAssignment(problem.orgId, problem.assignmentId)
      .then((res) => alive && setAssignment(res.assignment))
      .catch((err) => alive && setError(errorText(err, 'This problem could not be loaded. You may not be enrolled in its course.')));
    return () => {
      alive = false;
    };
  }, [problem.orgId, problem.assignmentId]);
  if (error) return <p className="p-5 text-sm text-[#B42318]">{error}</p>;
  if (!assignment) return <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#7444E8]" /></div>;
  return <AssignmentSolver assignment={assignment} orgId={problem.orgId} onSubmitted={onSubmitted} embedded />;
};

const SubmissionsView: React.FC<{ problem: CodingAnnouncement; syncTick: number; onGraded: () => void }> = ({ problem, syncTick, onGraded }) => {
  const [subs, setSubs] = useState<LabSubmission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetchSubmissions(problem.orgId, problem.assignmentId);
      setSubs(res.submissions ?? []);
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Submissions could not be loaded.'));
    }
  }, [problem.orgId, problem.assignmentId]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, SUBMISSIONS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    refresh();
  }, [syncTick, refresh]);

  if (error) return <p className="p-5 text-sm text-[#B42318]">{error}</p>;
  if (!subs) return <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#7444E8]" /></div>;
  return (
    <div className="p-4 space-y-3">
      <p className="text-xs text-[#5E5A50]">
        {subs.length === 0 ? 'Waiting for students to submit… this list updates live.' : `${subs.length} submission${subs.length === 1 ? '' : 's'} · updates live`}
      </p>
      {subs.map((s) => (
        <div key={s.id} className="rounded-xl bg-white border border-[#E4E2DB]">
          <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#17151F] truncate">{s.student_name || 'Student'}</p>
              <p className="text-[11px] text-[#5E5A50]">
                {s.language.toUpperCase()} · tests {s.passed_count}/{s.total_count} · {new Date(s.created_at).toLocaleTimeString()}
              </p>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${s.status === 'graded' ? 'bg-[#E4F8EB] text-[#1F6B3B]' : 'bg-[#FFF4E5] text-[#8A5300]'}`}>
              {s.status === 'graded' ? `Graded ${s.score}` : 'Needs grading'}
            </span>
          </button>
          {open === s.id && <GradeBox submission={s} orgId={problem.orgId} onGraded={() => { refresh(); onGraded(); }} />}
        </div>
      ))}
    </div>
  );
};

const GradeBox: React.FC<{ submission: LabSubmission; orgId: string; onGraded: () => void }> = ({ submission, orgId, onGraded }) => {
  const [score, setScore] = useState<number>(submission.status === 'graded' ? submission.score : 0);
  const [feedback, setFeedback] = useState(submission.faculty_feedback || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await gradeSubmission(orgId, submission.id, score, feedback);
      onGraded();
    } catch (err) {
      setError(errorText(err, 'The grade could not be saved.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="px-4 pb-4 space-y-3 border-t border-[#F0EEE8]">
      <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-[#17151F] text-[#F4F3EF] text-xs p-3 font-mono whitespace-pre">{submission.source_code}</pre>
      {submission.test_results?.length > 0 && (
        <ul className="text-[11px] space-y-1">
          {submission.test_results.map((t, i) => (
            <li key={i} className={t.passed ? 'text-[#1F6B3B]' : 'text-[#B42318]'}>
              {t.passed ? '✓' : '✗'} Test {i + 1}{t.is_hidden ? ' (hidden)' : ''}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-semibold text-[#5E5A50]">
          Score{' '}
          <input type="number" min={0} value={score} onChange={(e) => setScore(Number(e.target.value))} className="ml-1 w-20 px-2 py-1 border border-[#E4E2DB] rounded-md text-sm" />
        </label>
        <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Feedback for the student" className="flex-1 min-w-[160px] px-2 py-1 border border-[#E4E2DB] rounded-md text-sm" />
        <button type="button" onClick={save} disabled={busy} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#7444E8] text-white hover:bg-[#6537D6] disabled:opacity-50">
          {busy ? 'Saving…' : 'Save grade'}
        </button>
      </div>
      {error && <p className="text-xs text-[#B42318]">{error}</p>}
    </div>
  );
};

interface TestCaseDraft { input: string; expected: string; hidden: boolean }

const LANGUAGES: { id: SupportedLanguage; label: string }[] = [
  { id: 'python', label: 'Python (runs in browser)' },
  { id: 'sql', label: 'SQL (runs in browser)' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'cpp', label: 'C++ (graded manually)' },
  { id: 'java', label: 'Java (graded manually)' },
];

const AssignCodingModal: React.FC<{ orgId: string | null; onClose: () => void; onAssigned: (p: CodingAnnouncement) => Promise<void> }> = ({ orgId, onClose, onAssigned }) => {
  const [courses, setCourses] = useState<LabCourse[] | null>(null);
  const [courseId, setCourseId] = useState('');
  const [title, setTitle] = useState('');
  const [statement, setStatement] = useState('');
  const [language, setLanguage] = useState<SupportedLanguage>('python');
  const [starter, setStarter] = useState('');
  const [marks, setMarks] = useState(10);
  const [tests, setTests] = useState<TestCaseDraft[]>([{ input: '', expected: '', hidden: false }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    if (!orgId) return;
    fetchLabCourses(orgId)
      .then((res) => {
        setCourses(res.courses);
        setCourseId(res.courses[0]?.id ?? '');
      })
      .catch((err) => setError(errorText(err, 'Your lab courses could not be loaded.')));
  }, [orgId]);

  const assign = async () => {
    if (!orgId || !courseId || !title.trim() || !statement.trim()) {
      setError('Choose a course and enter a title and problem statement.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await createLabAssignment(orgId, {
        lab_course_id: courseId,
        title: title.trim(),
        description: statement.trim(),
        allowed_languages: [language],
        starter_code: starter,
        due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        max_score: marks > 0 ? marks : 10,
        status: 'published',
        test_cases: tests
          .filter((t) => t.input.trim() !== '' || t.expected.trim() !== '')
          .map((t) => ({ input: t.input, expected_output: t.expected, is_hidden: t.hidden, weight: 1, time_limit_ms: 2000 })),
      });
      await onAssigned({ orgId, assignmentId: res.assignment.id, title: title.trim() });
    } catch (err) {
      setError(
        err instanceof ApiError && err.statusCode === 403
          ? 'You can only assign problems in a course you teach. Choose another course.'
          : errorText(err, 'The problem could not be assigned.')
      );
      setBusy(false);
    }
  };

  const field = 'w-full px-3 py-2 border border-[#E4E2DB] rounded-lg text-sm focus:outline-none focus:border-[#7444E8]';
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div role="dialog" aria-label="Assign coding problem" onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#17151F] flex items-center gap-2"><Code2 className="w-5 h-5 text-[#7444E8]" /> Assign coding problem</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-md text-[#5E5A50] hover:bg-[#F2F2F0]"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-[#5E5A50]">It pops up for every student in this class immediately. Submissions appear here live for grading.</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="sm:col-span-2 text-xs font-semibold text-[#5E5A50] space-y-1">
            <span>Course</span>
            <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className={field} disabled={!courses}>
              {!courses && <option>Loading…</option>}
              {courses?.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-[#5E5A50] space-y-1">
            <span>Marks</span>
            <input type="number" min={1} value={marks} onChange={(e) => setMarks(Number(e.target.value))} className={field} />
          </label>
        </div>
        <label className="block text-xs font-semibold text-[#5E5A50] space-y-1">
          <span>Title</span>
          <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Reverse a string" className={field} />
        </label>
        <label className="block text-xs font-semibold text-[#5E5A50] space-y-1">
          <span>Problem statement</span>
          <textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={4} placeholder="Read a line from input and print it reversed." className={field} />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-xs font-semibold text-[#5E5A50] space-y-1">
            <span>Language</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value as SupportedLanguage)} className={field}>
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          <label className="sm:col-span-2 text-xs font-semibold text-[#5E5A50] space-y-1">
            <span>Starter code (optional)</span>
            <textarea value={starter} onChange={(e) => setStarter(e.target.value)} rows={2} className={`${field} font-mono`} placeholder="s = input()" />
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#5E5A50]">Test cases (hidden ones are never shown to students)</span>
            <button type="button" onClick={() => setTests((t) => [...t, { input: '', expected: '', hidden: true }])} className="inline-flex items-center gap-1 text-xs font-semibold text-[#7444E8]">
              <Plus className="w-3.5 h-3.5" /> Add test
            </button>
          </div>
          {tests.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-start">
              <textarea value={t.input} onChange={(e) => setTests((all) => all.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)))} rows={1} placeholder="Input" className={`${field} font-mono`} aria-label={`Test ${i + 1} input`} />
              <textarea value={t.expected} onChange={(e) => setTests((all) => all.map((x, j) => (j === i ? { ...x, expected: e.target.value } : x)))} rows={1} placeholder="Expected output" className={`${field} font-mono`} aria-label={`Test ${i + 1} expected output`} />
              <label className="text-[11px] text-[#5E5A50] flex items-center gap-1 pt-2">
                <input type="checkbox" checked={t.hidden} onChange={(e) => setTests((all) => all.map((x, j) => (j === i ? { ...x, hidden: e.target.checked } : x)))} className="accent-[#7444E8]" /> Hidden
              </label>
              <button type="button" onClick={() => setTests((all) => all.filter((_, j) => j !== i))} aria-label={`Remove test ${i + 1}`} className="p-2 text-[#9C988D] hover:text-[#B42318]">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {error && <p className="text-xs text-[#B42318]">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold rounded-lg text-[#5E5A50] hover:bg-[#F2F2F0]">Cancel</button>
          <button type="button" onClick={assign} disabled={busy || !orgId} className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#7444E8] text-white hover:bg-[#6537D6] disabled:opacity-50">
            {busy ? 'Assigning…' : 'Assign to class'}
          </button>
        </div>
      </div>
    </div>
  );
};
