'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, Check, Copy, Loader2, Lock } from 'lucide-react';
import { getSession } from '@/features/auth/api';
import { cancelMeeting, getUpcomingMeetings, scheduleMeeting } from '@/features/rooms/api';
import { Room } from '@/features/rooms/types';
import { ApiError } from '@/lib/api/client';

const inputClass =
  'w-full px-3.5 py-2.5 rounded-xl border border-[#E9E9E5] bg-[#FCFCFA] text-[16px] sm:text-sm text-[#171717] placeholder-[#888888] focus:outline-none focus:ring-2 focus:ring-[#7258E8] min-h-[44px]';
const labelClass = 'block text-xs font-semibold text-[#171717] mb-1 uppercase tracking-wider';

function formatMeetingTime(room: Room): string {
  if (!room.scheduledStart) return 'Time not set';
  return new Date(room.scheduledStart).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function SchedulePage() {
  const router = useRouter();
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const [loading, setLoading] = useState(true);
  const [upcoming, setUpcoming] = useState<Room[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [passcode, setPasscode] = useState('');
  const [waitingRoom, setWaitingRoom] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [cancellingCode, setCancellingCode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUpcoming(await getUpcomingMeetings());
      setLoadError(null);
    } catch {
      setLoadError('Could not load your upcoming meetings.');
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      const user = await getSession().catch(() => null);
      if (!isMounted) return;
      if (!user) {
        router.replace('/sign-in?redirect=/schedule');
        return;
      }
      await refresh();
      if (isMounted) setLoading(false);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [refresh, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await scheduleMeeting({
        title: title.trim(),
        scheduledStart: new Date(start).toISOString(),
        scheduledEnd: new Date(end).toISOString(),
        timeZone,
        passcode: passcode.trim() || undefined,
        waitingRoomEnabled: waitingRoom,
      });
      setTitle('');
      setStart('');
      setEnd('');
      setPasscode('');
      setWaitingRoom(false);
      await refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not schedule the meeting.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (code: string) => {
    if (!window.confirm('Cancel this meeting? Its link will stop working.')) return;
    setCancellingCode(code);
    try {
      await cancelMeeting(code);
      await refresh();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not cancel the meeting.');
    } finally {
      setCancellingCode(null);
    }
  };

  const handleCopy = async (code: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/room/${code}/preview`);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FCFCFA]">
        <Loader2 className="w-6 h-6 animate-spin text-[#7258E8]" aria-label="Loading" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FCFCFA] px-4 py-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <Link href="/history" className="inline-flex items-center gap-1.5 text-sm text-[#686868] hover:text-[#171717] min-h-[44px]">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Meeting history
        </Link>
        <h1 className="text-xl font-bold text-[#171717]">Schedule a meeting</h1>

        <form onSubmit={handleSubmit} className="space-y-4 p-5 rounded-2xl border border-[#E9E9E5] bg-white">
          <div>
            <label htmlFor="title" className={labelClass}>Title</label>
            <input id="title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="start" className={labelClass}>Starts</label>
              <input id="start" type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="end" className={labelClass}>Ends</label>
              <input id="end" type="datetime-local" required min={start} value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
            </div>
          </div>
          <p className="text-xs text-[#686868]">Times are in your time zone: {timeZone}</p>
          <div>
            <label htmlFor="passcode" className={labelClass}>Passcode (optional)</label>
            <input id="passcode" type="text" autoComplete="off" minLength={4} maxLength={32} value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="4 to 32 characters" className={inputClass} />
          </div>
          <label className="flex items-center gap-2 text-sm text-[#171717] min-h-[44px]">
            <input type="checkbox" checked={waitingRoom} onChange={(e) => setWaitingRoom(e.target.checked)} />
            Admit people from a waiting room
          </label>
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
          <button type="submit" disabled={submitting} className="w-full rounded-xl bg-[#7258E8] text-white text-sm font-semibold py-2.5 min-h-[44px] disabled:opacity-60">
            {submitting ? 'Scheduling…' : 'Schedule meeting'}
          </button>
        </form>

        <section aria-labelledby="upcoming-heading" className="space-y-3">
          <h2 id="upcoming-heading" className="text-base font-semibold text-[#171717]">Upcoming</h2>
          {loadError && <p role="alert" className="text-sm text-red-600">{loadError}</p>}
          {!loadError && upcoming.length === 0 && (
            <p className="text-sm text-[#686868]">Nothing scheduled yet. Meetings you schedule appear here.</p>
          )}
          <ul className="space-y-3">
            {upcoming.map((room) => (
              <li key={room.id} className="p-4 rounded-2xl border border-[#E9E9E5] bg-white space-y-3">
                <div>
                  <p className="text-sm font-semibold text-[#171717] flex items-center gap-1.5">
                    {room.title}
                    {room.hasPasscode && <Lock className="w-3.5 h-3.5 text-[#686868]" aria-label="Passcode protected" />}
                  </p>
                  <p className="text-xs text-[#686868] flex items-center gap-1.5 mt-1">
                    <Calendar className="w-3.5 h-3.5" aria-hidden="true" /> {formatMeetingTime(room)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/room/${room.publicCode}/preview`} className="px-3 py-2 rounded-xl bg-[#7258E8] text-white text-xs font-semibold min-h-[44px] inline-flex items-center">Start</Link>
                  <button type="button" onClick={() => handleCopy(room.publicCode)} className="px-3 py-2 rounded-xl border border-[#E9E9E5] text-xs font-semibold text-[#171717] min-h-[44px] inline-flex items-center gap-1.5">
                    {copiedCode === room.publicCode ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                    {copiedCode === room.publicCode ? 'Copied' : 'Copy link'}
                  </button>
                  <button type="button" disabled={cancellingCode === room.publicCode} onClick={() => handleCancel(room.publicCode)} className="px-3 py-2 rounded-xl border border-[#E9E9E5] text-xs font-semibold text-red-600 min-h-[44px] disabled:opacity-60">
                    Cancel meeting
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
