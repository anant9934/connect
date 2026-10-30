'use client';

import React from 'react';

export function HeroMeetingWindow() {
  return (
    <section aria-label="Interactive meeting preview" className="max-w-[1120px] mx-auto mt-8 sm:mt-12 px-4 sm:px-8 pb-14 sm:pb-[112px]">
      <div className="border border-[#E4E2DB] rounded-[24px] sm:rounded-[30px] bg-white p-2.5 sm:p-3 shadow-[0_30px_90px_rgba(116,68,232,0.12)] sm:shadow-[0_50px_110px_rgba(116,68,232,0.16)]">
        {/* Window Top Bar */}
        <div className="flex items-center justify-between p-[8px_10px_12px] sm:p-[8px_14px_12px] flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#7444E8]" />
            <span className="font-bold text-[14px] sm:text-[15px] text-[#17151F]">
              Federated Learning Collaboration
            </span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="rounded-full py-1 px-2.5 sm:py-1.5 sm:px-[13px] text-[12px] sm:text-[13px] font-semibold inline-block bg-[#F1EBFF] text-[#5A2FC7]">
              Research Room
            </span>
            <span className="rounded-full py-1 px-2.5 sm:py-1.5 sm:px-[13px] text-[12px] sm:text-[13px] font-semibold bg-[#E4F8EB] text-[#1F6B3B] inline-flex items-center">
              <span className="inline-block w-2 h-2 rounded-full bg-[#2DBE74] mr-1.5 animate-pulse" />
              00:32:14
            </span>
          </div>
        </div>

        {/* Video Surface Container */}
        <div className="bg-[#FAF9FC] rounded-[18px] sm:rounded-[22px] p-2.5 sm:p-3">
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-2.5 sm:gap-3">
            {/* Big Speaker Tile: Anant */}
            {/* Internal layout reserves dedicated Avatar, Speech Bubble, and Status areas */}
            <div className="relative rounded-[18px] sm:rounded-[20px] bg-[#F1EBFF] min-h-[290px] sm:min-h-[410px] sm:h-[410px] overflow-hidden shadow-[inset_0_0_0_3px_#7444E8] flex flex-col justify-between p-3.5 sm:p-5">
              {/* Dedicated Avatar & Speech Bubble Area */}
              <div className="flex-1 flex flex-col items-center justify-center gap-2.5 sm:gap-4 py-2">
                <div className="w-[80px] h-[80px] sm:w-[108px] sm:h-[108px] rounded-full flex items-center justify-center font-heading font-bold text-[34px] sm:text-[42px] bg-[#7444E8] text-white shadow-md flex-shrink-0">
                  A
                </div>
                <div
                  id="anant-speech-bubble"
                  className="bg-white rounded-[16px] py-2 px-3.5 sm:py-2.5 sm:px-4 text-[12px] sm:text-[14px] leading-[1.35] max-w-[260px] sm:max-w-[300px] text-center shadow-[0_8px_24px_rgba(23,21,31,0.08)] text-[#17151F] font-medium border border-[#E8E2F5]"
                >
                  What if we federate at the grid edge?
                </div>
              </div>

              {/* Dedicated Participant Identity Bar (Guaranteed zero intersection with speech bubble) */}
              <div className="flex items-center justify-between w-full pt-1 z-10">
                <span
                  id="anant-speaker-badge"
                  className="bg-white/95 backdrop-blur-sm rounded-full py-1 px-3 text-[11px] sm:text-[12px] font-semibold text-[#17151F] shadow-[0_2px_8px_rgba(23,21,31,0.08)] border border-[#E5E0F2] inline-flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full bg-[#2DBE74] animate-pulse" />
                  Anant · speaking
                </span>
              </div>
            </div>

            {/* Side 3 Participant Tiles: 3-column compact grid on mobile, stacked on desktop */}
            <div className="grid grid-cols-3 md:flex md:flex-col gap-2.5 sm:gap-3">
              {/* Sanara Singh */}
              <div className="relative rounded-[16px] sm:rounded-[20px] bg-[#FFF4D1] h-[104px] sm:h-[128px] overflow-hidden flex flex-col items-center justify-center p-2">
                <div className="w-[44px] h-[44px] sm:w-[56px] sm:h-[56px] rounded-full flex items-center justify-center font-heading font-bold text-[18px] sm:text-[22px] bg-[#FFC93C] text-[#17151F] shadow-sm mb-1.5">
                  S
                </div>
                <span className="bg-white/90 backdrop-blur-xs rounded-full py-0.5 px-2.5 text-[11px] sm:text-[12px] font-semibold text-[#17151F] shadow-xs">
                  Sanara Singh
                </span>
              </div>

              {/* Shivam */}
              <div className="relative rounded-[16px] sm:rounded-[20px] bg-[#E4F8EB] h-[104px] sm:h-[128px] overflow-hidden flex flex-col items-center justify-center p-2">
                <div className="w-[44px] h-[44px] sm:w-[56px] sm:h-[56px] rounded-full flex items-center justify-center font-heading font-bold text-[18px] sm:text-[22px] bg-[#86E3A8] text-[#17151F] shadow-sm mb-1.5">
                  S
                </div>
                <span className="bg-white/90 backdrop-blur-xs rounded-full py-0.5 px-2.5 text-[11px] sm:text-[12px] font-semibold text-[#17151F] shadow-xs">
                  Shivam
                </span>
              </div>

              {/* Mentor */}
              <div className="relative rounded-[16px] sm:rounded-[20px] bg-[#FFE9E9] h-[104px] sm:h-[128px] overflow-hidden flex flex-col items-center justify-center p-2">
                <div className="w-[44px] h-[44px] sm:w-[56px] sm:h-[56px] rounded-full flex items-center justify-center font-heading font-bold text-[18px] sm:text-[22px] bg-[#FF8A8A] text-[#17151F] shadow-sm mb-1.5">
                  M
                </div>
                <span className="bg-white/90 backdrop-blur-xs rounded-full py-0.5 px-2.5 text-[11px] sm:text-[12px] font-semibold text-[#17151F] shadow-xs text-center">
                  Mentor
                </span>
              </div>
            </div>
          </div>

          {/* Controls Bar */}
          <div className="flex justify-center items-center gap-2 sm:gap-2.5 pt-3 sm:pt-4" role="region" aria-label="Simulated meeting controls (illustration only)">
            <div
              aria-label="Mute microphone (illustration only)"
              className="w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center bg-[#86E3A8] text-[#17151F] shadow-xs cursor-default select-none"
            >
              <svg className="w-5 h-5 fill-none stroke-current stroke-2 stroke-linecap-round stroke-linejoin-round" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </div>
            <div
              aria-label="Camera (preview)"
              className="w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center bg-[#86E3A8] text-[#17151F] shadow-xs cursor-default select-none"
            >
              <svg className="w-5 h-5 fill-none stroke-current stroke-2 stroke-linecap-round stroke-linejoin-round" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="6" width="12" height="12" rx="3" />
                <path d="M15 10l6-3v10l-6-3z" />
              </svg>
            </div>
            <div
              aria-label="Share screen (preview)"
              className="w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center bg-[#7444E8] text-white shadow-xs cursor-default select-none"
            >
              <svg className="w-5 h-5 fill-none stroke-current stroke-2 stroke-linecap-round stroke-linejoin-round" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="4" width="18" height="12" rx="2" />
                <path d="M8 20h8M12 16v4" />
              </svg>
            </div>
            <div
              aria-label="Raise hand (preview)"
              className="w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center bg-[#FFC93C] text-[#17151F] shadow-xs cursor-default select-none"
            >
              <svg className="w-5 h-5 fill-none stroke-current stroke-2 stroke-linecap-round stroke-linejoin-round" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.5-1.5L8 13" />
              </svg>
            </div>
            <div
              aria-label="Leave meeting (preview)"
              className="w-[58px] sm:w-[68px] h-11 sm:h-12 rounded-full flex items-center justify-center bg-[#FF6B6B] text-[#17151F] shadow-xs cursor-default select-none"
            >
              <svg className="w-5 h-5 fill-none stroke-current stroke-2 stroke-linecap-round stroke-linejoin-round" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 15c5-5 11-5 16 0l-2 3-3-1.5v-2c-2-.7-4-.7-6 0v2L6 18z" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
