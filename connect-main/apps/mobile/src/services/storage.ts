import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const SESSION_TOKEN_KEY = 'tathastu_meet_session_token';
const USER_DATA_KEY = 'tathastu_meet_user_data';
const PREFERENCES_KEY = 'tathastu_meet_preferences';

// In-memory fallback for headless or test environments
const memoryStore = new Map<string, string>();

export interface SavedPreferences {
  rememberDevices?: boolean;
  defaultMicOn?: boolean;
  defaultCameraOn?: boolean;
  preferredCameraFacing?: 'front' | 'back';
}

export const secureStorage = {
  async setItem(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        await SecureStore.setItemAsync(key, value);
        return;
      }
    } catch (_) {}
    memoryStore.set(key, value);
  },

  async getItem(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        const val = await SecureStore.getItemAsync(key);
        if (val !== null) return val;
      }
    } catch (_) {}
    return memoryStore.get(key) || null;
  },

  async removeItem(key: string): Promise<void> {
    try {
      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        await SecureStore.deleteItemAsync(key);
      }
    } catch (_) {}
    memoryStore.delete(key);
  },

  async saveSession(token: string, user: any): Promise<void> {
    await this.setItem(SESSION_TOKEN_KEY, token);
    await this.setItem(USER_DATA_KEY, JSON.stringify(user));
  },

  async saveUser(user: any): Promise<void> {
    await this.setItem(USER_DATA_KEY, JSON.stringify(user));
  },


  async getSession(): Promise<{ token: string | null; user: any | null }> {
    const token = await this.getItem(SESSION_TOKEN_KEY);
    const userStr = await this.getItem(USER_DATA_KEY);
    let user = null;
    if (userStr) {
      try {
        user = JSON.parse(userStr);
      } catch (_) {}
    }
    return { token, user };
  },

  async clearSession(): Promise<void> {
    await this.removeItem(SESSION_TOKEN_KEY);
    await this.removeItem(USER_DATA_KEY);
  },

  async savePreferences(prefs: SavedPreferences): Promise<void> {
    await this.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
  },

  async getPreferences(): Promise<SavedPreferences> {
    const str = await this.getItem(PREFERENCES_KEY);
    if (!str) return { defaultMicOn: false, defaultCameraOn: false };
    try {
      return JSON.parse(str);
    } catch (_) {
      return { defaultMicOn: false, defaultCameraOn: false };
    }
  },
};
