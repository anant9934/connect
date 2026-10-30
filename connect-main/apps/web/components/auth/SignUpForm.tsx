'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { signup } from '@/features/auth/api';
import { createRoom } from '@/features/rooms/api';
import { ApiError } from '@/lib/api/client';

export const SignUpForm: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get('redirect');

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (displayName.trim().length < 2) {
      setError('Please enter a display name with at least 2 characters.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setLoading(true);

    try {
      await signup({ displayName: displayName.trim(), email, password });

      if (redirectTarget === '/room/new') {
        const roomRes = await createRoom();
        router.push(`/room/${roomRes.room.publicCode}/preview`);
      } else if (redirectTarget) {
        router.push(redirectTarget);
      } else {
        router.push('/');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to create account. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white rounded-2xl border border-[#E9E9E5] p-8 shadow-sm">
      <div className="mb-6 text-center">
        <Link href="/" className="inline-flex items-center gap-2.5 mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon.svg"
            alt="Tathastu Meet Logo"
            width={32}
            height={32}
            className="w-8 h-8 rounded-xl object-cover shadow-2xs"
          />
          <span className="font-semibold text-lg text-[#171717] font-heading">Tathastu Meet</span>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-[#171717]">Create your account</h1>
        <p className="text-sm text-[#686868] mt-1">Get started with meetings and collaboration</p>
      </div>

      {error && (
        <div className="mb-5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="displayName" className="block text-xs font-semibold text-[#171717] mb-1.5 uppercase tracking-wider">
            Your name
          </label>
          <input
            id="displayName"
            type="text"
            required
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Jane Doe"
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#E9E9E5] bg-[#FCFCFA] text-[16px] sm:text-sm text-[#171717] placeholder-[#888888] focus:outline-none focus:ring-2 focus:ring-[#7258E8] focus:bg-white transition-all min-h-[44px]"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-xs font-semibold text-[#171717] mb-1.5 uppercase tracking-wider">
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#E9E9E5] bg-[#FCFCFA] text-[16px] sm:text-sm text-[#171717] placeholder-[#888888] focus:outline-none focus:ring-2 focus:ring-[#7258E8] focus:bg-white transition-all min-h-[44px]"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="password" className="block text-xs font-semibold text-[#171717] uppercase tracking-wider">
              Password
            </label>
            <span className="text-[11px] text-[#888888]">Minimum 8 characters</span>
          </div>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a strong password"
              className="w-full px-3.5 py-2.5 pr-10 rounded-xl border border-[#E9E9E5] bg-[#FCFCFA] text-[16px] sm:text-sm text-[#171717] placeholder-[#888888] focus:outline-none focus:ring-2 focus:ring-[#7258E8] focus:bg-white transition-all min-h-[44px]"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#888888] hover:text-[#171717] p-1"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 px-4 rounded-xl bg-[#7258E8] hover:bg-[#6045D8] text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Creating account...</span>
            </>
          ) : (
            <span>Create account</span>
          )}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-[#686868]">
        Already have an account?{' '}
        <Link
          href={redirectTarget ? `/sign-in?redirect=${encodeURIComponent(redirectTarget)}` : '/sign-in'}
          className="text-[#7258E8] font-medium hover:underline"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
};
