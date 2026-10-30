'use client';

import React from 'react';
import { Video, ArrowRight } from 'lucide-react';
import { Button } from '../ui/Button';

export const FinalCTA: React.FC = () => {
  return (
    <section className="py-20 md:py-24 px-4 sm:px-6 max-w-6xl mx-auto">
      {/* Strong Dark Panel (#171717) with Subtle Purple Atmospheric Glow */}
      <div className="relative rounded-[28px] bg-[#171717] border border-[#262626] p-10 sm:p-16 text-center space-y-7 overflow-hidden shadow-2xl">
        {/* Very subtle purple atmospheric glow (NO blue neon) */}
        <div
          className="absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-96 bg-[#7357E8]/15 rounded-full blur-3xl pointer-events-none"
          aria-hidden="true"
        />

        {/* Tiny floating decorative purple sphere accent */}
        <div
          className="absolute top-8 right-12 w-6 h-6 rounded-full bg-gradient-to-tr from-[#7357E8] to-[#9E8BF8] opacity-60 shadow-lg shadow-[#7357E8]/30 hidden sm:block animate-pulse pointer-events-none"
          style={{ animationDuration: '6s' }}
          aria-hidden="true"
        />

        {/* Content */}
        <div className="relative z-10 max-w-xl mx-auto space-y-3.5">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight">
            Work better, together.
          </h2>
          <p className="text-base sm:text-lg text-[#A3A3A3] leading-relaxed font-normal">
            Start a meeting or join one in seconds.
          </p>
        </div>

        {/* CTAs: White button with dark text + Transparent dark button with light border */}
        <div className="relative z-10 flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2">
          <a href="#meeting">
            <button
              type="button"
              className="w-full sm:w-auto px-7 py-3.5 rounded-full bg-white text-[#171717] font-semibold text-sm hover:bg-[#F0F0EE] transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
            >
              <Video className="w-4 h-4 text-[#171717]" />
              <span>Start a meeting</span>
            </button>
          </a>

          <a href="#meeting">
            <button
              type="button"
              className="w-full sm:w-auto px-6 py-3.5 rounded-full bg-transparent border border-white/20 text-white font-medium text-sm hover:bg-white/10 hover:border-white/30 transition-all flex items-center justify-center gap-2"
            >
              <span>Join with a code</span>
              <ArrowRight className="w-4 h-4 text-[#A3A3A3]" />
            </button>
          </a>
        </div>
      </div>
    </section>
  );
};

export default FinalCTA;
