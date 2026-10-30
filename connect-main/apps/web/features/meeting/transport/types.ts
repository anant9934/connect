import { ConnectionState, Track } from 'livekit-client';

export type TransportType = 'livekit' | 'p2p';

export interface TransportTrack {
  kind: 'audio' | 'video';
  mediaStreamTrack: MediaStreamTrack;
  isMuted: boolean;
  source: Track.Source;
  attach(element: HTMLMediaElement): HTMLMediaElement;
  detach(element?: HTMLMediaElement): HTMLMediaElement[];
}

export interface TransportTrackPublication {
  track?: TransportTrack;
  isMuted: boolean;
  source: Track.Source;
}

export interface TransportParticipant {
  identity: string;
  name: string;
  isLocal: boolean;
  isSpeaking: boolean;
  connectionQuality: 'excellent' | 'good' | 'poor' | 'unknown';
  getTrackPublication(source: Track.Source): TransportTrackPublication | undefined;
  on(event: string, callback: (...args: any[]) => void): void;
  off(event: string, callback: (...args: any[]) => void): void;
}

export interface MediaTransportStats {
  transportType: TransportType;
  rttMs: number;
  jitterMs: number;
  packetsLost: number;
  packetsReceived?: number;
  resolution: { width: number; height: number } | null;
  frameRate: number | null;
  bitrateKbps: number;
  inboundBitrateKbps?: number;
  outboundBitrateKbps?: number;
  candidateType: 'host' | 'srflx' | 'prflx' | 'relay' | 'unknown';
  isRelayed: boolean;
  timestamp: number;
}

export interface ScreenShareOptions {
  captureMode?: 'detail' | 'motion';
}

export interface TransportConnectOptions {
  roomCode: string;
  token?: string;
  livekitUrl?: string;
  guestToken?: string;
  identity: string;
  displayName: string;
  isHost: boolean;
  initialAudioEnabled: boolean;
  initialVideoEnabled: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}

export interface MediaTransport {
  readonly type: TransportType;
  readonly state: ConnectionState;
  readonly localParticipant: TransportParticipant | null;
  readonly remoteParticipants: TransportParticipant[];
  readonly screenSharePub: TransportTrackPublication | null;
  readonly screenShareParticipant: TransportParticipant | null;

  connect(options: TransportConnectOptions): Promise<void>;
  disconnect(): Promise<void>;

  setMicrophoneEnabled(enabled: boolean, deviceId?: string): Promise<void>;
  setCameraEnabled(enabled: boolean, deviceId?: string): Promise<void>;
  switchCamera(deviceId: string): Promise<void>;

  startScreenShare(options?: ScreenShareOptions): Promise<void>;
  stopScreenShare(): Promise<void>;

  sendData(topic: string, data: any): Promise<void>;
  getStats(): Promise<MediaTransportStats | null>;

  startAudio?(): Promise<void>;
  readonly canPlaybackAudio?: boolean;

  on(event: 'state_changed', callback: (state: ConnectionState) => void): void;
  on(event: 'participants_changed', callback: () => void): void;
  on(event: 'data_received', callback: (payload: Uint8Array, participant?: TransportParticipant, topic?: string) => void): void;
  on(event: 'fallback_required', callback: (reason: string) => void): void;
  off(event: string, callback: (...args: any[]) => void): void;
}

