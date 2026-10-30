import React from 'react';
import Image from 'next/image';
import { Mic, MicOff } from 'lucide-react';

export interface ParticipantTileProps {
  imageSrc: string;
  altText: string;
  isSpeaking?: boolean;
  isMuted?: boolean;
  className?: string;
  aspectRatio?: 'square' | 'video' | 'standard';
}

export const ParticipantTile: React.FC<ParticipantTileProps> = ({
  imageSrc,
  altText,
  isSpeaking = false,
  isMuted = false,
  className = '',
  aspectRatio = 'video',
}) => {
  const aspectClasses = {
    square: 'aspect-square',
    video: 'aspect-video',
    standard: 'aspect-[4/3]',
  }[aspectRatio];

  return (
    <div
      className={`relative w-full ${aspectClasses} rounded-2xl overflow-hidden bg-[#F2F2EE] border transition-all duration-200 ${
        isSpeaking
          ? 'border-[#52B879] shadow-[0_0_0_2px_rgba(82,184,121,0.25)]'
          : 'border-[#E5E5DF] shadow-xs'
      } ${className}`}
    >
      {/* Real Participant Portrait */}
      <Image
        src={imageSrc}
        alt={altText}
        fill
        sizes="(max-width: 768px) 100vw, 50vw"
        className="object-cover"
        priority
      />

      {/* Subtle State Indicator Pill (Mic status, no fake names) */}
      <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 bg-[#171717]/60 backdrop-blur-md px-2 py-1 rounded-full text-white text-[11px]">
        {isMuted ? (
          <MicOff className="w-3 h-3 text-[#F87171]" />
        ) : (
          <Mic className={`w-3 h-3 ${isSpeaking ? 'text-[#52B879]' : 'text-white/80'}`} />
        )}
      </div>
    </div>
  );
};

export default ParticipantTile;
