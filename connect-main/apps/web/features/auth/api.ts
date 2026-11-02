import { apiFetch, ApiError } from '@/lib/api/client';
import { SignupDTO, LoginDTO, AuthResponse, LogoutResponse, Profile, User } from './types';

export async function signup(dto: SignupDTO): Promise<User> {
  const res = await apiFetch<AuthResponse>('/api/v1/auth/signup', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
  return res.user;
}

export async function login(dto: LoginDTO): Promise<User> {
  const res = await apiFetch<AuthResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
  return res.user;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch<LogoutResponse>('/api/v1/auth/logout', {
      method: 'POST',
    });
  } catch {
    // Ignore errors during logout
  }
}

export async function getSession(): Promise<User | null> {
  try {
    const res = await apiFetch<AuthResponse>('/api/v1/auth/session', {
      method: 'GET',
    });
    return res.user;
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 401) {
      return null;
    }
    // Return null for network failure or session absence
    return null;
  }
}

export const getProfile = async () => (await apiFetch<{ profile: Profile }>('/api/v1/users/me/profile', { method: 'GET' })).profile;
export const updateDisplayName = async (displayName: string) =>
  (await apiFetch<{ profile: Profile }>('/api/v1/users/me/profile', { method: 'PATCH', body: JSON.stringify({ displayName }) })).profile;
export const changePassword = (currentPassword: string, newPassword: string) =>
  apiFetch('/api/v1/users/me/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
export const removeAvatar = async () =>
  (await apiFetch<{ profile: Profile }>('/api/v1/users/me/avatar', { method: 'DELETE' })).profile;

export async function uploadAvatar(file: File): Promise<Profile> {
  const form = new FormData();
  form.append('avatar', file);
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/users/me/avatar`, { method: 'POST', body: form, credentials: 'include' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || 'Your picture could not be saved.');
  return data.profile;
}

export const avatarSrc = (url?: string) => (url ? `${process.env.NEXT_PUBLIC_API_URL || ''}${url}` : '');
