import React from 'react';
import { Mic, Video, MonitorUp, MoreHorizontal, PhoneOff, Square } from 'lucide-react';

export interface MeetingToolbarProps {
  isSharing?: boolean;
  onStopSharing?: () => void;
  className?: string;
}

export const MeetingToolbar: React.FC<MeetingToolbarProps> = ({
  isSharing = false,
  className = '',
}) => {
  return (
    <div
      className={`inline-flex items-center gap-2 sm:gap-2.5 px-3 py-2 sm:px-4 sm:py-2.5 rounded-full bg-white/95 backdrop-blur-md border border-[#E5E5DF] shadow-md select-none ${className}`}
      role="toolbar"
      aria-label="Meeting controls"
    >
      {/* Microphone Button */}
      <button
        type="button"
        aria-label="Toggle microphone"
        className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#F4FAF6] border border-[#D5EDE0] text-[#52B879] flex items-center justify-center hover:bg-[#E5F5EC] transition-colors"
      >
        <Mic className="w-4 h-4" />
      </button>

      {/* Camera Button */}
      <button
        type="button"
        aria-label="Toggle camera"
        className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#F8F8F5] border border-[#E9E9E5] text-[#171717] flex items-center justify-center hover:bg-[#EFEFEA] transition-colors"
      >
        <Video className="w-4 h-4" />
      </button>

      {/* Screen Share Button */}
      {isSharing ? (
        <button
          type="button"
          aria-label="Stop screen sharing"
          className="px-3 h-8 sm:h-9 rounded-full bg-[#7357E8] text-white text-xs font-medium flex items-center gap-1.5 shadow-xs hover:bg-[#6345D8] transition-colors"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
          <span>Stop sharing</span>
        </button>
      ) : (
        <button
          type="button"
          aria-label="Share screen"
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#F6F4FE] border border-[#E2DCF8] text-[#7357E8] flex items-center justify-center hover:bg-[#EDE9FD] transition-colors"
        >
          <MonitorUp className="w-4 h-4" />
        </button>
      )}

      {/* More Options Button */}
      <button
        type="button"
        aria-label="More options"
        className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#F8F8F5] border border-[#E9E9E5] text-[#666666] flex items-center justify-center hover:bg-[#EFEFEA] hover:text-[#171717] transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {/* Leave Meeting Button (Soft Coral / Red) */}
      <button
        type="button"
        aria-label="Leave meeting"
        className="px-3 h-8 sm:h-9 rounded-full bg-[#FFE7E2] border border-[#FFD2CA] text-[#E56F63] hover:bg-[#FFD9D2] text-xs font-semibold flex items-center gap-1.5 transition-colors"
      >
        <PhoneOff className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Leave</span>
      </button>
    </div>
  );
};

export default MeetingToolbar;
