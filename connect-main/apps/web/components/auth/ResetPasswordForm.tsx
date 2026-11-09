'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { KeyRound, Loader2 } from 'lucide-react';
import { forgotPassword, resetPassword } from '@/features/auth/api';
import { ApiError } from '@/lib/api/client';

const inputClass =
  'w-full px-3.5 py-2.5 rounded-xl border border-[#E9E9E5] bg-[#FCFCFA] text-[16px] sm:text-sm text-[#171717] placeholder-[#888888] focus:outline-none focus:ring-2 focus:ring-[#7258E8] focus:bg-white transition-all min-h-[44px]';
const labelClass = 'block text-xs font-semibold text-[#171717] mb-1.5 uppercase tracking-wider';

// Reset with a one-time code. Codes come from an institution administrator; outside
// production, asking here writes one to the server log for testing. Nothing is emailed yet.
export const ResetPasswordForm: React.FC = () => {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setNotice((await forgotPassword(email)).message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the reset.');
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(code, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset the password.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="neu-card w-full max-w-md p-8 text-center space-y-4" data-testid="reset-done">
        <h1 className="font-heading text-2xl font-bold text-[#171717]">Password changed</h1>
        <p className="text-sm text-[#686868]">You were signed out everywhere. Sign in with your new password.</p>
        <Link href="/sign-in" className="neu-pill inline-flex items-center justify-center px-5 min-h-[44px] text-sm font-semibold !bg-[#7444E8] !text-white">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="neu-card w-full max-w-md p-8 space-y-6">
      <div className="text-center space-y-1">
        <KeyRound className="w-8 h-8 mx-auto text-[#7444E8]" aria-hidden="true" />
        <h1 className="font-heading text-2xl font-bold tracking-tight text-[#171717]">Reset your password</h1>
        <p className="text-sm text-[#686868]">Enter the one-time code from your institution&apos;s administrator.</p>
      </div>

      {error && <p role="alert" className="p-3 rounded-xl bg-[#FFE9E9] text-[#9B2C2C] text-sm">{error}</p>}

      <form onSubmit={reset} className="space-y-4" data-testid="reset-form">
        <div>
          <label htmlFor="reset-code" className={labelClass}>Reset code</label>
          <input id="reset-code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX"
            autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} className={`${inputClass} font-mono tracking-wider`} />
        </div>
        <div>
          <label htmlFor="new-password" className={labelClass}>New password</label>
          <input id="new-password" type="password" required minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password" className={inputClass} />
        </div>
        <div>
          <label htmlFor="confirm-password" className={labelClass}>Confirm new password</label>
          <input id="confirm-password" type="password" required minLength={8} maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password" className={inputClass} />
        </div>
        <button type="submit" disabled={busy} className="w-full min-h-[44px] rounded-xl bg-[#7444E8] text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Set new password
        </button>
      </form>

      <details className="rounded-2xl border border-[#ECECE6] p-4">
        <summary className="text-sm font-semibold text-[#171717] cursor-pointer">No code yet?</summary>
        <form onSubmit={ask} className="mt-3 space-y-3">
          <p className="text-xs text-[#686868]">
            Codes are not emailed yet. Ask your institution&apos;s administrator; they can issue one from the People page.
          </p>
          <label htmlFor="reset-email" className={labelClass}>Account email</label>
          <input id="reset-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={inputClass} />
          <button type="submit" disabled={busy} className="neu-pill w-full min-h-[40px] text-sm font-semibold text-[#17171A]">Request a code</button>
          {notice && <p role="status" className="text-xs text-[#1F6B3B] bg-[#E4F8EB] rounded-xl p-2">{notice}</p>}
        </form>
      </details>

      <p className="text-center text-sm text-[#686868]">
        <Link href="/sign-in" className="text-[#7258E8] font-medium hover:underline">Back to sign in</Link>
      </p>
    </div>
  );
};
