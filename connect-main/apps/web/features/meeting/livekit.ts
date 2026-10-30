import { RoomOptions, VideoPresets, ScreenSharePresets, Track } from 'livekit-client';

export const LIVEKIT_ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: {
    resolution: VideoPresets.h720.resolution,
    facingMode: 'user',
  },
  audioCaptureDefaults: {
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: true,
    channelCount: 1,
    sampleRate: 48000,
  },
  publishDefaults: {
    simulcast: true,
    videoCodec: 'vp8',
    videoEncoding: VideoPresets.h720.encoding,
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
    audioPreset: {
      maxBitrate: 36_000, // 36 kbps high-definition speech (Opus)
    },
    dtx: true, // Discontinuous transmission: save bandwidth during silence
    red: true, // Audio redundancy RFC 2198: zero-delay recovery under packet loss
    screenShareEncoding: {
      maxBitrate: 3_000_000, // 3.0 Mbps for crisp 1080p text, diagrams & slides
      maxFramerate: 30,
    },
    screenShareSimulcastLayers: [ScreenSharePresets.h720fps15],
  },
};

export const SCREEN_SHARE_PRESETS = {
  detail: {
    resolution: {
      width: 1920,
      height: 1080,
    },
    encoding: {
      maxBitrate: 3_000_000,
      maxFramerate: 15,
    },
    contentHint: 'detail',
  },
  motion: {
    resolution: {
      width: 1920,
      height: 1080,
    },
    encoding: {
      maxBitrate: 3_500_000,
      maxFramerate: 30,
    },
    contentHint: 'motion',
  },
};

