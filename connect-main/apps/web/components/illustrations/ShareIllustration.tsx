'use client';

import React from 'react';
import { Monitor } from 'lucide-react';

export const ShareIllustration: React.FC = () => {
  return (
    <div
      role="img"
      aria-label="Illustration of a screen-share surface with participant thumbnails"
      className="relative w-full rounded-2xl bg-white border border-[#E9E9E5] shadow-xs p-5 sm:p-6 space-y-3.5 select-none"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-[#E9E9E5] pb-3 text-xs text-[#666666]">
        <div className="flex items-center gap-2 text-[#171717] font-medium">
          <Monitor className="w-3.5 h-3.5 text-[#7357E8]" />
          <span>Screen Presentation</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#52B879]" />
          <span className="text-[11px] text-[#52B879] font-medium">Sharing</span>
        </div>
      </div>

      {/* Main presentation canvas with supporting thumbnail row */}
      <div className="relative rounded-xl bg-[#F7F7F4] border border-[#E9E9E5] p-5 space-y-4">
        {/* Abstract presentation slides / chart lines */}
        <div className="space-y-2">
          <div className="w-1/3 h-2.5 rounded bg-[#E9E9E5]" />
          <div className="w-2/3 h-1.5 rounded bg-[#EAEAE6]" />
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2">
          <div className="h-16 rounded-lg bg-white border border-[#E9E9E5] p-2 flex flex-col justify-end">
            <div className="w-full h-8 rounded bg-[#EEE9FF]" />
          </div>
          <div className="h-16 rounded-lg bg-white border border-[#E9E9E5] p-2 flex flex-col justify-end">
            <div className="w-full h-12 rounded bg-[#E7F3FF]" />
          </div>
          <div className="h-16 rounded-lg bg-white border border-[#E9E9E5] p-2 flex flex-col justify-end">
            <div className="w-full h-6 rounded bg-[#E1F7EA]" />
          </div>
        </div>

        {/* Small floating participant thumbnails in corner */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-white/90 backdrop-blur-xs p-1.5 rounded-xl border border-[#E9E9E5] shadow-2xs">
          <div className="w-7 h-5 rounded-md bg-[#EEE9FF] border border-[#7357E8]/20" />
          <div className="w-7 h-5 rounded-md bg-[#E7F3FF] border border-[#65A8E8]/20" />
        </div>
      </div>
    </div>
  );
};

export default ShareIllustration;
