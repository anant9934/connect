import { apiFetch } from '@/lib/api/client';

export interface MeetingItem {
  id: string;
  publicCode: string;
  title: string | null;
  status: string;
  meetingAt: string;
  endedAt: string | null;
  hostName: string;
  access: 'host' | 'admin' | 'faculty' | 'participant' | 'student';
  courseTitle: string | null;
  organizationName: string | null;
  participantCount: number | null;
}

export interface MeetingDetail {
  id: string;
  publicCode: string;
  title: string | null;
  status: string;
  meetingAt: string;
  startedAt: string | null;
  endedAt: string | null;
  access: MeetingItem['access'];
  hostName: string;
  courseTitle: string | null;
  organizationName: string | null;
  participants: { displayName: string; role: string; isGuest: boolean; joinedAt: string; leftAt: string | null; isYou: boolean }[];
  myAttendance: { status: string; connectedSeconds: number } | null;
  attendanceSummary: Record<string, number> | null;
}

export interface MeetingSearch {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  sort?: string;
  limit: number;
  offset: number;
}

export async function searchMeetings(search: MeetingSearch) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return apiFetch<{ meetings: MeetingItem[]; total: number }>(`/api/v1/meetings?${params}`, { method: 'GET' });
}

export const getMeeting = async (id: string) =>
  (await apiFetch<{ meeting: MeetingDetail }>(`/api/v1/meetings/${encodeURIComponent(id)}`, { method: 'GET' })).meeting;
