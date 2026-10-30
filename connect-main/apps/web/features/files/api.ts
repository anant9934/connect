import { apiFetch } from '@/lib/api/client';
import { MeetingFile, FileListResponse, FileUploadResponse } from './types';

const getApiBase = (): string => {
  if (typeof window !== 'undefined') {
    return process.env.NEXT_PUBLIC_API_URL || '';
  }
  return process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
};

export async function uploadFile(
  roomCode: string,
  file: File,
  participantIdentity?: string
): Promise<MeetingFile> {
  const formData = new FormData();
  formData.append('file', file);

  const base = getApiBase();
  const url = `${base}/api/v1/rooms/${encodeURIComponent(roomCode)}/files/upload`;

  const headers: Record<string, string> = {};
  if (participantIdentity) {
    headers['X-Participant-Identity'] = participantIdentity;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
    credentials: 'include',
  });

  if (!res.ok) {
    let errMsg = 'Failed to upload file';
    try {
      const data = await res.json();
      if (data?.error?.message) {
        errMsg = data.error.message;
      }
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  const data: FileUploadResponse = await res.json();
  return data.file;
}

export async function listFiles(
  roomCode: string,
  participantIdentity?: string
): Promise<MeetingFile[]> {
  const headers: Record<string, string> = {};
  if (participantIdentity) {
    headers['X-Participant-Identity'] = participantIdentity;
  }

  const res = await apiFetch<FileListResponse>(`/api/v1/rooms/${encodeURIComponent(roomCode)}/files`, {
    method: 'GET',
    headers,
  });
  return res.files || [];
}

export function getDownloadUrl(
  roomCode: string,
  fileId: string,
  participantIdentity?: string
): string {
  const base = getApiBase();
  let url = `${base}/api/v1/rooms/${encodeURIComponent(roomCode)}/files/${encodeURIComponent(fileId)}/download`;
  if (participantIdentity) {
    url += `?identity=${encodeURIComponent(participantIdentity)}`;
  }
  return url;
}

export async function deleteFile(
  roomCode: string,
  fileId: string,
  participantIdentity?: string
): Promise<void> {
  const headers: Record<string, string> = {};
  if (participantIdentity) {
    headers['X-Participant-Identity'] = participantIdentity;
  }

  await apiFetch(`/api/v1/rooms/${encodeURIComponent(roomCode)}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers,
  });
}
