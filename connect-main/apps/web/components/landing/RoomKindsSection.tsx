'use client';

import React from 'react';

export function RoomKindsSection() {
  return (
    <section id="rooms" aria-label="Room categories" className="max-w-[1120px] mx-auto px-4 sm:px-8 pb-16 sm:pb-24">
      <div className="mb-7 sm:mb-9">
        <h2 className="font-heading font-extrabold text-[28px] sm:text-[46px] leading-[1.1] sm:leading-[1.04] tracking-[-0.03em] m-0 mb-3 max-w-[620px] text-[#17151F]">
          One engine. Five kinds of rooms.
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 sm:gap-4">
        {/* Instant Meet */}
        <div className="rounded-[22px] sm:rounded-[28px] p-5 sm:p-[26px] flex flex-col gap-2 sm:gap-2.5 min-h-[148px] sm:min-h-[190px] bg-[#F3F2EE] border border-[#E9E7E1] shadow-2xs">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-[#17151F] mb-1 sm:mb-3 shadow-xs" />
          <div className="font-bold text-[18px] sm:text-[19px] text-[#17151F]">Instant Meet</div>
          <div className="text-[14px] sm:text-[15px] leading-[1.45] text-[#4F4B44]">
            A normal call, ready in one click.
          </div>
        </div>

        {/* Research Room */}
        <div className="rounded-[22px] sm:rounded-[28px] p-5 sm:p-[26px] flex flex-col gap-2 sm:gap-2.5 min-h-[148px] sm:min-h-[190px] bg-[#F1EBFF] border border-[#E4DCFC] shadow-2xs">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-[#7444E8] mb-1 sm:mb-3 shadow-xs" />
          <div className="font-bold text-[18px] sm:text-[19px] text-[#17151F]">Research Room</div>
          <div className="text-[14px] sm:text-[15px] leading-[1.45] text-[#4F4B44]">
            Papers, notes and repo beside the call.
          </div>
        </div>

        {/* Project Room */}
        <div className="rounded-[22px] sm:rounded-[28px] p-5 sm:p-[26px] flex flex-col gap-2 sm:gap-2.5 min-h-[148px] sm:min-h-[190px] bg-[#E4F8EB] border border-[#CDEED8] shadow-2xs">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-[#2DBE74] mb-1 sm:mb-3 shadow-xs" />
          <div className="font-bold text-[18px] sm:text-[19px] text-[#17151F]">Project Room</div>
          <div className="text-[14px] sm:text-[15px] leading-[1.45] text-[#4F4B44]">
            Teammates, tasks and context together.
          </div>
        </div>

        {/* Mentor Session */}
        <div className="rounded-[22px] sm:rounded-[28px] p-5 sm:p-[26px] flex flex-col gap-2 sm:gap-2.5 min-h-[148px] sm:min-h-[190px] bg-[#FFF4D1] border border-[#FBEAB4] shadow-2xs">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-[#FFC93C] mb-1 sm:mb-3 shadow-xs" />
          <div className="font-bold text-[18px] sm:text-[19px] text-[#17151F]">Mentor Session</div>
          <div className="text-[14px] sm:text-[15px] leading-[1.45] text-[#4F4B44]">
            Goals and agenda ready before you join.
          </div>
        </div>

        {/* Community Room */}
        <div className="rounded-[22px] sm:rounded-[28px] p-5 sm:p-[26px] flex flex-col gap-2 sm:gap-2.5 min-h-[148px] sm:min-h-[190px] bg-[#FFE9E9] border border-[#FBD2D2] shadow-2xs">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-[#FF6B6B] mb-1 sm:mb-3 shadow-xs" />
          <div className="font-bold text-[18px] sm:text-[19px] text-[#17151F]">Community Room</div>
          <div className="text-[14px] sm:text-[15px] leading-[1.45] text-[#4F4B44]">
            Clubs, events and group discussions.
          </div>
        </div>
      </div>
    </section>
  );
}
