/**
 * Native Audio Routing & In-Call Session Management Contract
 * Coordinates native audio mode switching: Speakerphone, Earpiece, Bluetooth SCO, and Proximity.
 */

export type AudioOutputRoute = 'speaker' | 'earpiece' | 'bluetooth' | 'wired_headset';

export interface AudioSessionState {
  currentRoute: AudioOutputRoute;
  availableRoutes: AudioOutputRoute[];
  isProximityNear: boolean;
  isBluetoothConnected: boolean;
}

export interface NativeAudioSessionContract {
  setAudioRoute(route: AudioOutputRoute): Promise<void>;
  enableSpeakerphone(enable: boolean): Promise<void>;
  startBluetoothSco(): Promise<void>;
  stopBluetoothSco(): Promise<void>;
  setMicrophoneMute(muted: boolean): Promise<void>;
}
