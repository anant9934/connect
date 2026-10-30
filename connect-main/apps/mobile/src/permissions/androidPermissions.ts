/**
 * Android Runtime Permissions Specifications & Implementations for Tathastu Meet
 * Compliant with Android 14+ (API Level 34) Foreground Service & Runtime Permission Gates.
 */

import { PermissionsAndroid, Platform } from 'react-native';

export type AndroidPermissionStatus = 'granted' | 'denied' | 'never_ask_again';

export interface AndroidPermissionState {
  recordAudio: AndroidPermissionStatus;
  camera: AndroidPermissionStatus;
  postNotifications: AndroidPermissionStatus;
  bluetoothConnect: AndroidPermissionStatus;
}

export const MANDATORY_ANDROID_PERMISSIONS = {
  AUDIO: PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  CAMERA: PermissionsAndroid.PERMISSIONS.CAMERA,
  NOTIFICATIONS: (PermissionsAndroid.PERMISSIONS as any).POST_NOTIFICATIONS || 'android.permission.POST_NOTIFICATIONS',
  BLUETOOTH_CONNECT: (PermissionsAndroid.PERMISSIONS as any).BLUETOOTH_CONNECT || 'android.permission.BLUETOOTH_CONNECT',
} as const;

export const ANDROID_FOREGROUND_SERVICE_TYPES = {
  MICROPHONE: 'microphone',
  CAMERA: 'camera',
  MEDIA_PROJECTION: 'mediaProjection',
} as const;

export async function checkCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    return await PermissionsAndroid.check(MANDATORY_ANDROID_PERMISSIONS.CAMERA);
  } catch (err) {
    console.warn('Error checking camera permission:', err);
    return false;
  }
}

export async function checkMicrophonePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    return await PermissionsAndroid.check(MANDATORY_ANDROID_PERMISSIONS.AUDIO);
  } catch (err) {
    console.warn('Error checking microphone permission:', err);
    return false;
  }
}

export async function requestCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const result = await PermissionsAndroid.request(
      MANDATORY_ANDROID_PERMISSIONS.CAMERA,
      {
        title: 'Camera Access Required',
        message: 'Tathastu Meet needs camera access to transmit your video feed during meetings.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      }
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch (err) {
    console.warn('Error requesting camera permission:', err);
    return false;
  }
}

export async function requestMicrophonePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const result = await PermissionsAndroid.request(
      MANDATORY_ANDROID_PERMISSIONS.AUDIO,
      {
        title: 'Microphone Access Required',
        message: 'Tathastu Meet needs microphone access so others can hear you during meetings.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      }
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch (err) {
    console.warn('Error requesting microphone permission:', err);
    return false;
  }
}

export async function checkAllMediaPermissions(): Promise<{ camera: boolean; microphone: boolean }> {
  const [camera, microphone] = await Promise.all([
    checkCameraPermission(),
    checkMicrophonePermission(),
  ]);
  return { camera, microphone };
}

export async function requestAllMediaPermissions(): Promise<{ camera: boolean; microphone: boolean }> {
  if (Platform.OS !== 'android') return { camera: true, microphone: true };

  const permissions: string[] = [
    MANDATORY_ANDROID_PERMISSIONS.CAMERA,
    MANDATORY_ANDROID_PERMISSIONS.AUDIO,
  ];

  if (typeof Platform.Version === 'number' && Platform.Version >= 31) {
    permissions.push(MANDATORY_ANDROID_PERMISSIONS.BLUETOOTH_CONNECT);
  }
  if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
    permissions.push(MANDATORY_ANDROID_PERMISSIONS.NOTIFICATIONS);
  }

  try {
    const results = await PermissionsAndroid.requestMultiple(permissions as any);
    return {
      camera: results[MANDATORY_ANDROID_PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED,
      microphone: results[MANDATORY_ANDROID_PERMISSIONS.AUDIO] === PermissionsAndroid.RESULTS.GRANTED,
    };
  } catch (err) {
    console.warn('Error requesting multiple permissions:', err);
    return { camera: false, microphone: false };
  }
}

/**
 * Validates permission status and returns user-friendly guidance for Android system settings.
 */
export function getAndroidPermissionGuidance(permission: keyof AndroidPermissionState): string {
  switch (permission) {
    case 'recordAudio':
      return 'Microphone permission is required so other meeting participants can hear you.';
    case 'camera':
      return 'Camera permission enables video streaming with other participants in your room.';
    case 'postNotifications':
      return 'Notification permission allows you to control in-progress calls while multitasking.';
    case 'bluetoothConnect':
      return 'Nearby devices permission enables high-fidelity audio through Bluetooth headsets.';
    default:
      return 'Permission is required to proceed.';
  }
}
