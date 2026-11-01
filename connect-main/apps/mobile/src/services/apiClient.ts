/**
 * Tathastu Meet Native - Production API Client
 * Seamlessly integrates with the existing Tathastu Go API for
 * Authentication, Room Lifecycle, LiveKit Cloud Access Tokens, and Host Controls.
 */

export interface MobileAuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarId?: string | null;
  avatarUrl?: string | null;
  role?: string;
  createdAt?: string;
  googleConnected?: boolean;
  emailPasswordConnected?: boolean;
  preferences?: any;
}


export interface MobileRoomTokenResponse {
  token: string;
  livekitUrl: string;
  expiresInSec?: number;
}

export interface MobileRoomInfo {
  id: string;
  publicCode: string;
  status: string;
  isLocked: boolean;
  waitingRoomEnabled?: boolean;
  maxParticipants: number;
  createdAt: string;
  hasPasscode?: boolean;
}

export interface MobileParticipant {
  identity: string;
  displayName: string;
  role: string;
  isGuest: boolean;
  joinedAt: string;
}

export interface MobileHistoryItem {
  id: string;
  public_code: string;
  host_user_id: string;
  status: string;
  created_at: string;
  ended_at?: string;
  duration_seconds: number;
  participant_count: number;
  is_locked: boolean;
  waiting_room_enabled?: boolean;
}

export interface MobileJoinResponse {
  room: MobileRoomInfo;
  participant: MobileParticipant;
  isHost: boolean;
  guestToken?: string;
}

