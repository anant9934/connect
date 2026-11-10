'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Camera, CameraOff, Mic, MicOff, RefreshCw, AlertCircle, Settings, Volume2 } from 'lucide-react';
import { createAudioMeter } from '@/features/meeting/audioMeter';

interface DevicePreviewProps {
  stream: MediaStream | null;
  videoEnabled: boolean;
  audioEnabled: boolean;
  onToggleVideo: () => void;
  onToggleAudio: () => void;
  onSwitchCamera?: () => void;
  canSwitchCamera?: boolean;
  onOpenSettings?: () => void;
  displayName?: string;
  isFrontCamera?: boolean;
  cameraBlocked?: boolean;
  micBlocked?: boolean;
  onRequestHelp?: (device: 'camera' | 'microphone') => void;
}

export const DevicePreview: React.FC<DevicePreviewProps> = ({
  stream,
  videoEnabled,
  audioEnabled,
  onToggleVideo,
  onToggleAudio,
  onSwitchCamera,
  canSwitchCamera = false,
  onOpenSettings,
  displayName,
  isFrontCamera = true,
  cameraBlocked = false,
  micBlocked = false,
  onRequestHelp,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [audioVolume, setAudioVolume] = useState<number>(0);

  // Sync stream to video element
  useEffect(() => {
    if (videoRef.current) {
      if (stream && videoEnabled) {
        videoRef.current.srcObject = stream;
      } else {
        videoRef.current.srcObject = null;
      }
    }
  }, [stream, videoEnabled]);

  // Google Meet-style Live Audio Level Meter
  useEffect(() => {
    if (!stream || !audioEnabled || micBlocked) {
      setAudioVolume(0);
      return;
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack || audioTrack.readyState !== 'live') {
      setAudioVolume(0);
      return;
    }

    const meter = createAudioMeter(audioTrack, (vol) => {
      setAudioVolume(vol);
    });

    return () => {
      meter.stop();
      setAudioVolume(0);
    };
  }, [stream, audioEnabled, micBlocked]);

  const initials = displayName
    ? displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'U';

  const handleMicClick = () => {
    if (micBlocked && onRequestHelp) {
      onRequestHelp('microphone');
    } else {
      onToggleAudio();
    }
  };

  const handleCameraClick = () => {
    if (cameraBlocked && onRequestHelp) {
      onRequestHelp('camera');
    } else {
      onToggleVideo();
    }
  };

  return (
    <div
      id="device-preview-container"
      data-testid="device-preview-container"
      className="relative w-full aspect-[4/3] sm:aspect-video max-h-[320px] sm:max-h-[380px] rounded-2xl bg-[#171717] overflow-hidden flex items-center justify-center border border-[#262626] shadow-sm select-none"
    >
      {/* Live Video Element */}
      {videoEnabled && stream ? (
        <video
          id="camera-preview-video"
          data-testid="camera-preview-video"
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            isFrontCamera ? '-scale-x-100' : ''
          }`}
        />
      ) : (
        /* Video Off Fallback Avatar & Clean Status */
        <div className="flex flex-col items-center justify-center text-center px-6 pt-6 pb-16 space-y-2.5">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#2A2A2A] text-white flex items-center justify-center text-xl sm:text-2xl font-bold border border-[#404040]">
            {initials}
          </div>
          <p className="text-xs text-[#A0A0A0]">
            {cameraBlocked ? 'Camera access is blocked' : 'Camera is off'}
          </p>
          {cameraBlocked && onRequestHelp && (
            <button
              type="button"
              onClick={() => onRequestHelp('camera')}
              className="text-[11px] font-medium text-[#A78BFA] hover:text-white underline mt-1"
            >
              How to enable in browser
            </button>
          )}
        </div>
      )}

      {/* Top Left: Live Status & Audio Meter */}
      <div className="absolute top-3 left-3 flex items-center gap-2 z-10">
        {videoEnabled && stream && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md text-white text-[11px] font-medium border border-white/10">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Camera on
          </span>
        )}

        {/* Real-time Google Meet Microphone Volume Wave Indicator */}
        {audioEnabled && !micBlocked && (
          <div
            className="flex items-center gap-0.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md text-white text-[11px] font-medium border border-white/10"
            title={`Mic volume: ${audioVolume}%`}
          >
            <Mic className="w-3 h-3 text-emerald-400 mr-1" />
            <div className="flex items-end gap-[2px] h-3">
              <span
                className={`w-1 rounded-full transition-all duration-75 ${
                  audioVolume > 5 ? 'h-3 bg-emerald-400' : 'h-1.5 bg-white/30'
                }`}
              />
              <span
                className={`w-1 rounded-full transition-all duration-75 ${
                  audioVolume > 25 ? 'h-3 bg-emerald-400' : 'h-1.5 bg-white/30'
                }`}
              />
              <span
                className={`w-1 rounded-full transition-all duration-75 ${
                  audioVolume > 55 ? 'h-3.5 bg-emerald-400' : 'h-1.5 bg-white/30'
                }`}
              />
            </div>
          </div>
        )}
      </div>

      {/* Top Right: Switch Camera & Settings Buttons */}
      <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
        {canSwitchCamera && onSwitchCamera && videoEnabled && stream && (
          <button
            type="button"
            onClick={onSwitchCamera}
            className="p-2.5 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-md transition-all shadow-md active:scale-90"
            title="Switch camera"
            aria-label="Switch camera"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}

        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-2.5 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-md transition-all shadow-md active:scale-90"
            title="Audio & video settings"
            aria-label="Audio & video settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Floating Preview Controls (Dedicated bottom control zone) */}
      <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-3 z-10">
        {/* Microphone Control */}
        <div className="relative">
          <button
            id="preview-mic-btn"
            data-testid="preview-mic-btn"
            type="button"
            onClick={handleMicClick}
            className={`p-3 rounded-full transition-all shadow-md min-w-[46px] min-h-[46px] flex items-center justify-center active:scale-95 ${
              audioEnabled && !micBlocked
                ? 'bg-[#2A2A2A]/90 hover:bg-[#3A3A3A] text-white'
                : 'bg-[#D32F2F] hover:bg-[#B71C1C] text-white'
            }`}
            aria-label={
              micBlocked
                ? 'Microphone blocked — tap for help'
                : audioEnabled
                ? 'Mute microphone'
                : 'Unmute microphone'
            }
            title={
              micBlocked
                ? 'Microphone blocked — tap for help'
                : audioEnabled
                ? 'Mute microphone'
                : 'Unmute microphone'
            }
          >
            {audioEnabled && !micBlocked ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>
          {micBlocked && (
            <span
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-black flex items-center justify-center shadow-xs pointer-events-none"
              title="Microphone permission blocked"
            >
              <AlertCircle className="w-3 h-3 text-black" />
            </span>
          )}
        </div>

        {/* Camera Control */}
        <div className="relative">
          <button
            id="preview-camera-btn"
            data-testid="preview-camera-btn"
            type="button"
            onClick={handleCameraClick}
            className={`p-3 rounded-full transition-all shadow-md min-w-[46px] min-h-[46px] flex items-center justify-center active:scale-95 ${
              videoEnabled && !cameraBlocked
                ? 'bg-[#2A2A2A]/90 hover:bg-[#3A3A3A] text-white'
                : 'bg-[#D32F2F] hover:bg-[#B71C1C] text-white'
            }`}
            aria-label={
              cameraBlocked
                ? 'Camera blocked — tap for help'
                : videoEnabled
                ? 'Turn off camera'
                : 'Turn on camera'
            }
            title={
              cameraBlocked
                ? 'Camera blocked — tap for help'
                : videoEnabled
                ? 'Turn off camera'
                : 'Turn on camera'
            }
          >
            {videoEnabled && !cameraBlocked ? <Camera className="w-5 h-5" /> : <CameraOff className="w-5 h-5" />}
          </button>
          {cameraBlocked && (
            <span
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-black flex items-center justify-center shadow-xs pointer-events-none"
              title="Camera permission blocked"
            >
              <AlertCircle className="w-3 h-3 text-black" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
