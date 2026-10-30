import React from 'react';
import Image from 'next/image';
import { MonitorUp } from 'lucide-react';
import { PresentationPreview } from './PresentationPreview';
import { MeetingToolbar } from './MeetingToolbar';

export const ScreenSharePreview: React.FC = () => {
  return (
    <div className="relative w-full rounded-2xl sm:rounded-3xl bg-[#FCFCFA] border border-[#E9E9E5] p-3 sm:p-5 shadow-lg overflow-hidden transition-all duration-300">
      {/* Top Header with Screen Share Status */}
      <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-[#F0F0EC]">
        {/* macOS dots */}
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="w-2.5 h-2.5 rounded-full bg-[#E56F63]/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#E3B936]/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#52B879]/80" />
        </div>

        {/* Screen sharing status indicator */}
        <div className="flex items-center gap-2 bg-[#F6F4FE] border border-[#E2DCF8] px-3 py-1 rounded-full text-xs font-medium text-[#7357E8]">
          <MonitorUp className="w-3.5 h-3.5" />
          <span>Screen sharing</span>
        </div>

        <div className="w-10" aria-hidden="true" />
      </div>

      {/* Main Presentation Surface */}
      <div className="py-3 sm:py-4">
        <PresentationPreview />
      </div>

      {/* Participant Thumbnails Strip */}
      <div className="flex items-center justify-center gap-2.5 pb-3">
        <div className="relative w-14 h-11 sm:w-16 sm:h-12 rounded-lg overflow-hidden border-2 border-[#52B879] shadow-xs">
          <Image
            src="/demo/participant-01.webp"
            alt="Presenter video thumbnail"
            fill
            sizes="64px"
            className="object-cover"
          />
        </div>
        <div className="relative w-14 h-11 sm:w-16 sm:h-12 rounded-lg overflow-hidden border border-[#E5E5DF] shadow-xs opacity-90">
          <Image
            src="/demo/participant-02.webp"
            alt="Viewer video thumbnail"
            fill
            sizes="64px"
            className="object-cover"
          />
        </div>
      </div>

      {/* Meeting Toolbar with "Stop sharing" active button */}
      <div className="flex justify-center">
        <MeetingToolbar isSharing={true} />
      </div>
    </div>
  );
};

export default ScreenSharePreview;
