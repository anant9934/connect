import React from 'react';

interface AvatarItem {
  initial: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}

const avatars: AvatarItem[] = [
  { initial: 'A', bgColor: 'bg-[#EEE9FF]', textColor: 'text-[#7357E8]', borderColor: 'border-white' },
  { initial: 'M', bgColor: 'bg-[#E1F7EA]', textColor: 'text-[#2E8B57]', borderColor: 'border-white' },
  { initial: 'R', bgColor: 'bg-[#E0F2FE]', textColor: 'text-[#0284C7]', borderColor: 'border-white' },
  { initial: 'S', bgColor: 'bg-[#FEE2E2]', textColor: 'text-[#DC2626]', borderColor: 'border-white' },
];

export const AudienceStrip: React.FC = () => {
  return (
    <div className="flex items-center justify-center lg:justify-start gap-3 pt-1">
      {/* 4 small overlapping colorful circular initial badges */}
      <div className="flex -space-x-2 shrink-0" aria-hidden="true">
        {avatars.map((avatar, idx) => (
          <div
            key={idx}
            className={`w-7 h-7 rounded-full border-2 ${avatar.borderColor} ${avatar.bgColor} ${avatar.textColor} flex items-center justify-center text-[11px] font-semibold shadow-xs select-none`}
          >
            {avatar.initial}
          </div>
        ))}
      </div>

      {/* Honest, grounded audience statement */}
      <p className="text-xs text-[#666666] font-normal leading-tight">
        Built for research, projects, mentorship and teams.
      </p>
    </div>
  );
};

export default AudienceStrip;
