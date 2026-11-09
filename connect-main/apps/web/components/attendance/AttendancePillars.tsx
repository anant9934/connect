'use client';

import React from 'react';
import { Clock, Eye, MessageCircle } from 'lucide-react';
import { formulaTerms, pct, type Pillars } from '@/features/attendance/pillars';

const mins = (s: number) => `${Math.round(s / 60)} min`;
const time = (v: string | null) => (v ? new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

function Bar({ value, color }: { value: number | null; color: string }) {
  const w = Math.max(0, Math.min(1, value ?? 0)) * 100;
  return (
    <div className="h-2.5 rounded-full neu-well !rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${w}%`, backgroundColor: color }} />
    </div>
  );
}

function Pillar({ title, icon, ratio, color, tint, children, testId }: { title: string; icon: React.ReactNode; ratio: number | null; color: string; tint: string; children: React.ReactNode; testId: string }) {
  return (
    <section data-testid={testId} className="neu-card p-4 space-y-3 flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-heading font-bold text-sm text-[#17171A] flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: tint, color }}>{icon}</span>
          {title}
        </h3>
        <span className="font-heading text-2xl font-extrabold tracking-tight" style={{ color }}>{pct(ratio)}</span>
      </div>
      <Bar value={ratio} color={color} />
      <div className="text-xs text-[#5F5F68] space-y-1">{children}</div>
    </section>
  );
}

// Duration, engagement and focus as separate pillars, then the rule that combined them.
export function AttendancePillars({ pillars, name }: { pillars: Pillars; name?: string }) {
  const d = pillars.duration;
  const e = pillars.engagement;
  const f = pillars.focus;
  const formula = formulaTerms(pillars);
  const durationRatio = d.ratio ?? (d.sessionSeconds > 0 ? Math.min(1, d.connectedSeconds / d.sessionSeconds) : null);
  return (
    <div className="space-y-3" data-testid="attendance-pillars">
      {name && <p className="text-sm font-semibold text-[#17171A]">{name}</p>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Pillar testId="pillar-duration" title="Duration" icon={<Clock className="w-4 h-4" />} ratio={durationRatio} color="#5A2FC7" tint="#F1EBFF">
          <p>{mins(d.connectedSeconds)} connected of {mins(d.sessionSeconds)}</p>
          <p>Joined {time(d.firstJoinedAt)} · left {time(d.lastLeftAt)}</p>
          <p>{d.reconnections === 0 ? 'No reconnections' : `${d.reconnections} reconnection${d.reconnections === 1 ? '' : 's'}`}</p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {d.joinedLate && <span className="rounded-full bg-[#FFF4D1] text-[#6B4E00] px-2 py-0.5 font-semibold">Joined late</span>}
            {d.leftEarly && <span className="rounded-full bg-[#FFE9E9] text-[#9B2C2C] px-2 py-0.5 font-semibold">Left early</span>}
            {!d.joinedLate && !d.leftEarly && d.joins > 0 && <span className="rounded-full bg-[#E4F8EB] text-[#1F6B3B] px-2 py-0.5 font-semibold">On time</span>}
          </div>
        </Pillar>
        <Pillar testId="pillar-engagement" title="Active engagement" icon={<MessageCircle className="w-4 h-4" />} ratio={e.ratio ?? e.liveScore / 100} color="#B8860B" tint="#FFF4D1">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <dt>Polls answered</dt><dd className="text-right font-semibold text-[#17171A]">{e.pollsAnswered}/{e.pollsTotal}</dd>
            <dt>Quiz points</dt><dd className="text-right font-semibold text-[#17171A]">{e.quizPoints}</dd>
            <dt>Questions asked</dt><dd className="text-right font-semibold text-[#17171A]">{e.doubts}</dd>
            <dt>Chat messages</dt><dd className="text-right font-semibold text-[#17171A]">{e.messages}</dd>
            <dt>Hands raised</dt><dd className="text-right font-semibold text-[#17171A]">{e.hands}</dd>
            <dt>Coding submitted</dt><dd className="text-right font-semibold text-[#17171A]">{e.codingSubmitted}/{e.codingTotal}</dd>
          </dl>
        </Pillar>
        <Pillar testId="pillar-focus" title="Tab focus" icon={<Eye className="w-4 h-4" />} ratio={f.ratio} color="#1F8A55" tint="#E4F8EB">
          {f.reported ? (
            <>
              <p>Tab visible {mins(f.visibleSeconds)} · in the background {mins(f.hiddenSeconds)}</p>
              <p>Reported by the browser. It shows the tab was open, not that someone was paying attention.</p>
            </>
          ) : (
            <p>No tab visibility was reported, so focus counts neither for nor against.</p>
          )}
        </Pillar>
      </div>
      <div data-testid="pillar-formula" className="neu-surface rounded-2xl px-4 py-3 text-sm text-[#17171A] flex flex-wrap items-center gap-x-2 gap-y-1">
        {formula ? (
          <>
            {formula.terms.map((t, i) => (
              <span key={t.label} className="font-mono">
                {i > 0 && '+ '}
                {t.weight.toFixed(2)} × {t.label} {pct(t.ratio)}
              </span>
            ))}
            <span className="font-mono">= <strong>{pct(pillars.score ?? formula.total)}</strong></span>
            {pillars.status && <span className="ml-auto rounded-full bg-[#F1EBFF] text-[#5A2FC7] px-2.5 py-0.5 text-xs font-bold capitalize">{pillars.status}</span>}
            <span className="w-full text-[11px] text-[#5F5F68]">Rules version {pillars.policyVersion ?? 'default'}. A pillar without a signal adds nothing.</span>
          </>
        ) : (
          <span className="text-[#5F5F68]">
            Not finalised yet. The institution&apos;s attendance rule is applied after class; until then these are the live signals. Live engagement score {e.liveScore}/100.
          </span>
        )}
      </div>
    </div>
  );
}
