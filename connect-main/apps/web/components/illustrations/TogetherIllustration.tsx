'use client';

import React from 'react';
import { Users, ArrowRight } from 'lucide-react';

export const TogetherIllustration: React.FC = () => {
  return (
    <div
      role="img"
      aria-label="Illustration of collaborators gathering into a shared space"
      className="relative w-full rounded-2xl bg-white border border-[#E9E9E5] shadow-xs p-5 sm:p-6 space-y-4 select-none"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-[#E9E9E5] pb-3 text-xs text-[#666666]">
        <div className="flex items-center gap-2 text-[#171717] font-medium">
          <Users className="w-3.5 h-3.5 text-[#52B879]" />
          <span>Connected Space</span>
        </div>
        <span className="text-[11px] text-[#7357E8] font-medium bg-[#EEE9FF] px-2 py-0.5 rounded-full">
          One-Click Join
        </span>
      </div>

      {/* Abstract profile circles entering a shared room */}
      <div className="rounded-xl bg-[#F7F7F4] border border-[#E9E9E5] p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Collaborators entering */}
        <div className="flex items-center gap-2">
          <div className="w-11 h-11 rounded-2xl bg-[#EEE9FF] border border-[#7357E8]/20 flex items-center justify-center shadow-xs">
            <div className="w-4 h-4 rounded-full bg-[#7357E8]/40" />
          </div>
          <div className="w-11 h-11 rounded-2xl bg-[#E7F3FF] border border-[#65A8E8]/20 flex items-center justify-center shadow-xs">
            <div className="w-4 h-4 rounded-full bg-[#65A8E8]/40" />
          </div>
          <div className="w-11 h-11 rounded-2xl bg-[#E1F7EA] border border-[#52B879]/20 flex items-center justify-center shadow-xs">
            <div className="w-4 h-4 rounded-full bg-[#52B879]/40" />
          </div>
        </div>

        {/* Transition arrow into common space */}
        <div className="flex items-center justify-center text-[#666666]">
          <ArrowRight className="w-4 h-4" />
        </div>

        {/* Shared common conversation card */}
        <div className="px-4 py-3 rounded-xl bg-white border border-[#E9E9E5] shadow-2xs space-y-1 text-center sm:text-left">
          <div className="w-20 h-2 rounded bg-[#E9E9E5]" />
          <div className="w-14 h-1.5 rounded bg-[#F0F0EC]" />
        </div>
      </div>
    </div>
  );
};

export default TogetherIllustration;
