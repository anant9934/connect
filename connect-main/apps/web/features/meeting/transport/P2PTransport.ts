import { ConnectionState, Track } from 'livekit-client';
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
import { createLocalMediaStream, stopMediaStream } from '../media';

// Local or Remote WebRTC track adapter
export class P2PTrackAdapter implements TransportTrack {
  constructor(
    public mediaStreamTrack: MediaStreamTrack,
    public kind: 'audio' | 'video',
    public source: Track.Source,
    private _isMuted = false
  ) {}

  get isMuted(): boolean {
    return this._isMuted || !this.mediaStreamTrack.enabled;
  }

  setMuted(muted: boolean) {
    this._isMuted = muted;
  }

  attach(element: HTMLMediaElement): HTMLMediaElement {
    if (element.srcObject instanceof MediaStream) {
      const stream = element.srcObject;
      const existing = stream.getTracks().find((t) => t.kind === this.kind);
      if (existing && existing !== this.mediaStreamTrack) {
        stream.removeTrack(existing);
      }
      if (!stream.getTracks().includes(this.mediaStreamTrack)) {
        stream.addTrack(this.mediaStreamTrack);
      }
    } else {
      const stream = new MediaStream([this.mediaStreamTrack]);
      element.srcObject = stream;
    }
    element.play().catch(() => {});
    return element;
  }

  detach(element?: HTMLMediaElement): HTMLMediaElement[] {
    if (element && element.srcObject instanceof MediaStream) {
      const stream = element.srcObject;
      if (stream.getTracks().includes(this.mediaStreamTrack)) {
        stream.removeTrack(this.mediaStreamTrack);
      }
      return [element];
    }
    return [];
  }
}

// Normalized P2P Participant adapter
export class P2PParticipantAdapter implements TransportParticipant {
  public isSpeaking = false;
  public connectionQuality: 'excellent' | 'good' | 'poor' | 'unknown' = 'excellent';
  private eventListeners: Map<string, Set<Function>> = new Map();
  private publications: Map<Track.Source, TransportTrackPublication> = new Map();

  constructor(
    public identity: string,
    public name: string,
    public isLocal: boolean,
    public isHost: boolean = false
  ) {}

  getTrackPublication(source: Track.Source): TransportTrackPublication | undefined {
    return this.publications.get(source);
  }

  setTrackPublication(source: Track.Source, pub: TransportTrackPublication | undefined) {
    if (pub) {
      this.publications.set(source, pub);
    } else {
      this.publications.delete(source);
    }
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

  emit(event: string, ...args: any[]): void {
    this.eventListeners.get(event)?.forEach((cb) => {
      try {
        cb(...args);
      } catch (err) {
        console.error('Error in P2PParticipant listener:', err);
      }
    });
  }
}

export class P2PTransport implements MediaTransport {
  readonly type: TransportType = 'p2p';
  private _state: ConnectionState = ConnectionState.Disconnected;
  private pc: RTCPeerConnection | null = null;
  private ws: WebSocket | null = null;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private videoSender: RTCRtpSender | null = null;
  private audioSender: RTCRtpSender | null = null;
  private dataChannel: RTCDataChannel | null = null;

  private _localParticipant: P2PParticipantAdapter | null = null;
  private _remoteParticipants: Map<string, P2PParticipantAdapter> = new Map();
  private _screenSharePub: TransportTrackPublication | null = null;
  private _screenShareParticipant: TransportParticipant | null = null;

  // Perfect Negotiation state
  private isPolite = false;
  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  private eventListeners: Map<string, Set<Function>> = new Map();
  private connectOptions: TransportConnectOptions | null = null;
  private statsInterval: any = null;
  private latestStats: MediaTransportStats | null = null;
  private prevBytesReceived = 0;
  private prevTimestamp = 0;

  get state(): ConnectionState {
    return this._state;
  }

  get localParticipant(): TransportParticipant | null {
    return this._localParticipant;
  }

  get remoteParticipants(): TransportParticipant[] {
    return Array.from(this._remoteParticipants.values());
  }

  get screenSharePub(): TransportTrackPublication | null {
    return this._screenSharePub;
  }

