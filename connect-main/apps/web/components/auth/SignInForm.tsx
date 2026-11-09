'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { login, loginMember } from '@/features/auth/api';
import { createRoom } from '@/features/rooms/api';
import { ApiError } from '@/lib/api/client';
import { SsoOptions } from './SsoOptions';

export const SignInForm: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get('redirect');

  const [mode, setMode] = useState<'email' | 'institution'>('email');
  const [email, setEmail] = useState('');
  const [institution, setInstitution] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'email') await login({ email, password });
      else await loginMember(institution, registrationNumber, password);

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
        setError(mode === 'email' ? 'Email or password is incorrect.' : 'Those details are incorrect.');
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
        <h1 className="text-2xl font-bold tracking-tight text-[#171717]">Sign in to your account</h1>
        <p className="text-sm text-[#686868] mt-1">
          {mode === 'email' ? 'Enter your email and password to continue' : 'Use your university registration number'}
        </p>
      </div>

      <div role="tablist" aria-label="How to sign in" className="neu-well grid grid-cols-2 gap-1 p-1 mb-5">
        {([['email', 'Email'], ['institution', 'University ID']] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            data-testid={`signin-tab-${value}`}
            onClick={() => { setMode(value); setError(null); }}
            className={`rounded-full min-h-[40px] text-sm font-semibold transition-all ${mode === value ? 'bg-white text-[#5A2FC7] shadow-soft' : 'text-[#5F5F68]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'email' ? (
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
        ) : (
          <>
            <div>
              <label htmlFor="institution" className="block text-xs font-semibold text-[#171717] mb-1.5 uppercase tracking-wider">
                Institution
              </label>
              <input
                id="institution"
                required
                autoComplete="organization"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="e.g. anant-university"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E9E9E5] bg-[#FCFCFA] text-[16px] sm:text-sm text-[#171717] placeholder-[#888888] focus:outline-none focus:ring-2 focus:ring-[#7258E8] focus:bg-white transition-all min-h-[44px]"
              />
              <p className="mt-1 text-[11px] text-[#686868]">Your institution&apos;s short name, from your administrator.</p>
            </div>
            <div>
              <label htmlFor="registration-number" className="block text-xs font-semibold text-[#171717] mb-1.5 uppercase tracking-wider">
                Registration number
              </label>
              <input
                id="registration-number"
                required
                autoComplete="username"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                placeholder="e.g. 12215678"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E9E9E5] bg-[#FCFCFA] text-[16px] sm:text-sm text-[#171717] placeholder-[#888888] focus:outline-none focus:ring-2 focus:ring-[#7258E8] focus:bg-white transition-all min-h-[44px]"
              />
            </div>
          </>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="password" className="block text-xs font-semibold text-[#171717] uppercase tracking-wider">
              Password
            </label>
            <Link href="/reset-password" className="text-xs font-medium text-[#7258E8] hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
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
              <span>Signing in...</span>
            </>
          ) : (
            <span>Sign in</span>
          )}
        </button>
      </form>

      <SsoOptions redirect={redirectTarget} errorCode={searchParams.get('sso_error')} />

      <div className="mt-6 text-center text-sm text-[#686868]">
        Don&apos;t have an account?{' '}
        <Link
          href={redirectTarget ? `/sign-up?redirect=${encodeURIComponent(redirectTarget)}` : '/sign-up'}
          className="text-[#7258E8] font-medium hover:underline"
        >
          Sign up
        </Link>
      </div>
    </div>
  );
};
