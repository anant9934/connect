'use client';

import React from 'react';

/** Score bands used everywhere engagement is shown. */
export function engagementBand(score: number | null | undefined): 'high' | 'medium' | 'low' | 'none' {
  if (score === null || score === undefined || Number.isNaN(score)) return 'none';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

const BAND_STYLE: Record<ReturnType<typeof engagementBand>, string> = {
  high: 'bg-[#E4F8EB] text-[#1F6B3B] border-[#BFE8CC]',
  medium: 'bg-[#FFF4E5] text-[#8A5300] border-[#F5D9AE]',
  low: 'bg-[#FDECEC] text-[#B42318] border-[#F5C2C0]',
  none: 'bg-[#F2F2F0] text-[#686868] border-[#E5E5E3]',
};
const BAND_LABEL: Record<ReturnType<typeof engagementBand>, string> = { high: 'High', medium: 'Medium', low: 'Low', none: 'No data' };

export const ScoreBadge: React.FC<{ score: number | null | undefined; showLabel?: boolean }> = ({ score, showLabel = false }) => {
  const band = engagementBand(score);
  const value = band === 'none' ? '—' : Math.round(score as number);
  return (
    <span
      data-testid="engagement-score"
      title={`Engagement ${band === 'none' ? 'not available yet' : `${value}/100 (${BAND_LABEL[band]})`}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold tabular-nums ${BAND_STYLE[band]}`}
    >
      {value}
      {showLabel && band !== 'none' && <span className="font-medium">· {BAND_LABEL[band]}</span>}
    </span>
  );
};

/** One-line explanation shown wherever the score appears, so nobody mistakes it for attention. */
export const EngagementExplainer: React.FC = () => (
  <p className="text-xs text-[#686868]">
    Engagement score (0–100) = polls and quizzes answered 35%, in-class coding problems submitted 25%, chat, raised hands and
    questions 20%, and tab kept visible 20%. Parts that did not happen in a class (for example no coding problem) are left out
    and the rest are reweighted. It measures activity, not attention, and is reported separately from attendance.
  </p>
);

export interface EngagementTableRow {
  userId: string;
  displayName: string;
  present?: boolean;
  connectedSeconds?: number;
  pollsAnswered: number;
  pollsTotal?: number;
  codingSubmitted?: number;
  codingTotal?: number;
  messages: number;
  hands: number;
  doubts: number;
  reactions: number;
  focusRatio?: number | null;
  visibleSeconds?: number;
  hiddenSeconds?: number;
  reported?: boolean;
  score?: number | null;
}

const minutes = (seconds?: number) => (seconds === undefined ? '—' : `${Math.round(seconds / 60)} min`);
const fraction = (done: number, total?: number) => (total ? `${done}/${total}` : '—');
const focusOf = (r: EngagementTableRow) => {
  if (r.focusRatio !== undefined && r.focusRatio !== null) return `${Math.round(r.focusRatio * 100)}%`;
  if (r.reported && r.visibleSeconds !== undefined && r.hiddenSeconds !== undefined) {
    return `${Math.round((r.visibleSeconds / Math.max(1, r.visibleSeconds + r.hiddenSeconds)) * 100)}%`;
  }
  return 'Not reported';
};

/** Per-student engagement breakdown. `live` adds a "here now" column. */
export const EngagementTable: React.FC<{ rows: EngagementTableRow[]; live?: boolean; onSelect?: (userId: string, name: string) => void }> = ({ rows, live = false, onSelect }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm text-left">
      <thead>
        <tr className="text-xs text-[#686868]">
          {['Student', ...(live ? ['Here now'] : []), 'Score', 'Polls', 'Coding', 'Chat · hands · questions', 'Tab visible', 'Time in class'].map((h) => (
            <th key={h} className="py-1 pr-3 font-semibold whitespace-nowrap">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.userId} data-testid="engagement-row" className="border-t border-[#E9E9E5]">
            <td className="py-1.5 pr-3 whitespace-nowrap font-medium text-[#171717]">
              {onSelect ? (
                <button type="button" data-testid="open-pillars" onClick={() => onSelect(r.userId, r.displayName)} className="text-[#7258E8] underline">{r.displayName}</button>
              ) : r.displayName}
            </td>
            {live && (
              <td className="py-1.5 pr-3">
                <span className={`inline-block w-2 h-2 rounded-full ${r.present ? 'bg-[#22A06B]' : 'bg-[#D0D0CC]'}`} aria-label={r.present ? 'In the class now' : 'Not in the class'} />
              </td>
            )}
            <td className="py-1.5 pr-3"><ScoreBadge score={r.score} /></td>
            <td className="py-1.5 pr-3 tabular-nums">{fraction(r.pollsAnswered, r.pollsTotal)}</td>
            <td className="py-1.5 pr-3 tabular-nums">{fraction(r.codingSubmitted ?? 0, r.codingTotal)}</td>
            <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{r.messages} · {r.hands} · {r.doubts}</td>
            <td className="py-1.5 pr-3 tabular-nums">{focusOf(r)}</td>
            <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{minutes(r.connectedSeconds)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
