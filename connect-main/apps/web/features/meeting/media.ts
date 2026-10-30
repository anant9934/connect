import { DevicePermissionState } from './permissions/types';

export interface DeviceInfo {
  deviceId: string;
  label: string;
}

export interface MediaPermissions {
  video: boolean;
  audio: boolean;
  videoError?: string;
  audioError?: string;
}

export const DEFAULT_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  frameRate: { ideal: 30, max: 30 },
  aspectRatio: { ideal: 1.7777777778 },
  facingMode: { ideal: 'user' },
};

export const DEFAULT_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48000 },
  sampleSize: { ideal: 16 },
  ...({
    googEchoCancellation: true,
    googAutoGainControl: true,
    googNoiseSuppression: true,
    googHighpassFilter: true,
  } as any),
};

export function parseMediaError(err: any, deviceType: 'camera' | 'microphone'): { state: DevicePermissionState; message: string } {
  const name = err?.name || '';
  const isCam = deviceType === 'camera';
  const deviceName = isCam ? 'Camera' : 'Microphone';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      state: 'denied',
      message: `${deviceName} permission was blocked. Please allow ${isCam ? 'camera' : 'microphone'} access in your browser settings.`,
    };
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      state: 'unavailable',
      message: `No ${isCam ? 'camera' : 'microphone'} device was found on this system.`,
    };
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      state: 'device-busy',
      message: `${deviceName} is currently in use by another application.`,
    };
  }

  if (name === 'OverconstrainedError') {
    return {
      state: 'unavailable',
      message: `Requested ${isCam ? 'camera' : 'microphone'} settings are not supported by this device.`,
    };
  }

  if (name === 'SecurityError') {
    return {
      state: 'policy-blocked',
      message: `${deviceName} access is blocked by security policy or permissions context.`,
    };
  }

  return {
    state: 'denied',
    message: `Unable to access ${isCam ? 'camera' : 'microphone'}.`,
  };
}

export async function getMediaDevices(): Promise<{
  videoDevices: DeviceInfo[];
  audioInputDevices: DeviceInfo[];
  audioOutputDevices: DeviceInfo[];
}> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return { videoDevices: [], audioInputDevices: [], audioOutputDevices: [] };
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices: DeviceInfo[] = [];
    const audioInputDevices: DeviceInfo[] = [];
    const audioOutputDevices: DeviceInfo[] = [];

    devices.forEach((device) => {
      const info: DeviceInfo = {
        deviceId: device.deviceId,
        label: device.label || `${device.kind} (${device.deviceId.slice(0, 5)}...)`,
      };
      if (device.kind === 'videoinput') {
        videoDevices.push(info);
      } else if (device.kind === 'audioinput') {
        audioInputDevices.push(info);
      } else if (device.kind === 'audiooutput') {
        audioOutputDevices.push(info);
      }
    });

    return { videoDevices, audioInputDevices, audioOutputDevices };
  } catch {
    return { videoDevices: [], audioInputDevices: [], audioOutputDevices: [] };
  }
}

/**
 * Acquire camera track independently
 */
export async function acquireCameraTrack(videoId?: string): Promise<{
  track: MediaStreamTrack | null;
  state: DevicePermissionState;
  error?: string;
}> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { track: null, state: 'unsupported', error: 'Media devices not supported in this browser' };
  }

  // Tier 1: Ideal constraints with deviceId if provided
  const tier1Constraints: MediaStreamConstraints = {
    video: {
      ...DEFAULT_VIDEO_CONSTRAINTS,
      ...(videoId ? { deviceId: { ideal: videoId } } : {}),
    },
    audio: false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(tier1Constraints);
    const track = stream.getVideoTracks()[0] || null;
    return { track, state: 'granted' };
  } catch (err1: any) {
    if (err1.name === 'NotAllowedError' || err1.name === 'PermissionDeniedError' || err1.name === 'SecurityError') {
      const parsed = parseMediaError(err1, 'camera');
      return { track: null, state: parsed.state, error: parsed.message };
    }

    // Tier 2: Relaxed fallback
    try {
      const tier2Constraints: MediaStreamConstraints = {
        video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(tier2Constraints);
      const track = stream.getVideoTracks()[0] || null;
      return { track, state: 'granted' };
    } catch (err2: any) {
      if (err2.name === 'NotAllowedError' || err2.name === 'PermissionDeniedError' || err2.name === 'SecurityError') {
        const parsed = parseMediaError(err2, 'camera');
        return { track: null, state: parsed.state, error: parsed.message };
      }

      // Tier 3: Minimal unconstrained video
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const track = stream.getVideoTracks()[0] || null;
        return { track, state: 'granted' };
      } catch (err3: any) {
        const parsed = parseMediaError(err3, 'camera');
        return { track: null, state: parsed.state, error: parsed.message };
      }
    }
  }
}

/**
 * Acquire microphone track independently
 */
