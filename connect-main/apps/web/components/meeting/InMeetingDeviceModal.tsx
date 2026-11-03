'use client';

import React from 'react';
import { X, Settings, Check } from 'lucide-react';
import { DeviceSelector } from './DeviceSelector';
import { DeviceInfo } from '@/features/meeting/media';

interface InMeetingDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
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

export const InMeetingDeviceModal: React.FC<InMeetingDeviceModalProps> = ({
  isOpen,
  onClose,
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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white border border-[#E5E5E3] rounded-3xl p-6 text-[#1C1C1C] space-y-5 shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-[#F2F2F0]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-[#7258E8] flex items-center justify-center border border-purple-100">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#171717]">Audio & Video Settings</h2>
              <p className="text-xs text-[#686868]">Switch devices during the meeting</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-[#F2F2F0] text-[#666664] transition-colors"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <DeviceSelector
          videoDevices={videoDevices}
          audioInputDevices={audioInputDevices}
          audioOutputDevices={audioOutputDevices}
          selectedVideoId={selectedVideoId}
          selectedAudioId={selectedAudioId}
          selectedOutputId={selectedOutputId}
          onSelectVideo={onSelectVideo}
          onSelectAudio={onSelectAudio}
          onSelectOutput={onSelectOutput}
          hasAudioOutputSupport={hasAudioOutputSupport}
        />

        <div className="pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 px-4 rounded-xl bg-[#7658E8] hover:bg-[#6045D8] text-white text-xs font-semibold transition-all flex items-center justify-center gap-1.5 shadow-xs"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Done</span>
          </button>
        </div>
      </div>
    </div>
  );
};
