'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Search } from 'lucide-react';
import { getSession } from '@/features/auth/api';
import { User } from '@/features/auth/types';
import { ApiError } from '@/lib/api/client';
import { allMeetingsCalendarUrl, MeetingItem, searchMeetings } from '@/features/rooms/meetings';

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;
const inputClass =
  'w-full px-3 py-2 rounded-xl border border-[#E9E9E5] bg-[#FCFCFA] text-[16px] sm:text-sm text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#7258E8] min-h-[44px]';
const labelClass = 'block text-xs font-semibold text-[#171717] mb-1';
const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  active: 'In progress',
  ended: 'Ended',
  cancelled: 'Cancelled',
  created: 'Created',
};
const ACCESS_LABELS: Record<string, string> = {
  host: 'You hosted',
  admin: 'Administrator',
  faculty: 'You teach',
  participant: 'You attended',
  student: 'Your class',
};

// A date input is a local calendar day, so its bounds are local midnights sent as instants.
const startOfDay = (day: string) => (day ? new Date(`${day}T00:00:00`).toISOString() : '');
const endOfDay = (day: string) => {
  if (!day) return '';
  const next = new Date(`${day}T00:00:00`);
  next.setDate(next.getDate() + 1);
  return next.toISOString();
};

export default function MeetingHistoryPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [status, setStatus] = useState('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [sort, setSort] = useState('newest');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<MeetingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSession()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setOffset(0);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async (isCurrent: () => boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await searchMeetings({ q: debouncedQuery, status, from: startOfDay(fromDay), to: endOfDay(toDay), sort, limit: PAGE_SIZE, offset });
      if (!isCurrent()) return;
      setItems(res.meetings);
      setTotal(res.total);
    } catch (err) {
      if (!isCurrent()) return;
      setItems([]);
      setTotal(0);
      setError(err instanceof ApiError ? err.message : 'Could not search your meetings. Please try again.');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [debouncedQuery, status, fromDay, toDay, sort, offset]);

  useEffect(() => {
    if (!user) return;
    let current = true;
    load(() => current);
    return () => {
      current = false;
    };
  }, [user, load]);

  const change = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setOffset(0);
  };
  const hasFilters = Boolean(debouncedQuery || status || fromDay || toDay);
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (checkingSession) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FCFCFA]">
        <Loader2 className="w-6 h-6 animate-spin text-[#7258E8]" aria-label="Loading" />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FCFCFA] px-4">
        <div className="text-center space-y-3">
          <h1 className="text-lg font-bold text-[#171717]">Authentication Required</h1>
          <p className="text-sm text-[#686868]">Sign in to see your meetings.</p>
          <Link href="/sign-in?redirect=/history" className="inline-flex items-center px-4 rounded-xl bg-[#7258E8] text-white text-sm font-semibold min-h-[44px]">
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FCFCFA] px-4 py-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-[#686868] hover:text-[#171717] min-h-[44px]">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Home
          </Link>
          <div className="flex flex-wrap gap-4">
            <a href={allMeetingsCalendarUrl()} download data-testid="calendar-all" className="text-sm font-semibold text-[#7258E8] underline inline-flex items-center min-h-[44px]">
              Export to calendar
            </a>
            <Link href="/schedule" className="text-sm font-semibold text-[#7258E8] underline inline-flex items-center min-h-[44px]">
              Schedule a meeting
            </Link>
          </div>
        </div>
        <h1 className="text-xl font-bold text-[#171717]">Meeting history</h1>

        <form role="search" onSubmit={(e) => e.preventDefault()} className="p-4 rounded-2xl border border-[#E9E9E5] bg-white space-y-3">
          <div>
            <label htmlFor="history-search" className={labelClass}>Search by title or meeting code</label>
            <div className="relative">
              <Search className="w-4 h-4 text-[#686868] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input id="history-search" type="search" maxLength={100} value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} pl-9`} />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label htmlFor="history-status" className={labelClass}>Status</label>
              <select id="history-status" value={status} onChange={(e) => change(setStatus)(e.target.value)} className={inputClass}>
                <option value="">Any</option>
                {['scheduled', 'active', 'ended', 'cancelled'].map((value) => (
                  <option key={value} value={value}>{STATUS_LABELS[value]}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="history-sort" className={labelClass}>Sort</label>
              <select id="history-sort" value={sort} onChange={(e) => change(setSort)(e.target.value)} className={inputClass}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="title">Title</option>
              </select>
            </div>
            <div>
              <label htmlFor="history-from" className={labelClass}>From</label>
              <input id="history-from" type="date" value={fromDay} max={toDay || undefined} onChange={(e) => change(setFromDay)(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="history-to" className={labelClass}>To</label>
              <input id="history-to" type="date" value={toDay} min={fromDay || undefined} onChange={(e) => change(setToDay)(e.target.value)} className={inputClass} />
            </div>
          </div>
        </form>

        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}

        <div aria-live="polite" className="text-xs text-[#686868]">
          {loading ? 'Searching…' : `${total} ${total === 1 ? 'meeting' : 'meetings'}`}
        </div>

        {!loading && !error && items.length === 0 && (
          <p className="text-sm text-[#686868] p-6 text-center rounded-2xl border border-dashed border-[#E9E9E5]">
            {hasFilters ? 'No meetings match this search. Try removing a filter.' : 'No meetings yet. Meetings you host or attend appear here.'}
          </p>
        )}

        <ul className={`space-y-2 ${loading ? 'opacity-60' : ''}`}>
          {items.map((item) => (
            <li key={item.id} data-testid="meeting-row">
              <Link href={`/history/${item.id}`} className="block p-4 rounded-2xl border border-[#E9E9E5] bg-white hover:border-[#7258E8]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#171717] break-words min-w-0">{item.title || `Meeting ${item.publicCode}`}</p>
                  <span className="text-xs text-[#404040]">{STATUS_LABELS[item.status] ?? item.status}</span>
                </div>
                <p className="text-xs text-[#686868] mt-1">
                  {new Date(item.meetingAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {item.publicCode} · {ACCESS_LABELS[item.access]}
                </p>
                <p className="text-xs text-[#686868] break-words">
                  Host: {item.hostName}
                  {item.courseTitle ? ` · ${item.courseTitle}` : ''}
                  {item.organizationName ? ` · ${item.organizationName}` : ''}
                  {item.participantCount !== null ? ` · ${item.participantCount} ${item.participantCount === 1 ? 'person' : 'people'}` : ''}
                </p>
              </Link>
            </li>
          ))}
        </ul>

        {total > PAGE_SIZE && (
          <nav aria-label="Pages" className="flex items-center justify-between gap-2">
            <button type="button" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="px-4 rounded-xl border border-[#E9E9E5] text-sm font-semibold text-[#171717] min-h-[44px] disabled:opacity-50">
              Previous
            </button>
            <span className="text-xs text-[#686868]">Page {page} of {pages}</span>
            <button type="button" disabled={page >= pages || loading} onClick={() => setOffset(offset + PAGE_SIZE)} className="px-4 rounded-xl border border-[#E9E9E5] text-sm font-semibold text-[#171717] min-h-[44px] disabled:opacity-50">
              Next
            </button>
          </nav>
        )}
      </div>
    </main>
  );
}
