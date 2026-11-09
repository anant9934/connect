'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, CircleHelp, PlayCircle } from 'lucide-react';
import { replayLink, type Artifact, type FlashcardSet, type LectureSummary, type PracticeQuiz } from '@/features/study/api';

function At({ roomId, at }: { roomId?: string; at?: string }) {
  if (!at) return null;
  const href = roomId ? replayLink(roomId, at) : null;
  const chip = <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-[#5A2FC7] bg-[#F1EBFF] rounded-full px-2 py-0.5"><PlayCircle className="w-3 h-3" aria-hidden="true" />{at}</span>;
  return href ? <Link href={href} data-testid="timestamp-link" title="Open the recording at this moment">{chip}</Link> : chip;
}

const lines = (v: string) => v.split('\n').map((l) => l.trim()).filter(Boolean);

// Editable fields of a summary; the rest stays as generated. Faculty edit, then publish.
export function SummaryEditor({ summary, onSave, onCancel, busy }: { summary: LectureSummary; onSave: (s: LectureSummary) => void; onCancel: () => void; busy: boolean }) {
  const [title, setTitle] = useState(summary.title);
  const [overview, setOverview] = useState(summary.overview);
  const [notes, setNotes] = useState((summary.revisionNotes ?? []).join('\n'));
  const [concepts, setConcepts] = useState(summary.keyConcepts.join('\n'));
  const [unresolved, setUnresolved] = useState((summary.unresolved ?? []).join('\n'));
  const field = 'mt-1 w-full rounded-xl border border-[#ECECE6] px-3 py-2 text-sm';
  return (
    <div className="neu-card p-4 space-y-3" data-testid="summary-editor">
      <label className="block text-xs font-semibold">Title<input className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></label>
      <label className="block text-xs font-semibold">Overview<textarea className={field} rows={5} value={overview} onChange={(e) => setOverview(e.target.value)} /></label>
      <label className="block text-xs font-semibold">Key concepts, one per line<textarea className={field} rows={4} value={concepts} onChange={(e) => setConcepts(e.target.value)} /></label>
      <label className="block text-xs font-semibold">Revision notes (cheat sheet), one per line<textarea className={field} rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <label className="block text-xs font-semibold">Unresolved questions, one per line<textarea className={field} rows={3} value={unresolved} onChange={(e) => setUnresolved(e.target.value)} /></label>
      <div className="flex justify-end gap-2">
        <button type="button" className="neu-pill px-4 min-h-[40px] text-sm font-semibold" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" data-testid="save-summary" disabled={busy || !title.trim() || !overview.trim()} className="neu-pill px-4 min-h-[40px] text-sm font-semibold !bg-[#7444E8] !text-white"
          onClick={() => onSave({ ...summary, title: title.trim(), overview: overview.trim(), keyConcepts: lines(concepts), revisionNotes: lines(notes), unresolved: lines(unresolved) })}>
          Save changes
        </button>
      </div>
    </div>
  );
}

function SummaryView({ s }: { s: LectureSummary }) {
  const [tab, setTab] = useState<'notes' | 'cheat' | 'questions'>('notes');
  const roomId = s.source?.roomId;
  const answered = (s.questions ?? []).filter((q) => q.answered);
  const open = (s.questions ?? []).filter((q) => !q.answered);
  return (
    <div className="space-y-3">
      <div role="tablist" className="neu-well grid grid-cols-3 gap-1 p-1">
        {([['notes', 'Lecture notes'], ['cheat', 'Revision sheet'], ['questions', `Questions (${(s.questions ?? []).length + (s.unresolved ?? []).length})`]] as const).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={tab === v} data-testid={`study-tab-${v}`} onClick={() => setTab(v)}
            className={`rounded-full min-h-[36px] text-xs font-semibold ${tab === v ? 'bg-white text-[#5A2FC7] shadow-soft' : 'text-[#5F5F68]'}`}>{label}</button>
        ))}
      </div>
      {tab === 'notes' && (
        <div className="space-y-4 text-sm text-[#17171A]">
          <p className="whitespace-pre-wrap leading-relaxed">{s.overview}</p>
          {(s.topics ?? []).length > 0 && (
            <section>
              <h4 className="font-heading font-bold mb-2">Topics, in order</h4>
              <ol className="space-y-2">
                {s.topics!.map((t, i) => (
                  <li key={i} className="neu-card !rounded-2xl p-3">
                    <p className="font-semibold flex flex-wrap items-center gap-2">{t.title} <At roomId={roomId} at={t.at} /></p>
                    {t.points && t.points.length > 0 && <ul className="list-disc pl-5 mt-1 text-[#5F5F68]">{t.points.map((p, j) => <li key={j}>{p}</li>)}</ul>}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {(s.definitions ?? []).length > 0 && (
            <section>
              <h4 className="font-heading font-bold mb-2">Definitions</h4>
              <dl className="space-y-1.5">{s.definitions!.map((d, i) => <div key={i}><dt className="font-semibold inline">{d.term}: </dt><dd className="inline text-[#5F5F68]">{d.meaning}</dd></div>)}</dl>
            </section>
          )}
          {s.keyConcepts.length > 0 && (
            <section>
              <h4 className="font-heading font-bold mb-2">Key concepts</h4>
              <div className="flex flex-wrap gap-1.5">{s.keyConcepts.map((k, i) => <span key={i} className="rounded-full bg-[#FFF4D1] text-[#6B4E00] px-2.5 py-0.5 text-xs font-semibold">{k}</span>)}</div>
            </section>
          )}
        </div>
      )}
      {tab === 'cheat' && (
        <div className="neu-card p-4 space-y-2" data-testid="revision-sheet">
          <h4 className="font-heading font-bold text-[#17171A]">Before the exam</h4>
          {(s.revisionNotes ?? []).length === 0 ? <p className="text-sm text-[#5F5F68]">No revision notes in this summary.</p> : (
            <ul className="space-y-1.5 text-sm">{s.revisionNotes!.map((n, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 w-2 h-2 rounded-full bg-[#FFC93C] shrink-0" aria-hidden="true" />{n}</li>)}</ul>
          )}
          {s.takeaways.length > 0 && <><h5 className="text-xs font-bold uppercase tracking-wide text-[#8B8B93] pt-2">Takeaways</h5><ul className="list-disc pl-5 text-sm">{s.takeaways.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
        </div>
      )}
      {tab === 'questions' && (
        <div className="space-y-3 text-sm" data-testid="study-questions">
          {answered.length > 0 && <h4 className="font-heading font-bold">Answered in class</h4>}
          {answered.map((q, i) => (
            <div key={i} className="neu-card !rounded-2xl p-3 space-y-1">
              <p className="font-semibold flex flex-wrap items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#1F8A55]" aria-hidden="true" />{q.question} <At roomId={roomId} at={q.at} /></p>
              <p className="text-[#5F5F68]">{q.answer}</p>
            </div>
          ))}
          {(open.length > 0 || (s.unresolved ?? []).length > 0) && <h4 className="font-heading font-bold">Still open</h4>}
          {open.map((q, i) => (
            <p key={`o${i}`} className="neu-card !rounded-2xl p-3 flex flex-wrap items-center gap-2"><CircleHelp className="w-4 h-4 text-[#B8860B]" aria-hidden="true" />{q.question} <At roomId={roomId} at={q.at} /></p>
          ))}
          {(s.unresolved ?? []).map((u, i) => <p key={`u${i}`} className="neu-card !rounded-2xl p-3 flex items-center gap-2"><CircleHelp className="w-4 h-4 text-[#B8860B]" aria-hidden="true" />{u}</p>)}
          {answered.length === 0 && open.length === 0 && (s.unresolved ?? []).length === 0 && <p className="text-[#5F5F68]">No questions were found.</p>}
        </div>
      )}
    </div>
  );
}

function QuizView({ q }: { q: PracticeQuiz }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const score = Object.entries(picked).filter(([i, p]) => q.questions[Number(i)]?.correctIndex === p).length;
  return (
    <div className="space-y-3" data-testid="study-quiz">
      <p className="text-xs text-[#5F5F68]">{Object.keys(picked).length} of {q.questions.length} answered · {score} correct</p>
      {q.questions.map((qn, i) => (
        <div key={i} className="neu-card !rounded-2xl p-3 space-y-2">
          <p className="text-sm font-semibold">{i + 1}. {qn.question}</p>
          <div className="grid gap-1.5">
            {qn.options.map((o, j) => {
              const chosen = picked[i] === j;
              const show = picked[i] !== undefined;
              const tone = show && j === qn.correctIndex ? 'bg-[#E4F8EB] border-[#2DBE74]' : chosen ? 'bg-[#FFE9E9] border-[#FF6B6B]' : 'bg-white border-[#ECECE6]';
              return <button key={j} type="button" disabled={show} onClick={() => setPicked({ ...picked, [i]: j })} className={`text-left text-sm rounded-xl border px-3 py-2 ${tone}`}>{o}</button>;
            })}
          </div>
          {picked[i] !== undefined && qn.explanation && <p className="text-xs text-[#5F5F68]">{qn.explanation}</p>}
        </div>
      ))}
    </div>
  );
}

function FlashcardsView({ f }: { f: FlashcardSet }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = f.cards[i];
  if (!card) return <p className="text-sm text-[#5F5F68]">No cards.</p>;
  return (
    <div className="space-y-3" data-testid="study-flashcards">
      <button type="button" onClick={() => setFlipped(!flipped)} aria-label={flipped ? 'Show the front' : 'Show the answer'}
        className={`w-full min-h-[180px] rounded-3xl p-6 text-center text-lg font-semibold neu-card ${flipped ? '!bg-[#F1EBFF] text-[#5A2FC7]' : 'text-[#17171A]'}`}>
        {flipped ? card.back : card.front}
        <span className="block text-[11px] font-normal text-[#8B8B93] mt-3">{flipped ? 'Answer' : 'Tap to reveal'} · {card.concept}</span>
      </button>
      <div className="flex items-center justify-between">
        <button type="button" className="neu-pill px-4 min-h-[40px] text-sm font-semibold" disabled={i === 0} onClick={() => { setI(i - 1); setFlipped(false); }}>Previous</button>
        <span className="text-xs font-semibold">{i + 1} / {f.cards.length}</span>
        <button type="button" className="neu-pill px-4 min-h-[40px] text-sm font-semibold" disabled={i >= f.cards.length - 1} onClick={() => { setI(i + 1); setFlipped(false); }}>Next</button>
      </div>
    </div>
  );
}

export function StudyArtifact({ artifact }: { artifact: Artifact }) {
  switch (artifact.artifactType) {
    case 'lecture_summary': return <SummaryView s={artifact.content as LectureSummary} />;
    case 'practice_quiz': return <QuizView q={artifact.content as PracticeQuiz} />;
    case 'flashcard_deck': return <FlashcardsView f={artifact.content as FlashcardSet} />;
    default: return <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(artifact.content, null, 2)}</pre>;
  }
}
