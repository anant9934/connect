'use client';

import React, { useRef, useEffect } from 'react';
import { Camera, CameraOff, Mic, MicOff, RefreshCw, AlertCircle } from 'lucide-react';

interface DevicePreviewProps {
  stream: MediaStream | null;
  videoEnabled: boolean;
  audioEnabled: boolean;
  onToggleVideo: () => void;
  onToggleAudio: () => void;
  onSwitchCamera?: () => void;
  canSwitchCamera?: boolean;
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
  displayName,
  isFrontCamera = true,
  cameraBlocked = false,
  micBlocked = false,
  onRequestHelp,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      if (stream && videoEnabled) {
        videoRef.current.srcObject = stream;
      } else {
        videoRef.current.srcObject = null;
      }
    }
  }, [stream, videoEnabled]);

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
      className="relative w-full aspect-video max-h-[320px] sm:max-h-[380px] rounded-2xl bg-[#171717] overflow-hidden flex items-center justify-center border border-[#262626] shadow-sm select-none"
    >
      {/* Live Video Element */}
      {videoEnabled && stream ? (
        <video
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
        <div className="flex flex-col items-center justify-center text-center p-6 space-y-2.5">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#2A2A2A] text-white flex items-center justify-center text-xl sm:text-2xl font-bold border border-[#404040]">
            {initials}
          </div>
          <p className="text-xs text-[#A0A0A0]">
            {cameraBlocked ? 'Camera blocked' : 'Camera is off'}
          </p>
        </div>
      )}

      {/* Switch Camera Button (Front/Rear on mobile) */}
      {canSwitchCamera && onSwitchCamera && videoEnabled && stream && (
        <button
          type="button"
          onClick={onSwitchCamera}
          className="absolute top-3 right-3 p-2.5 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-md transition-all shadow-md z-10 active:scale-90"
          title="Switch camera"
          aria-label="Switch camera"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      )}

      {/* Floating Preview Controls (Dedicated bottom control zone, never covering video) */}
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
