'use client';

import React from 'react';
import { Mic, MicOff, Video, PhoneOff } from 'lucide-react';

export const CallIllustration: React.FC = () => {
  return (
    <div
      role="img"
      aria-label="Illustration of a clear, focused video conversation layout"
      className="relative w-full rounded-2xl bg-white border border-[#E9E9E5] shadow-xs p-5 sm:p-6 space-y-4 select-none"
    >
      {/* 2 Simple Unlabeled Video Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {/* Tile 1 */}
        <div className="aspect-[4/3] rounded-xl bg-gradient-to-b from-[#F7F7F4] to-[#EAEAE6] border border-[#E9E9E5] p-3 flex flex-col justify-between shadow-2xs">
          <div className="flex justify-end">
            <div className="w-5 h-5 rounded-full bg-[#E1F7EA] text-[#52B879] flex items-center justify-center">
              <Mic className="w-3 h-3" />
            </div>
          </div>
          <div className="flex items-center justify-center">
            <div className="w-12 h-12 rounded-2xl bg-[#EEE9FF] border border-[#7357E8]/20 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full bg-[#7357E8]/40" />
            </div>
          </div>
          <div className="w-16 h-1.5 rounded-full bg-[#E9E9E5]" />
        </div>

        {/* Tile 2 */}
        <div className="aspect-[4/3] rounded-xl bg-gradient-to-b from-[#F7F7F4] to-[#EAEAE6] border border-[#E9E9E5] p-3 flex flex-col justify-between shadow-2xs">
          <div className="flex justify-end">
            <div className="w-5 h-5 rounded-full bg-[#F7F7F4] text-[#666666] flex items-center justify-center">
              <MicOff className="w-3 h-3" />
            </div>
          </div>
          <div className="flex items-center justify-center">
            <div className="w-12 h-12 rounded-2xl bg-[#E7F3FF] border border-[#65A8E8]/20 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full bg-[#65A8E8]/40" />
            </div>
          </div>
          <div className="w-16 h-1.5 rounded-full bg-[#E9E9E5]" />
        </div>
      </div>

      {/* Minimal Floating Call Controls */}
      <div className="flex items-center justify-center gap-2 pt-1">
        <div className="w-8 h-8 rounded-lg bg-[#F7F7F4] text-[#171717] flex items-center justify-center">
          <Mic className="w-3.5 h-3.5" />
        </div>
        <div className="w-8 h-8 rounded-lg bg-[#F7F7F4] text-[#171717] flex items-center justify-center">
          <Video className="w-3.5 h-3.5" />
        </div>
        <div className="px-3 h-8 rounded-lg bg-[#FFE7E2] text-[#E56F63] font-medium text-xs flex items-center gap-1.5">
          <PhoneOff className="w-3 h-3" />
          <span>Leave</span>
        </div>
      </div>
    </div>
  );
};

export default CallIllustration;
