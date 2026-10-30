'use client';

import React from 'react';

export function CtaSection({
  onStartMeeting,
  isCreating,
}: {
  onStartMeeting?: () => void;
  isCreating?: boolean;
}) {
  return (
    <section aria-label="Start meeting call to action" className="max-w-[1120px] mx-auto px-4 sm:px-8 pb-16 sm:pb-24">
      <div className="bg-[#FFC93C] rounded-[28px] sm:rounded-[44px] py-10 sm:py-16 lg:py-[84px] px-5 sm:px-10 text-center shadow-[0_16px_40px_rgba(255,201,60,0.3)]">
        <h2 className="font-heading font-extrabold text-[30px] sm:text-[48px] lg:text-[58px] leading-[1.08] sm:leading-[1.04] tracking-[-0.03em] max-w-[660px] mx-auto mb-6 sm:mb-7 text-[#17151F]">
          Start your first room in seconds.
        </h2>
        <button
          onClick={onStartMeeting}
          disabled={isCreating}
          className="border-0 rounded-full py-4 sm:py-[17px] px-8 sm:px-[34px] min-h-[48px] font-sans font-semibold text-[16px] sm:text-[17px] cursor-pointer bg-[#17151F] text-white hover:bg-black transition-all transform active:scale-95 disabled:opacity-50 shadow-md"
        >
          {isCreating ? 'Creating room...' : 'Start a meeting'}
        </button>
      </div>
    </section>
  );
}
