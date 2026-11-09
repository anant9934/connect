import { apiFetch } from '@/lib/api/client';
import {
  Room,
  CreateRoomResponse,
  JoinRoomResponse,
  TokenResponse,
  ParticipantsResponse,
  Participant,
  AdmissionRequest,
  MeetingHistoryItem,
} from './types';

export async function createRoom(
  maxParticipants?: number,
  waitingRoomEnabled?: boolean
): Promise<CreateRoomResponse> {
  return apiFetch<CreateRoomResponse>('/api/v1/rooms', {
    method: 'POST',
    body: JSON.stringify({ maxParticipants, waitingRoomEnabled }),
  });
}

export async function getRoom(code: string): Promise<Room> {
  const res = await apiFetch<{ room: Room }>(`/api/v1/rooms/${encodeURIComponent(code)}`, {
    method: 'GET',
  });
  return res.room;
}

/** Resolves an 11-digit meeting number to the room's public code. */
export async function resolveMeetingNumber(number: string): Promise<string> {
  const res = await apiFetch<{ publicCode: string }>(`/api/v1/rooms/by-number/${encodeURIComponent(number.replace(/\D/g, ''))}`, {
    method: 'GET',
  });
  return res.publicCode;
}

export interface ScheduleMeetingInput {
  title: string;
  scheduledStart: string;
  scheduledEnd: string;
  timeZone: string;
  passcode?: string;
  waitingRoomEnabled?: boolean;
}

