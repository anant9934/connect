import React from 'react';
import { ParticipantTile } from './ParticipantTile';
import { MeetingToolbar } from './MeetingToolbar';

export const MeetingPreview: React.FC = () => {
  return (
    <div className="relative w-full rounded-2xl sm:rounded-3xl bg-[#FCFCFA] border border-[#E9E9E5] p-3 sm:p-5 shadow-lg overflow-hidden transition-all duration-300">
      {/* Top Window Header */}
      <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-[#F0F0EC]">
        {/* macOS-style window dots */}
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="w-2.5 h-2.5 rounded-full bg-[#E56F63]/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#E3B936]/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#52B879]/80" />
        </div>

        {/* Minimal room pill (no fake telemetry) */}
        <div className="flex items-center gap-2 bg-[#F2F2EE] px-3 py-1 rounded-full text-xs font-medium text-[#171717]">
          <span className="w-2 h-2 rounded-full bg-[#52B879] animate-pulse" />
          <span>Active call</span>
        </div>

        <div className="w-10" aria-hidden="true" />
      </div>

      {/* Video Tiles Grid (Two Real Participant Portraits) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 py-3 sm:py-4">
        {/* Participant 1: Active Speaker */}
        <ParticipantTile
          imageSrc="/demo/participant-01.webp"
          altText="Active call participant in discussion"
          isSpeaking={true}
          isMuted={false}
          aspectRatio="standard"
        />

        {/* Participant 2: Co-participant */}
        <ParticipantTile
          imageSrc="/demo/participant-02.webp"
          altText="Connected team participant in discussion"
          isSpeaking={false}
          isMuted={false}
          aspectRatio="standard"
        />
      </div>

      {/* Bottom Meeting Toolbar */}
      <div className="pt-1 pb-1 flex justify-center">
        <MeetingToolbar />
      </div>
    </div>
  );
};

export default MeetingPreview;
