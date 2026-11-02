import { apiFetch } from '@/lib/api/client';

export interface PollOption { id: string; label: string }
export interface PollResult { optionId: string; votes: number; isCorrect: boolean | null }
export interface Poll {
  id: string;
  kind: 'poll' | 'quiz';
  question: string;
  choiceMode: 'single' | 'multiple';
  points: number;
  allowChange: boolean;
  closesAt: string | null;
  closed: boolean;
  options: PollOption[];
  results: PollResult[];
  myResponse: { optionIds: string[]; score: number | null } | null;
}
export interface Doubt {
  id: string;
  askedBy: string;
  askedByName: string;
  question: string;
  status: 'open' | 'assigned' | 'answered' | 'resolved';
  assignedTo: string | null;
  answer: string | null;
}
export interface NewPoll {
  kind: 'poll' | 'quiz';
  question: string;
  choiceMode: 'single' | 'multiple';
  options: { label: string; isCorrect: boolean }[];
  points: number;
  durationSeconds: number;
  allowChange: boolean;
}

const roomPath = (code: string, rest: string) => `/api/v1/rooms/${encodeURIComponent(code)}${rest}`;
const post = (path: string, body?: unknown) =>
  apiFetch(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const listPolls = (code: string) =>
  apiFetch<{ polls: Poll[]; canManage: boolean }>(roomPath(code, '/polls'), { method: 'GET' });
export const createPoll = (code: string, poll: NewPoll) => post(roomPath(code, '/polls'), poll);
export const respondPoll = (code: string, id: string, optionIds: string[]) =>
  post(roomPath(code, `/polls/${id}/respond`), { optionIds });
export const closePoll = (code: string, id: string) => post(roomPath(code, `/polls/${id}/close`));
export const listDoubts = (code: string) =>
  apiFetch<{ doubts: Doubt[]; canManage: boolean }>(roomPath(code, '/doubts'), { method: 'GET' });
export const askDoubt = (code: string, question: string) => post(roomPath(code, '/doubts'), { question });
export const answerDoubt = (code: string, id: string, answer: string) =>
  post(roomPath(code, `/doubts/${id}/answer`), { answer });
export const resolveDoubt = (code: string, id: string) => post(roomPath(code, `/doubts/${id}/resolve`));
