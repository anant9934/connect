import { apiFetch, ApiError } from '@/lib/api/client';
import { SignupDTO, LoginDTO, AuthResponse, LogoutResponse, User } from './types';

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