  get screenShareParticipant(): TransportParticipant | null {
    return this._screenShareParticipant;
  }

  async connect(options: TransportConnectOptions): Promise<void> {
    this.connectOptions = options;
    this.setState(ConnectionState.Connecting);

    this._localParticipant = new P2PParticipantAdapter(
      options.identity,
      options.displayName,
      true,
      options.isHost
    );

    try {
      // 1. Fetch ICE configuration from backend
      const iceConfig = await this.fetchIceConfig(options.roomCode, options.guestToken);

      // 2. Acquire local media stream (camera & mic)
      const { stream, error } = await createLocalMediaStream({
        audio: options.initialAudioEnabled,
        video: options.initialVideoEnabled,
        audioId: options.audioDeviceId,
        videoId: options.videoDeviceId,
      });

      if (error && !stream) {
        console.warn('P2P media stream notice:', error);
      }
      this.localStream = stream;

      // Register local tracks
      if (this.localStream) {
        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
          const adapter = new P2PTrackAdapter(audioTrack, 'audio', Track.Source.Microphone, !options.initialAudioEnabled);
          this._localParticipant.setTrackPublication(Track.Source.Microphone, {
            source: Track.Source.Microphone,
            isMuted: !options.initialAudioEnabled,
            track: adapter,
          });
        }

        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
          const adapter = new P2PTrackAdapter(videoTrack, 'video', Track.Source.Camera, !options.initialVideoEnabled);
          this._localParticipant.setTrackPublication(Track.Source.Camera, {
            source: Track.Source.Camera,
            isMuted: !options.initialVideoEnabled,
            track: adapter,
          });
        }
      }

