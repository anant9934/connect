'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingHero } from '@/components/landing/LandingHero';
import { HeroMeetingWindow } from '@/components/landing/HeroMeetingWindow';
import { RoundTableSection } from '@/components/landing/RoundTableSection';
import { RoomKindsSection } from '@/components/landing/RoomKindsSection';
import { FeatureRowsSection } from '@/components/landing/FeatureRowsSection';
import { CtaSection } from '@/components/landing/CtaSection';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { createRoom } from '@/features/rooms/api';

export default function LandingPage() {
  const [isCreating, setIsCreating] = useState(false);
  const router = useRouter();

  const handleStartMeeting = async () => {
    try {
      setIsCreating(true);
      const res = await createRoom(50, false);
      if (res && res.room && res.room.publicCode) {
        router.push(`/room/${res.room.publicCode}/preview`);
      } else {
        router.push('/sign-in');
      }
    } catch {
      // If user is unauthenticated, redirect to sign-in or instant room
      router.push('/sign-in');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-[#17151F] font-sans antialiased selection:bg-[#F1EBFF] selection:text-[#7444E8]">
      <LandingNav onStartMeeting={handleStartMeeting} />

      <main id="main-content">
        <LandingHero onStartMeeting={handleStartMeeting} isCreating={isCreating} />
        <HeroMeetingWindow />
        <RoundTableSection />
        <RoomKindsSection />
        <FeatureRowsSection />
        <CtaSection onStartMeeting={handleStartMeeting} isCreating={isCreating} />
      </main>

      <LandingFooter />
    </div>
  );
}
