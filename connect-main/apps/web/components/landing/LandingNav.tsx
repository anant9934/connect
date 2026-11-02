'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppMenu } from '@/components/AppMenu';
import { getSession } from '@/features/auth/api';
import { User } from '@/features/auth/types';

export function LandingNav({ onStartMeeting }: { onStartMeeting?: () => void }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    getSession().then(setUser).catch(() => setUser(null));
  }, []);

  return (
    <nav className="w-full bg-white/95 backdrop-blur-md sticky top-0 z-30 border-b border-[#F0EEE8]/80 transition-all">
      <div className="max-w-[1200px] mx-auto px-3 sm:px-8 py-2.5 sm:py-3 flex items-center justify-between gap-2 sm:gap-4">
        {/* Brand and Desktop Links */}
        <div className="flex items-center gap-2 sm:gap-8 shrink-0">
          <Link
            id="nav-brand-link"
            href="/"
            className="flex items-center gap-2 sm:gap-2.5 text-[#17151F] no-underline shrink-0"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon.svg"
              alt="Tathastu Meet Logo"
              width={34}
              height={34}
              className="w-[30px] h-[30px] sm:w-[34px] sm:h-[34px] rounded-[9px] sm:rounded-[10px] shrink-0 shadow-2xs object-cover"
            />
            <span
              id="nav-brand-text"
              className="font-heading font-bold text-[15px] xs:text-[16px] sm:text-[21px] tracking-tight whitespace-nowrap"
            >
              Tathastu Meet
            </span>
          </Link>

          <div className="hidden md:flex gap-6 text-[15px] font-medium text-[#5E5A50]">
            <Link href="/features" className="hover:text-[#17151F] transition-colors no-underline">
              Features
            </Link>
            <Link href="/rooms" className="hover:text-[#17151F] transition-colors no-underline">
              Rooms
            </Link>
            <Link href="/security" className="hover:text-[#17151F] transition-colors no-underline">
              Security
            </Link>
          </div>
        </div>

        {/* Action Items: Mobile-safe spacing with guaranteed zero collision */}
        <div
          id="nav-actions-container"
          className="flex items-center gap-1.5 xs:gap-2 sm:gap-3 text-[12px] xs:text-[13px] sm:text-[15px] font-medium shrink-0"
        >
          <a
            id="nav-action-join"
            href="/#code"
            className="hidden sm:inline-flex text-[#5E5A50] hover:text-[#17151F] px-2.5 py-2 rounded-lg hover:bg-[#F6F5F2] transition-colors no-underline items-center justify-center min-h-[40px] min-w-[40px]"
          >
            Join
          </a>
          {user ? (
            <AppMenu user={user} />
          ) : (
            <Link
              id="nav-action-signin"
              href="/sign-in"
              className="text-[#5E5A50] hover:text-[#17151F] px-1.5 xs:px-2 sm:px-2.5 py-1.5 sm:py-2 rounded-lg hover:bg-[#F6F5F2] transition-colors no-underline inline-flex items-center justify-center min-h-[40px] whitespace-nowrap"
            >
              Sign in
            </Link>
          )}
          <button
            id="nav-action-start"
            onClick={onStartMeeting}
            className="border-0 rounded-full px-3 xs:px-3.5 sm:px-5 min-h-[40px] sm:min-h-[44px] font-semibold text-[12.5px] xs:text-[13px] sm:text-[14px] cursor-pointer bg-[#FFC93C] text-[#17151F] hover:bg-[#F2BD31] shadow-2xs transition-all transform active:scale-95 shrink-0 inline-flex items-center justify-center whitespace-nowrap"
          >
            Start free
          </button>
        </div>
      </div>
    </nav>
  );
}
