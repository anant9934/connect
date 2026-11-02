import { apiFetch } from '@/lib/api/client';

export interface StoredMessage {
  id: string;
  seq: number;
  senderIdentity: string;
  senderName: string;
  kind: 'chat' | 'announcement';
  body: string;
  clientMessageId: string;
  createdAt: string;
}

export interface LiveState {
  messages: StoredMessage[];
  raisedHands: string[];
  reactions: { id: string; identity: string; emoji: string; createdAt: string }[];
}

const roomPath = (code: string, rest: string) => `/api/v1/rooms/${encodeURIComponent(code)}${rest}`;

export const getLiveState = (code: string, afterSeq: number) =>
  apiFetch<LiveState>(roomPath(code, `/live-state?afterSeq=${afterSeq}`), { method: 'GET' });

export const getOlderMessages = async (code: string, beforeSeq: number, limit: number) =>
  (await apiFetch<{ messages: StoredMessage[] }>(roomPath(code, `/messages?before=${beforeSeq}&limit=${limit}`), { method: 'GET' })).messages;

export const postMessage = async (code: string, clientMessageId: string, body: string, kind: string) =>
  (await apiFetch<{ message: StoredMessage }>(roomPath(code, '/messages'), {
    method: 'POST',
    body: JSON.stringify({ clientMessageId, body, kind }),
  })).message;

export const postReaction = (code: string, emoji: string) =>
  apiFetch(roomPath(code, '/reactions'), { method: 'POST', body: JSON.stringify({ emoji }) });

export const setHand = (code: string, raised: boolean) =>
  apiFetch(roomPath(code, '/hand'), { method: 'POST', body: JSON.stringify({ raised }) });

export const lowerParticipantHand = (code: string, identity: string) =>
  apiFetch(roomPath(code, `/participants/${encodeURIComponent(identity)}/hand`), { method: 'DELETE' });

export const reportActivity = (code: string, visibleSeconds: number, hiddenSeconds: number) =>
  apiFetch<{ recorded: boolean }>(`/api/v1/rooms/${encodeURIComponent(code)}/activity`, {
    method: 'POST',
    body: JSON.stringify({ visibleSeconds, hiddenSeconds }),
  });