export async function acquireMicrophoneTrack(audioId?: string): Promise<{
  track: MediaStreamTrack | null;
  state: DevicePermissionState;
  error?: string;
}> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { track: null, state: 'unsupported', error: 'Media devices not supported in this browser' };
  }

  // Tier 1: Ideal constraints with deviceId if provided
  const tier1Constraints: MediaStreamConstraints = {
    audio: {
      ...DEFAULT_AUDIO_CONSTRAINTS,
      ...(audioId ? { deviceId: { ideal: audioId } } : {}),
    },
    video: false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(tier1Constraints);
    const track = stream.getAudioTracks()[0] || null;
    return { track, state: 'granted' };
  } catch (err1: any) {
    if (err1.name === 'NotAllowedError' || err1.name === 'PermissionDeniedError' || err1.name === 'SecurityError') {
      const parsed = parseMediaError(err1, 'microphone');
      return { track: null, state: parsed.state, error: parsed.message };
    }

    // Tier 2: Relaxed fallback
    try {
      const tier2Constraints: MediaStreamConstraints = {
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(tier2Constraints);
      const track = stream.getAudioTracks()[0] || null;
      return { track, state: 'granted' };
    } catch (err2: any) {
      if (err2.name === 'NotAllowedError' || err2.name === 'PermissionDeniedError' || err2.name === 'SecurityError') {
        const parsed = parseMediaError(err2, 'microphone');
        return { track: null, state: parsed.state, error: parsed.message };
      }

      // Tier 3: Minimal audio
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const track = stream.getAudioTracks()[0] || null;
        return { track, state: 'granted' };
      } catch (err3: any) {
        const parsed = parseMediaError(err3, 'microphone');
        return { track: null, state: parsed.state, error: parsed.message };
      }
    }
  }
}

export interface LocalMediaStreamResult {
  stream: MediaStream | null;
  cameraTrack?: MediaStreamTrack | null;
  audioTrack?: MediaStreamTrack | null;
  cameraState?: DevicePermissionState;
  microphoneState?: DevicePermissionState;
  cameraError?: string;
  microphoneError?: string;
  error?: string;
}

export async function createLocalMediaStream(options: {
  video: boolean;
  audio: boolean;
  videoId?: string;
  audioId?: string;
}): Promise<LocalMediaStreamResult> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return {
      stream: null,
      cameraState: 'unsupported',
      microphoneState: 'unsupported',
      error: 'Media devices not supported in this environment',
    };
  }

  if (!options.video && !options.audio) {
    return { stream: null, cameraState: 'prompt', microphoneState: 'prompt' };
  }

  // If only one device is requested, acquire that device directly
  if (options.video && !options.audio) {
    const cam = await acquireCameraTrack(options.videoId);
    if (cam.track) {
      const stream = new MediaStream([cam.track]);
      return { stream, cameraTrack: cam.track, cameraState: 'granted' };
    }
    return {
      stream: null,
      cameraState: cam.state,
      cameraError: cam.error,
      error: cam.error,
    };
  }

  if (!options.video && options.audio) {
    const mic = await acquireMicrophoneTrack(options.audioId);
    if (mic.track) {
      const stream = new MediaStream([mic.track]);
      return { stream, audioTrack: mic.track, microphoneState: 'granted' };
    }
    return {
      stream: null,
      microphoneState: mic.state,
      microphoneError: mic.error,
      error: mic.error,
    };
  }

  // Both video and audio requested: attempt combined capture first
  const tier1Constraints: MediaStreamConstraints = {
    video: {
      ...DEFAULT_VIDEO_CONSTRAINTS,
      ...(options.videoId ? { deviceId: { ideal: options.videoId } } : {}),
    },
    audio: {
      ...DEFAULT_AUDIO_CONSTRAINTS,
      ...(options.audioId ? { deviceId: { ideal: options.audioId } } : {}),
    },
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(tier1Constraints);
    const cameraTrack = stream.getVideoTracks()[0] || null;
    const audioTrack = stream.getAudioTracks()[0] || null;
    return {
      stream,
      cameraTrack,
      audioTrack,
      cameraState: cameraTrack ? 'granted' : 'unknown',
      microphoneState: audioTrack ? 'granted' : 'unknown',
    };
  } catch (errCombined: any) {
    // If combined acquisition fails, ATTEMPT INDEPENDENT ACQUISITION!
    // A camera denial MUST NOT disable a working microphone!
    // A microphone denial MUST NOT disable a working camera!
    const [camResult, micResult] = await Promise.all([
      acquireCameraTrack(options.videoId),
      acquireMicrophoneTrack(options.audioId),
    ]);

    const tracks: MediaStreamTrack[] = [];
    if (camResult.track) tracks.push(camResult.track);
    if (micResult.track) tracks.push(micResult.track);

    const stream = tracks.length > 0 ? new MediaStream(tracks) : null;
    const combinedError = camResult.error || micResult.error || 'Failed to acquire media devices';

    return {
      stream,
      cameraTrack: camResult.track,
      audioTrack: micResult.track,
      cameraState: camResult.state,
      microphoneState: micResult.state,
      cameraError: camResult.error,
      microphoneError: micResult.error,
      error: stream ? undefined : combinedError,
    };
  }
}

export function stopMediaStream(stream: MediaStream | null) {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // safe ignore
    }
  });
}
