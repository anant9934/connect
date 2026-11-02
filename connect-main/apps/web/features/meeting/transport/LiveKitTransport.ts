import {
  Room as LiveKitRoom,
  RoomEvent,
  ConnectionState,
  Track,
  TrackPublication,
  Participant,
  LocalParticipant,
  setLogLevel,
} from 'livekit-client';
import { LIVEKIT_ROOM_OPTIONS } from '../livekit';
import {
  MediaTransport,
  TransportType,
  TransportConnectOptions,
  TransportParticipant,
  TransportTrack,
  TransportTrackPublication,
  MediaTransportStats,
  ScreenShareOptions,
} from './types';

import { webDiagnostics } from '../diagnostics';

// Adapts a LiveKit Track to the TransportTrack interface
class LiveKitTrackAdapter implements TransportTrack {
  constructor(public livekitTrack: any, public source: Track.Source) {}

  get kind(): 'audio' | 'video' {
    return this.livekitTrack?.kind === 'video' ? 'video' : 'audio';
  }

  get mediaStreamTrack(): MediaStreamTrack {
    return this.livekitTrack?.mediaStreamTrack;
  }

  get isMuted(): boolean {
    return Boolean(this.livekitTrack?.isMuted);
  }

  attach(element: HTMLMediaElement): HTMLMediaElement {
    return this.livekitTrack?.attach(element);
  }

  detach(element?: HTMLMediaElement): HTMLMediaElement[] {
    return this.livekitTrack?.detach(element) || [];
  }
}

// Adapts a LiveKit Participant to the TransportParticipant interface
class LiveKitParticipantAdapter implements TransportParticipant {
  constructor(public livekitParticipant: Participant) {}

  get identity(): string {
    return this.livekitParticipant.identity;
  }

  get name(): string {
    return this.livekitParticipant.name || this.livekitParticipant.identity;
  }

  get isLocal(): boolean {
    return this.livekitParticipant instanceof LocalParticipant;
  }

  get isSpeaking(): boolean {
    return this.livekitParticipant.isSpeaking;
  }

  get connectionQuality(): 'excellent' | 'good' | 'poor' | 'unknown' {
    const q = (this.livekitParticipant as any).connectionQuality;
    if (q === 0) return 'poor';
    if (q === 1) return 'good';
    if (q === 2) return 'excellent';
    return 'unknown';
  }

  getTrackPublication(source: Track.Source): TransportTrackPublication | undefined {
    const pub = this.livekitParticipant.getTrackPublication(source);
    if (!pub) return undefined;
    return {
      source,
      isMuted: pub.isMuted,
      track: pub.track ? new LiveKitTrackAdapter(pub.track, source) : undefined,
    };
  }

  on(event: string, callback: (...args: any[]) => void): void {
    this.livekitParticipant.on(event as any, callback as any);
  }

  off(event: string, callback: (...args: any[]) => void): void {
    this.livekitParticipant.off(event as any, callback as any);
  }
}

export class LiveKitTransport implements MediaTransport {
  readonly type: TransportType = 'livekit';
  private room: LiveKitRoom | null = null;
  private eventListeners: Map<string, Set<Function>> = new Map();
  private _screenSharePub: TransportTrackPublication | null = null;
  private _screenShareParticipant: TransportParticipant | null = null;
  private prevInboundSample: { bytes: number; timestamp: number } | null = null;
  private prevOutboundSample: { bytes: number; timestamp: number } | null = null;

  constructor() {
    this.initRoom();
  }