export async function scheduleMeeting(input: ScheduleMeetingInput): Promise<CreateRoomResponse> {
  return apiFetch<CreateRoomResponse>('/api/v1/rooms', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getUpcomingMeetings(): Promise<Room[]> {
  const res = await apiFetch<{ rooms: Room[] }>('/api/v1/rooms/upcoming', { method: 'GET' });
  return res.rooms || [];
}

export async function cancelMeeting(code: string): Promise<void> {
  await apiFetch(`/api/v1/rooms/${encodeURIComponent(code)}/cancel`, { method: 'POST' });
}

export async function joinRoom(code: string, displayName?: string, passcode?: string): Promise<JoinRoomResponse> {
  return apiFetch<JoinRoomResponse>(`/api/v1/rooms/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    body: JSON.stringify({ displayName, passcode: passcode || undefined }),
  });
}

export async function leaveRoom(code: string, identity: string): Promise<void> {
  try {
    await apiFetch(`/api/v1/rooms/${encodeURIComponent(code)}/leave`, {
      method: 'POST',
      body: JSON.stringify({ identity }),
    });
  } catch {
    // Non-blocking departure
  }
}

export async function lockRoom(code: string): Promise<void> {
  await apiFetch(`/api/v1/rooms/${encodeURIComponent(code)}/lock`, {
    method: 'POST',
  });
}

export async function unlockRoom(code: string): Promise<void> {
  await apiFetch(`/api/v1/rooms/${encodeURIComponent(code)}/unlock`, {
    method: 'POST',
  });
}

export async function endRoom(code: string): Promise<void> {
  await apiFetch(`/api/v1/rooms/${encodeURIComponent(code)}/end`, {
    method: 'POST',
  });
}

export async function getParticipants(code: string): Promise<Participant[]> {
  const res = await apiFetch<ParticipantsResponse>(`/api/v1/rooms/${encodeURIComponent(code)}/participants`, {
    method: 'GET',
  });
  return res.participants || [];
}

export async function getRoomToken(
  code: string,
  guestIdentity?: string,
  guestDisplayName?: string
): Promise<TokenResponse> {
  return apiFetch<TokenResponse>(`/api/v1/rooms/${encodeURIComponent(code)}/token`, {
    method: 'POST',
    body: JSON.stringify({
      guestIdentity,
      guestDisplayName,
    }),
  });
}

export async function requestAdmission(
  code: string,
  displayName: string
): Promise<{ request: { id: string; status: string } }> {
  return apiFetch<{ request: { id: string; status: string } }>(
    `/api/v1/rooms/${encodeURIComponent(code)}/admission/request`,
    {
      method: 'POST',
      body: JSON.stringify({ displayName }),
    }
  );
}

export async function getAdmissionStatus(
  code: string,
  identity: string
): Promise<{ request: { id: string; status: 'pending' | 'admitted' | 'denied' } }> {
  return apiFetch<{ request: { id: string; status: 'pending' | 'admitted' | 'denied' } }>(
    `/api/v1/rooms/${encodeURIComponent(code)}/admission/status?identity=${encodeURIComponent(identity)}`,
    {
      method: 'GET',
    }
  );
}

export async function getPendingAdmissions(
  code: string
): Promise<{ requests: AdmissionRequest[] }> {
  return apiFetch<{ requests: AdmissionRequest[] }>(
    `/api/v1/rooms/${encodeURIComponent(code)}/admission/pending`,
    {
      method: 'GET',
    }
  );
}

export async function decideAdmission(
  code: string,
  requestId: string,
  decision: 'admitted' | 'denied'
): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(
    `/api/v1/rooms/${encodeURIComponent(code)}/admission/decision`,
    {
      method: 'POST',
      body: JSON.stringify({ requestId, decision }),
    }
  );
}

export async function removeParticipant(
  code: string,
  identity: string
): Promise<{ removed: boolean }> {
  return apiFetch<{ removed: boolean }>(
    `/api/v1/rooms/${encodeURIComponent(code)}/participants/${encodeURIComponent(identity)}/remove`,
    {
      method: 'POST',
    }
  );
}

export async function muteParticipant(
  code: string,
  identity: string,
  trackSid?: string
): Promise<{ muted: boolean }> {
  return apiFetch<{ muted: boolean }>(
    `/api/v1/rooms/${encodeURIComponent(code)}/participants/${encodeURIComponent(identity)}/mute`,
    {
      method: 'POST',
      body: JSON.stringify({ trackSid }),
    }
  );
}

export async function getMeetingHistory(
  limit: number = 20,
  offset: number = 0
): Promise<{ history: MeetingHistoryItem[]; total: number }> {
  return apiFetch<{ history: MeetingHistoryItem[]; total: number }>(
    `/api/v1/rooms/history?limit=${limit}&offset=${offset}`,
    {
      method: 'GET',
    }
  );
}


export interface MyRole {
  role: string;
  isHost: boolean;
  hostIdentity: string;
  permissions: Record<string, boolean>;
}

export async function getMyRole(code: string): Promise<MyRole> {
  return apiFetch<MyRole>(`/api/v1/rooms/${encodeURIComponent(code)}/me`, { method: 'GET' });
}

export async function grantCoHost(code: string, identity: string): Promise<void> {
  await apiFetch(`/api/v1/rooms/${encodeURIComponent(code)}/participants/${encodeURIComponent(identity)}/cohost`, { method: 'POST' });
}

export async function revokeCoHost(code: string, identity: string): Promise<void> {
  await apiFetch(`/api/v1/rooms/${encodeURIComponent(code)}/participants/${encodeURIComponent(identity)}/cohost`, { method: 'DELETE' });
}

export async function transferHost(code: string, identity: string): Promise<void> {
  await apiFetch(`/api/v1/rooms/${encodeURIComponent(code)}/participants/${encodeURIComponent(identity)}/transfer-host`, { method: 'POST' });
}

export async function muteAllParticipants(code: string): Promise<void> {
  await apiFetch(`/api/v1/rooms/${encodeURIComponent(code)}/mute-all`, { method: 'POST' });
}

export async function updateRoomPermissions(
  code: string,
  coHost: Record<string, boolean>,
  participantsCanPublish: boolean
): Promise<void> {
  await apiFetch(`/api/v1/rooms/${encodeURIComponent(code)}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ coHost, participantsCanPublish }),
  });
}
