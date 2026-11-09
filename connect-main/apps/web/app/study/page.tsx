'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpenCheck, Layers, ListChecks, Loader2, Pencil, Send, Sparkles } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import { listOrganizations, type Organization } from '@/features/institution/api';
import { searchMeetings, type MeetingItem } from '@/features/rooms/meetings';
import * as study from '@/features/study/api';
import { StudyArtifact, SummaryEditor } from '@/components/study/StudyArtifact';

const STAFF = ['institution_admin', 'department_coordinator', 'faculty'];
const TYPE_LABEL: Record<string, string> = { lecture_summary: 'Notes', practice_quiz: 'Quiz', flashcard_deck: 'Flashcards', study_plan: 'Study plan' };

// The study vault: faculty turn a class's saved transcript into notes, check and edit them, then
// publish; students see only what was published.
export default function StudyPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgId, setOrgId] = useState('');
  const [artifacts, setArtifacts] = useState<study.Artifact[]>([]);
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [meetingId, setMeetingId] = useState('');
  const [selected, setSelected] = useState<study.Artifact | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const org = orgs.find((o) => o.id === orgId);
  const isStaff = !!org && STAFF.includes(org.role);

  useEffect(() => {
    listOrganizations()
      .then((list) => { setOrgs(list); if (list[0]) setOrgId(list[0].id); })
      .catch(() => setError('Sign in to see your study vault.'))
      .finally(() => setLoading(false));
  }, []);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    try {
      const list = await study.listArtifacts(orgId);
      setArtifacts(list);
      setSelected((cur) => (cur ? list.find((a) => a.id === cur.id) ?? null : null));
    } catch {
      setError('Could not load the study vault.');
    }
  }, [orgId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!isStaff) return;
    searchMeetings({ status: 'ended', sort: 'newest', limit: 50, offset: 0 })
      .then((res) => setMeetings(res.meetings.filter((m) => !org || !m.organizationName || m.organizationName === org.name)))
      .catch(() => setMeetings([]));
  }, [isStaff, org]);

  const run = async (label: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await work();
      if (done) setNotice(done);
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const summary = selected?.artifactType === 'lecture_summary' ? (selected.content as study.LectureSummary) : null;
  const sorted = useMemo(() => [...artifacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [artifacts]);

  if (loading) return <main className="min-h-screen flex items-center justify-center bg-[#FCFCFA]"><Loader2 className="w-6 h-6 animate-spin text-[#7444E8]" /></main>;

  return (
    <main className="min-h-screen bg-[#FCFCFA] px-4 py-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-[#5F5F68]"><ArrowLeft className="w-4 h-4" /> Home</Link>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-3xl font-extrabold tracking-tight text-[#17171A] flex items-center gap-2"><BookOpenCheck className="w-7 h-7 text-[#7444E8]" /> Study vault</h1>
            <p className="text-sm text-[#5F5F68]">{isStaff ? 'Turn a class into notes, check them, then publish to students.' : 'Notes, revision sheets, quizzes and flashcards your teachers published.'}</p>
          </div>
          {orgs.length > 1 && (
            <select aria-label="Institution" value={orgId} onChange={(e) => { setOrgId(e.target.value); setSelected(null); }} className="neu-well !rounded-xl px-3 min-h-[40px] text-sm bg-transparent">
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </header>
        {error && <p role="alert" className="text-sm text-[#9B2C2C] bg-[#FFE9E9] rounded-xl px-3 py-2">{error}</p>}
        {notice && <p role="status" className="text-sm text-[#1F6B3B] bg-[#E4F8EB] rounded-xl px-3 py-2">{notice}</p>}
        {!orgId && !error && <p className="text-sm text-[#5F5F68]">Join an institution to use the study vault.</p>}

        {isStaff && (
          <section className="neu-card p-4 space-y-3" data-testid="summarise-meeting">
            <h2 className="font-heading font-bold text-[#17171A] flex items-center gap-2"><Sparkles className="w-4 h-4 text-[#7444E8]" /> Summarise a class</h2>
            <p className="text-xs text-[#5F5F68]">Uses the class&apos;s saved captions and Q&amp;A. The notes stay with faculty until you publish them.</p>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Class meeting" value={meetingId} onChange={(e) => setMeetingId(e.target.value)} className="flex-1 min-w-[14rem] neu-well !rounded-xl px-3 min-h-[44px] text-sm bg-transparent">
                <option value="">Choose a finished class</option>
                {meetings.map((m) => <option key={m.id} value={m.id}>{m.title || m.publicCode} · {new Date(m.meetingAt).toLocaleDateString()}{m.courseTitle ? ` · ${m.courseTitle}` : ''}</option>)}
              </select>
              <button type="button" data-testid="summarise" disabled={!meetingId || busy !== null}
                onClick={() => run('summarise', () => study.summariseMeeting(orgId, meetingId), 'Notes created. Check them, then publish.')}
                className="neu-pill inline-flex items-center gap-1.5 px-4 min-h-[44px] text-sm font-bold !bg-[#7444E8] !text-white disabled:opacity-50">
                {busy === 'summarise' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Summarise
              </button>
            </div>
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <aside className="space-y-2" data-testid="artifact-list">
            {sorted.length === 0 && <p className="text-sm text-[#5F5F68]">{isStaff ? 'Nothing yet. Summarise a class to start.' : 'Nothing has been published yet.'}</p>}
            {sorted.map((a) => (
              <button key={a.id} type="button" onClick={() => { setSelected(a); setEditing(false); }} aria-pressed={selected?.id === a.id}
                className={`w-full text-left neu-card !rounded-2xl p-3 space-y-1 ${selected?.id === a.id ? 'ring-2 ring-[#7444E8]' : ''}`}>
                <p className="text-sm font-semibold text-[#17171A] line-clamp-2">{a.title}</p>
                <p className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full bg-[#FFF4D1] text-[#6B4E00] px-2 py-0.5 font-semibold">{TYPE_LABEL[a.artifactType]}</span>
                  {isStaff && <span className={`rounded-full px-2 py-0.5 font-semibold ${a.visibility === 'published' ? 'bg-[#E4F8EB] text-[#1F6B3B]' : 'bg-[#F1EBFF] text-[#5A2FC7]'}`}>{a.visibility === 'published' ? 'Published' : a.visibility === 'archived' ? 'Archived' : 'Faculty only'}</span>}
                  <span className="text-[#8B8B93]">{new Date(a.createdAt).toLocaleDateString()}</span>
                </p>
              </button>
            ))}
          </aside>

          <section className="min-w-0">
            {!selected ? <p className="text-sm text-[#5F5F68]">Choose something on the left.</p> : (
              <div className="space-y-3" data-testid="artifact-view">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-heading text-xl font-bold text-[#17171A]">{selected.title}</h2>
                  {isStaff && (
                    <div className="flex flex-wrap gap-2">
                      {summary && !editing && <button type="button" data-testid="edit-artifact" className="neu-pill inline-flex items-center gap-1.5 px-3 min-h-[40px] text-xs font-semibold" onClick={() => setEditing(true)}><Pencil className="w-3.5 h-3.5" /> Edit</button>}
                      {summary && (
                        <>
                          <button type="button" disabled={busy !== null} className="neu-pill inline-flex items-center gap-1.5 px-3 min-h-[40px] text-xs font-semibold" onClick={() => run('quiz', () => study.generateQuiz(orgId, summary.title, `${summary.title}: ${summary.keyConcepts.join(', ')}`), 'Quiz created as a draft.')}>
                            {busy === 'quiz' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListChecks className="w-3.5 h-3.5" />} MCQs
                          </button>
                          <button type="button" disabled={busy !== null} className="neu-pill inline-flex items-center gap-1.5 px-3 min-h-[40px] text-xs font-semibold" onClick={() => run('cards', () => study.generateFlashcards(orgId, `${summary.title} flashcards`, study.summaryAsNotes(summary)), 'Flashcards created as a draft.')}>
                            {busy === 'cards' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />} Flashcards
                          </button>
                        </>
                      )}
                      {selected.visibility !== 'published' ? (
                        <button type="button" data-testid="publish-artifact" disabled={busy !== null} className="neu-pill inline-flex items-center gap-1.5 px-3 min-h-[40px] text-xs font-bold !bg-[#2DBE74] !text-white" onClick={() => run('publish', () => study.publishArtifact(orgId, selected.id, 'published'), 'Approved and published to students.')}>
                          <Send className="w-3.5 h-3.5" /> Approve &amp; publish
                        </button>
                      ) : (
                        <button type="button" disabled={busy !== null} className="neu-pill px-3 min-h-[40px] text-xs font-semibold" onClick={() => run('unpublish', () => study.publishArtifact(orgId, selected.id, 'faculty_only'), 'Hidden from students.')}>Unpublish</button>
                      )}
                    </div>
                  )}
                </div>
                {editing && summary ? (
                  <SummaryEditor summary={summary} busy={busy !== null} onCancel={() => setEditing(false)}
                    onSave={async (s) => { if (await run('save', () => study.updateArtifact(orgId, selected.id, s.title, s), selected.visibility === 'published' ? 'Saved. Edited notes go back to review; publish again when ready.' : 'Saved.')) setEditing(false); }} />
                ) : (
                  <StudyArtifact artifact={selected} />
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
