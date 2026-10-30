'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Video, Check } from 'lucide-react';
import { Button } from '../ui/Button';
import { HeroExperienceLoader } from '../3d/HeroExperienceLoader';
import { AudienceStrip } from './AudienceStrip';
import { getSession } from '@/features/auth/api';
import { createRoom } from '@/features/rooms/api';

export const Hero: React.FC = () => {
  const router = useRouter();
  const [meetingCode, setMeetingCode] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isEarlyAccessOpen, setIsEarlyAccessOpen] = useState(false);
  const [earlyEmail, setEarlyEmail] = useState('');
  const [emailSubmitted, setEmailSubmitted] = useState(false);

  const handleStartMeeting = async () => {
    try {
      const sessionUser = await getSession();
      if (!sessionUser) {
        router.push('/sign-in?redirect=/room/new');
        return;
      }
      const roomRes = await createRoom();
      router.push(`/room/${roomRes.room.publicCode}/preview`);
    } catch {
      router.push('/sign-in?redirect=/room/new');
    }
  };

  const handleJoinMeeting = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = meetingCode.trim();
    if (!raw) {
      setStatusMessage('Please enter a meeting code or link.');
      return;
    }
    const match = raw.match(/\/room\/([a-zA-Z0-9-]+)/);
    const code = match ? match[1] : raw;
    router.push(`/room/${encodeURIComponent(code)}/preview`);
  };

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!earlyEmail.trim()) return;
    setEmailSubmitted(true);
    setTimeout(() => {
      setIsEarlyAccessOpen(false);
      setEmailSubmitted(false);
      setEarlyEmail('');
    }, 2500);
  };

  return (
    <section className="relative pt-10 pb-14 md:pt-16 md:pb-20 px-4 sm:px-6 max-w-6xl mx-auto overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        {/* Left Column: Immediate Headline, Clear CTAs & Colorful Audience Strip */}
        <div className="lg:col-span-6 space-y-6 text-center lg:text-left z-10">
          {/* Main Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-[3.6rem] font-bold tracking-tight text-[#171717] leading-[1.12]">
            Meet. Share. <br />
            <span className="text-[#7357E8]">Build together.</span>
          </h1>

          {/* Supporting Copy */}
          <p className="text-lg sm:text-xl text-[#666666] leading-relaxed max-w-xl mx-auto lg:mx-0 font-normal">
            Fast, clear video conversations for teams, projects, research, mentorship and everyday collaboration.
          </p>

          {/* Action Area: Start a meeting + Enter code */}
          <div className="space-y-4 max-w-md mx-auto lg:mx-0" id="meeting">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <Button
                size="lg"
                onClick={handleStartMeeting}
                className="whitespace-nowrap shrink-0 flex items-center justify-center gap-2 shadow-soft hover:shadow-md"
              >
                <Video className="w-4 h-4" />
                <span>Start a meeting</span>
              </Button>

              <form onSubmit={handleJoinMeeting} className="flex-1 flex gap-2">
                <input
                  type="text"
                  placeholder="Enter code"
                  value={meetingCode}
                  onChange={(e) => setMeetingCode(e.target.value)}
                  className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#E9E9E5] bg-white text-sm text-[#171717] placeholder-[#666666] focus:outline-none focus:ring-2 focus:ring-[#7357E8] transition-all"
                  aria-label="Meeting code"
                />
                <Button type="submit" variant="secondary" size="md">
                  Join
                </Button>
              </form>
            </div>

            {statusMessage && (
              <p className="text-xs text-[#7357E8] font-medium text-center lg:text-left animate-in fade-in">
                {statusMessage}
              </p>
            )}

            {/* Audience Strip: 4 colorful circles + honest text */}
            <AudienceStrip />

            <p className="text-xs text-[#888888]">
              Runs directly in modern browsers. No downloads required.
            </p>
          </div>
        </div>

        {/* Right Column: 3D Robot & VC Meeting Experience */}
        <div className="lg:col-span-6 w-full flex items-center justify-center">
          <HeroExperienceLoader />
        </div>
      </div>

      {/* Honest Host Access Modal */}
      {isEarlyAccessOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#171717]/35 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-[#FCFCFA] border border-[#E9E9E5] rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[#171717]">
                Instant Meeting Rooms
              </h3>
              <button
                onClick={() => setIsEarlyAccessOpen(false)}
                className="text-[#666666] hover:text-[#171717] text-sm p-1"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <p className="text-sm text-[#666666] leading-relaxed">
              We are rolling out room hosting gradually to maintain smooth audio and video performance. Enter your email to receive early host access.
            </p>

            {emailSubmitted ? (
              <div className="p-3 bg-[#E1F7EA] border border-[#52B879]/30 rounded-xl flex items-center gap-2 text-sm text-[#171717]">
                <Check className="w-4 h-4 text-[#52B879]" />
                <span>You are on the list! We will send your room link shortly.</span>
              </div>
            ) : (
              <form onSubmit={handleEmailSubmit} className="space-y-3">
                <input
                  type="email"
                  required
                  placeholder="Enter your email"
                  value={earlyEmail}
                  onChange={(e) => setEarlyEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E9E9E5] bg-white text-sm text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#7357E8]"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEarlyAccessOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm">
                    Get host access
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default Hero;
