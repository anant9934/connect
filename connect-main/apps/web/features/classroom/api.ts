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

/** One student's live engagement in a meeting (host and co-host only). */
export interface LiveEngagement {
  userId: string;
  displayName: string;
  present: boolean;
  connectedSeconds: number;
  messages: number;
  reactions: number;
  hands: number;
  doubts: number;
  pollsTotal: number;
  pollsAnswered: number;
  quizPoints: number;
  codingTotal: number;
  codingSubmitted: number;
  visibleSeconds: number;
  hiddenSeconds: number;
  reported: boolean;
  pollsRatio: number | null;
  codingRatio: number | null;
  interactionRatio: number | null;
  focusRatio: number | null;
  score: number;
}
export const getRoomEngagement = async (code: string) =>
  (await apiFetch<{ students: LiveEngagement[] | null }>(roomPath(code, '/engagement'), { method: 'GET' })).students ?? [];

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

export interface ClassroomState {
  studentsCanDraw: boolean;
  canDraw: boolean;
  canManage: boolean;
  fileId: string | null;
  fileName: string | null;
  fileType: string | null;
  page: number;
  pages: number;
  presenter: string | null;
  version: number;
}
export type BoardTool = 'pen' | 'highlighter' | 'text' | 'rect' | 'circle' | 'arrow' | 'note';
export interface Stroke {
  id: string;
  seq: number;
  authorIdentity: string;
  tool: BoardTool;
  color: string;
  width: number;
  points: [number, number][];
  /** Text of a text box or sticky note. */
  body?: string;
}
export interface NewStroke {
  clientStrokeId: string;
  board: string;
  tool: BoardTool;
  color: string;
  width: number;
  points: [number, number][];
  body?: string;
}


export const getClassroom = (code: string) => apiFetch<ClassroomState>(roomPath(code, '/classroom'), { method: 'GET' });
export const updateClassroom = (
  code: string,
  change: { studentsCanDraw?: boolean; fileId?: string; pages?: number; page?: number; stop?: boolean }
) => apiFetch(roomPath(code, '/classroom'), { method: 'PATCH', body: JSON.stringify(change) });
export const listStrokes = async (code: string, board: string, afterSeq: number) =>
  (await apiFetch<{ strokes: Stroke[] }>(roomPath(code, `/board?board=${encodeURIComponent(board)}&afterSeq=${afterSeq}`), { method: 'GET' })).strokes;
export const postStroke = (code: string, stroke: NewStroke) =>
  apiFetch<{ seq: number }>(roomPath(code, '/board/strokes'), { method: 'POST', body: JSON.stringify(stroke) });
export const moveStroke = (code: string, id: string, point: [number, number]) =>
  apiFetch(roomPath(code, '/board/move'), { method: 'POST', body: JSON.stringify({ id, points: [point] }) });
export const removeStrokes = (code: string, board: string, all: boolean) =>
  apiFetch<{ removed: number }>(roomPath(code, '/board/remove'), { method: 'POST', body: JSON.stringify({ board, all }) });

export interface BreakoutRoom { id: string; code: string; name: string }
export interface BreakoutState {
  canManage: boolean;
  isBreakout: boolean;
  ended: boolean;
  mainCode: string;
  myRoom: BreakoutRoom | null;
  rooms: BreakoutRoom[];
  people: { identity: string; displayName: string; isGuest: boolean; breakoutId: string | null }[];
}

export const getBreakouts = (code: string) => apiFetch<BreakoutState>(roomPath(code, '/breakouts'), { method: 'GET' });
export const openBreakouts = (code: string, names: string[]) =>
  apiFetch(roomPath(code, '/breakouts'), { method: 'POST', body: JSON.stringify({ names }) });
export const assignBreakout = (code: string, identity: string, roomId: string | null) =>
  apiFetch(roomPath(code, '/breakouts/assign'), { method: 'POST', body: JSON.stringify({ identity, roomId }) });
export const closeBreakouts = (code: string) => apiFetch(roomPath(code, '/breakouts/close'), { method: 'POST', body: '{}' });
