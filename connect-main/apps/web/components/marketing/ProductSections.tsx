'use client';

import React from 'react';
import { MeetingPreview } from '../product-preview/MeetingPreview';
import { ScreenSharePreview } from '../product-preview/ScreenSharePreview';
import { CollaborationPreview } from '../product-preview/CollaborationPreview';

export const ProductSections: React.FC = () => {
  return (
    <section id="product" className="py-20 md:py-28 px-4 sm:px-6 max-w-6xl mx-auto space-y-24 md:space-y-28">
      {/* 1. Clear Conversations (Text Left | Visual Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
        <div className="lg:col-span-5 space-y-4 text-center lg:text-left">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#7357E8]">
            Calls
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#171717] leading-[1.15]">
            Clear conversations.
          </h2>
          <p className="text-base sm:text-lg text-[#666666] leading-relaxed">
            High-quality video and clear audio keep the focus on the conversation, not complicated controls.
          </p>
        </div>

        <div className="lg:col-span-7">
          <MeetingPreview />
        </div>
      </div>

      {/* 2. Screen Sharing (Visual Left | Text Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
        <div className="lg:col-span-7 order-2 lg:order-1">
          <ScreenSharePreview />
        </div>

        <div className="lg:col-span-5 space-y-4 text-center lg:text-left order-1 lg:order-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#65A8E8]">
            Sharing
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#171717] leading-[1.15]">
            Share what matters.
          </h2>
          <p className="text-base sm:text-lg text-[#666666] leading-relaxed">
            Present your screen, slides, and work without making the experience feel busy. Share presentations, documents, or project windows smoothly with participants.
          </p>
        </div>
      </div>

      {/* 3. Work Together (Text Left | Visual Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
        <div className="lg:col-span-5 space-y-4 text-center lg:text-left">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#52B879]">
            Together
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#171717] leading-[1.15]">
            Work together naturally.
          </h2>
          <p className="text-base sm:text-lg text-[#666666] leading-relaxed">
            Bring teammates, mentors, or collaborators into the same conversation with a simple link or room code. No friction, downloads, or complicated guest onboarding.
          </p>
        </div>

        <div className="lg:col-span-7">
          <CollaborationPreview />
        </div>
      </div>
    </section>
  );
};

export default ProductSections;
