'use client';

import React, { useState } from 'react';
import { Smile, Hand } from 'lucide-react';

interface ReactionPickerProps {
  isHandRaised: boolean;
  onSendReaction: (emoji: string) => void;
  onToggleHand: () => void;
}

const REACTIONS = [
  { emoji: '👍', label: 'Thumbs Up' },
  { emoji: '👏', label: 'Clap' },
  { emoji: '❤️', label: 'Heart' },
  { emoji: '🎉', label: 'Celebrate' },
];

export const ReactionPicker: React.FC<ReactionPickerProps> = ({
  isHandRaised,
  onSendReaction,
  onToggleHand,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isThrottled, setIsThrottled] = useState(false);

  const handleSend = (emoji: string) => {
    if (isThrottled) return;
    onSendReaction(emoji);
    setIsThrottled(true);
    setIsOpen(false);
    setTimeout(() => setIsThrottled(false), 2000);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`p-3 rounded-2xl border transition-all shadow-sm flex items-center justify-center ${
          isHandRaised
            ? 'bg-amber-100 border-amber-300 text-amber-800'
            : 'bg-[#FFFFFF] border-[#E5E7EB] text-[#374151] hover:bg-[#F3F4F6]'
        }`}
        title="Reactions and raise hand"
        aria-label="Reactions"
      >
        {isHandRaised ? <Hand className="w-5 h-5 text-amber-700" /> : <Smile className="w-5 h-5" />}
      </button>

      {isOpen && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-[#FFFFFF] border border-[#E5E7EB] rounded-2xl p-2 shadow-xl z-50 flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-150">
          {REACTIONS.map((r) => (
            <button
              key={r.label}
              disabled={isThrottled}
              onClick={() => handleSend(r.emoji)}
              className="w-9 h-9 rounded-xl hover:bg-[#F3F4F6] flex items-center justify-center text-lg transition-transform hover:scale-125 disabled:opacity-50"
              title={r.label}
              aria-label={r.label}
            >
              {r.emoji}
            </button>
          ))}

          <div className="w-px h-6 bg-[#E5E7EB] mx-0.5" />

          {/* Raise / Lower Hand Toggle */}
          <button
            onClick={() => {
              onToggleHand();
              setIsOpen(false);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              isHandRaised
                ? 'bg-amber-100 text-amber-900 hover:bg-amber-200'
                : 'bg-[#EEE8FF] text-[#7658E8] hover:bg-[#DDD5FF]'
            }`}
          >
            <Hand className="w-3.5 h-3.5" />
            <span>{isHandRaised ? 'Lower Hand' : 'Raise Hand'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
