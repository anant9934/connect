'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, UserRound } from 'lucide-react';
import { avatarSrc, changePassword, getProfile, removeAvatar, updateDisplayName, uploadAvatar } from '@/features/auth/api';
import { Profile } from '@/features/auth/types';
import { ApiError } from '@/lib/api/client';

const inputClass =
  'w-full px-3 py-2 rounded-xl border border-[#E9E9E5] bg-[#FCFCFA] text-[16px] sm:text-sm text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#7258E8] min-h-[44px]';
const labelClass = 'block text-xs font-semibold text-[#171717] mb-1';
const cardClass = 'p-4 rounded-2xl border border-[#E9E9E5] bg-white space-y-3';
const buttonClass = 'rounded-xl bg-[#7258E8] text-white text-sm font-semibold px-4 min-h-[44px] disabled:opacity-60';
const secondaryClass = 'rounded-xl border border-[#E9E9E5] text-sm font-semibold text-[#171717] px-4 min-h-[44px] inline-flex items-center disabled:opacity-60';
const MIN_PASSWORD = 8;

const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export default function ProfilePage() {
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready'>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProfile()
      .then((loaded) => {
        setProfile(loaded);
        setName(loaded.displayName);
        setState('ready');
      })
      .catch((err) => {
        if (err instanceof ApiError && err.statusCode === 401) {
          setState('signed-out');
        } else {
          setError('Could not load your profile.');
          setState('ready');
        }
      });
  }, []);

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(messageOf(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FCFCFA]">
        <Loader2 className="w-6 h-6 animate-spin text-[#7258E8]" aria-label="Loading" />
      </main>
    );
  }
  if (state === 'signed-out') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FCFCFA] px-4">
        <div className="text-center space-y-3">
          <h1 className="text-lg font-bold text-[#171717]">Authentication Required</h1>
          <Link href="/sign-in?redirect=/profile" className="inline-flex items-center px-4 rounded-xl bg-[#7258E8] text-white text-sm font-semibold min-h-[44px]">Sign in</Link>
        </div>
      </main>
    );
  }

  const picture = avatarSrc(profile?.avatarUrl);

  return (
    <main className="min-h-screen bg-[#FCFCFA] px-4 py-6">
      <div className="max-w-xl mx-auto space-y-4">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-[#686868] hover:text-[#171717] min-h-[44px]">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Home
        </Link>
        <h1 className="text-xl font-bold text-[#171717]">Your profile</h1>
        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
        {notice && <p role="status" className="text-sm text-[#171717] bg-[#F3F0FF] rounded-xl px-3 py-2">{notice}</p>}

        <section className={cardClass}>
          <h2 className="text-sm font-semibold text-[#171717]">Picture</h2>
          <div className="flex flex-wrap items-center gap-4">
            {picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img data-testid="avatar-image" src={picture} alt="Your picture" width={96} height={96} className="w-24 h-24 rounded-full object-cover border border-[#E9E9E5]" />
            ) : (
              <div data-testid="avatar-empty" className="w-24 h-24 rounded-full bg-[#F3F0FF] flex items-center justify-center text-[#7258E8]">
                <UserRound className="w-10 h-10" aria-hidden="true" />
              </div>
            )}
            <div className="space-y-2 min-w-0">
              <label className={labelClass}>
                Upload a PNG or JPEG under 900 KB
                <input
                  data-testid="avatar-file"
                  type="file"
                  accept="image/png,image/jpeg"
                  disabled={busy}
                  className="block w-full text-sm mt-1 min-h-[44px]"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) {
                      run(async () => {
                        setProfile(await uploadAvatar(file));
                        setNotice('Your picture was updated.');
                      }, 'Your picture could not be saved.');
                    }
                  }}
                />
              </label>
              {picture && (
                <button type="button" disabled={busy} className={secondaryClass} onClick={() => run(async () => {
                  setProfile(await removeAvatar());
                  setNotice('Your picture was removed.');
                }, 'Your picture could not be removed.')}>Remove picture</button>
              )}
            </div>
          </div>
        </section>

        <form className={cardClass} onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            setProfile(await updateDisplayName(name));
            setNotice('Your name was updated.');
          }, 'Your name could not be saved.');
        }}>
          <h2 className="text-sm font-semibold text-[#171717]">Name</h2>
          <div>
            <label htmlFor="profile-name" className={labelClass}>Display name</label>
            <input id="profile-name" value={name} maxLength={100} required onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <p className="text-xs text-[#686868] break-all">Signed in as {profile?.email}</p>
          <button type="submit" disabled={busy} className={buttonClass}>Save name</button>
        </form>

        <form id="change-password" className={cardClass} onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const next = String(form.get('next') ?? '');
          if (next !== String(form.get('confirm') ?? '')) {
            setError('The new passwords do not match.');
            return;
          }
          run(async () => {
            await changePassword(String(form.get('current') ?? ''), next);
            // Changing a password ends every session, this one included.
            window.location.assign('/sign-in?redirect=/profile');
          }, 'Your password could not be changed.');
        }}>
          <h2 className="text-sm font-semibold text-[#171717]">Password</h2>
          <div>
            <label htmlFor="password-current" className={labelClass}>Current password</label>
            <input id="password-current" name="current" type="password" autoComplete="current-password" className={inputClass} />
          </div>
          <div>
            <label htmlFor="password-next" className={labelClass}>New password</label>
            <input id="password-next" name="next" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} maxLength={128} required className={inputClass} />
          </div>
          <div>
            <label htmlFor="password-confirm" className={labelClass}>Confirm new password</label>
            <input id="password-confirm" name="confirm" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} maxLength={128} required className={inputClass} />
          </div>
          <p className="text-xs text-[#686868]">Changing your password signs you out everywhere.</p>
          <button type="submit" disabled={busy} className={buttonClass}>Change password</button>
        </form>
      </div>
    </main>
  );
}
