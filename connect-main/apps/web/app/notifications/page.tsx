'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { getSession } from '@/features/auth/api';
import { ApiError } from '@/lib/api/client';
import {
  AppNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/features/notifications/api';

const REFRESH_MS = 15000;
const PAGE_SIZE = 30;

export default function NotificationsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await listNotifications();
      setUnread(res.unread);
      setItems((prev) => {
        const older = prev.filter((old) => !res.notifications.some((n) => n.id === old.id) && old.seq < (res.notifications.at(-1)?.seq ?? 0));
        return [...res.notifications, ...older];
      });
      setHasOlder((previous) => previous || res.notifications.length >= PAGE_SIZE);
      setError(null);
    } catch {
      setError('Could not load notifications. Trying again shortly.');
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      const user = await getSession().catch(() => null);
      if (!isMounted) return;
      if (!user) {
        router.replace('/sign-in?redirect=/notifications');
        return;
      }
      await refresh();
      if (isMounted) setLoading(false);
    }
    load();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [refresh, router]);

  const act = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That could not be completed.');
    }
  };

  const loadOlder = async () => {
    const oldest = items.at(-1)?.seq;
    if (!oldest) return;
    try {
      const res = await listNotifications(oldest);
      setItems((prev) => [...prev, ...res.notifications]);
      setHasOlder(res.notifications.length >= PAGE_SIZE);
    } catch {
      setError('Earlier notifications could not be loaded.');
    }
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
      <div className="max-w-2xl mx-auto space-y-4">
        <Link href="/institution" className="inline-flex items-center gap-1.5 text-sm text-[#686868] hover:text-[#171717] min-h-[44px]">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Institution
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-[#171717]">Notifications</h1>
            <p className="text-xs text-[#686868]">{unread} unread</p>
          </div>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => act(markAllNotificationsRead)}
              className="px-3 rounded-xl border border-[#E9E9E5] text-xs font-semibold text-[#171717] min-h-[44px]"
            >
              Mark all as read
            </button>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
        {items.length === 0 && !error && (
          <div data-testid="notifications-empty" className="neu-card p-6 text-center space-y-1">
            <p className="text-sm font-semibold text-[#171717]">You are all caught up</p>
            <p className="text-xs text-[#686868]">Class changes, reminders and attendance corrections appear here.</p>
          </div>
        )}
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              data-testid="notification"
              className={`p-4 rounded-2xl border bg-white space-y-1 ${item.readAt ? 'border-[#E9E9E5]' : 'border-[#7258E8]'}`}
            >
              <p className="text-sm font-semibold text-[#171717] break-words">{item.title}</p>
              <p className="text-sm text-[#404040] break-words">{item.body}</p>
              <p className="text-xs text-[#686868]">
                {new Date(item.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
              <div className="flex flex-wrap gap-3">
                {item.link && (
                  <Link href={item.link} className="text-xs font-semibold text-[#7258E8] underline inline-flex items-center min-h-[44px]">
                    Open
                  </Link>
                )}
                {!item.readAt && (
                  <button type="button" onClick={() => act(() => markNotificationRead(item.id))} className="text-xs font-semibold text-[#171717] underline min-h-[44px]">
                    Mark as read
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {hasOlder && (
          <button type="button" onClick={loadOlder} className="w-full rounded-xl border border-[#E9E9E5] text-sm font-semibold text-[#171717] min-h-[44px]">
            Load earlier
          </button>
        )}
      </div>
    </main>
  );
}
