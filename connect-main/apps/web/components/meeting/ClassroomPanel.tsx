'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Loader2, X } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import * as api from '@/features/classroom/api';

const POLL_INTERVAL_MS = 4000;
const inputClass =
  'w-full px-3 py-2 rounded-xl border border-[#E5E7EB] bg-[#FAFAF8] text-[16px] sm:text-xs text-[#1C1C1C] focus:outline-none focus:ring-2 focus:ring-[#7658E8] min-h-[40px]';
const buttonClass = 'px-3 rounded-xl bg-[#7658E8] text-white text-xs font-semibold min-h-[40px] disabled:opacity-60';
const secondaryClass = 'px-3 rounded-xl border border-[#E5E7EB] text-xs font-semibold text-[#1C1C1C] min-h-[40px]';

interface ClassroomPanelProps {
  roomCode: string;
  selfIdentity: string;
  syncTick: number;
  onChanged: () => void;
  onClose: () => void;
}

function PollCard({ poll, canManage, onRespond, onClosePoll }: {
  poll: api.Poll;
  canManage: boolean;
  onRespond: (id: string, optionIds: string[]) => void;
  onClosePoll: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const answered = poll.myResponse !== null;
  const locked = poll.closed || (answered && !poll.allowChange);
  const resultFor = (id: string) => poll.results.find((r) => r.optionId === id);
  const totalVotes = poll.results.reduce((sum, r) => sum + r.votes, 0);
  const choose = (id: string) =>
    setSelected((prev) =>
      poll.choiceMode === 'single' ? [id] : prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );

  return (
    <li data-testid="poll-card" className="p-3 rounded-xl border border-[#E5E7EB] bg-white space-y-2">
      <div>
        <p className="text-xs font-semibold text-[#1C1C1C]">{poll.question}</p>
        <p className="text-[11px] text-[#6B7280]">
          {poll.kind === 'quiz' ? `Quiz · ${poll.points} points` : 'Poll'}
          {poll.closed ? ' · Closed' : poll.closesAt ? ` · Closes ${new Date(poll.closesAt).toLocaleTimeString()}` : ''}
        </p>
      </div>
      <fieldset className="space-y-1">
        <legend className="sr-only">{poll.question}</legend>
        {poll.options.map((option) => {
          const result = resultFor(option.id);
          const mine = poll.myResponse?.optionIds.includes(option.id);
          return (
            <label key={option.id} className="flex items-center gap-2 text-xs text-[#1C1C1C] min-h-[32px]">
              <input
                type={poll.choiceMode === 'single' ? 'radio' : 'checkbox'}
                name={`poll-${poll.id}`}
                disabled={locked}
                checked={locked ? Boolean(mine) : selected.includes(option.id)}
                onChange={() => choose(option.id)}
              />
              <span className="flex-1 break-words">{option.label}</span>
              {result && (
                <span className="text-[11px] text-[#6B7280]">
                  {result.isCorrect === true ? 'Correct · ' : ''}
                  {result.votes}
                  {totalVotes > 0 ? ` (${Math.round((result.votes / totalVotes) * 100)}%)` : ''}
                </span>
              )}
            </label>
          );
        })}
      </fieldset>
      {poll.closed && poll.kind === 'quiz' && poll.myResponse && (
        <p className="text-xs font-semibold text-[#1C1C1C]">
          Your score: {poll.myResponse.score ?? 0} of {poll.points}
        </p>
      )}
      {poll.closed && poll.kind === 'quiz' && (
        <p className="text-[11px] text-[#6B7280]">Score = points × (right choices − wrong choices, at least 0) ÷ correct options.</p>
      )}
      {answered && !poll.closed && <p className="text-[11px] text-[#6B7280]">Your answer is saved.</p>}
      <div className="flex flex-wrap gap-2">
        {!locked && (
          <button type="button" className={buttonClass} disabled={selected.length === 0} onClick={() => onRespond(poll.id, selected)}>
            {answered ? 'Change answer' : 'Submit answer'}
          </button>
        )}
        {canManage && !poll.closed && (
          <button type="button" className={secondaryClass} onClick={() => onClosePoll(poll.id)}>
            Close question
          </button>
        )}
      </div>
    </li>
  );
}

function NewPollForm({ onCreate }: { onCreate: (poll: api.NewPoll) => Promise<boolean> }) {
  const [kind, setKind] = useState<'poll' | 'quiz'>('poll');
  const [question, setQuestion] = useState('');
  const [multiple, setMultiple] = useState(false);
  const [options, setOptions] = useState([{ label: '', isCorrect: false }, { label: '', isCorrect: false }]);
  const [points, setPoints] = useState(10);
  const [duration, setDuration] = useState(0);

  const setOption = (index: number, change: Partial<{ label: string; isCorrect: boolean }>) =>
    setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, ...change } : multiple || change.isCorrect === undefined ? o : { ...o, isCorrect: false })));

  return (
    <form
      id="new-poll"
      className="p-3 rounded-xl border border-[#E5E7EB] bg-white space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const created = await onCreate({
          kind,
          question,
          choiceMode: multiple ? 'multiple' : 'single',
          options: options.filter((o) => o.label.trim()),
          points: kind === 'quiz' ? points : 0,
          durationSeconds: duration,
          allowChange: false,
        });
        if (created) {
          setQuestion('');
          setOptions([{ label: '', isCorrect: false }, { label: '', isCorrect: false }]);
        }
      }}
    >
      <p className="text-xs font-semibold text-[#1C1C1C]">Ask a question</p>
      <label className="block text-[11px] font-semibold text-[#1C1C1C]" htmlFor="poll-kind">Type</label>
      <select id="poll-kind" className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as 'poll' | 'quiz')}>
        <option value="poll">Poll</option>
        <option value="quiz">Quiz</option>
      </select>
      <label className="block text-[11px] font-semibold text-[#1C1C1C]" htmlFor="poll-question">Question</label>
      <input id="poll-question" required maxLength={500} className={inputClass} value={question} onChange={(e) => setQuestion(e.target.value)} />
      {options.map((option, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            aria-label={`Option ${index + 1}`}
            data-testid="poll-option"
            maxLength={200}
            className={inputClass}
            value={option.label}
            onChange={(e) => setOption(index, { label: e.target.value })}
          />
          {kind === 'quiz' && (
            <label className="flex items-center gap-1 text-[11px] text-[#1C1C1C] shrink-0">
              <input data-testid="poll-correct" type="checkbox" checked={option.isCorrect} onChange={(e) => setOption(index, { isCorrect: e.target.checked })} />
              Correct
            </label>
          )}
        </div>
      ))}
      {options.length < 10 && (
        <button type="button" className={secondaryClass} onClick={() => setOptions((prev) => [...prev, { label: '', isCorrect: false }])}>
          Add option
        </button>
      )}
      <label className="flex items-center gap-2 text-xs text-[#1C1C1C] min-h-[32px]">
        <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} /> Allow several answers
      </label>
      {kind === 'quiz' && (
        <>
          <label className="block text-[11px] font-semibold text-[#1C1C1C]" htmlFor="poll-points">Points</label>
          <input id="poll-points" type="number" min={0} max={1000} className={inputClass} value={points} onChange={(e) => setPoints(Number(e.target.value))} />
        </>
      )}
      <label className="block text-[11px] font-semibold text-[#1C1C1C]" htmlFor="poll-duration">Time limit in seconds (0 for none)</label>
      <input id="poll-duration" type="number" min={0} max={86400} className={inputClass} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
      <button type="submit" className={buttonClass}>Ask</button>
    </form>
  );
}