export function normalizeRoomCode(code: string): string {
  const cleaned = code.toUpperCase().trim().replace(/[-\s]/g, '');
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}-${cleaned.slice(8, 10)}`;
  }
  return cleaned;
}

export class TathastuApiClient {
  private baseUrl: string;
  private authToken: string | null = null;
  private guestTokens: Map<string, string> = new Map();
  private sessionCookies: Map<string, string> = new Map();

  constructor(baseUrl: string = process.env.EXPO_PUBLIC_API_URL || 'https://connect-idhm.onrender.com') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  public setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/$/, '');
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public setAuthToken(token: string | null) {
    this.authToken = token;
  }

  public getAuthToken(): string | null {
    return this.authToken;
  }

  public getGuestToken(roomCode: string): string | undefined {
    return this.guestTokens.get(normalizeRoomCode(roomCode));
  }

  public setGuestToken(roomCode: string, token: string) {
    const norm = normalizeRoomCode(roomCode);
    this.guestTokens.set(norm, token);
    this.sessionCookies.set(`tc_guest_${norm}`, token);
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Origin': 'https://connect.aitathastu.com',
      'Referer': 'https://connect.aitathastu.com/',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    // Attach any stored session cookies if Cookie header not already explicitly specified
    if (!headers['Cookie'] && this.sessionCookies.size > 0) {
      const cookiePairs: string[] = [];
      this.sessionCookies.forEach((val, key) => {
        cookiePairs.push(`${key}=${val}`);
      });
      headers['Cookie'] = cookiePairs.join('; ');
    }

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });

    // Inspect Set-Cookie headers for room guest credentials
    try {
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        const parts = setCookie.split(',');
        for (const part of parts) {
          const cookiePair = part.split(';')[0].trim();
          const eqIdx = cookiePair.indexOf('=');
          if (eqIdx > 0) {
            const key = cookiePair.substring(0, eqIdx).trim();
            const val = cookiePair.substring(eqIdx + 1).trim();
            this.sessionCookies.set(key, val);
            if (key.startsWith('tc_guest_')) {
              const code = key.replace('tc_guest_', '');
              this.guestTokens.set(normalizeRoomCode(code), val);
            }
          }
        }
      }
    } catch (_) {}

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData?.error?.message) {
          errorMessage = errorData.error.message;
        } else if (errorData?.message) {
          errorMessage = errorData.message;
        }
      } catch (_) {}
      throw new Error(errorMessage);
    }

    return response.json() as Promise<T>;
  }

  // --- AUTHENTICATION ---
  public async login(email: string, password: string): Promise<{ user: MobileAuthUser; token: string }> {
    const res = await this.request<{ user: MobileAuthUser; token?: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (!res.token) {
      throw new Error('Authentication succeeded but no session token was issued.');
    }
    this.setAuthToken(res.token);
    return res as { user: MobileAuthUser; token: string };
  }

  public async signup(email: string, password: string, displayName: string): Promise<{ user: MobileAuthUser; token: string }> {
    const res = await this.request<{ user: MobileAuthUser; token?: string }>('/api/v1/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    });
    if (!res.token) {
      throw new Error('Account created but no session token was issued.');
    }
    this.setAuthToken(res.token);
    return res as { user: MobileAuthUser; token: string };
  }

  public async logout(): Promise<void> {
    try {
      await this.request('/api/v1/auth/logout', { method: 'POST' });
    } catch (_) {}
    this.setAuthToken(null);
    this.sessionCookies.clear();
    this.guestTokens.clear();
  }

  public async getSession(): Promise<{ user: MobileAuthUser } | null> {
    try {
      return await this.request<{ user: MobileAuthUser }>('/api/v1/auth/session', {
        method: 'GET',
      });
    } catch (_) {
      return null;
    }
  }

  // --- PROFILE & ACCOUNT MANAGEMENT ---
  public async getProfile(): Promise<{ profile: MobileAuthUser }> {
    return this.request<{ profile: MobileAuthUser }>('/api/v1/users/me/profile', {
      method: 'GET',
    });
  }

  public async updateProfile(data: { displayName?: string; avatarId?: string; avatarUrl?: string }): Promise<{ profile: MobileAuthUser }> {
    return this.request<{ profile: MobileAuthUser }>('/api/v1/users/me/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  public async changePassword(data: { currentPassword?: string; newPassword: string }): Promise<{ success: boolean; message?: string }> {
    return this.request<{ success: boolean; message?: string }>('/api/v1/users/me/change-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async updatePreferences(preferences: Record<string, any>): Promise<{ preferences: Record<string, any> }> {
    return this.request<{ preferences: Record<string, any> }>('/api/v1/users/me/preferences', {
      method: 'POST',
      body: JSON.stringify({ preferences }),
    });
  }

  public async googleAuth(idToken: string): Promise<{ user: MobileAuthUser; token: string }> {
    const res = await this.request<{ user: MobileAuthUser; token?: string }>('/api/v1/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    });
    if (!res.token) {
      throw new Error('Google authentication succeeded but no session token was issued.');
    }
    this.setAuthToken(res.token);
    return res as { user: MobileAuthUser; token: string };
  }

  public async linkGoogle(idToken: string): Promise<{ success: boolean; googleConnected: boolean }> {
    return this.request<{ success: boolean; googleConnected: boolean }>('/api/v1/users/me/link-google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    });
  }


  // --- ROOMS & LIFECYCLE ---
  public async createRoom(maxParticipants: number = 25, waitingRoomEnabled: boolean = false): Promise<{ room: MobileRoomInfo; inviteUrl: string }> {
    return this.request<{ room: MobileRoomInfo; inviteUrl: string }>('/api/v1/rooms', {
      method: 'POST',
      body: JSON.stringify({ maxParticipants, waitingRoomEnabled }),
    });
  }

  public async getRoom(code: string): Promise<{ room: MobileRoomInfo }> {
    const norm = normalizeRoomCode(code);
    return this.request<{ room: MobileRoomInfo }>(`/api/v1/rooms/${encodeURIComponent(norm)}`, {
      method: 'GET',
    });
  }

  public async joinRoom(code: string, displayName?: string, passcode?: string): Promise<MobileJoinResponse> {
    const norm = normalizeRoomCode(code);
    const res = await this.request<MobileJoinResponse>(
      `/api/v1/rooms/${encodeURIComponent(norm)}/join`,
      {
        method: 'POST',
        body: JSON.stringify({ displayName, passcode: passcode || undefined }),
      }
    );

    // Save guestToken from JSON response or cookie
    const guestToken = res.guestToken || this.guestTokens.get(norm);
    if (guestToken) {
      this.guestTokens.set(norm, guestToken);
      this.sessionCookies.set(`tc_guest_${norm}`, guestToken);
      res.guestToken = guestToken;
    }

    return res;
  }

  public async getRoomToken(
    code: string,
    guestIdentity?: string,
    guestDisplayName?: string,
    explicitGuestToken?: string
  ): Promise<MobileRoomTokenResponse> {
    const norm = normalizeRoomCode(code);
    const guestToken = explicitGuestToken || this.guestTokens.get(norm);

    const headers: Record<string, string> = {};
    if (guestToken) {
      headers['X-Guest-Token'] = guestToken;
      headers['Cookie'] = `tc_guest_${norm}=${guestToken}`;
    }

    const payload: Record<string, any> = {
      guestIdentity,
      guestDisplayName,
    };
    if (guestToken) {
      payload.guestToken = guestToken;
    }

    return this.request<MobileRoomTokenResponse>(
      `/api/v1/rooms/${encodeURIComponent(norm)}/token`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }
    );
  }

  public async leaveRoom(code: string, identity: string = ''): Promise<void> {
    const norm = normalizeRoomCode(code);
    try {
      await this.request(`/api/v1/rooms/${encodeURIComponent(norm)}/leave`, {
        method: 'POST',
        body: JSON.stringify({ identity }),
      });
    } catch (_) {}
    this.guestTokens.delete(norm);
    this.sessionCookies.delete(`tc_guest_${norm}`);
  }

  public async endRoom(code: string): Promise<void> {
    const norm = normalizeRoomCode(code);
    await this.request(`/api/v1/rooms/${encodeURIComponent(norm)}/end`, {
      method: 'POST',
    });
    this.guestTokens.delete(norm);
    this.sessionCookies.delete(`tc_guest_${norm}`);
  }

  public async getParticipants(code: string): Promise<{ participants: MobileParticipant[] }> {
    const norm = normalizeRoomCode(code);
    return this.request<{ participants: MobileParticipant[] }>(
      `/api/v1/rooms/${encodeURIComponent(norm)}/participants`,
      { method: 'GET' }
    );
  }

  public async getMeetingHistory(): Promise<{ meetings: MobileHistoryItem[] }> {
    return this.request<{ meetings: MobileHistoryItem[] }>('/api/v1/rooms/history', {
      method: 'GET',
    });
  }

  public async muteParticipant(code: string, identity: string): Promise<void> {
    const norm = normalizeRoomCode(code);
    await this.request(`/api/v1/rooms/${encodeURIComponent(norm)}/participants/${encodeURIComponent(identity)}/mute`, {
      method: 'POST',
    });
  }

  public async removeParticipant(code: string, identity: string): Promise<void> {
    const norm = normalizeRoomCode(code);
    await this.request(`/api/v1/rooms/${encodeURIComponent(norm)}/participants/${encodeURIComponent(identity)}/remove`, {
      method: 'POST',
    });
  }
}

export const defaultApiClient = new TathastuApiClient();
