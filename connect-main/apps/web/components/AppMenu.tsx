'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { logout } from '@/features/auth/api';
import { User } from '@/features/auth/types';

const LINKS = [
  { href: '/history', label: 'Meetings' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/institution', label: 'Classes' },
  { href: '/attendance', label: 'Attendance' },
  { href: '/notifications', label: 'Notifications' },
  { href: '/admin', label: 'Administration' },
  { href: '/diagnostics', label: 'Connection check' },
  { href: '/profile', label: 'Profile' },
];

// The way around the signed-in product, from any page that shows the main navigation.
export const AppMenu: React.FC<{ user: User }> = ({ user }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id="nav-app-menu"
        aria-expanded={open}
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 rounded-lg border border-[#E9E9E5] text-[#17151F] bg-white"
      >
        {open ? <X className="w-4 h-4" aria-hidden="true" /> : <Menu className="w-4 h-4" aria-hidden="true" />}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-[#E9E9E5] bg-white shadow-lg p-2 z-40">
          <p className="px-3 py-1 text-xs text-[#686868] truncate">{user.displayName}</p>
          <ul>
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="flex items-center px-3 min-h-[44px] rounded-lg text-sm text-[#171717] hover:bg-[#F6F5F1] no-underline">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={async () => {
              await logout().catch(() => undefined);
              window.location.assign('/');
            }}
            className="w-full text-left px-3 min-h-[44px] rounded-lg text-sm text-[#171717] hover:bg-[#F6F5F1]"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
};