export const ClassroomPanel: React.FC<ClassroomPanelProps> = ({ roomCode, selfIdentity, syncTick, onChanged, onClose }) => {
  const [polls, setPolls] = useState<api.Poll[]>([]);
  const [doubts, setDoubts] = useState<api.Doubt[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doubtText, setDoubtText] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const [pollRes, doubtRes] = await Promise.all([api.listPolls(roomCode), api.listDoubts(roomCode)]);
      setPolls(pollRes.polls);
      setCanManage(pollRes.canManage);
      setDoubts(doubtRes.doubts);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, [roomCode]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh, syncTick]);

  const act = async (action: () => Promise<unknown>, failure: string) => {
    setError(null);
    try {
      await action();
      onChanged();
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failure);
      return false;
    }
  };

  return (
    <div className="flex flex-col h-full bg-white text-[#1C1C1C] w-full">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#E5E7EB]">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-[#7658E8]" aria-hidden="true" />
          <h3 className="font-semibold text-sm">Questions and doubts</h3>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-[#6B7280] hover:bg-[#F3F4F6]" aria-label="Close classroom panel">
          <X className="w-4 h-4" />
        </button>
      </div>
      {offline && (
        <p role="status" className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-900 text-center">
          Reconnecting. This will update when the connection returns.
        </p>
      )}
      {error && <p role="alert" className="px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700">{error}</p>}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#FAFAF8]">
        {loading ? (
          <div className="flex justify-center py-8" role="status" aria-label="Loading">
            <Loader2 className="w-5 h-5 animate-spin text-[#7658E8]" />
          </div>
        ) : (
          <>
            {canManage && <NewPollForm onCreate={(poll) => act(() => api.createPoll(roomCode, poll), 'The question could not be created.')} />}
            <section aria-label="Questions" className="space-y-2">
              {polls.length === 0 && <p className="text-xs text-[#6B7280]">No questions yet.</p>}
              <ul className="space-y-2">
                {polls.map((poll) => (
                  <PollCard
                    key={poll.id}
                    poll={poll}
                    canManage={canManage}
                    onRespond={(id, optionIds) => act(() => api.respondPoll(roomCode, id, optionIds), 'Your answer could not be saved.')}
                    onClosePoll={(id) => act(() => api.closePoll(roomCode, id), 'The question could not be closed.')}
                  />
                ))}
              </ul>
            </section>
            <section aria-label="Doubts" className="space-y-2">
              <h4 className="text-xs font-semibold">Doubts</h4>
              <form
                id="ask-doubt"
                className="flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await act(() => api.askDoubt(roomCode, doubtText), 'Your doubt could not be saved.')) setDoubtText('');
                }}
              >
                <input id="doubt-input" aria-label="Your doubt" required maxLength={1000} className={inputClass} value={doubtText} onChange={(e) => setDoubtText(e.target.value)} />
                <button type="submit" className={buttonClass}>Ask</button>
              </form>
              {doubts.length === 0 && <p className="text-xs text-[#6B7280]">No doubts yet.</p>}
              <ul className="space-y-2">
                {doubts.map((doubt) => (
                  <li key={doubt.id} data-testid="doubt-card" className="p-3 rounded-xl border border-[#E5E7EB] bg-white space-y-2">
                    <p className="text-xs font-semibold break-words">{doubt.question}</p>
                    <p className="text-[11px] text-[#6B7280]">{doubt.askedByName} · {doubt.status}</p>
                    {doubt.answer && <p className="text-xs break-words">{doubt.answer}</p>}
                    {canManage && doubt.status !== 'resolved' && (
                      <form
                        className="flex gap-2"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          await act(() => api.answerDoubt(roomCode, doubt.id, answers[doubt.id] || ''), 'The answer could not be saved.');
                        }}
                      >
                        <input
                          aria-label="Answer"
                          data-testid="doubt-answer"
                          required
                          maxLength={4000}
                          className={inputClass}
                          value={answers[doubt.id] || ''}
                          onChange={(e) => setAnswers((prev) => ({ ...prev, [doubt.id]: e.target.value }))}
                        />
                        <button type="submit" className={buttonClass}>Answer</button>
                      </form>
                    )}
                    {doubt.status !== 'resolved' && (canManage || doubt.askedBy === selfIdentity) && (
                      <button type="button" className={secondaryClass} onClick={() => act(() => api.resolveDoubt(roomCode, doubt.id), 'This could not be resolved.')}>
                        Mark resolved
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
};