      // 3. Initialize RTCPeerConnection with WebRTC config
      this.pc = new RTCPeerConnection({
        iceServers: iceConfig.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }],
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      });

      // 4. Attach local tracks to RTCPeerConnection
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => {
          const sender = this.pc!.addTrack(track, this.localStream!);
          if (track.kind === 'video') this.videoSender = sender;
          if (track.kind === 'audio') this.audioSender = sender;
        });
      }

      // Ensure transceivers exist so SDP offers always contain video and audio media descriptions
      if (!this.pc.getTransceivers().some((t) => t.receiver.track.kind === 'video')) {
        this.pc.addTransceiver('video', { direction: 'recvonly' });
      }
      if (!this.pc.getTransceivers().some((t) => t.receiver.track.kind === 'audio')) {
        this.pc.addTransceiver('audio', { direction: 'recvonly' });
      }

      // 5. Setup DataChannel for Chat, Reactions, Notes, Files & Mute signals
      this.setupDataChannel();

      // 6. Setup Perfect Negotiation and ICE Handlers
      this.setupPeerConnectionHandlers();

      // 7. Connect Signaling WebSocket
      await this.connectSignaling(options.roomCode, options.guestToken);

      // 8. Start Telemetry monitoring
      this.startStatsMonitoring();
    } catch (err: any) {
      console.error('P2P connect failed:', err);
      this.setState(ConnectionState.Disconnected);
      this.emit('fallback_required', err?.message || 'P2P setup failed');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.setState(ConnectionState.Disconnected);

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    if (this.screenStream) {
      stopMediaStream(this.screenStream);
      this.screenStream = null;
    }

    if (this.localStream) {
      stopMediaStream(this.localStream);
      this.localStream = null;
    }

    this._localParticipant = null;
    this._remoteParticipants.clear();
    this._screenSharePub = null;
    this._screenShareParticipant = null;
    this.pendingCandidates = [];

    this.emit('participants_changed');
  }

  async setMicrophoneEnabled(enabled: boolean, deviceId?: string): Promise<void> {
    if (!this.localStream) {
      if (enabled) {
        const { stream } = await createLocalMediaStream({ video: false, audio: true, audioId: deviceId });
        if (stream) {
          this.localStream = stream;
          const track = stream.getAudioTracks()[0];
          if (track && this.pc) {
            this.audioSender = this.pc.addTrack(track, this.localStream);
          }
        }
      }
    } else {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = enabled;
      }
    }

    if (this._localParticipant) {
      const pub = this._localParticipant.getTrackPublication(Track.Source.Microphone);
      if (pub) {
        pub.isMuted = !enabled;
        (pub.track as P2PTrackAdapter)?.setMuted(!enabled);
      }
      this._localParticipant.emit(enabled ? 'trackUnmuted' : 'trackMuted');
    }

    // Broadcast track mute event over DataChannel
    this.broadcastControlMessage({ type: 'track_mute', source: 'microphone', muted: !enabled });
    this.emit('participants_changed');
  }

  async setCameraEnabled(enabled: boolean, deviceId?: string): Promise<void> {
    if (!this.localStream) {
      if (enabled) {
        const { stream } = await createLocalMediaStream({ video: true, audio: false, videoId: deviceId });
        if (stream) {
          this.localStream = stream;
          const track = stream.getVideoTracks()[0];
          if (track && this.pc) {
            this.videoSender = this.pc.addTrack(track, this.localStream);
          }
        }
      }
    } else {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = enabled;
      }
    }

    if (this._localParticipant) {
      const pub = this._localParticipant.getTrackPublication(Track.Source.Camera);
      if (pub) {
        pub.isMuted = !enabled;
        (pub.track as P2PTrackAdapter)?.setMuted(!enabled);
      }
      this._localParticipant.emit(enabled ? 'trackUnmuted' : 'trackMuted');
    }

    // Broadcast track mute event over DataChannel
    this.broadcastControlMessage({ type: 'track_mute', source: 'camera', muted: !enabled });
    this.emit('participants_changed');
  }

  async switchCamera(deviceId: string): Promise<void> {
    if (!this.localStream) return;
    const oldTrack = this.localStream.getVideoTracks()[0];

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) return;

      if (this.videoSender) {
        await this.videoSender.replaceTrack(newTrack);
      }

      if (oldTrack) {
        oldTrack.stop();
        this.localStream.removeTrack(oldTrack);
      }
      this.localStream.addTrack(newTrack);

      if (this._localParticipant) {
        const pub = this._localParticipant.getTrackPublication(Track.Source.Camera);
        if (pub) {
          pub.track = new P2PTrackAdapter(newTrack, 'video', Track.Source.Camera, !newTrack.enabled);
        }
      }

      this.emit('participants_changed');
    } catch (err) {
      console.error('Failed to switch camera in P2P transport:', err);
    }
  }

  async startScreenShare(options?: ScreenShareOptions): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Screen sharing not supported on this browser');
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor',
          frameRate: options?.captureMode === 'motion' ? { ideal: 30, max: 30 } : { ideal: 15, max: 15 },
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
        } as any,
        audio: true,
      });

      this.screenStream = stream;
      const screenTrack = stream.getVideoTracks()[0];

      // Set content hint if supported
      if ('contentHint' in screenTrack) {
        (screenTrack as any).contentHint = options?.captureMode === 'motion' ? 'motion' : 'detail';
      }

      // Handle user stopping screen share via native browser bar
      screenTrack.onended = () => {
        this.stopScreenShare().catch(() => {});
      };

      // Replace or add track to RTCPeerConnection
      if (this.videoSender) {
        await this.videoSender.replaceTrack(screenTrack);
      } else if (this.pc) {
        this.videoSender = this.pc.addTrack(screenTrack, stream);
      }

      const trackAdapter = new P2PTrackAdapter(screenTrack, 'video', Track.Source.ScreenShare, false);
      const pub: TransportTrackPublication = {
        source: Track.Source.ScreenShare,
        isMuted: false,
        track: trackAdapter,
      };

      this._screenSharePub = pub;
      this._screenShareParticipant = this._localParticipant;

      this.broadcastControlMessage({ type: 'screen_share_start' });
      this.emit('participants_changed');
    } catch (err) {
      console.error('Failed to start screen share in P2P transport:', err);
      throw err;
    }
  }

  async stopScreenShare(): Promise<void> {
    if (this.screenStream) {
      stopMediaStream(this.screenStream);
      this.screenStream = null;
    }

    // Restore camera track if available
    const cameraTrack = this.localStream?.getVideoTracks()[0] || null;
    if (this.videoSender && cameraTrack) {
      await this.videoSender.replaceTrack(cameraTrack);
    }

    this._screenSharePub = null;
    this._screenShareParticipant = null;

    this.broadcastControlMessage({ type: 'screen_share_stop' });
    this.emit('participants_changed');
  }

  async sendData(topic: string, data: any): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      return;
    }
    const message = JSON.stringify({ topic, payload: data });
    this.dataChannel.send(message);
  }

  async getStats(): Promise<MediaTransportStats | null> {
    return this.latestStats;
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
        console.error('Error in P2PTransport listener:', err);
      }
    });
  }

  private setState(state: ConnectionState): void {
    if (this._state !== state) {
      this._state = state;
      this.emit('state_changed', state);
    }
  }

  private setupDataChannel(): void {
    if (!this.pc) return;

    this.dataChannel = this.pc.createDataChannel('tc-datachannel', { ordered: true });
    this.bindDataChannel(this.dataChannel);

    this.pc.ondatachannel = (event) => {
      this.bindDataChannel(event.channel);
    };
  }

  private bindDataChannel(channel: RTCDataChannel): void {
    channel.onopen = () => {
      this.setState(ConnectionState.Connected);
    };

    channel.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.control) {
          this.handleControlMessage(parsed.control);
          return;
        }

        if (parsed.topic) {
          const payloadBytes = new TextEncoder().encode(JSON.stringify(parsed.payload));
          let remoteParticipant = Array.from(this._remoteParticipants.values())[0];
          if (!remoteParticipant) {
            remoteParticipant = new P2PParticipantAdapter('peer:remote', 'Participant', false);
            this._remoteParticipants.set(remoteParticipant.identity, remoteParticipant);
          }
          this.emit('data_received', payloadBytes, remoteParticipant, parsed.topic);
        }
      } catch (err) {
        console.error('Failed to parse incoming DataChannel packet:', err);
      }
    };
  }

  private broadcastControlMessage(control: any): void {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify({ control }));
    }
  }

  private handleControlMessage(control: any): void {
    const remote = Array.from(this._remoteParticipants.values())[0];
    if (!remote) return;

    if (control.type === 'track_mute') {
      const source = control.source === 'camera' ? Track.Source.Camera : Track.Source.Microphone;
      const pub = remote.getTrackPublication(source);
      if (pub) {
        pub.isMuted = Boolean(control.muted);
        (pub.track as P2PTrackAdapter)?.setMuted(Boolean(control.muted));
      }
      remote.emit(control.muted ? 'trackMuted' : 'trackUnmuted');
      this.emit('participants_changed');
    } else if (control.type === 'screen_share_start') {
      const videoPub = remote.getTrackPublication(Track.Source.Camera);
      if (videoPub && videoPub.track) {
        this._screenSharePub = {
          source: Track.Source.ScreenShare,
          isMuted: false,
          track: videoPub.track,
        };
        this._screenShareParticipant = remote;
        this.emit('participants_changed');
      }
    } else if (control.type === 'screen_share_stop') {
      this._screenSharePub = null;
      this._screenShareParticipant = null;
      this.emit('participants_changed');
    }
  }

  // W3C Perfect Negotiation Pattern Implementation
  private setupPeerConnectionHandlers(): void {
    if (!this.pc) return;

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc!.setLocalDescription();
        this.sendSignalingMessage({
          type: 'offer',
          sdp: this.pc!.localDescription?.sdp,
        });
      } catch (err) {
        console.error('P2P negotiation needed error:', err);
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignalingMessage({
          type: 'candidate',
          candidate: event.candidate.toJSON(),
        });
      }
    };

    this.pc.ontrack = (event) => {
      const track = event.track;
      let remote = Array.from(this._remoteParticipants.values())[0];
      if (!remote) {
        remote = new P2PParticipantAdapter('peer:remote', 'Remote Participant', false);
        this._remoteParticipants.set(remote.identity, remote);
      }

      const source = track.kind === 'video' ? Track.Source.Camera : Track.Source.Microphone;
      const adapter = new P2PTrackAdapter(track, track.kind as any, source, !track.enabled);

      remote.setTrackPublication(source, {
        source,
        isMuted: !track.enabled,
        track: adapter,
      });

      track.onmute = () => {
        const pub = remote.getTrackPublication(source);
        if (pub) pub.isMuted = true;
        remote.emit('trackMuted');
        this.emit('participants_changed');
      };

      track.onunmute = () => {
        const pub = remote.getTrackPublication(source);
        if (pub) pub.isMuted = false;
        remote.emit('trackUnmuted');
        this.emit('participants_changed');
      };

      this.emit('participants_changed');
    };

    this.pc.oniceconnectionstatechange = () => {
      const iceState = this.pc?.iceConnectionState;
      if (iceState === 'connected' || iceState === 'completed') {
        this.setState(ConnectionState.Connected);
      } else if (iceState === 'disconnected') {
        this.setState(ConnectionState.Reconnecting);
      } else if (iceState === 'failed') {
        // Attempt ICE restart once
        try {
          if (this.pc && 'restartIce' in this.pc) {
            (this.pc as any).restartIce();
          }
        } catch {
          // Restart unsupported
        }

        setTimeout(() => {
          if (this.pc?.iceConnectionState === 'failed') {
            this.setState(ConnectionState.Disconnected);
            this.emit('fallback_required', 'ICE connection failed; falling back to SFU');
          }
        }, 6000);
      }
    };
  }

  private async connectSignaling(roomCode: string, guestToken?: string): Promise<void> {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let host = window.location.host;
    if (process.env.NEXT_PUBLIC_API_URL) {
      try {
        const u = new URL(process.env.NEXT_PUBLIC_API_URL);
        host = u.host;
      } catch {
        // Fallback
      }
    }
    let url = `${wsProto}//${host}/api/v1/rooms/${roomCode}/p2p/ws`;
    const params = new URLSearchParams();
    if (guestToken) {
      params.set('guest_token', guestToken);
    }
    if (this._localParticipant?.name) {
      params.set('display_name', this._localParticipant.name);
    }
    const q = params.toString();
    if (q) {
      url += `?${q}`;
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.sendSignalingMessage({ type: 'ready' });
        resolve();
      };

      ws.onerror = (err) => {
        console.error('Signaling WebSocket error:', err);
        reject(new Error('Signaling connection error'));
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          await this.handleSignalingMessage(msg);
        } catch (err) {
          console.error('Error handling signaling message:', err);
        }
      };

      ws.onclose = () => {
        if (this._state === ConnectionState.Connected) {
          this.setState(ConnectionState.Disconnected);
        }
      };
    });
  }

  private async handleSignalingMessage(msg: any): Promise<void> {
    if (!this.pc) return;

    switch (msg.type) {
      case 'role':
        this.isPolite = msg.role === 'polite';
        if (!this.isPolite && this._remoteParticipants.size > 0 && this.pc && this.pc.signalingState === 'stable') {
          try {
            this.makingOffer = true;
            this.pc.setLocalDescription().then(() => {
              this.sendSignalingMessage({
                type: 'offer',
                sdp: this.pc?.localDescription?.sdp,
              });
            }).catch(console.error);
          } finally {
            this.makingOffer = false;
          }
        }
        break;

      case 'peer_joined': {
        const displayName = msg.displayName || 'Remote Participant';
        if (!this._remoteParticipants.has(msg.senderId)) {
          const remote = new P2PParticipantAdapter(msg.senderId, displayName, false);
          this._remoteParticipants.set(msg.senderId, remote);
          this.emit('participants_changed');
        } else {
          const existing = this._remoteParticipants.get(msg.senderId);
          if (existing) {
            (existing as any).name = displayName;
            this.emit('participants_changed');
          }
        }

        if (!this.isPolite && this.pc && this.pc.signalingState === 'stable') {
          try {
            this.makingOffer = true;
            this.pc.setLocalDescription().then(() => {
              this.sendSignalingMessage({
                type: 'offer',
                sdp: this.pc?.localDescription?.sdp,
              });
            }).catch(console.error);
          } finally {
            this.makingOffer = false;
          }
        }
        break;
      }

      case 'peer_left':
        if (msg.senderId && this._remoteParticipants.has(msg.senderId)) {
          this._remoteParticipants.delete(msg.senderId);
          this.emit('participants_changed');
        }
        break;

      case 'offer': {
        const offerCollision =
          this.makingOffer || this.pc.signalingState !== 'stable';
        this.ignoreOffer = !this.isPolite && offerCollision;
        if (this.ignoreOffer) {
          return;
        }

        this.isSettingRemoteAnswerPending = false;
        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: msg.sdp }));
        await this.drainPendingCandidates();

        await this.pc.setLocalDescription();
        this.sendSignalingMessage({
          type: 'answer',
          sdp: this.pc.localDescription?.sdp,
        });
        break;
      }

      case 'answer': {
        this.isSettingRemoteAnswerPending = false;
        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }));
        await this.drainPendingCandidates();
        break;
      }

      case 'candidate': {
        if (msg.candidate) {
          const candidate = new RTCIceCandidate(msg.candidate);
          if (this.pc.remoteDescription && this.pc.remoteDescription.type) {
            await this.pc.addIceCandidate(candidate);
          } else {
            this.pendingCandidates.push(msg.candidate);
          }
        }
        break;
      }

      case 'fallback_to_sfu':
        this.emit('fallback_required', msg.reason || 'Server requested fallback to SFU');
        break;
    }
  }

  private async drainPendingCandidates(): Promise<void> {
    if (!this.pc) return;
    for (const cand of this.pendingCandidates) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        console.warn('Failed to add queued ICE candidate:', err);
      }
    }
    this.pendingCandidates = [];
  }

  private sendSignalingMessage(msg: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private async fetchIceConfig(roomCode: string, guestToken?: string): Promise<{ iceServers: any[] }> {
    try {
      const headers: Record<string, string> = {};
      if (guestToken) {
        headers['X-Guest-Token'] = guestToken;
      }
      const res = await fetch(`/api/v1/rooms/${roomCode}/p2p/config`, {
        headers,
        credentials: 'same-origin',
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Fallback to Google STUN
    }
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    };
  }

  private startStatsMonitoring(): void {
    if (this.statsInterval) clearInterval(this.statsInterval);

    this.statsInterval = setInterval(async () => {
      if (!this.pc || this.pc.iceConnectionState !== 'connected') return;

      try {
        const stats = await this.pc.getStats();
        let rttMs = 0;
        let jitterMs = 0;
        let packetsLost = 0;
        let resolution = { width: 0, height: 0 };
        let frameRate = 0;
        let candidateType: 'host' | 'srflx' | 'prflx' | 'relay' | 'unknown' = 'unknown';
        let isRelayed = false;
        let bytesReceived = 0;

        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            rttMs = Math.round((report.currentRoundTripTime || 0) * 1000);
          }
          if (report.type === 'remote-candidate') {
            candidateType = (report.candidateType as any) || 'unknown';
            if (candidateType === 'relay') isRelayed = true;
          }
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            jitterMs = Math.round((report.jitter || 0) * 1000);
            packetsLost = report.packetsLost || 0;
            resolution = { width: report.frameWidth || 0, height: report.frameHeight || 0 };
            frameRate = Math.round(report.framesPerSecond || 0);
            bytesReceived += report.bytesReceived || 0;
          }
        });

        // Compute bitrate
        const now = Date.now();
        let bitrateKbps = 0;
        if (this.prevTimestamp > 0 && now > this.prevTimestamp) {
          const deltaBits = (bytesReceived - this.prevBytesReceived) * 8;
          const deltaSec = (now - this.prevTimestamp) / 1000;
          bitrateKbps = Math.round(deltaBits / deltaSec / 1000);
        }
        this.prevBytesReceived = bytesReceived;
        this.prevTimestamp = now;

        this.latestStats = {
          transportType: 'p2p',
          rttMs: rttMs > 0 ? rttMs : 0,
          jitterMs: jitterMs > 0 ? jitterMs : 0,
          packetsLost,
          resolution: resolution.width > 0 && resolution.height > 0 ? resolution : null,
          frameRate: frameRate > 0 ? frameRate : null,
          bitrateKbps,
          inboundBitrateKbps: bitrateKbps,
          outboundBitrateKbps: 0,
          candidateType,
          isRelayed,
          timestamp: now,
        };
      } catch {
        // Non-blocking telemetry
      }
    }, 2000);
  }
}
