'use client';

import React from 'react';
import Image from 'next/image';
import { Mic, Video, MonitorUp, PhoneOff } from 'lucide-react';

export const HeroFallback: React.FC = () => {
  return (
    <div
      role="img"
      aria-label="Tathastu Meet video collaboration preview"
      className="relative w-full h-[400px] sm:h-[480px] lg:h-[520px] flex items-center justify-center select-none"
    >
      <div className="relative w-full max-w-[520px] flex flex-col items-center justify-center">
        {/* Soft atmospheric gradient */}
        <div className="absolute inset-0 bg-gradient-to-tr from-[#EEE9FF]/30 via-[#F7F7F4]/50 to-[#E7F3FF]/30 rounded-full blur-3xl pointer-events-none" />

        {/* 1. LITTLE ROBOT (Settled at upper right, greeting) */}
        <div className="absolute top-2 right-4 sm:right-8 z-30 flex flex-col items-center animate-bounce" style={{ animationDuration: '4s' }}>
          {/* Antenna */}
          <div className="flex flex-col items-center">
            <div className="w-2.5 h-2.5 rounded-full bg-[#4FD1C5] shadow-xs shadow-[#4FD1C5]/50" />
            <div className="w-0.5 h-3 bg-[#7357E8]" />
          </div>

          {/* Head & Ear Cups */}
          <div className="relative flex items-center">
            <div className="w-2 h-4 rounded-l-md bg-[#7357E8]" />
            <div className="w-16 h-12 rounded-2xl bg-white border border-[#E9E9E5] shadow-md flex items-center justify-center p-1">
              {/* Visor & Glowing Eyes */}
              <div className="w-full h-full rounded-xl bg-[#17171C] flex items-center justify-center gap-2.5">
                <div className="w-2.5 h-3 rounded-full bg-[#7357E8] shadow-xs shadow-[#9E8BF8]" />
                <div className="w-2.5 h-3 rounded-full bg-[#7357E8] shadow-xs shadow-[#9E8BF8]" />
              </div>
            </div>
            <div className="w-2 h-4 rounded-r-md bg-[#7357E8]" />
          </div>

          {/* Torso & Waving Arm */}
          <div className="relative flex items-center justify-center -mt-0.5">
            <div className="w-7 h-5 rounded-b-2xl bg-[#FAFAFC] border-x border-b border-[#E9E9E5]" />
            {/* Small hand waving badge */}
            <div className="absolute -top-1 -right-3 text-xs">👋</div>
          </div>
        </div>

        {/* 2. THE VC SCREEN (With Real Participant Portraits) */}
        <div className="relative z-10 w-full max-w-[380px] sm:max-w-[420px] bg-white rounded-2xl sm:rounded-3xl border border-[#E9E9E5] shadow-xl p-3 sm:p-4 flex flex-col gap-3 backdrop-blur-sm">
          {/* Window Header */}
          <div className="flex items-center justify-between pb-2 border-b border-[#F0F0EC]">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#E56F63]/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#E3B936]/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#52B879]/80" />
            </div>
            <div className="bg-[#F2F2EE] px-2.5 py-0.5 rounded-full text-[10px] font-semibold text-[#171717] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#52B879]" />
              <span>Active Call</span>
            </div>
          </div>

          {/* Video Participants Grid (Two Real Portraits) */}
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
            <div className="relative aspect-[4/3] rounded-xl overflow-hidden border-2 border-[#52B879] shadow-xs bg-[#F2F2EE]">
              <Image
                src="/demo/participant-01.webp"
                alt="Call participant"
                fill
                sizes="200px"
                className="object-cover"
                priority
              />
            </div>
            <div className="relative aspect-[4/3] rounded-xl overflow-hidden border border-[#E5E5DF] shadow-xs bg-[#F2F2EE]">
              <Image
                src="/demo/participant-02.webp"
                alt="Call participant"
                fill
                sizes="200px"
                className="object-cover"
                priority
              />
            </div>
          </div>

          {/* Bottom Toolbar */}
          <div className="flex items-center justify-center gap-2 pt-1">
            <div className="bg-white border border-[#E5E5DF] rounded-full px-3 py-1.5 flex items-center gap-2 shadow-xs">
              <div className="w-7 h-7 rounded-full bg-[#F4FAF6] border border-[#D5EDE0] text-[#52B879] flex items-center justify-center">
                <Mic className="w-3.5 h-3.5" />
              </div>
              <div className="w-7 h-7 rounded-full bg-[#F8F8F5] border border-[#E9E9E5] text-[#171717] flex items-center justify-center">
                <Video className="w-3.5 h-3.5" />
              </div>
              <div className="w-7 h-7 rounded-full bg-[#F6F4FE] border border-[#E2DCF8] text-[#7357E8] flex items-center justify-center">
                <MonitorUp className="w-3.5 h-3.5" />
              </div>
              <div className="px-2 h-7 rounded-full bg-[#FFE7E2] border border-[#FFD2CA] text-[#E56F63] flex items-center justify-center text-[11px] font-semibold">
                <PhoneOff className="w-3 h-3" />
              </div>
            </div>
          </div>
        </div>

        {/* 3. SIDE DOCUMENT THUMBNAIL */}
        <div className="absolute right-0 sm:-right-4 -bottom-4 z-20 hidden sm:flex flex-col">
          <div className="w-32 bg-white rounded-xl border border-[#E9E9E5] shadow-md p-2.5 space-y-1.5 rotate-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#7357E8]" />
              <span className="text-[10px] font-bold text-[#171717]">Shared Canvas</span>
            </div>
            <div className="w-full h-8 bg-[#FAF9FD] rounded border border-[#ECE8FB] flex items-center justify-center">
              <span className="text-[9px] text-[#7357E8] font-medium">Workflow Sync</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HeroFallback;
