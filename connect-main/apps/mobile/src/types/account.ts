/**
 * Tathastu Meet - Central Account & Profile Type Definitions
 */

export interface UserPreferences {
  defaultMicOn?: boolean;
  defaultCameraOn?: boolean;
  preferredCameraFacing?: 'front' | 'back';
  appearance?: 'Light' | 'Dark' | 'System';
  language?: string;
  notificationsEnabled?: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarId?: string | null;
  avatarUrl?: string | null;
  googleConnected: boolean;
  emailPasswordConnected: boolean;
  preferences: UserPreferences;
}

export interface UpdateProfileRequest {
  displayName?: string;
  avatarId?: string;
  avatarUrl?: string;
}

export interface ChangePasswordRequest {
  currentPassword?: string;
  newPassword: string;
}

export interface GoogleAuthRequest {
  idToken: string;
}
