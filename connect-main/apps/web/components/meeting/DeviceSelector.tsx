'use client';

import React from 'react';
import { Camera, Mic, Volume2 } from 'lucide-react';
import { DeviceInfo } from '@/features/meeting/media';

interface DeviceSelectorProps {
  videoDevices: DeviceInfo[];
  audioInputDevices: DeviceInfo[];
  audioOutputDevices: DeviceInfo[];
  selectedVideoId: string;
  selectedAudioId: string;
  selectedOutputId: string;
  onSelectVideo: (deviceId: string) => void;
  onSelectAudio: (deviceId: string) => void;
  onSelectOutput: (deviceId: string) => void;
  hasAudioOutputSupport: boolean;
}

export const DeviceSelector: React.FC<DeviceSelectorProps> = ({
  videoDevices,
  audioInputDevices,
  audioOutputDevices,
  selectedVideoId,
  selectedAudioId,
  selectedOutputId,
  onSelectVideo,
  onSelectAudio,
  onSelectOutput,
  hasAudioOutputSupport,
}) => {
  return (
    <div className="space-y-4">
      {/* Camera Selection */}
      <div>
        <label className="flex items-center gap-2 text-xs font-semibold text-[#171717] mb-1.5 uppercase tracking-wider">
          <Camera className="w-3.5 h-3.5 text-[#7258E8]" />
          <span>Camera</span>
        </label>
        <select
          value={selectedVideoId}
          onChange={(e) => onSelectVideo(e.target.value)}
          disabled={videoDevices.length === 0}
          className="w-full px-3 py-2 rounded-xl border border-[#E9E9E5] bg-white text-sm text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#7258E8] disabled:bg-[#F5F5F3] disabled:text-[#888888] transition-all"
        >
          {videoDevices.length === 0 ? (
            <option value="">No cameras detected</option>
          ) : (
            videoDevices.map((dev) => (
              <option key={dev.deviceId} value={dev.deviceId}>
                {dev.label || `Camera (${dev.deviceId.slice(0, 5)}...)`}
              </option>
            ))
          )}
        </select>
      </div>

      {/* Microphone Selection */}
      <div>
        <label className="flex items-center gap-2 text-xs font-semibold text-[#171717] mb-1.5 uppercase tracking-wider">
          <Mic className="w-3.5 h-3.5 text-[#7258E8]" />
          <span>Microphone</span>
        </label>
        <select
          value={selectedAudioId}
          onChange={(e) => onSelectAudio(e.target.value)}
          disabled={audioInputDevices.length === 0}
          className="w-full px-3 py-2 rounded-xl border border-[#E9E9E5] bg-white text-sm text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#7258E8] disabled:bg-[#F5F5F3] disabled:text-[#888888] transition-all"
        >
          {audioInputDevices.length === 0 ? (
            <option value="">No microphones detected</option>
          ) : (
            audioInputDevices.map((dev) => (
              <option key={dev.deviceId} value={dev.deviceId}>
                {dev.label || `Microphone (${dev.deviceId.slice(0, 5)}...)`}
              </option>
            ))
          )}
        </select>
      </div>

      {/* Speaker Output Selection (Only if supported by browser) */}
      {hasAudioOutputSupport && (
        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-[#171717] mb-1.5 uppercase tracking-wider">
            <Volume2 className="w-3.5 h-3.5 text-[#7258E8]" />
            <span>Speaker / Output</span>
          </label>
          <select
            value={selectedOutputId}
            onChange={(e) => onSelectOutput(e.target.value)}
            disabled={audioOutputDevices.length === 0}
            className="w-full px-3 py-2 rounded-xl border border-[#E9E9E5] bg-white text-sm text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#7258E8] disabled:bg-[#F5F5F3] disabled:text-[#888888] transition-all"
          >
            {audioOutputDevices.length === 0 ? (
              <option value="">Default System Speaker</option>
            ) : (
              audioOutputDevices.map((dev) => (
                <option key={dev.deviceId} value={dev.deviceId}>
                  {dev.label || `Speaker (${dev.deviceId.slice(0, 5)}...)`}
                </option>
              ))
            )}
          </select>
        </div>
      )}
    </div>
  );
};
