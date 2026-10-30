import { apiFetch } from '@/lib/api/client';
import { MeetingNote, UpdateNoteRequest, NoteResponse } from './types';

export async function getNotes(roomCode: string, participantIdentity?: string): Promise<MeetingNote> {
  const headers: Record<string, string> = {};
  if (participantIdentity) {
    headers['X-Participant-Identity'] = participantIdentity;
  }

  const res = await apiFetch<NoteResponse>(`/api/v1/rooms/${encodeURIComponent(roomCode)}/notes`, {
    method: 'GET',
    headers,
  });
  return res.note;
}

export async function updateNotes(
  roomCode: string,
  payload: UpdateNoteRequest,
  participantIdentity?: string
): Promise<MeetingNote> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (participantIdentity) {
    headers['X-Participant-Identity'] = participantIdentity;
  }

  const res = await apiFetch<NoteResponse>(`/api/v1/rooms/${encodeURIComponent(roomCode)}/notes`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });
  return res.note;
}
