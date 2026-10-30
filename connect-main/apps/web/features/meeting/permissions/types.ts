'use client';

export type DevicePermissionState =
  | 'unknown'
  | 'prompt'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'device-busy'
  | 'policy-blocked'
  | 'unsupported';

export type TargetMediaDevice = 'camera' | 'microphone' | 'both';

export interface SingleDeviceState {
  state: DevicePermissionState;
  error: string | null;
  track: MediaStreamTrack | null;
  enabled: boolean;
}

export interface MediaPermissionsState {
  camera: SingleDeviceState;
  microphone: SingleDeviceState;
  isChecking: boolean;
  isSecureContext: boolean;
  isInAppBrowser: boolean;
  inAppBrowserName: string | null;
}

export interface CaptureResult {
  track: MediaStreamTrack | null;
  state: DevicePermissionState;
  error?: string;
}
