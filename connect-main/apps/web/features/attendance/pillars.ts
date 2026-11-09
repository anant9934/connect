import { apiFetch } from '@/lib/api/client';

export interface Pillars {
  finalized: boolean;
  status: string | null;
  score: number | null;
  policyVersion: number | null;
  weights: { duration: number; engagement: number; focus: number } | null;
  duration: {
    firstJoinedAt: string | null; lastLeftAt: string | null; connectedSeconds: number; sessionSeconds: number;
    joins: number; reconnections: number; joinedLate: boolean; leftEarly: boolean; ratio: number | null;
  };
  engagement: {
    pollsAnswered: number; pollsTotal: number; quizPoints: number; doubts: number; messages: number; hands: number;
    reactions: number; codingSubmitted: number; codingTotal: number; liveScore: number; ratio: number | null;
  };
  focus: { visibleSeconds: number; hiddenSeconds: number; reported: boolean; ratio: number | null };
}

/** Pillars for a meeting (room id) or, with session, a class session. */
export async function getPillars(id: string, opts: { student?: string; org?: string; session?: boolean } = {}) {
  const params = new URLSearchParams();
  if (opts.student) params.set('student', opts.student);
  if (opts.org) params.set('org', opts.org);
  if (opts.session) params.set('session', '1');
  return (await apiFetch<{ pillars: Pillars }>(`/api/v1/meetings/${encodeURIComponent(id)}/pillars?${params}`, { method: 'GET' })).pillars;
}

export interface FormulaTerm { label: 'Duration' | 'Engagement' | 'Focus'; weight: number; ratio: number | null; contribution: number }

/**
 * The weighted sum the attendance rule applied, term by term. A pillar with no signal (for
 * example focus that was never reported) contributes nothing, as the rule does.
 */
export function formulaTerms(p: Pillars): { terms: FormulaTerm[]; total: number } | null {
  if (!p.weights) return null;
  const terms: FormulaTerm[] = (
    [
      { label: 'Duration', weight: Number(p.weights.duration), ratio: p.duration.ratio },
      { label: 'Engagement', weight: Number(p.weights.engagement), ratio: p.engagement.ratio },
      { label: 'Focus', weight: Number(p.weights.focus), ratio: p.focus.ratio },
    ] as const
  )
    .filter((t) => t.weight > 0)
    .map((t) => ({ ...t, contribution: t.weight * (t.ratio === null ? 0 : Number(t.ratio)) }));
  const total = terms.reduce((s, t) => s + t.contribution, 0);
  return { terms, total };
}

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(Number(v) * 100)}%`);
