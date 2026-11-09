'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { resolveMeetingNumber } from '@/features/rooms/api';
import { parseJoinInput } from '@/features/rooms/joinTarget';

export function LandingHero({
  onStartMeeting,
  isCreating,
}: {
  onStartMeeting?: () => void;
  isCreating?: boolean;
}) {
  const [code, setCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const router = useRouter();

  // Accepts a room code, an 11-digit meeting number, or a pasted meeting link.
  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);
    const target = parseJoinInput(code);
    if (target.kind === 'invalid') {
      setJoinError('Enter a room code like abcd-efgh-jk, or an 11-digit meeting number.');
      return;
    }
    if (target.kind === 'code') {
      router.push(`/room/${target.code}`);
      return;
    }
    setResolving(true);
    try {
      router.push(`/room/${await resolveMeetingNumber(target.number)}`);
    } catch {
      setJoinError('No meeting has that number. Check it and try again.');
      setResolving(false);
    }
  };

  return (
    <section className="max-w-[1000px] mx-auto pt-6 sm:pt-[52px] px-4 sm:px-8 pb-0 text-center">
      <h1 className="font-heading font-extrabold text-[36px] xs:text-[42px] sm:text-[76px] lg:text-[92px] leading-[1.02] sm:leading-[0.94] tracking-[-0.045em] m-0 mb-4 sm:mb-6 text-[#17151F]">
        Feels like a{' '}
        <span className="bg-[#FFC93C] rounded-[14px] sm:rounded-[18px] px-2 sm:px-[14px] inline-block">
          real room
        </span>{' '}
        talk.
      </h1>

      <p className="text-[16px] sm:text-[21px] leading-[1.5] text-[#5E5A50] mx-auto mb-7 sm:mb-[34px] max-w-[640px]">
        Crystal-clear voice, video that adapts to your network, and rooms that already know why you are meeting.
      </p>

      {/* CTA and Join Form Group */}
      <div className="flex flex-col sm:flex-row gap-3.5 sm:gap-3 justify-center items-center w-full max-w-[390px] sm:max-w-none mx-auto">
        <button
          onClick={onStartMeeting}
          disabled={isCreating}
          className="w-full sm:w-auto border-0 rounded-full py-4 sm:py-[17px] px-8 min-h-[48px] font-sans font-semibold text-[16px] sm:text-[17px] cursor-pointer bg-[#FFC93C] text-[#17151F] shadow-[0_12px_28px_rgba(255,201,60,0.4)] hover:bg-[#F2BD31] transition-all transform active:scale-95 disabled:opacity-50"
        >
          {isCreating ? 'Creating room...' : 'Start a meeting'}
        </button>

        {/* Room Code Form with #code anchor target for LandingNav */}
        <div id="code" className="scroll-mt-24 w-full sm:w-auto">
          <form
            onSubmit={handleJoin}
            className="w-full sm:w-auto flex items-center justify-between gap-1.5 sm:gap-2 border-[1.5px] border-[#E3E0D8] rounded-full p-1.5 pl-3.5 sm:pl-5 bg-white shadow-xs focus-within:border-[#7444E8] focus-within:ring-2 focus-within:ring-[#F1EBFF] transition-all"
          >
            <label
              htmlFor="room-code-input"
              className="text-[#6B675C] text-[14px] sm:text-[15px] font-medium whitespace-nowrap cursor-text shrink-0"
            >
              Code or ID
            </label>
            <input
              id="room-code-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="abc-defg-hij"
              aria-describedby={joinError ? 'join-error' : undefined}
              aria-invalid={joinError ? true : undefined}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="border-0 outline-none font-sans font-medium text-[16px] min-w-0 flex-1 w-[110px] sm:w-[130px] px-1 py-2.5 min-h-[44px] text-[#17151F] bg-transparent placeholder-[#9C988D]"
            />
            <button
              type="submit"
              disabled={resolving}
              className="border-0 rounded-full px-5 sm:px-[22px] min-h-[44px] font-sans font-semibold text-[15px] sm:text-[16px] cursor-pointer bg-[#7444E8] text-white hover:bg-[#6537D6] transition-all transform active:scale-95 shrink-0 shadow-xs"
            >
              {resolving ? 'Finding…' : 'Join'}
            </button>
          </form>
          {joinError && (
            <p id="join-error" role="alert" className="mt-2 text-[13px] text-[#9B2C2C] text-left sm:text-center px-4">
              {joinError}
            </p>
          )}
        </div>
      </div>

      {/* Room Category Pills */}
      <div className="flex gap-2 sm:gap-2.5 justify-center flex-wrap mt-6 sm:mt-[30px] px-2" aria-label="Room categories">
        <span className="rounded-full py-1.5 px-3 sm:px-[13px] text-[12px] sm:text-[13px] font-semibold inline-block bg-[#17151F] text-white shadow-2xs">
          Instant
        </span>
        <span className="rounded-full py-1.5 px-3 sm:px-[13px] text-[12px] sm:text-[13px] font-semibold inline-block bg-[#F1EBFF] text-[#5A2FC7]">
          Research
        </span>
        <span className="rounded-full py-1.5 px-3 sm:px-[13px] text-[12px] sm:text-[13px] font-semibold inline-block bg-[#E4F8EB] text-[#1F6B3B]">
          Project
        </span>
        <span className="rounded-full py-1.5 px-3 sm:px-[13px] text-[12px] sm:text-[13px] font-semibold inline-block bg-[#FFF4D1] text-[#6B4E00]">
          Mentor
        </span>
        <span className="rounded-full py-1.5 px-3 sm:px-[13px] text-[12px] sm:text-[13px] font-semibold inline-block bg-[#FFE9E9] text-[#9B2C2C]">
          Community
        </span>
      </div>
    </section>
  );
}
