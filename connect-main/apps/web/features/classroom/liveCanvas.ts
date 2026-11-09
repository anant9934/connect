// The live canvas: slides or a simulation a host or co-host generates during class. Stored
// state is the source of truth; data channel messages only hint and carry presenter frames.
import { apiFetch } from '@/lib/api/client';

export interface DeckColumn { heading: string; bullets: string[] }
export interface LiveSlide {
  layout: 'title' | 'bullets' | 'table' | 'code' | 'steps' | 'comparison';
  title: string;
  subtitle?: string;
  bullets?: string[];
  table?: { headers: string[]; rows: string[][] };
  code?: { language: string; source: string };
  steps?: string[];
  left?: DeckColumn;
  right?: DeckColumn;
  notes?: string;
}
export interface LiveDeck { title: string; slides: LiveSlide[] }

export type EngineName = 'projectile' | 'pendulum' | 'function' | 'scheduling' | 'sorting' | 'logic' | 'perceptron' | 'tree' | 'graph';
export interface LiveSimulation { engine: EngineName; title: string; explanation: string; observe: string[] }
export type SimParams = Record<string, unknown>;

export interface CanvasState {
  kind: 'slides' | 'simulation' | null;
  generation: string | null;
  content: LiveDeck | LiveSimulation | null;
  slide: number;
  slideCount: number;
  simMode: 'presenter' | 'sandbox';
  simParams: SimParams | null;
  presenter: string | null;
  version: number;
  canManage: boolean;
  myAnswer: SimParams | null;
}

export interface SimAnswer { identity: string; displayName: string; params: SimParams; submittedAt: string }

const path = (code: string, rest = '') => `/api/v1/rooms/${encodeURIComponent(code)}/canvas${rest}`;

export const getCanvas = (code: string) => apiFetch<CanvasState>(path(code), { method: 'GET' });

export const generateCanvas = (code: string, kind: 'slides' | 'simulation', prompt: string, context: string) =>
  apiFetch<CanvasState>(path(code, '/generate'), { method: 'POST', body: JSON.stringify({ kind, prompt, context }) });

export const updateCanvas = (
  code: string,
  change: { slide?: number; mode?: 'presenter' | 'sandbox'; params?: SimParams; stop?: boolean }
) => apiFetch<CanvasState>(path(code), { method: 'PATCH', body: JSON.stringify(change) });

export const editSlide = (code: string, index: number, slide: LiveSlide) =>
  apiFetch<CanvasState>(path(code, `/slides/${index}`), { method: 'PUT', body: JSON.stringify({ slide }) });

export const submitAnswer = (code: string, params: SimParams) =>
  apiFetch<CanvasState>(path(code, '/submit'), { method: 'POST', body: JSON.stringify({ params }) });

export const listAnswers = async (code: string) =>
  (await apiFetch<{ answers: SimAnswer[] }>(path(code, '/submissions'), { method: 'GET' })).answers;
