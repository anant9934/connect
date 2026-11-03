'use client';

import React, { useState } from 'react';
import { Camera, Mic, Volume2, Play, Check } from 'lucide-react';
import { DeviceInfo } from '@/features/meeting/media';
import { playSpeakerTestChime } from '@/features/meeting/audioMeter';

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
  const [testingSpeaker, setTestingSpeaker] = useState(false);

  const handleTestSpeaker = async () => {
    if (testingSpeaker) return;
    setTestingSpeaker(true);
    try {
      await playSpeakerTestChime(selectedOutputId || undefined);
    } catch {
      // safe ignore
    } finally {
      setTimeout(() => setTestingSpeaker(false), 800);
    }
  };

  return (
    <div className="space-y-4 text-left">
      {/* Camera Selection */}
      <div>
        <label className="flex items-center gap-2 text-xs font-semibold text-[#171717] mb-1.5 uppercase tracking-wider">
          <Camera className="w-3.5 h-3.5 text-[#7258E8]" />
          <span>Camera</span>
        </label>
        <select
          id="device-selector-video"
          value={selectedVideoId}
          onChange={(e) => onSelectVideo(e.target.value)}
          disabled={videoDevices.length === 0}
          className="w-full px-3 py-2 rounded-xl border border-[#E9E9E5] bg-white text-sm text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#7258E8] disabled:bg-[#F5F5F3] disabled:text-[#888888] transition-all min-h-[42px]"
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
        {videoDevices.length === 0 && (
          <p className="text-[11px] text-[#888888] mt-1">No webcam found. You can still join with microphone only.</p>
        )}
      </div>

      {/* Microphone Selection */}
      <div>
        <label className="flex items-center gap-2 text-xs font-semibold text-[#171717] mb-1.5 uppercase tracking-wider">
          <Mic className="w-3.5 h-3.5 text-[#7258E8]" />
          <span>Microphone</span>
        </label>
        <select
          id="device-selector-audio"
          value={selectedAudioId}
          onChange={(e) => onSelectAudio(e.target.value)}
          disabled={audioInputDevices.length === 0}
          className="w-full px-3 py-2 rounded-xl border border-[#E9E9E5] bg-white text-sm text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#7258E8] disabled:bg-[#F5F5F3] disabled:text-[#888888] transition-all min-h-[42px]"
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
        {audioInputDevices.length === 0 && (
          <p className="text-[11px] text-[#888888] mt-1">No microphone found. You can still join as a listener.</p>
        )}
      </div>

      {/* Speaker Output Selection (Where supported) */}
      {hasAudioOutputSupport && (
        <div>
          <label className="flex items-center justify-between text-xs font-semibold text-[#171717] mb-1.5 uppercase tracking-wider">
            <span className="flex items-center gap-2">
              <Volume2 className="w-3.5 h-3.5 text-[#7258E8]" />
              <span>Speaker / Audio Output</span>
            </span>
            <button
              type="button"
              id="test-speaker-btn"
              onClick={handleTestSpeaker}
              disabled={testingSpeaker}
              className="text-[11px] font-medium text-[#7258E8] hover:text-[#6045D8] flex items-center gap-1 disabled:opacity-60"
            >
              {testingSpeaker ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600" />
                  <span>Playing chime...</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-current" />
                  <span>Test speaker</span>
                </>
              )}
            </button>
          </label>
          <select
            value={selectedOutputId}
            onChange={(e) => onSelectOutput(e.target.value)}
            disabled={audioOutputDevices.length === 0}
            className="w-full px-3 py-2 rounded-xl border border-[#E9E9E5] bg-white text-sm text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#7258E8] disabled:bg-[#F5F5F3] disabled:text-[#888888] transition-all min-h-[42px]"
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