  private initRoom(): void {
    if (typeof window !== 'undefined' && (window as any).__TC_ENABLE_TEST_DIAGNOSTICS) {
      setLogLevel('debug');
    }
    const room = new LiveKitRoom(LIVEKIT_ROOM_OPTIONS);
    this.room = room;
    webDiagnostics.log('room', 'RoomCreated');

    room
      .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        webDiagnostics.log('room', 'ConnectionStateChanged', { details: { state } });
        this.emit('state_changed', state);
      })
      .on(RoomEvent.Connected, () => {
        webDiagnostics.log('room', 'Connected', {
          details: {
            roomName: room.name,
            canPlaybackAudio: room.canPlaybackAudio,
            remoteParticipants: room.remoteParticipants.size,
          },
        });
        this.updateScreenShareState();
        this.emit('participants_changed');
      })
      .on(RoomEvent.SignalReconnecting, () => {
        webDiagnostics.log('room', 'SignalReconnecting');
      })
      .on(RoomEvent.ParticipantPermissionsChanged, () => {
        webDiagnostics.log('room', 'PermissionsChanged');
      })
      .on(RoomEvent.Disconnected, (reason?: unknown) => {
        webDiagnostics.log('room', 'Disconnected', { details: { reason } });
        this.emit('participants_changed');
      })
      .on(RoomEvent.Reconnecting, () => {
        webDiagnostics.log('room', 'Reconnecting');
        this.emit('state_changed', ConnectionState.Reconnecting);
      })
      .on(RoomEvent.Reconnected, () => {
        webDiagnostics.log('room', 'Reconnected');
        this.updateScreenShareState();
        this.emit('state_changed', ConnectionState.Connected);
        this.emit('participants_changed');
      })
      .on(RoomEvent.ParticipantConnected, (p: Participant) => {
        webDiagnostics.log('room', 'ParticipantConnected', {
          participantIdentity: p.identity,
          details: { name: p.name },
        });
        this.updateScreenShareState();
        this.emit('participants_changed');
      })
      .on(RoomEvent.ParticipantDisconnected, (p: Participant) => {
        webDiagnostics.log('room', 'ParticipantDisconnected', {
          participantIdentity: p.identity,
        });
        this.updateScreenShareState();
        this.emit('participants_changed');
      })
      .on(RoomEvent.TrackSubscribed, (track: any, pub: any, p: Participant) => {
        webDiagnostics.log('track', 'TrackSubscribed', {
          participantIdentity: p.identity,
          trackSid: pub?.trackSid,
          source: pub?.source,
          kind: track?.kind,
          isSubscribed: true,
        });
        this.updateScreenShareState();
        this.emit('participants_changed');
      })
      .on(RoomEvent.TrackUnsubscribed, (track: any, pub: any, p: Participant) => {
        webDiagnostics.log('track', 'TrackUnsubscribed', {
          participantIdentity: p.identity,
          trackSid: pub?.trackSid,
          source: pub?.source,
          kind: track?.kind,
          isSubscribed: false,
        });
        this.updateScreenShareState();
        this.emit('participants_changed');
      })
      .on(RoomEvent.TrackPublished, (pub: any, p: Participant) => {
        webDiagnostics.log('track', 'TrackPublished', {
          participantIdentity: p.identity,
          trackSid: pub?.trackSid,
          source: pub?.source,
          kind: pub?.kind,
        });
        this.updateScreenShareState();
        this.emit('participants_changed');
      })
      .on(RoomEvent.TrackUnpublished, (pub: any, p: Participant) => {
        webDiagnostics.log('track', 'TrackUnpublished', {
          participantIdentity: p.identity,
          trackSid: pub?.trackSid,
          source: pub?.source,
        });
        this.updateScreenShareState();
        this.emit('participants_changed');
      })
      .on(RoomEvent.LocalTrackPublished, (pub: any) => {
        webDiagnostics.log('track', 'LocalTrackPublished', {
          trackSid: pub?.trackSid,
          source: pub?.source,
          kind: pub?.kind,
        });
        this.updateScreenShareState();
        this.emit('participants_changed');
      })
      .on(RoomEvent.LocalTrackUnpublished, (pub: any) => {
        webDiagnostics.log('track', 'LocalTrackUnpublished', {
          trackSid: pub?.trackSid,
          source: pub?.source,
        });
        this.updateScreenShareState();
        this.emit('participants_changed');
      })
      .on(RoomEvent.TrackMuted, (pub: any, p?: Participant) => {
        webDiagnostics.log('track', 'TrackMuted', {
          participantIdentity: p?.identity,
          trackSid: pub?.trackSid,
          source: pub?.source,
        });
        this.updateScreenShareState();
        this.emit('participants_changed');
      })
      .on(RoomEvent.TrackUnmuted, (pub: any, p?: Participant) => {
        webDiagnostics.log('track', 'TrackUnmuted', {
          participantIdentity: p?.identity,
          trackSid: pub?.trackSid,
          source: pub?.source,
        });
        this.updateScreenShareState();
        this.emit('participants_changed');
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        webDiagnostics.log('audio', 'AudioPlaybackStatusChanged', {
          details: { canPlaybackAudio: room.canPlaybackAudio },
        });
        this.emit('participants_changed');
      })
      .on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: Participant, _kind?: any, topic?: string) => {
        webDiagnostics.log('media', 'DataReceived', {
          participantIdentity: participant?.identity,
          details: { topic, byteLength: payload.length },
        });
        const adaptedParticipant = participant ? new LiveKitParticipantAdapter(participant) : undefined;
        this.emit('data_received', payload, adaptedParticipant, topic);
      });
  }

  get state(): ConnectionState {
    return this.room?.state ?? ConnectionState.Disconnected;
  }

  get localParticipant(): TransportParticipant | null {
    if (!this.room?.localParticipant) return null;
    return new LiveKitParticipantAdapter(this.room.localParticipant);
  }

  get remoteParticipants(): TransportParticipant[] {
    if (!this.room) return [];
    return Array.from(this.room.remoteParticipants.values()).map(
      (p) => new LiveKitParticipantAdapter(p)
    );
  }

  get screenSharePub(): TransportTrackPublication | null {
    return this._screenSharePub;
  }

  get screenShareParticipant(): TransportParticipant | null {
    return this._screenShareParticipant;
  }

  get canPlaybackAudio(): boolean {
    return this.room?.canPlaybackAudio ?? true;
  }

  async startAudio(): Promise<void> {
    if (!this.room) return;
    if (typeof this.room.startAudio === 'function') {
      await this.room.startAudio();
    }
  }

  // Returns underlying LiveKit Room instance for components that require direct room hooks
  getLiveKitRoom(): LiveKitRoom | null {
    return this.room;
  }

  async connect(options: TransportConnectOptions): Promise<void> {
    if (!options.livekitUrl || !options.token) {
      throw new Error('LiveKit URL and token required for LiveKitTransport');
    }

    if (!this.room) {
      this.initRoom();
    }

    webDiagnostics.log('room', 'ConnectStarted');
    await this.room!.connect(options.livekitUrl, options.token);
    webDiagnostics.log('room', 'ConnectFinished', { details: { sid: this.room!.localParticipant?.sid } });

    if (typeof window !== 'undefined') {
      const allowDiagnostics =
        process.env.NODE_ENV !== 'production' ||
        Boolean((window as any).__TC_ENABLE_TEST_DIAGNOSTICS);

      if (allowDiagnostics) {
        (window as any).__livekitRoom = this.room;
        (window as any).__tcDiagnostics = {
          getRoomState: () => this.room?.state,
          getPeerConnections: () => {
            const pcs: RTCPeerConnection[] = [];
            const sub = (this.room?.engine as any)?.pcManager?.subscriber?.pc;
            const pub = (this.room?.engine as any)?.pcManager?.publisher?.pc;
            if (sub) pcs.push(sub);
            if (pub) pcs.push(pub);
            return pcs;
          },
          canPlaybackAudio: () => Boolean(this.room?.canPlaybackAudio),
          startAudio: () => this.room?.startAudio(),
          getRemoteTrackStats: () => {
            if (!this.room) return [];
            return Array.from(this.room.remoteParticipants.values()).map((p) => ({
              identity: p.identity,
              tracks: Array.from(p.trackPublications.values()).map((pub) => ({
                source: pub.source,
                kind: pub.kind,
                isSubscribed: pub.isSubscribed,
                isMuted: pub.isMuted,
              })),
            }));
          },
        };
      } else {
        delete (window as any).__livekitRoom;
        delete (window as any).__tcDiagnostics;
      }
    }

    if (options.initialAudioEnabled) {
      try {
        await this.setMicrophoneEnabled(true, options.audioDeviceId);
      } catch (err: any) {
        console.warn('[LiveKitTransport] Initial audio enable skipped:', err?.name || err?.message);
      }
    }

    if (options.initialVideoEnabled) {
      try {
        await this.setCameraEnabled(true, options.videoDeviceId);
      } catch (err: any) {
        console.warn('[LiveKitTransport] Initial video enable skipped:', err?.name || err?.message);
      }
    }

    this.updateScreenShareState();
    this.emit('participants_changed');
  }

  async disconnect(): Promise<void> {
    if (typeof window !== 'undefined') {
      delete (window as any).__livekitRoom;
      delete (window as any).__tcDiagnostics;
    }
    if (this.room) {
      await this.room.disconnect();
      this.room = null;
    }
    this._screenSharePub = null;
    this._screenShareParticipant = null;
  }

  async setMicrophoneEnabled(enabled: boolean, deviceId?: string): Promise<void> {
    if (!this.room) return;
    try {
      if (enabled) {
        try {
          await this.room.localParticipant.setMicrophoneEnabled(true, {
            deviceId: deviceId ? { ideal: deviceId } : undefined,
          });
        } catch (deviceErr: any) {
          if (deviceId) {
            await this.room.localParticipant.setMicrophoneEnabled(true);
          } else {
            throw deviceErr;
          }
        }
      } else {
        await this.room.localParticipant.setMicrophoneEnabled(false);
      }
    } catch (err: any) {
      console.error('[LiveKitTransport] setMicrophoneEnabled error:', err?.name, err?.message);
      throw err;
    } finally {
      this.emit('participants_changed');
    }
  }

  async setCameraEnabled(enabled: boolean, deviceId?: string): Promise<void> {
    if (!this.room) return;
    try {
      if (enabled) {
        try {
          await this.room.localParticipant.setCameraEnabled(true, {
            deviceId: deviceId ? { ideal: deviceId } : undefined,
          });
        } catch (deviceErr: any) {
          if (deviceId) {
            await this.room.localParticipant.setCameraEnabled(true);
          } else {
            throw deviceErr;
          }
        }
      } else {
        await this.room.localParticipant.setCameraEnabled(false);
      }
    } catch (err: any) {
      console.error('[LiveKitTransport] setCameraEnabled error:', err?.name, err?.message);
      throw err;
    } finally {
      this.emit('participants_changed');
    }
  }

  async switchCamera(deviceId: string): Promise<void> {
    if (!this.room) return;
    try {
      const roomAny = this.room as any;
      if (typeof roomAny.switchActiveDevice === 'function') {
        await roomAny.switchActiveDevice('videoinput', deviceId);
      } else if (roomAny.localParticipant) {
        await this.setCameraEnabled(true, deviceId);
      }
    } catch (err) {
      console.warn('[LiveKitTransport] switchCamera fallback:', err);
    }
    this.emit('participants_changed');
  }

  async startScreenShare(_options?: ScreenShareOptions): Promise<void> {
    if (!this.room) return;
    await this.room.localParticipant.setScreenShareEnabled(true);
    this.updateScreenShareState();
    this.emit('participants_changed');
  }

  async stopScreenShare(): Promise<void> {
    if (!this.room) return;
    await this.room.localParticipant.setScreenShareEnabled(false);
    this.updateScreenShareState();
    this.emit('participants_changed');
  }

  async sendData(topic: string, data: any): Promise<void> {
    if (!this.room) return;
    const payload = new TextEncoder().encode(JSON.stringify(data));
    await this.room.localParticipant.publishData(payload, { topic, reliable: true });
  }

  async getStats(): Promise<MediaTransportStats | null> {
    if (!this.room) return null;

    let rttMs = 0;
    let jitterMs = 0;
    let packetsLost = 0;
    let inboundFps: number | null = null;
    let inboundWidth: number | null = null;
    let inboundHeight: number | null = null;
    let outboundFps: number | null = null;
    let outboundWidth: number | null = null;
    let outboundHeight: number | null = null;
    let inboundBytes = 0;
    let outboundBytes = 0;
    let candidateType: string | undefined;
    let isRelayed = false;

    try {
      // Query underlying WebRTC PeerConnections (subscriber & publisher)
      const pcs: RTCPeerConnection[] = [];
      const sub = (this.room.engine as any)?.pcManager?.subscriber?.pc;
      const pub = (this.room.engine as any)?.pcManager?.publisher?.pc;
      if (sub) pcs.push(sub);
      if (pub) pcs.push(pub);

      for (const pc of pcs) {
        if (!pc || typeof pc.getStats !== 'function') continue;
        const report = await pc.getStats();
        report.forEach((stat: any) => {
          if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
            if (typeof stat.currentRoundTripTime === 'number') {
              rttMs = Math.round(stat.currentRoundTripTime * 1000);
            }
          }
          if (stat.type === 'local-candidate') {
            candidateType = stat.candidateType;
            if (stat.candidateType === 'relay') isRelayed = true;
          }
          if (stat.type === 'inbound-rtp') {
            if (typeof stat.bytesReceived === 'number') {
              inboundBytes += stat.bytesReceived;
            }
            if (stat.kind === 'video') {
              if (typeof stat.jitter === 'number') {
                jitterMs = Math.round(stat.jitter * 1000);
              }
              if (typeof stat.packetsLost === 'number') {
                packetsLost += stat.packetsLost;
              }
              if (typeof stat.framesPerSecond === 'number' && stat.framesPerSecond > 0) {
                inboundFps = Math.round(stat.framesPerSecond);
              }
              if (typeof stat.frameWidth === 'number' && stat.frameWidth > 0 && typeof stat.frameHeight === 'number') {
                inboundWidth = stat.frameWidth;
                inboundHeight = stat.frameHeight;
              }
            }
          }
          if (stat.type === 'outbound-rtp') {
            if (typeof stat.bytesSent === 'number') {
              outboundBytes += stat.bytesSent;
            }
            if (stat.kind === 'video') {
              if (typeof stat.framesPerSecond === 'number' && stat.framesPerSecond > 0) {
                outboundFps = Math.round(stat.framesPerSecond);
              }
              if (typeof stat.frameWidth === 'number' && stat.frameWidth > 0 && typeof stat.frameHeight === 'number') {
                outboundWidth = stat.frameWidth;
                outboundHeight = stat.frameHeight;
              }
            }
          }
        });
      }
    } catch (e) {
      console.warn('[LiveKitTransport] getStats query error:', e);
    }

    const now = Date.now();
    let inboundBitrateKbps = 0;
    let outboundBitrateKbps = 0;

    if (this.prevInboundSample && inboundBytes >= this.prevInboundSample.bytes) {
      const deltaBytes = inboundBytes - this.prevInboundSample.bytes;
      const deltaTimeMs = now - this.prevInboundSample.timestamp;
      if (deltaTimeMs > 0) {
        inboundBitrateKbps = Math.round((deltaBytes * 8) / deltaTimeMs);
      }
    }
    this.prevInboundSample = { bytes: inboundBytes, timestamp: now };

    if (this.prevOutboundSample && outboundBytes >= this.prevOutboundSample.bytes) {
      const deltaBytes = outboundBytes - this.prevOutboundSample.bytes;
      const deltaTimeMs = now - this.prevOutboundSample.timestamp;
      if (deltaTimeMs > 0) {
        outboundBitrateKbps = Math.round((deltaBytes * 8) / deltaTimeMs);
      }
    }
    this.prevOutboundSample = { bytes: outboundBytes, timestamp: now };

    const bitrateKbps = inboundBitrateKbps + outboundBitrateKbps;

    // Genuine resolution determination: Inbound takes priority, then outbound, else null
    let resolution: { width: number; height: number } | null = null;
    if (inboundWidth && inboundHeight) {
      resolution = { width: inboundWidth, height: inboundHeight };
    } else if (outboundWidth && outboundHeight) {
      resolution = { width: outboundWidth, height: outboundHeight };
    }

    // Genuine frame rate determination: Inbound takes priority, then outbound, else null
    let frameRate: number | null = null;
    if (inboundFps !== null) {
      frameRate = inboundFps;
    } else if (outboundFps !== null) {
      frameRate = outboundFps;
    }

    return {
      transportType: 'livekit',
      rttMs: rttMs > 0 ? rttMs : 0,
      jitterMs: jitterMs > 0 ? jitterMs : 0,
      packetsLost,
      resolution,
      frameRate,
      bitrateKbps,
      inboundBitrateKbps,
      outboundBitrateKbps,
      candidateType: (candidateType as any) || 'unknown',
      isRelayed,
      timestamp: now,
    };
  }

  on(event: string, callback: (...args: any[]) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  off(event: string, callback: (...args: any[]) => void): void {
    this.eventListeners.get(event)?.delete(callback);
  }

  private emit(event: string, ...args: any[]): void {
    this.eventListeners.get(event)?.forEach((cb) => {
      try {
        cb(...args);
      } catch (err) {
        console.error('Error in LiveKitTransport listener:', err);
      }
    });
  }

  private updateScreenShareState(): void {
    if (!this.room) {
      this._screenSharePub = null;
      this._screenShareParticipant = null;
      return;
    }

    // 1. Local screen share
    const localScreen = this.room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    if (localScreen && !localScreen.isMuted) {
      this._screenSharePub = {
        source: Track.Source.ScreenShare,
        isMuted: localScreen.isMuted,
        track: localScreen.track ? new LiveKitTrackAdapter(localScreen.track, Track.Source.ScreenShare) : undefined,
      };
      this._screenShareParticipant = new LiveKitParticipantAdapter(this.room.localParticipant);
      return;
    }

    // 2. Remote screen share
    for (const rp of this.room.remoteParticipants.values()) {
      const screenPub = rp.getTrackPublication(Track.Source.ScreenShare);
      const track = screenPub ? (screenPub.track || (screenPub as any).videoTrack) : undefined;
      if (screenPub && !screenPub.isMuted && track) {
        this._screenSharePub = {
          source: Track.Source.ScreenShare,
          isMuted: screenPub.isMuted,
          track: new LiveKitTrackAdapter(track, Track.Source.ScreenShare),
        };
        this._screenShareParticipant = new LiveKitParticipantAdapter(rp);
        return;
      }
    }

    this._screenSharePub = null;
    this._screenShareParticipant = null;
  }
}
