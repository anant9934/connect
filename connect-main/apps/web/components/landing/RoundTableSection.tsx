'use client';

import React from 'react';

export function RoundTableSection() {
  return (
    <section aria-label="Research circle collaboration" className="max-w-[1120px] mx-auto px-3 sm:px-8 pb-16 sm:pb-24">
      <div className="text-center mb-6 sm:mb-14">
        <span className="inline-block rounded-full py-1.5 px-[13px] text-[12px] font-bold tracking-[0.06em] uppercase mb-2.5 sm:mb-4 bg-[#FFF4D1] text-[#6B4E00]">
          The real-room feeling
        </span>
        <h2 className="font-heading font-extrabold text-[26px] xs:text-[30px] sm:text-[46px] leading-[1.12] sm:leading-[1.04] tracking-[-0.03em] m-0 mb-3 text-[#17151F]">
          Everyone gets a seat at the table.
        </h2>
      </div>

      {/* RESPONSIVE ROUNDTABLE CONSTELLATION: Preserves table + surrounding participants storytelling across all screen widths */}
      <div
        id="roundtable-container"
        className="relative w-full max-w-[700px] h-[340px] xs:h-[370px] sm:h-[420px] mx-auto select-none"
        aria-label="Interactive roundtable meeting simulation"
      >
        {/* Central Table Surface */}
        <div
          id="roundtable-surface"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] xs:w-[62%] sm:w-[60%] h-[36%] xs:h-[38%] sm:h-[42%] rounded-[100px] bg-[#F6F5F2] border border-[#E9E7E1] flex items-center justify-center font-bold text-[11px] xs:text-[12px] sm:text-[15px] text-[#6B675C] text-center px-2 sm:px-4 shadow-2xs"
        >
          Multimodal AI Research Circle
        </div>

        {/* 1. Anant (Top) */}
        <div
          id="participant-anant"
          className="absolute left-1/2 top-[2%] xs:top-[2%] sm:top-[1%] -translate-x-1/2 text-center text-[10px] xs:text-[11px] sm:text-[13px] font-semibold text-[#17151F] z-10"
        >
          <div
            id="avatar-anant"
            className="w-10 h-10 xs:w-11 xs:h-11 sm:w-15 sm:h-15 rounded-full flex items-center justify-center font-heading font-bold text-[16px] xs:text-[18px] sm:text-[23px] bg-[#7444E8] text-white mx-auto mb-1 shadow-xs"
          >
            A
          </div>
          <span id="name-anant">Anant</span>
        </div>

        {/* Speech Bubble 1: Anant */}
        <div
          id="bubble-anant"
          className="absolute left-[58%] xs:left-[58%] sm:left-[58%] top-[1%] xs:top-[1%] sm:top-[2%] bg-white rounded-[12px] xs:rounded-[14px] sm:rounded-[16px] p-2 xs:p-2.5 sm:p-[10px_14px] text-[10px] xs:text-[11px] sm:text-[13px] leading-[1.35] max-w-[120px] xs:max-w-[140px] sm:max-w-[190px] shadow-[0_8px_24px_rgba(23,21,31,0.09)] text-[#17151F] border border-[#F0EEE8] z-20"
        >
          Can we reuse the same evaluation set?
        </div>

        {/* 2. Sanara Singh (Left) */}
        <div
          id="participant-sanara"
          className="absolute left-[10%] xs:left-[11%] sm:left-[11%] top-[32%] xs:top-[31%] sm:top-[30%] -translate-x-1/2 text-center text-[10px] xs:text-[11px] sm:text-[13px] font-semibold text-[#17151F] z-10"
        >
          <div
            id="avatar-sanara"
            className="w-10 h-10 xs:w-11 xs:h-11 sm:w-15 sm:h-15 rounded-full flex items-center justify-center font-heading font-bold text-[16px] xs:text-[18px] sm:text-[23px] bg-[#FFC93C] text-[#17151F] mx-auto mb-1 shadow-xs"
          >
            S
          </div>
          <span id="name-sanara" className="leading-tight block">Sanara Singh</span>
        </div>

        {/* Speech Bubble 2: Sanara Singh */}
        <div
          id="bubble-sanara"
          className="absolute left-[1%] xs:left-[2%] sm:left-0 top-[11%] xs:top-[12%] sm:top-[13%] bg-white rounded-[12px] xs:rounded-[14px] sm:rounded-[16px] p-2 xs:p-2.5 sm:p-[10px_14px] text-[10px] xs:text-[11px] sm:text-[13px] leading-[1.35] max-w-[110px] xs:max-w-[125px] sm:max-w-[150px] shadow-[0_8px_24px_rgba(23,21,31,0.09)] text-[#17151F] border border-[#F0EEE8] z-20"
        >
          Power data is the hard part.
        </div>

        {/* 3. Shivam (Right) */}
        <div
          id="participant-shivam"
          className="absolute left-[90%] xs:left-[89%] sm:left-[89%] top-[32%] xs:top-[31%] sm:top-[30%] -translate-x-1/2 text-center text-[10px] xs:text-[11px] sm:text-[13px] font-semibold text-[#17151F] z-10"
        >
          <div
            id="avatar-shivam"
            className="w-10 h-10 xs:w-11 xs:h-11 sm:w-15 sm:h-15 rounded-full flex items-center justify-center font-heading font-bold text-[16px] xs:text-[18px] sm:text-[23px] bg-[#86E3A8] text-[#17151F] mx-auto mb-1 shadow-xs"
          >
            S
          </div>
          <span id="name-shivam">Shivam</span>
        </div>

        {/* 4. Prof. Rao (Bottom Left) */}
        <div
          id="participant-rao"
          className="absolute left-[26%] xs:left-[26%] sm:left-[27%] bottom-[3%] xs:bottom-[3%] sm:bottom-[3%] -translate-x-1/2 text-center text-[10px] xs:text-[11px] sm:text-[13px] font-semibold text-[#17151F] z-10"
        >
          <div
            id="avatar-rao"
            className="w-10 h-10 xs:w-11 xs:h-11 sm:w-15 sm:h-15 rounded-full flex items-center justify-center font-heading font-bold text-[16px] xs:text-[18px] sm:text-[23px] bg-[#FF8A8A] text-[#17151F] mx-auto mb-1 shadow-xs"
          >
            P
          </div>
          <span id="name-rao">Prof. Rao</span>
        </div>

        {/* 5. Neha (Bottom Right) */}
        <div
          id="participant-neha"
          className="absolute left-[74%] xs:left-[74%] sm:left-[73%] bottom-[3%] xs:bottom-[3%] sm:bottom-[3%] -translate-x-1/2 text-center text-[10px] xs:text-[11px] sm:text-[13px] font-semibold text-[#17151F] z-10"
        >
          <div
            id="avatar-neha"
            className="w-10 h-10 xs:w-11 xs:h-11 sm:w-15 sm:h-15 rounded-full flex items-center justify-center font-heading font-bold text-[16px] xs:text-[18px] sm:text-[23px] bg-[#17151F] text-white mx-auto mb-1 shadow-xs"
          >
            N
          </div>
          <span id="name-neha">Neha</span>
        </div>

        {/* Speech Bubble 3: Neha */}
        <div
          id="bubble-neha"
          className="absolute right-[1%] xs:right-[2%] sm:right-0 bottom-[23%] xs:bottom-[23%] sm:bottom-[115px] bg-white rounded-[12px] xs:rounded-[14px] sm:rounded-[16px] p-2 xs:p-2.5 sm:p-[10px_14px] text-[10px] xs:text-[11px] sm:text-[13px] leading-[1.35] max-w-[115px] xs:max-w-[130px] sm:max-w-[170px] shadow-[0_8px_24px_rgba(23,21,31,0.09)] text-[#17151F] border border-[#F0EEE8] z-20"
        >
          I can share my dataset notes.
        </div>
      </div>
    </section>
  );
}
